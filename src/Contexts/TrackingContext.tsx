import { createContext } from 'react';
import type { TrackerStatus } from '../Hooks/useGameTracker';

export type TrackingState = {
  status: TrackerStatus;
  lastSentAt: number | null;
  forceUpdate: () => void;
};

/**
 * The live tracking status, for the parts of the play view that are too deep
 * to reach it by props. `Play` owns the tracker; the player menu shows it.
 *
 * The default is idle and does nothing, and reading it outside a provider is
 * not an error. Every other context in this app throws in that case, and
 * this one must not: the governing rule of tracking is that it may never
 * degrade the life counter, and a throw from a status readout would take the
 * whole menu down with it. Idle renders nothing, which is the right answer
 * for a game that is not tracked anyway.
 */
export const TrackingContext = createContext<TrackingState>({
  status: 'idle',
  lastSentAt: null,
  forceUpdate: () => {},
});
