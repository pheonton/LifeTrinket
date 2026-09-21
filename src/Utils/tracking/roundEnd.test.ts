import { describe, expect, it } from 'vitest';
import { formatDuration, planRoundEndReadout } from './roundEnd';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const END = 1_700_000_000_000;

describe('formatDuration', () => {
  it('reads as minutes and seconds under an hour', () => {
    expect(formatDuration(49 * MINUTE + 32 * SECOND)).toBe('49:32');
  });

  it('pads both fields', () => {
    expect(formatDuration(5 * MINUTE + 3 * SECOND)).toBe('05:03');
  });

  it('adds an hours field only when there are hours', () => {
    expect(formatDuration(2 * HOUR + 5 * MINUTE)).toBe('02:05:00');
  });

  // A round that has ended must read 00:00 rather than counting up. The
  // overlay owns what happens next; this is only what the digits say while
  // it is being dismissed.
  it('never goes negative', () => {
    expect(formatDuration(-1)).toBe('00:00');
    expect(formatDuration(-5 * MINUTE)).toBe('00:00');
  });
});

describe('planRoundEndReadout', () => {
  it('counts down the time that is left', () => {
    expect(planRoundEndReadout(END, END - (12 * MINUTE + 5 * SECOND))).toEqual({
      label: '12:05',
      isExpired: false,
    });
  });

  // Two devices whose games began an hour apart read the same number,
  // because both subtract from the same published instant. That is the whole
  // feature, and it is the one thing a local countdown cannot do.
  it('agrees between devices, because both subtract from the same end', () => {
    const a = planRoundEndReadout(END, END - 10 * MINUTE);
    const b = planRoundEndReadout(END, END - 10 * MINUTE);
    expect(a?.label).toBe(b?.label);
  });

  it('is expired at the end instant, not a second after it', () => {
    expect(planRoundEndReadout(END, END)?.isExpired).toBe(true);
    expect(planRoundEndReadout(END, END - 1)?.isExpired).toBe(false);
  });

  it('reads 00:00 once the round is over', () => {
    expect(planRoundEndReadout(END, END + MINUTE)).toEqual({
      label: '00:00',
      isExpired: true,
    });
  });

  it('has nothing to say without an end', () => {
    expect(planRoundEndReadout(null, END)).toBeNull();
  });

  it('has nothing to say about an end that is not a number', () => {
    expect(planRoundEndReadout(Number.NaN, END)).toBeNull();
  });
});
