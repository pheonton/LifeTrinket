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
  readTrackEntry,
  storeTrackLink,
} from './Utils/tracking/trackLink';

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
