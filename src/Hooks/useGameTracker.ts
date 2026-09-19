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

  const writerRef = useRef<Writer | null>(null);
  const throttleRef = useRef<Throttle | null>(null);
  const sentRef = useRef<SeatState[] | null>(null);
  const playersRef = useRef<Player[]>(players);
  const connectedRef = useRef(false);
  const dirtyRef = useRef(false);
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

  // The full snapshot repairs a missing or drifted node. It is the first
  // step of the recovery ladder, and it runs on every reconnect.
  const sendFull = useCallback(
    async (state: 'live' | 'ended', w: number | null) => {
      const writer = writerRef.current;
      if (!writer || stoppedRef.current) {
        return;
      }
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

      try {
        await writer.set(node);
        sentRef.current = seats;
        setLastSentAt(Date.now());
        setStatus('live');
      } catch (error) {
        console.warn('Live tracking stopped:', error);
        stoppedRef.current = true;
        setStatus('error');
      }
    },
    []
  );

  // Step one of the ladder on failure, then stop. A retry loop against a
  // rejecting rule burns bandwidth and fixes nothing.
  const sendDiff = useCallback(async () => {
    const writer = writerRef.current;
    if (!writer || stoppedRef.current || !connectedRef.current) {
      dirtyRef.current = true;
      return;
    }
    const seats = toSeatStates(playersRef.current);
    // A null here deletes that path, which is how a counter that has been
    // switched off stops showing a stale value on the board.
    const changes = diffSeats(sentRef.current, seats);
    if (Object.keys(changes).length === 0) {
      return;
    }
    const nowMs = writer.serverNow();
    try {
      await writer.update({ ...changes, up: nowMs, exp: nowMs + EXP_LIVE_MS });
      sentRef.current = seats;
      setLastSentAt(Date.now());
    } catch {
      await sendFull('live', null);
    }
  }, [sendFull]);

  const forceUpdate = useCallback(() => {
    stoppedRef.current = false;
    void sendFull(winner === null ? 'live' : 'ended', winner);
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

        writerRef.current = {
          update: (values) => update(node, values),
          set: (value) => set(node, value),
          serverNow,
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
              dirtyRef.current = true;
              return;
            }

            // A fired onDisconnect is consumed, so it must be set again.
            // A rejected registration must stay silent, never an unhandled
            // rejection: tracking may not degrade the counter.
            onDisconnect(node)
              .update({
                st: 'offline',
                off: serverNow(),
              })
              .catch(() => undefined);

            dirtyRef.current = false;
            void sendFull(winner === null ? 'live' : 'ended', winner);
          })
        );

        // The two-writer guard. Another device taking over stops this one.
        // A node that does not parse is not a takeover, so it changes nothing.
        cleanups.push(
          onValue(node, (snap) => {
            const parsed = liveNodeSchema.safeParse(snap.val());
            if (parsed.success && parsed.data.wr !== sessionRef.current) {
              stoppedRef.current = true;
              setStatus('taken');
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
      cleanups.forEach((off) => off());
      writerRef.current = null;
      throttleRef.current = null;
    };
    // sendFull, sendDiff and winner are stable enough here. The hook
    // reconnects only when the game id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

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
