import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThrottle } from './throttle';

// The clock is injected, so the throttle never reads Date.now directly.
let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

describe('createThrottle', () => {
  it('runs the first request at once', () => {
    const run = vi.fn();
    createThrottle(3000, run, now).request();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('delays a second request to the end of the window', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(1000);
    throttle.request();
    expect(run).toHaveBeenCalledTimes(1);

    advance(2000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('collapses a burst into one trailing run', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(200); throttle.request();
    advance(200); throttle.request();
    advance(200); throttle.request();
    expect(run).toHaveBeenCalledTimes(1);

    advance(3000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs again at once after the window passed with no request', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(5000);
    throttle.request();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flush runs at once and clears the pending run', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(500);
    throttle.request();
    expect(throttle.pending).toBe(true);

    throttle.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(throttle.pending).toBe(false);

    advance(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel prevents the trailing run', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(500);
    throttle.request();
    throttle.cancel();

    advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(throttle.pending).toBe(false);
  });
});
