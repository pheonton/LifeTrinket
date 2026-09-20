import { useEffect, useRef, useState } from 'react';
import { useGameTimer } from '../../Hooks/useGameTimer';
import { useGlobalSettings } from '../../Hooks/useGlobalSettings';
import { useRoundEnd } from '../../Hooks/useRoundEnd';
import { planRoundEndReadout } from '../../Utils/tracking/roundEnd';

const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
};

const getBarColor = (progress: number): string => {
  // Green (120) → Yellow (60) → Red (0)
  const hue = Math.round(120 * (1 - progress));
  return `hsl(${hue}, 85%, 45%)`;
};

export const GameTimer = () => {
  const { settings, playing, trackedRoundId } = useGlobalSettings();
  const { remainingMs, progress, isRunning, isExpired, togglePause, start } =
    useGameTimer(settings.countdownMinutes);

  // Spec 19. A tracked link names the tournament's clock, and every table in
  // the round then ends at the same instant instead of at its own local
  // count. Null for every game that is not tracked, and for every failure.
  const { endAt } = useRoundEnd(trackedRoundId);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endAt === null) {
      return;
    }
    // The local timer's own ticking drives the countdown, but it stops when
    // the timer is paused or was never started -- and with a round end there
    // may be no local timer at all. This is the only thing that notices the
    // round end passing, so the overlay needs it.
    //
    // The first tick is a second away rather than immediate, so a round that
    // ended before this subscription resolved raises its overlay up to a
    // second late. A synchronous set here would be a cascading render, and a
    // second is nothing against a round that is already over.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endAt]);

  const roundEnd = planRoundEndReadout(endAt, now);

  const [dismissed, setDismissed] = useState(false);

  // Auto-start when game starts playing
  const hasStartedRef = useRef(false);
  useEffect(() => {
    // Gated on the round end, not on `showTimer`. A tracked round owns the
    // clock, so a local countdown beside it is a second answer to a question
    // that has one. But `showTimer` must not gate this: with the timer
    // hidden, today's build still starts the local clock at game start, so
    // turning the setting on mid-game shows the real elapsed time. Gating
    // here would start it from zero at that moment instead.
    if (
      endAt === null &&
      playing &&
      !hasStartedRef.current &&
      !isRunning &&
      progress === 0
    ) {
      start();
      hasStartedRef.current = true;
    }
  }, [endAt, playing, isRunning, progress, start]);

  // A tracked round end deliberately ignores `showTimer`. Scanning the QR is
  // an explicit opt in to the tournament's clock, so a player who turned the
  // timer off for a kitchen-table game still sees when the round ends. It is
  // the one place a tracked game overrides a device preference.
  if (!settings.showTimer && !roundEnd) return null;

  // The round end owns expiry when there is one. The display changes; the
  // behaviour at expiry does not.
  const expired = roundEnd ? roundEnd.isExpired : isExpired;

  // "Time's Up" overlay — tap to dismiss to badge
  if (expired && !dismissed) {
    return (
      <button
        onClick={() => setDismissed(true)}
        className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="text-red-500 text-3xl font-bold drop-shadow-lg">
            Time's Up!
          </span>
          <span className="text-white/80 text-sm text-center px-8 max-w-xs leading-relaxed">
            The active player finishes their turn, then 5 extra turns are
            played. If no winner after extra turns, most game wins takes the
            match.
          </span>
          <span className="text-white/50 text-xs mt-1">Tap to dismiss</span>
        </div>
      </button>
    );
  }

  // "Time's Up" badge — small badge at top-center after dismissal
  if (expired && dismissed) {
    return (
      <div className="absolute top-0 right-2 z-10 pointer-events-none">
        <div className="bg-red-600/80 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-b-md">
          Time's Up
        </div>
      </div>
    );
  }

  // The tournament's clock — the wall-clock instant the round ends, and no
  // progress bar. Spec 19.5: an absolute instant cannot express a pause, so
  // a bar counting down against it would colour its way to red through a
  // judge call and tell the table a lie. Nothing here is tappable either:
  // the local pause means nothing to a round the organizer owns.
  if (roundEnd) {
    return (
      <div className="absolute top-0 left-0 right-0 z-10 flex justify-center pointer-events-none">
        <div className="flex items-baseline gap-1.5 bg-black/70 rounded-b-lg px-3 py-1 text-white">
          <span className="text-xs opacity-70">Ends</span>
          <span className="text-xl font-semibold tabular-nums tracking-tight">
            {roundEnd.label}
          </span>
        </div>
      </div>
    );
  }

  // Progress bar — thin bar at top of screen
  return (
    <button
      onClick={togglePause}
      className="absolute top-0 left-0 right-0 z-10 pointer-events-auto h-2 group"
      aria-label={isRunning ? 'Pause timer' : 'Resume timer'}
    >
      {/* Background track */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Fill */}
      <div
        className="absolute top-0 left-0 bottom-0 transition-all duration-200 ease-linear"
        style={{
          width: `${progress * 100}%`,
          backgroundColor: getBarColor(progress),
        }}
      />

      {/* Time label — visible on hover/tap area, always discreet */}
      <div
        className={`absolute top-full left-1/2 -translate-x-1/2 mt-0.5
          bg-black/60 rounded-full px-2 py-0.5 text-[10px] font-mono text-white/90
          opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none
          ${!isRunning ? 'opacity-100 animate-pulse' : ''}
        `}
      >
        {formatTime(remainingMs)}
        {!isRunning && (
          <span className="ml-1 uppercase tracking-wider text-[8px] opacity-75">
            Paused
          </span>
        )}
      </div>
    </button>
  );
};
