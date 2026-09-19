import { twc } from 'react-twc';
import type { TrackerStatus } from '../../Hooks/useGameTracker';

const Chip = twc.button`
  absolute bottom-2 left-1/2 z-50 -translate-x-1/2
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
 * The only sign of live tracking in the play view. It shows nothing at all
 * when no game is tracked, so a player who never tracks never sees it.
 */
export const TrackingChip = ({
  status,
  lastSentAt,
  onForce,
}: {
  status: TrackerStatus;
  lastSentAt: number | null;
  onForce: () => void;
}) => {
  if (status === 'idle') {
    return null;
  }

  const time = lastSentAt
    ? new Date(lastSentAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <Chip onClick={onForce} aria-label="Live tracking status. Tap to sync now.">
      <Dot className={DOT_CLASS[status]} />
      <span>
        {LABEL[status]}
        {status === 'live' && time ? ` ${time}` : ''}
      </span>
    </Chip>
  );
};
