import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import type { Database } from 'firebase/database';

const TRACK_APP_NAME = 'track';

const config = {
  apiKey: import.meta.env.VITE_TRACK_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_TRACK_PROJECT_ID as string | undefined,
  databaseURL: import.meta.env.VITE_TRACK_DATABASE_URL as string | undefined,
};

export function isTrackingConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.databaseURL);
}

let cached: Promise<Database | null> | null = null;

function trackApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === TRACK_APP_NAME);
  return existing ?? initializeApp(config, TRACK_APP_NAME);
}

/**
 * Loads firebase/database on demand. It adds about 40 KB gzipped, and most
 * users never track a game, so it must stay out of the main bundle.
 *
 * Returns null instead of throwing. Tracking must never stop the counter.
 */
export function getTrackDatabase(): Promise<Database | null> {
  if (!isTrackingConfigured()) {
    return Promise.resolve(null);
  }

  if (!cached) {
    cached = import('firebase/database')
      .then(({ getDatabase }) => getDatabase(trackApp()))
      .catch((error) => {
        console.warn('Live tracking is unavailable:', error);
        return null;
      });
  }

  return cached;
}

export const trackAppName = TRACK_APP_NAME;
