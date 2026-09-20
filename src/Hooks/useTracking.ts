import { useContext } from 'react';
import { TrackingContext, type TrackingState } from '../Contexts/TrackingContext';

/** The live tracking status. Idle, and harmless, outside a provider. */
export const useTracking = (): TrackingState => useContext(TrackingContext);
