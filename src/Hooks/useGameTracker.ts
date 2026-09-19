import { useCallback, useEffect, useRef, useState } from 'react';
import type { Player } from '../Types/Player';
import { liveNodeSchema, type SeatState } from '../Types/Tracking';
import { diffSeats, toSeatStates } from '../Utils/tracking/snapshot';
import { createThrottle, type Throttle } from '../Utils/tracking/throttle';
import { getTrackDatabase } from '../Utils/tracking/trackDb';

export const THROTTLE_MS = 3000;
export const EXP_LIVE_MS = 6 * 60 * 60 * 1000;
export const EXP_ENDED_MS = 30 * 60 * 1000;

const SESSION_KEY = 'trackedGameSession';
const T0_KEY = 'trackedGameT0';

export type TrackerStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'offline'
  | 'error'
  | 'taken';

type Writer = {
  update: (values: Record<string, unknown>) => Promise<void>;
  set: (value: unknown) => Promise<void>;
  serverNow: () => number;
  /** Stamp the node offline if this socket dies. A fired one is consumed. */
  armDisconnect: () => void;
  /**
   * Disarm it. An armed registration belongs to a game this writer still
   * owns and still believes is live. Once that stops being true it would
   * stamp `offline` over someone else's node, or over a finished game.
   */
  cancelDisconnect: () => void;
};

/**
 * Reads the persisted start time, but only when it belongs to this game.
 * Spec 8.9 persists the game id alongside t0: without that check a second
 * tracked game on the same device would inherit the first game's start.
 */
function readSavedT0(gameId: string | null): number {
  if (!gameId) {
    return 0;
  }
  const saved = localStorage.getItem(T0_KEY);
  if (!saved) {
    return 0;
  }
  const separator = saved.indexOf('|');
  if (saved.slice(0, separator) !== gameId) {
    return 0;
  }
  return Number(saved.slice(separator + 1)) || 0;
}

export function useGameTracker({
  gameId,
  players,
  winner,
}: {
  gameId: string | null;
  players: Player[];
  winner: number | null;
}): {
  status: TrackerStatus;
  lastSentAt: number | null;
  forceUpdate: () => void;
} {
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  // Bumped by forceUpdate to re-run the connection effect after a failed
  // connect. It is the only way back from a writer that never existed.
  const [attempt, setAttempt] = useState(0);

  const writerRef = useRef<Writer | null>(null);
  const throttleRef = useRef<Throttle | null>(null);
  const sentRef = useRef<SeatState[] | null>(null);
  const playersRef = useRef<Player[]>(players);
  // The winner is read by callbacks that outlive the render that made them:
  // the reconnect handler and the diff fallback. Both must see the current
  // winner, or they will publish a finished game as live.
  const winnerRef = useRef<number | null>(winner);
  const connectedRef = useRef(false);
  const stoppedRef = useRef(false);
  // Spec 8.9: t0 and wr must survive a reload, because every reconnect sends
  // a full snapshot and that snapshot must carry the original start time.
  const sessionRef = useRef<string>('');
  const t0Ref = useRef<number>(0);
  const t0GameIdRef = useRef<string | null>(null);

  if (sessionRef.current === '') {
    const saved = localStorage.getItem(SESSION_KEY);
    sessionRef.current = saved ?? Math.random().toString(36).slice(2, 10);
    localStorage.setItem(SESSION_KEY, sessionRef.current);
  }

  if (t0GameIdRef.current !== gameId) {
    t0GameIdRef.current = gameId;
    t0Ref.current = readSavedT0(gameId);
  }

  playersRef.current = players;
  winnerRef.current = winner;

  // The end of the ladder. Every failure lands here: stop writing, say so
  // once, and stay silent. Never a retry loop against a rejecting rule.
  const stopTracking = useCallback((error: unknown) => {
    console.warn('Live tracking stopped:', error);
    stoppedRef.current = true;
    setStatus('error');
  }, []);

  // The full snapshot repairs a missing or drifted node. It is the first
  // step of the recovery ladder, and it runs on every reconnect.
  const sendFull = useCallback(
    async (state: 'live' | 'ended', w: number | null) => {
      const writer = writerRef.current;
      if (!writer || stoppedRef.current) {
        return;
      }
      // The try opens here, not at the write. Building the snapshot touches
      // localStorage and the player array, and every caller voids this
      // promise, so a throw above the write would escape as an unhandled
      // rejection behind a status still claiming to be live.
      try {
        const seats = toSeatStates(playersRef.current);
        const nowMs = writer.serverNow();
        const node: Record<string, unknown> = {
          v: 1,
          st: state,
          t0: t0Ref.current || nowMs,
          exp: nowMs + (state === 'ended' ? EXP_ENDED_MS : EXP_LIVE_MS),
          up: nowMs,
          wr: sessionRef.current,
          p: seats,
        };
        if (w !== null) {
          node.w = w;
        }
        t0Ref.current = node.t0 as number;
        localStorage.setItem(T0_KEY, `${t0GameIdRef.current}|${t0Ref.current}`);

        await writer.set(node);
        sentRef.current = seats;
        setLastSentAt(Date.now());
        setStatus('live');

        // An ended game must not be flipped back to offline by a tab close,
        // and an undone ending must get its registration back.
        if (state === 'ended') {
          writer.cancelDisconnect();
        } else {
          writer.armDisconnect();
        }
      } catch (error) {
        stopTracking(error);
      }
    },
    [stopTracking]
  );

  // Step one of the ladder on failure, then stop. A retry loop against a
  // rejecting rule burns bandwidth and fixes nothing.
  const sendDiff = useCallback(async () => {
    const writer = writerRef.current;
    if (!writer || stoppedRef.current || !connectedRef.current) {
      return;
    }
    // As in sendFull: the preparation is inside the try, because a throw
    // from it would otherwise escape this voided promise.
    try {
      const seats = toSeatStates(playersRef.current);
      // A null here deletes that path, which is how a counter that has been
      // switched off stops showing a stale value on the board.
      const changes = diffSeats(sentRef.current, seats);
      if (Object.keys(changes).length === 0) {
        return;
      }
      const nowMs = writer.serverNow();
      // A finished game keeps the short expiry. Players still change after a
      // win, because hasLost is a toggle, and a live-length expiry here would
      // hold a finished game in the live tree twelve times too long.
      const ttl = winnerRef.current === null ? EXP_LIVE_MS : EXP_ENDED_MS;

      try {
        await writer.update({ ...changes, up: nowMs, exp: nowMs + ttl });
        sentRef.current = seats;
        setLastSentAt(Date.now());
      } catch {
        // Step one of the ladder. It must carry the current winner: a game
        // that has already ended would otherwise be republished as live with
        // no winner, and nothing later would repair it. sendFull never
        // rejects, so this inner catch cannot throw on into the outer one.
        await sendFull(
          winnerRef.current === null ? 'live' : 'ended',
          winnerRef.current
        );
      }
    } catch (error) {
      stopTracking(error);
    }
  }, [sendFull, stopTracking]);

  const forceUpdate = useCallback(() => {
    stoppedRef.current = false;
    if (writerRef.current) {
      void sendFull(winner === null ? 'live' : 'ended', winner);
      return;
    }
    // No writer means the connection never came up: a failed import, a
    // missing configuration, a rejected handle. Clearing the stopped flag
    // alone would leave the button doing nothing in exactly the case a user
    // reaches for it, so ask the connection effect to run again.
    setAttempt((count) => count + 1);
  }, [sendFull, winner]);

  // Connect once per game id.
  useEffect(() => {
    if (!gameId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    stoppedRef.current = false;
    sentRef.current = null;

    const cleanups: Array<() => void> = [];

    // Every surprise inside this body ends as 'error' and silence. Nothing
    // here may reject into the page: tracking must not degrade the counter.
    void (async () => {
      try {
        const db = await getTrackDatabase();
        if (!db || cancelled) {
          if (!cancelled) setStatus('error');
          return;
        }

        const { ref, onValue, onDisconnect, update, set } =
          await import('firebase/database');
        if (cancelled) return;

        let offset = 0;
        const node = ref(db, `live/${gameId}`);
        const serverNow = () => Date.now() + offset;

        // Both registrations are best effort and must stay silent: a
        // rejection here may not reach the page.
        const armDisconnect = () => {
          onDisconnect(node)
            .update({ st: 'offline', off: serverNow() })
            .catch(() => undefined);
        };
        const cancelDisconnect = () => {
          onDisconnect(node)
            .cancel()
            .catch(() => undefined);
        };

        writerRef.current = {
          update: (values) => update(node, values),
          set: (value) => set(node, value),
          serverNow,
          armDisconnect,
          cancelDisconnect,
        };

        throttleRef.current = createThrottle(
          THROTTLE_MS,
          () => void sendDiff()
        );

        cleanups.push(
          onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
            offset = (snap.val() as number | null) ?? 0;
          })
        );

        cleanups.push(
          onValue(ref(db, '.info/connected'), (snap) => {
            const connected = snap.val() === true;
            connectedRef.current = connected;

            if (!connected) {
              setStatus('offline');
              return;
            }

            // A fired onDisconnect is consumed, so it must be set again --
            // but only while this writer still owns a node it believes is
            // live. A stopped writer that reconnects (backgrounding, a
            // network switch) would otherwise re-arm on the node it no
            // longer owns, and stamp the new writer's live game offline on
            // tab close. Not for a finished game either: sendFull would
            // cancel it a round trip later, and a socket dying inside that
            // window would stamp a finished game offline.
            if (!stoppedRef.current && winnerRef.current === null) {
              armDisconnect();
            }

            void sendFull(
              winnerRef.current === null ? 'live' : 'ended',
              winnerRef.current
            );
          })
        );

        // The two-writer guard. Another device taking over stops this one.
        // A node that does not parse is not a takeover, so it changes nothing.
        // stoppedRef makes this edge-triggered: this listener sees every one
        // of the new writer's updates, and without it each would repeat the
        // status set and fire another cancel round trip, indefinitely.
        cleanups.push(
          onValue(node, (snap) => {
            if (stoppedRef.current) {
              return;
            }
            const parsed = liveNodeSchema.safeParse(snap.val());
            if (parsed.success && parsed.data.wr !== sessionRef.current) {
              stoppedRef.current = true;
              setStatus('taken');
              // The node is theirs now. A registration left armed here would
              // stamp their live game offline when this tab closes, and their
              // diff writes never touch st, so it would stay that way.
              cancelDisconnect();
            }
          })
        );
      } catch (error) {
        console.warn('Live tracking is unavailable:', error);
        stoppedRef.current = true;
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      throttleRef.current?.cancel();
      // Every SDK call below is wrapped on its own. A throw in a cleanup
      // propagates into React's unmount, which is the one thing tracking may
      // never do to the counter, and a shared try would let the first
      // failure strand the listeners after it.
      const quietly = (step: () => void) => {
        try {
          step();
        } catch (error) {
          console.warn('Live tracking cleanup failed:', error);
        }
      };

      // Spec 8.8: leaving a tracked game must not leave it reading live for
      // the whole six hours of its expiry. React never runs a cleanup on a
      // tab close, so reaching here means the game id changed or this view
      // unmounted -- the user left this game, either way. A tab close stays
      // covered by the onDisconnect that is still armed at that moment.
      //
      // Only a writer that still owns a node may write it. A stopped one has
      // been taken over or has been failing, and a null w deletes the child,
      // which is how an ending with no winner clears a stale one.
      //
      // It goes before the disarming: if the socket dies between the two,
      // an armed registration still stamps the node offline, where a
      // disarmed one would leave it reading live.
      quietly(() => {
        const writer = writerRef.current;
        if (!writer || stoppedRef.current) {
          return;
        }
        void writer
          .update({
            st: 'ended',
            w: winnerRef.current,
            exp: writer.serverNow() + EXP_ENDED_MS,
          })
          .catch(() => undefined);
      });

      // This tab is done with the node, so it must not stamp it offline when
      // the socket eventually closes.
      quietly(() => writerRef.current?.cancelDisconnect());
      cleanups.forEach((off) => quietly(off));
      writerRef.current = null;
      throttleRef.current = null;
    };
    // sendFull and sendDiff are stable enough here. The hook reconnects only
    // when the game id changes, or when forceUpdate asks for another attempt.
    // The winner is read through winnerRef, so it is never stale despite not
    // being a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, attempt]);

  // Ask for a write whenever the players change.
  useEffect(() => {
    if (!gameId || stoppedRef.current) {
      return;
    }
    throttleRef.current?.request();
  }, [gameId, players]);

  // The end of a game, and the undo of an end.
  useEffect(() => {
    if (!gameId || stoppedRef.current || !writerRef.current) {
      return;
    }
    void sendFull(winner === null ? 'live' : 'ended', winner);
  }, [gameId, winner, sendFull]);

  // A backgrounded mobile tab drops its socket, so returning must clear it.
  useEffect(() => {
    if (!gameId) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) {
        void sendFull(winner === null ? 'live' : 'ended', winner);
      }
    };
    const onHide = () => throttleRef.current?.flush();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
    };
  }, [gameId, sendFull, winner]);

  return { status, lastSentAt, forceUpdate };
}
