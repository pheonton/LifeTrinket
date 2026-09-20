import { createContext } from 'react';
import { InitialGameSettings, Settings } from '../Types/Settings';
import { LifeHistoryEvent, Player } from '../Types/Player';

type Version = {
  installedVersion: string;
  isLatest: boolean;
  checkForNewVersion: (source: 'settings' | 'start_menu') => Promise<void>;
  remoteVersion?: string;
};

export type SavedGame = {
  initialGameSettings: InitialGameSettings;
  players: Player[];
  gameScore?: GameScore;
} | null;

export type GameScore = {
  [playerIndex: number]: number;
};

export type GlobalSettingsContextType = {
  fullscreen: {
    isFullscreen: boolean;
    enableFullscreen: () => void;
    disableFullscreen: () => void;
  };
  wakeLock: {
    isSupported: boolean;
    release: () => void;
    active: boolean;
    request: () => void;
    type: 'screen' | undefined;
    toggleWakeLock: () => void;
  };
  goToStart: () => void;
  showPlay: boolean;
  setShowPlay: (showPlay: boolean) => void;
  initialGameSettings: InitialGameSettings;
  setInitialGameSettings: (initialGameSettings: InitialGameSettings) => void;
  settings: Settings;
  setSettings: (settings: Settings) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  randomizingPlayer: boolean;
  setRandomizingPlayer: (stopRandom: boolean) => void;
  isPWA: boolean;
  preStartCompleted: boolean;
  setPreStartCompleted: (completed: boolean) => void;
  version: Version;
  savedGame: SavedGame;
  saveCurrentGame: (currentGame: SavedGame) => void;
  gameScore: GameScore;
  setGameScore: (score: GameScore) => void;
  lifeHistory: LifeHistoryEvent[];
  addLifeHistoryEvent: (event: LifeHistoryEvent) => void;
  clearLifeHistory: () => void;
  /** The id of the game this device publishes life totals to, or null. */
  trackedGameId: string | null;
  /**
   * The id of the round clock this game follows, or null. It names a node
   * this device only ever reads: the tournament owns the round end.
   */
  trackedRoundId: string | null;
  /** Stops publishing. A game that has been reset is no longer that game. */
  clearTrackedGame: () => void;
};

export const GlobalSettingsContext =
  createContext<GlobalSettingsContextType | null>(null);
