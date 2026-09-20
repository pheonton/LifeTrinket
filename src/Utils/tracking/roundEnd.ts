/**
 * What the timer shows for a tracked round: a wall-clock end time instead of
 * a countdown.
 *
 * Spec 19.5. An absolute instant cannot express a pause, so a counter that
 * keeps running through a judge call tells every table a lie. A displayed end
 * time is either right or visibly stale, which is the honest failure.
 *
 * Pure, and separate from the subscription, so the decision of what to show
 * can be tested without a Firebase SDK anywhere near it.
 */

export type RoundEndReadout = {
  /** The wall-clock time the round ends, formatted for the viewer. */
  label: string;
  /** True once that instant has passed. The overlay fires on this. */
  isExpired: boolean;
};

const HOUR_AND_MINUTE: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * The whole readout, or null for no readout at all.
 *
 * Null is never a zero and never a guess: it is "this device has nothing to
 * say about when the round ends", and the caller falls back to its own timer.
 *
 * `locales` and `timeZone` exist for the tests. The real call passes neither,
 * which formats in the viewer's own locale and zone.
 */
export function planRoundEndReadout(
  endAt: number | null,
  now: number,
  locales?: Intl.LocalesArgument,
  timeZone?: string
): RoundEndReadout | null {
  if (endAt === null || !Number.isFinite(endAt)) {
    return null;
  }

  let label: string;
  try {
    label = new Intl.DateTimeFormat(locales, {
      ...HOUR_AND_MINUTE,
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(endAt));
  } catch {
    // A locale or zone this engine rejects. No readout beats a broken one,
    // and this must not throw into a render.
    return null;
  }

  return { label, isExpired: now >= endAt };
}
