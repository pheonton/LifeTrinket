import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Player } from '../Types/Player';
import { PlayersContextType, PlayersContext } from '../Contexts/PlayersContext';
import {
  InitialGameSettings,
  defaultInitialGameSettings,
  initialGameSettingsSchema,
} from '../Types/Settings';
import type { SharedGameState } from '../Types/SharedState';
import { DEFAULT_TRACKED_LIFE, type TrackLink } from '../Types/Tracking';
import { createInitialPlayers } from '../Data/getInitialPlayers';

/**
 * The settings the player last used, which a track link then overrides. A
 * corrupt value must not stop the counter, so it falls back to the defaults.
 */
const readSavedGameSettings = (): InitialGameSettings => {
  const saved = localStorage.getItem('initialGameSettings');
  if (!saved) {
    return defaultInitialGameSettings;
  }
  try {
    const parsed = initialGameSettingsSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : defaultInitialGameSettings;
  } catch {
    return defaultInitialGameSettings;
  }
};

/**
 * Seat order is fixed by the link. Seat 0 is player1 of the pairing, and
 * LifeTrinket never reorders the seats. The link decides only the seat count
 * and the starting life; the orientation and the format stay the player's own.
 */
const playersFromTrackLink = (link: TrackLink): Player[] =>
  createInitialPlayers({
    ...readSavedGameSettings(),
    numberOfPlayers: link.seats.length,
    startingLifeTotal: link.life ?? DEFAULT_TRACKED_LIFE,
  }).map((player, seat) => ({
    ...player,
    name: link.seats[seat],
  }));

export const PlayersProvider = ({
  children,
  sharedState,
  trackLink,
}: {
  children: ReactNode;
  sharedState?: SharedGameState | null;
  trackLink?: TrackLink | null;
}) => {
  // Prioritize shared state over localStorage
  const savedPlayers = sharedState?.players || localStorage.getItem('players');
  const savedStartingPlayerIndex =
    sharedState?.startingPlayerIndex ?? localStorage.getItem('startingPlayerIndex');

  const [startingPlayerIndex, setStartingPlayerIndex] = useState<number>(() => {
    if (sharedState?.startingPlayerIndex !== undefined) {
      return sharedState.startingPlayerIndex;
    }
    if (savedStartingPlayerIndex !== null) {
      return typeof savedStartingPlayerIndex === 'number'
        ? savedStartingPlayerIndex
        : parseInt(savedStartingPlayerIndex);
    }
    return -1;
  });

  const setStartingPlayerIndexAndLocalStorage = useCallback((index: number) => {
    setStartingPlayerIndex(index);
    localStorage.setItem('startingPlayerIndex', String(index));
  }, []);

  const [players, setPlayers] = useState<Player[]>(() => {
    if (sharedState?.players) {
      return sharedState.players;
    }
    if (trackLink) {
      return playersFromTrackLink(trackLink);
    }
    if (typeof savedPlayers === 'string') {
      return JSON.parse(savedPlayers);
    }
    if (Array.isArray(savedPlayers)) {
      return savedPlayers;
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('players', JSON.stringify(players));
  }, [players]);

  const ctxValue = useMemo((): PlayersContextType => {
    const updatePlayer = (updatedPlayer: Player) => {
      const updatedPlayers = players.map((player) =>
        player.index === updatedPlayer.index ? updatedPlayer : player
      );

      setPlayers(updatedPlayers);
    };

    const updateLifeTotal = (
      player: Player,
      updatedLifeTotal: number
    ): number => {
      const difference = updatedLifeTotal - player.lifeTotal;
      const updatedPlayer = {
        ...player,
        lifeTotal: updatedLifeTotal,
        hasLost: false,
      };
      updatePlayer(updatedPlayer);

      return difference;
    };

    const resetCurrentGame = () => {
      const savedGameSettings = localStorage.getItem('initialGameSettings');

      const initialGameSettings: InitialGameSettings = savedGameSettings
        ? JSON.parse(savedGameSettings)
        : null;

      if (!initialGameSettings) {
        return;
      }

      // Use the saved starting player index if available, otherwise random
      const newStartingPlayerIndex =
        startingPlayerIndex >= 0
          ? startingPlayerIndex
          : Math.floor(Math.random() * players.length);

      players.forEach((player: Player) => {
        player.commanderDamage.map((damage) => {
          damage.damageTotal = 0;
          damage.partnerDamageTotal = 0;
        });

        player.extraCounters.map((counter) => {
          counter.value = 0;
        });

        player.lifeTotal = initialGameSettings.startingLifeTotal;
        player.hasLost = false;

        player.isStartingPlayer = newStartingPlayerIndex === player.index;

        updatePlayer(player);
      });
      localStorage.setItem('playing', 'false');
    };

    return {
      players,
      setPlayers,
      updatePlayer,
      updateLifeTotal,
      resetCurrentGame,
      startingPlayerIndex,
      setStartingPlayerIndex: setStartingPlayerIndexAndLocalStorage,
    };
  }, [players, startingPlayerIndex, setStartingPlayerIndexAndLocalStorage]);

  return (
    <PlayersContext.Provider value={ctxValue}>
      {children}
    </PlayersContext.Provider>
  );
};
