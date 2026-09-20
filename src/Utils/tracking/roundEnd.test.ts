import { describe, expect, it } from 'vitest';
import { planRoundEndReadout } from './roundEnd';

// A fixed instant, formatted in a fixed zone, so the assertions do not move
// with the machine running them. 2026-09-20T14:20:00Z.
const END = Date.UTC(2026, 8, 20, 14, 20, 0);
const MINUTE = 60_000;

const readout = (endAt: number | null, now: number) =>
  planRoundEndReadout(endAt, now, 'en-GB', 'UTC');

describe('planRoundEndReadout', () => {
  it('shows the wall-clock end time while the round is still running', () => {
    expect(readout(END, END - 10 * MINUTE)).toEqual({
      label: '14:20',
      isExpired: false,
    });
  });

  it('reports an end that has already passed as expired', () => {
    expect(readout(END, END + MINUTE)).toEqual({
      label: '14:20',
      isExpired: true,
    });
  });

  it('treats the end instant itself as expired', () => {
    expect(readout(END, END)?.isExpired).toBe(true);
  });

  it('has no readout at all without an end', () => {
    expect(readout(null, END)).toBeNull();
  });

  it('has no readout for an end that is not a real instant', () => {
    expect(readout(Number.NaN, END)).toBeNull();
    expect(readout(Number.POSITIVE_INFINITY, END)).toBeNull();
  });

  it('has no readout rather than a broken one when formatting fails', () => {
    expect(planRoundEndReadout(END, END - MINUTE, 'en-GB', 'Not/AZone')).toBe(
      null
    );
  });

  it('formats in the viewer locale when none is given', () => {
    // No locale and no zone is the real call. It must still produce a label,
    // whatever this machine's locale turns it into.
    expect(planRoundEndReadout(END, END - MINUTE)?.label).toBeTruthy();
  });
});
