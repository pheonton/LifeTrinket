import { useEffect, useState } from 'react';
import { roundNodeSchema } from '../Types/Tracking';
import { getTrackDatabase } from '../Utils/tracking/trackDb';

/**
 * When the tournament's round ends, read from `/rounds/$roundId`.
 *
 * Spec 19. EventTrinket owns the clock and writes one node per session; this
 * is the only place LifeTrinket reads it. The direction is reversed from
 * every other part of tracking: this hook never writes.
 *
 * The governing constraint, above everything else: tracking must never
 * degrade the life counter. Nothing here throws into React and nothing here
 * blocks a tap. Every one of these ends at `endAt: null` and silence, which
 * leaves the caller with its own local timer (spec 19.6):
 *
 * - no `roundId`, because the link carried no `r`
 * - tracking is not configured, so there is no database to ask
 * - the node does not exist yet, because the organizer has not started the
 *   clock. This is the common case, not an error
 * - the node does not parse against `roundNodeSchema`
 * - the read is denied by the rules
 * - the database handle fails to load
 *
 * Null means "no readout". It never means zero and it never means a guess.
 *
 * The subscription costs no extra connection: `getTrackDatabase` is a lazy
 * singleton, so this listener multiplexes onto the socket `useGameTracker`
 * already holds.
 */
export function useRoundEnd(roundId: string | null | undefined): {
  /**
   * The instant the round ends, in *this device's* clock, or null.
   *
   * The node's `end` is server time. It is carried across by the offset from
   * `.info/serverTimeOffset`, so both things a caller does with this value
   * stay right on a device whose clock is wrong: `Date.now() >= endAt` is the
   * server's idea of expiry, and `new Date(endAt)` formats to the time this
   * device's own clock will read at that moment.
   */
  endAt: number | null;
} {
  const [endAt, setEndAt] = useState<number | null>(null);

  useEffect(() => {
    if (!roundId) {
      setEndAt(null);
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    // The two halves arrive on their own listeners and in either order, so
    // each keeps its own value and the published result is recomputed from
    // both. An end held without an offset yet is still shown: the offset is
    // a correction of seconds, and waiting for it would blank the readout on
    // every load.
    let end: number | null = null;
    let offset = 0;
    const publish = () => {
      if (!cancelled) {
        setEndAt(end === null ? null : end - offset);
      }
    };

    // Every surprise inside this body ends as no readout and silence.
    // Nothing here may reject into the page.
    void (async () => {
      try {
        const db = await getTrackDatabase();
        if (!db || cancelled) {
          return;
        }

        const { ref, onValue } = await import('firebase/database');
        if (cancelled) {
          return;
        }

        cleanups.push(
          onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
            offset = (snap.val() as number | null) ?? 0;
            publish();
          })
        );

        cleanups.push(
          onValue(
            ref(db, `rounds/${roundId}`),
            (snap) => {
              // A missing node and a malformed one are the same answer: the
              // clock has not started, or what is there cannot be trusted.
              const parsed = roundNodeSchema.safeParse(snap.val());
              end = parsed.success ? parsed.data.end : null;
              publish();
            },
            // A denied read, and any other listener error. Spec 19.6: no
            // readout, and no retry. A retry loop against a rejecting rule
            // burns bandwidth and fixes nothing.
            (error) => {
              console.warn('Round end is unavailable:', error);
              end = null;
              publish();
            }
          )
        );
      } catch (error) {
        console.warn('Round end is unavailable:', error);
      }
    })();

    return () => {
      cancelled = true;
      // Each unsubscribe is wrapped on its own, for the reason given in
      // `useGameTracker`'s cleanup: a throw in a cleanup propagates into
      // React's unmount, which is the one thing tracking may never do to the
      // counter, and a shared try would let the first failure strand the
      // listeners after it.
      cleanups.forEach((off) => {
        try {
          off();
        } catch (error) {
          console.warn('Round end cleanup failed:', error);
        }
      });
    };
  }, [roundId]);

  return { endAt };
}
