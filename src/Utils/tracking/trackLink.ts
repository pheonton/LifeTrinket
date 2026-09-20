import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';
import { trackLinkSchema, type TrackLink } from '../../Types/Tracking';

export const TRACK_HASH_PREFIX = '#track=';

export function encodeTrackLink(link: TrackLink): string {
  return compressToEncodedURIComponent(JSON.stringify(link));
}

/**
 * Returns null for anything that does not decode to a valid link.
 * It never throws, because a bad link must not stop the life counter.
 */
export function decodeTrackLink(encoded: string): TrackLink | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) {
      return null;
    }
    const parsed = trackLinkSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function getTrackLinkFromUrl(
  hash: string = typeof window === 'undefined' ? '' : window.location.hash
): TrackLink | null {
  if (!hash.startsWith(TRACK_HASH_PREFIX)) {
    return null;
  }
  return decodeTrackLink(hash.slice(TRACK_HASH_PREFIX.length));
}

export function clearTrackLinkFromUrl(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = typeof window ===
  'undefined'
    ? { hash: '', pathname: '', search: '' }
    : window.location,
  hist: Pick<History, 'replaceState'> = typeof window === 'undefined'
    ? { replaceState: () => {} }
    : window.history
): void {
  if (!loc.hash.startsWith(TRACK_HASH_PREFIX)) {
    return;
  }
  hist.replaceState(null, '', loc.pathname + loc.search);
}

/** Where a track link waits out a reload. */
export const TRACKED_GAME_KEY = 'trackedGame';

/**
 * The link this device is tracking, or null.
 *
 * It reads and does not write, not even to drop a value that fails to
 * validate. A reader that also cleans up cannot be called from a render, and
 * this one is: the decision of whether a link is new has to be reached the
 * same way on every render pass. `clearStoredTrackLink` does the cleaning.
 */
export function readStoredTrackLink(
  storage: Pick<Storage, 'getItem'> = typeof localStorage === 'undefined'
    ? { getItem: () => null }
    : localStorage
): TrackLink | null {
  const saved = storage.getItem(TRACKED_GAME_KEY);
  if (!saved) {
    return null;
  }
  try {
    const parsed = trackLinkSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type TrackEntry = { link: TrackLink; isNew: boolean };

/**
 * Which game this load is tracking, and whether it is one that still has to
 * be built.
 *
 * Reading only, on purpose. StrictMode runs a memo factory twice, and a
 * factory that stored the link and stripped the hash would answer the second
 * run differently from the first -- no hash left to find, a stored link that
 * was not there before -- and React keeps the second answer. That is a new
 * link arriving as a resume, and a table that never gets built. The writes
 * belong after the commit, and `App` does them in an effect.
 */
export function readTrackEntry(
  storage?: Pick<Storage, 'getItem'>,
  hash?: string
): TrackEntry | null {
  const stored = readStoredTrackLink(storage);
  const fromUrl = getTrackLinkFromUrl(hash);

  if (fromUrl) {
    return { link: fromUrl, isNew: stored?.id !== fromUrl.id };
  }

  return stored ? { link: stored, isNew: false } : null;
}

export function storeTrackLink(link: TrackLink): void {
  localStorage.setItem(TRACKED_GAME_KEY, JSON.stringify(link));
}

export function clearStoredTrackLink(): void {
  localStorage.removeItem(TRACKED_GAME_KEY);
}
