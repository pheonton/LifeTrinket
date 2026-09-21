export type Throttle = {
  /** Ask for a run. The first call runs at once. A later call inside the window waits. */
  request(): void;
  /** Run now, and clear any pending run. Used on pagehide and by the force button. */
  flush(): void;
  /** Drop any pending run. */
  cancel(): void;
  readonly pending: boolean;
};

/**
 * A trailing-edge throttle. A debounce delays every change by the full
 * window, and that makes the organizer board feel dead. This runs the
 * first change at once and caps the rate afterwards.
 */
export function createThrottle(
  windowMs: number,
  run: () => void,
  now: () => number = Date.now
): Throttle {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    timer = null;
    lastRunAt = now();
    run();
  };

  return {
    request() {
      if (timer !== null) {
        return;
      }
      const waited = now() - lastRunAt;
      if (waited >= windowMs) {
        fire();
        return;
      }
      timer = setTimeout(fire, windowMs - waited);
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      fire();
    },

    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },

    get pending() {
      return timer !== null;
    },
  };
}
