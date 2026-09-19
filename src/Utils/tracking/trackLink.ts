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

export function clearTrackLinkFromUrl(): void {
  if (window.location.hash.startsWith(TRACK_HASH_PREFIX)) {
    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    );
  }
}
