import { normalizeDeckName } from '../Types/DeckStats';

/**
 * Cosmetic-only Scryfall lookup for commander card art.
 *
 * Nothing here is persisted - results live in an in-memory cache for the
 * session so re-renders, two players on the same commander, and re-opening
 * the picker never re-fetch. The service worker (see vite.config.ts) caches
 * the API responses and the images across sessions.
 */

export type CommanderArt = {
  artUrl: string | null;
  cardName: string | null;
  // Scryfall asks that the artist be creditable wherever an `art_crop` is
  // shown (the crop drops the card's printed artist line).
  artist: string | null;
};

const NOT_FOUND: CommanderArt = {
  artUrl: null,
  cardName: null,
  artist: null,
};

type ScryfallImageUris = { art_crop?: string };
type ScryfallCard = {
  name?: string;
  artist?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: { image_uris?: ScryfallImageUris; artist?: string }[];
};

const resultCache = new Map<string, CommanderArt>();
const inFlight = new Map<string, Promise<CommanderArt>>();

const pickArt = (card: ScryfallCard): CommanderArt => ({
  artUrl:
    card.image_uris?.art_crop ??
    card.card_faces?.[0]?.image_uris?.art_crop ??
    null,
  cardName: card.name ?? null,
  artist: card.artist ?? card.card_faces?.[0]?.artist ?? null,
});

/**
 * Fuzzy-resolve a commander name to its art. Never throws: a miss (404,
 * network error, abort) resolves to `{ artUrl: null, cardName: null }`.
 * `signal` only aborts the network request - the returned promise still
 * settles so callers don't hang.
 */
export const fetchCommanderArt = (
  name: string,
  signal?: AbortSignal
): Promise<CommanderArt> => {
  const key = normalizeDeckName(name ?? '');
  if (!key) {
    return Promise.resolve(NOT_FOUND);
  }

  const cached = resultCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = (async (): Promise<CommanderArt> => {
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
        { headers: { Accept: 'application/json' }, signal }
      );
      if (!res.ok) {
        resultCache.set(key, NOT_FOUND);
        return NOT_FOUND;
      }
      const card = (await res.json()) as ScryfallCard;
      const result = pickArt(card);
      resultCache.set(key, result);
      return result;
    } catch {
      // Aborted or offline: don't poison the cache, just report a miss.
      return NOT_FOUND;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
};

/** Synchronous cache peek, for rendering without a fetch flicker. */
export const getCachedCommanderArt = (name: string): CommanderArt | undefined =>
  resultCache.get(normalizeDeckName(name));
