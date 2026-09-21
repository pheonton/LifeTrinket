import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `trackDb` reads `import.meta.env` once, at module load, so every case here
 * stubs the environment and then re-imports the module.
 */
const loadTrackDb = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import('./trackDb');
};

const FULL = {
  VITE_TRACK_API_KEY: 'a-real-looking-key',
  VITE_TRACK_PROJECT_ID: 'draft-trinket',
  VITE_TRACK_DATABASE_URL: 'https://example.firebasedatabase.app',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('isTrackingConfigured', () => {
  it('is true only when every value is present', async () => {
    const { isTrackingConfigured } = await loadTrackDb(FULL);
    expect(isTrackingConfigured()).toBe(true);
  });

  it.each(['VITE_TRACK_API_KEY', 'VITE_TRACK_PROJECT_ID', 'VITE_TRACK_DATABASE_URL'])(
    'is false when %s is empty',
    async (key) => {
      const { isTrackingConfigured } = await loadTrackDb({ ...FULL, [key]: '' });
      expect(isTrackingConfigured()).toBe(false);
    }
  );
});

describe('getTrackDatabase with an empty API key', () => {
  // The shipped .env.production leaves the key empty until the live database
  // exists. That must mean tracking is off, not half on: no Firebase app, no
  // connection, and so no node written under a wrong key.
  it('resolves to null and never loads firebase/database', async () => {
    const { getTrackDatabase } = await loadTrackDb({
      ...FULL,
      VITE_TRACK_API_KEY: '',
    });

    await expect(getTrackDatabase()).resolves.toBeNull();
  });

  it('leaves no Firebase app behind', async () => {
    const { getTrackDatabase, trackAppName } = await loadTrackDb({
      ...FULL,
      VITE_TRACK_API_KEY: '',
    });

    await getTrackDatabase();

    const { getApps } = await import('firebase/app');
    expect(getApps().some((app) => app.name === trackAppName)).toBe(false);
  });
});

describe('the shipped .env.production', () => {
  const env = readFileSync(new URL('../../../.env.production', import.meta.url), 'utf8');
  const value = (key: string) =>
    env.split('\n').find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;

  // A placeholder is worse than an empty value. `isTrackingConfigured()` reads
  // a non-empty placeholder as configured, and the database does not check the
  // key for unauthenticated access, so tracking would appear to work while
  // pointed at a key nobody chose. Empty is the safe state; a real key is the
  // working one. Anything in between is the trap this guards.
  it('carries a real tracking key, or none at all', () => {
    const key = value('VITE_TRACK_API_KEY');

    if (key === '') {
      return;
    }

    expect(key).toMatch(/^AIza[\w-]{20,}$/);
  });

  // Upstream's own file names its `draft-trinket` project even with the key
  // blank - a real database URL/project ID with only the key pending. This
  // fork's copy is blank on all three, on purpose: populating just the key
  // would make `isTrackingConfigured()` true against *upstream's* Firebase
  // project, which we have no permission to write into. If a future merge
  // from upstream brings their values back, this must catch it before a
  // build ships with them.
  it('names no database in this fork - tracking is fully unconfigured', () => {
    expect(value('VITE_TRACK_DATABASE_URL')).toBe('');
    expect(value('VITE_TRACK_PROJECT_ID')).toBe('');
    expect(value('VITE_TRACK_API_KEY')).toBe('');
  });
});
