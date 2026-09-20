import { useEffect, useMemo } from 'react';
import { LifeTrinket } from './Components/LifeTrinket';
import { GlobalSettingsProvider } from './Providers/GlobalSettingsProvider';
import { PlayersProvider } from './Providers/PlayersProvider';
import {
  getSharedStateFromUrl,
  clearSharedStateFromUrl,
} from './Utils/shareState';
import {
  clearStoredTrackLink,
  clearTrackLinkFromUrl,
  getTrackLinkFromUrl,
  readStoredTrackLink,
  storeTrackLink,
} from './Utils/tracking/trackLink';
import type { TrackLink } from './Types/Tracking';

type TrackEntry = { link: TrackLink; isNew: boolean };

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
const readTrackEntry = (): TrackEntry | null => {
  const stored = readStoredTrackLink();
  const fromUrl = getTrackLinkFromUrl();

  if (fromUrl) {
    return { link: fromUrl, isNew: stored?.id !== fromUrl.id };
  }

  return stored ? { link: stored, isNew: false } : null;
};

const App = () => {
  // Check for shared state in URL during initialization
  // This runs once and doesn't trigger re-renders
  const sharedState = useMemo(() => {
    const shared = getSharedStateFromUrl();

    if (shared) {
      console.log('Shared game state detected, loading...');
      // Clear the hash from URL for cleaner address bar
      clearSharedStateFromUrl();
      return shared;
    }

    return null;
  }, []);

  // A track link starts a game that publishes life totals to EventTrinket.
  // `isNew` separates the two ways a link arrives. A link for a game that is
  // not already being tracked builds a fresh table. A link restored from
  // localStorage, or a re-scan of the game in progress, only resumes the
  // publishing, so a reopened tab keeps the life totals it had.
  const trackEntry = useMemo(() => readTrackEntry(), []);

  useEffect(() => {
    // A link keeps a game tracked across a reload. No link means there is
    // nothing to keep, and anything left under that key is a value that no
    // longer validates.
    if (trackEntry) {
      storeTrackLink(trackEntry.link);
    } else {
      clearStoredTrackLink();
    }
    // Clears any `#track=` hash, a bad one included, and leaves other hashes
    // alone. A link that never decodes must not stick to the URL.
    clearTrackLinkFromUrl();
  }, [trackEntry]);

  return (
    <GlobalSettingsProvider
      sharedState={sharedState}
      trackLink={trackEntry?.link ?? null}
    >
      <PlayersProvider
        sharedState={sharedState}
        newTrackLink={trackEntry?.isNew ? trackEntry.link : null}
      >
        <LifeTrinket />
      </PlayersProvider>
    </GlobalSettingsProvider>
  );
};

export default App;
