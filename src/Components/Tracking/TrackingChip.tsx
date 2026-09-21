import { twc } from 'react-twc';
import type { TrackerStatus } from '../../Hooks/useGameTracker';
import { useTracking } from '../../Hooks/useTracking';

// The pill only. It used to pin itself to the bottom of the play view; it
// now lives in the player menu, so placement belongs to the caller.
const Chip = twc.button`
  flex items-center gap-2 rounded-full
  bg-black/60 px-3 py-1 text-xs text-white
`;

const Dot = twc.span`h-2 w-2 rounded-full`;

const DOT_CLASS: Record<TrackerStatus, string> = {
  idle: 'bg-gray-400',
  connecting: 'bg-gray-400',
  live: 'bg-green-500',
  offline: 'bg-amber-500',
  error: 'bg-red-500',
  taken: 'bg-red-500',
};

const LABEL: Record<TrackerStatus, string> = {
  idle: '',
  connecting: 'Connecting',
  live: 'Synced',
  offline: 'Not synced',
  error: 'Sync failed, tap to retry',
  taken: 'Another device is tracking this game',
};

/**
 * The only sign of live tracking, at the top of the player menu. It shows
 * nothing at all when no game is tracked, so a player who never tracks never
 * sees it, and the menu keeps the shape it has always had.
 *
 * It reads the status from context rather than from props: `Play` owns the
 * tracker and the menu is three components below it.
 */
export const TrackingChip = () => {
  const { status, lastSentAt, forceUpdate } = useTracking();

  if (status === 'idle') {
    return null;
  }

  // 24 hour, like the round end above it. Two clocks on one screen reading
  // "21:59" and "09:12 PM" makes a player work out whether they agree.
  const time = lastSentAt
    ? new Date(lastSentAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;

  return (
    <Chip onClick={forceUpdate} aria-label="Live tracking status. Tap to sync now.">
      <Dot className={DOT_CLASS[status]} />
      <span>
        {LABEL[status]}
        {status === 'live' && time ? ` ${time}` : ''}
      </span>
    </Chip>
  );
};
