import { useEffect, useState } from 'react';
import { commanderSearchDebounceMs } from '../Data/constants';
import {
  CommanderArt,
  fetchCommanderArt,
  getCachedCommanderArt,
} from '../Utils/scryfall';

// A failed fetch (offline, network error) is reported as 'notfound' so the
// UI falls back to the flat colour either way.
export type CommanderArtStatus = 'idle' | 'loading' | 'found' | 'notfound';

type UseCommanderArt = CommanderArt & { status: CommanderArtStatus };

const IDLE: UseCommanderArt = { artUrl: null, cardName: null, status: 'idle' };

const settle = (result: CommanderArt): UseCommanderArt => ({
  ...result,
  status: result.artUrl ? 'found' : 'notfound',
});

/**
 * Debounced, cached Scryfall lookup for a commander's art. Purely cosmetic -
 * safe to call with a rapidly changing name (an input value) or a stable one
 * (a player's saved commander). The current value is derived during render
 * from the shared cache; the effect only schedules the async fetch.
 */
export const useCommanderArt = (name: string): UseCommanderArt => {
  const trimmed = (name ?? '').trim();
  const [fetched, setFetched] = useState<{
    key: string;
    result: CommanderArt;
  } | null>(null);

  useEffect(() => {
    if (!trimmed || getCachedCommanderArt(trimmed)) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchCommanderArt(trimmed, controller.signal).then((result) => {
        if (!controller.signal.aborted) {
          setFetched({ key: trimmed, result });
        }
      });
    }, commanderSearchDebounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  if (!trimmed) return IDLE;

  const cached = getCachedCommanderArt(trimmed);
  if (cached) return settle(cached);
  if (fetched && fetched.key === trimmed) return settle(fetched.result);
  return { ...IDLE, status: 'loading' };
};
