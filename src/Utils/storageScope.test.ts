import { describe, it, expect } from 'vitest';
import {
  DEVICE_SCOPED_KEYS,
  GAME_SCOPED_KEYS,
  KEPT_BY_GO_TO_START,
  SESSION_SCOPED_KEYS,
  TRACKING_KEYS,
  clearKeys,
  keysToClearOnGoToStart,
  keysToClearOnLoad,
} from './storageScope';

const fakeStorage = (entries: Record<string, string>) => {
  const store = { ...entries };
  return {
    store,
    removeItem: (key: string) => {
      delete store[key];
    },
  };
};

describe('the persisted key lists', () => {
  it('names every key that belongs to one game', () => {
    expect([...GAME_SCOPED_KEYS].sort()).toEqual(
      [
        'gameScore',
        'lifeHistory',
        'players',
        'preStartComplete',
        'startingPlayerIndex',
        'timerAccumulatedMs',
        'timerStartedAt',
      ].sort()
    );
  });

  it('names the keys that belong to the device', () => {
    expect([...DEVICE_SCOPED_KEYS].sort()).toEqual(
      ['initialGameSettings', 'settings'].sort()
    );
  });

  it('puts every persisted key in exactly one list', () => {
    const all = [
      ...GAME_SCOPED_KEYS,
      ...DEVICE_SCOPED_KEYS,
      ...SESSION_SCOPED_KEYS,
      ...TRACKING_KEYS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('never lets a device-scoped key into the game-scoped list', () => {
    for (const key of DEVICE_SCOPED_KEYS) {
      expect(GAME_SCOPED_KEYS).not.toContain(key);
    }
  });
});

describe('keysToClearOnLoad', () => {
  it('clears every game-scoped key when the link names a new game', () => {
    const cleared = keysToClearOnLoad({ isNew: true });
    for (const key of GAME_SCOPED_KEYS) {
      expect(cleared).toContain(key);
    }
  });

  it('never clears a device-scoped key', () => {
    const cleared = keysToClearOnLoad({ isNew: true });
    for (const key of DEVICE_SCOPED_KEYS) {
      expect(cleared).not.toContain(key);
    }
  });

  it('clears nothing when the link resumes the game in progress', () => {
    expect(keysToClearOnLoad({ isNew: false })).toEqual([]);
  });

  it('clears nothing when no game is tracked', () => {
    expect(keysToClearOnLoad(null)).toEqual([]);
  });
});

describe('clearKeys', () => {
  it('removes the named keys and leaves everything else alone', () => {
    const storage = fakeStorage({
      players: '[]',
      gameScore: '{"0":1}',
      lifeHistory: '[]',
      timerStartedAt: '1',
      timerAccumulatedMs: '2',
      startingPlayerIndex: '0',
      preStartComplete: 'true',
      settings: '{}',
      initialGameSettings: '{}',
      savedGame: 'null',
      trackedGame: '{}',
    });

    clearKeys(keysToClearOnLoad({ isNew: true }), storage);

    expect(Object.keys(storage.store).sort()).toEqual([
      'initialGameSettings',
      'savedGame',
      'settings',
      'trackedGame',
    ]);
  });

  it('removes nothing for a resumed game', () => {
    const storage = fakeStorage({ players: '[]', gameScore: '{"0":1}' });
    clearKeys(keysToClearOnLoad({ isNew: false }), storage);
    expect(Object.keys(storage.store).sort()).toEqual(['gameScore', 'players']);
  });
});

describe('keysToClearOnGoToStart', () => {
  // Pins the set `removeLocalStorage` has always cleared. It is not the
  // game-scoped list: it drops the setup and the view flags as well, and it
  // keeps the two keys in KEPT_BY_GO_TO_START.
  it('clears exactly what going back to the start menu has always cleared', () => {
    expect([...keysToClearOnGoToStart()].sort()).toEqual(
      [
        'initialGameSettings',
        'players',
        'playing',
        'showPlay',
        'preStartComplete',
        'gameScore',
        'timerStartedAt',
        'timerAccumulatedMs',
      ].sort()
    );
  });

  it('clears every game-scoped key it does not deliberately keep', () => {
    for (const key of GAME_SCOPED_KEYS) {
      if (KEPT_BY_GO_TO_START.includes(key)) {
        expect(keysToClearOnGoToStart()).not.toContain(key);
      } else {
        expect(keysToClearOnGoToStart()).toContain(key);
      }
    }
  });

  it('keeps only keys that are game-scoped in the first place', () => {
    for (const key of KEPT_BY_GO_TO_START) {
      expect(GAME_SCOPED_KEYS).toContain(key);
    }
  });
});
