/**
 * Analytics hook.
 *
 * This fork ships with no third-party analytics provider. `trackEvent` keeps the
 * same call signature used throughout the app so call sites don't need to change:
 * in development it logs events to the console, and in production it is a no-op.
 *
 * To wire up a provider, implement the body of `trackEvent` below.
 */
export const useAnalytics = () => {
  const trackEvent = (
    eventName: string,
    eventParams?: { [key: string]: unknown }
  ) => {
    if (process.env.NODE_ENV === 'development') {
      console.info('Event (not sent anywhere):', { eventName, eventParams });
      return;
    }

    // No analytics provider configured. Intentionally does nothing.
  };

  return { trackEvent };
};
