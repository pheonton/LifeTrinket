import { useMemo } from 'react';
import { LifeTrinket } from './Components/LifeTrinket';
import { GlobalSettingsProvider } from './Providers/GlobalSettingsProvider';
import { PlayersProvider } from './Providers/PlayersProvider';
import {
  getSharedStateFromUrl,
  clearSharedStateFromUrl,
} from './Utils/shareState';
import {
  getTrackLinkFromUrl,
  clearTrackLinkFromUrl,
} from './Utils/tracking/trackLink';
import { trackLinkSchema, type TrackLink } from './Types/Tracking';

/**
 * The link kept from an earlier visit. Anything that does not validate is
 * dropped rather than thrown, because tracking must never stop the counter.
 */
const readStoredTrackLink = (): TrackLink | null => {
  const saved = localStorage.getItem('trackedGame');
  if (!saved) {
    return null;
  }
  try {
    const parsed = trackLinkSchema.safeParse(JSON.parse(saved));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Fall through to the cleanup below.
  }
  localStorage.removeItem('trackedGame');
  return null;
};

const readTrackEntry = (): { link: TrackLink; isNew: boolean } | null => {
  const stored = readStoredTrackLink();
  const fromUrl = getTrackLinkFromUrl();

  // Clears any `#track=` hash, a bad one included, and leaves other hashes
  // alone. A link that never decodes must not stick to the URL.
  clearTrackLinkFromUrl();

  if (fromUrl) {
    localStorage.setItem('trackedGame', JSON.stringify(fromUrl));
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

  return (
    <GlobalSettingsProvider
      sharedState={sharedState}
      trackLink={trackEntry?.link ?? null}
    >
      <PlayersProvider
        sharedState={sharedState}
        // Only a link for a game that is not yet in progress builds the table.
        trackLink={trackEntry?.isNew ? trackEntry.link : null}
      >
        <LifeTrinket />
      </PlayersProvider>
    </GlobalSettingsProvider>
  );
};

export default App;
