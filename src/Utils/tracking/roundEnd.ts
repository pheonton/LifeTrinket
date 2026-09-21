/**
 * What the timer shows for a tracked round: time left, counted down to the
 * instant the organizer published.
 *
 * Spec 19.5. The point is not the shape of the readout but its origin. Every
 * table subtracts from the same absolute end, so every table reaches zero
 * together however long ago each game began. A local countdown cannot do
 * that: it starts when its own game starts.
 *
 * The cost of a countdown is that an absolute instant cannot express a
 * pause. A judge stopping the clock does not reach the phones, and they keep
 * counting. The tables stay agreed with each other, and all of them drift
 * from the organizer together.
 *
 * Pure, and separate from the subscription, so the decision of what to show
 * can be tested without a Firebase SDK anywhere near it.
 */

export type RoundEndReadout = {
  /** Time left, as `mm:ss`, or `hh:mm:ss` past an hour. */
  label: string;
  /** True once the end has passed. The overlay fires on this. */
  isExpired: boolean;
};

/**
 * A duration as clock digits. Never negative: a round that is over reads
 * `00:00` rather than counting up into nonsense.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * The whole readout, or null for no readout at all.
 *
 * Null is never a zero and never a guess: it is "this device has nothing to
 * say about when the round ends", and the caller falls back to its own timer.
 */
export function planRoundEndReadout(
  endAt: number | null,
  now: number
): RoundEndReadout | null {
  if (endAt === null || !Number.isFinite(endAt)) {
    return null;
  }

  return { label: formatDuration(endAt - now), isExpired: now >= endAt };
}
