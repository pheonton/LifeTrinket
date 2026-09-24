import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Player } from '../Types/Player';
import { PlayersContextType, PlayersContext } from '../Contexts/PlayersContext';
import {
  GameFormat,
  InitialGameSettings,
  defaultInitialGameSettings,
  initialGameSettingsSchema,
} from '../Types/Settings';
import type { SharedGameState } from '../Types/SharedState';
import { DEFAULT_TRACKED_LIFE, type TrackLink } from '../Types/Tracking';
import { createInitialPlayers } from '../Data/getInitialPlayers';
import { readStoredTrackLink } from '../Utils/tracking/trackLink';

/**
 * The settings the player last used, or null when there are none to read.
 * Only the start menu ever writes them, and a track link must never touch
 * them: they are the setup the player goes back to after the match.
 */
const readSavedGameSettings = (): InitialGameSettings | null => {
  const saved = localStorage.getItem('initialGameSettings');
  if (!saved) {
    return null;
  }
  try {
    const parsed = initialGameSettingsSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * The life total a reset goes back to, or null when nothing says.
 *
 * A tracked game answers from its own link, which is the only record of what
 * the tournament set the match to. The player's saved settings cannot answer
 * for it -- they describe the game the player would have set up -- and on a
 * device that has only ever opened a link there are none to read at all.
 */
const readStartingLifeTotal = (): number | null => {
  const tracked = readStoredTrackLink();
  if (tracked) {
    return tracked.life ?? DEFAULT_TRACKED_LIFE;
  }
  return readSavedGameSettings()?.startingLifeTotal ?? null;
};

/**
 * Seat order is fixed by the link. Seat 0 is player1 of the pairing, and
 * LifeTrinket never reorders the seats.
 *
 * The format follows the event, and the orientation follows the player. A
 * tracked game is a round of a Swiss tournament: it is not commander,
 * whatever the player last set up for their own table, and a commander
 * player's saved `useCommanderDamage` used to carry damage bars and a
 * commander tax counter into a match that has neither. Orientation is the
 * other kind of preference entirely -- it says how the player holds their
 * phone -- so it is still inherited, along with everything else the link does
 * not decide.
 *
 * This decides only how the game *starts*. A node that already carries
 * commander damage overturns it, in `applySeatStates`: the node is the record
 * of what is being played, and hiding damage another device is tracking would
 * show a false life state.
 */
const startGameFromTrackLink = (link: TrackLink): Player[] =>
  createInitialPlayers({
    ...(readSavedGameSettings() ?? defaultInitialGameSettings),
    numberOfPlayers: link.seats.length,
    startingLifeTotal: link.life ?? DEFAULT_TRACKED_LIFE,
    useCommanderDamage: false,
    gameFormat: GameFormat.Standard,
  }).map((player, seat) => ({
    ...player,
    name: link.seats[seat],
  }));

export const PlayersProvider = ({
  children,
  sharedState,
  newTrackLink,
}: {
  children: ReactNode;
  sharedState?: SharedGameState | null;
  /**
   * A link for a game that is not already in progress, and only then. A link
   * restored on a reload names the game this device is already playing, so it
   * must leave the saved players alone rather than build the table again.
   */
  newTrackLink?: TrackLink | null;
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
    if (newTrackLink) {
      return startGameFromTrackLink(newTrackLink);
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

  const [gameResetCount, setGameResetCount] = useState(0);

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
      const startingLifeTotal = readStartingLifeTotal();

      if (startingLifeTotal === null) {
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

        player.lifeTotal = startingLifeTotal;
        player.hasLost = false;

        player.isStartingPlayer = newStartingPlayerIndex === player.index;

        updatePlayer(player);
      });
      localStorage.setItem('playing', 'false');
      setGameResetCount((count) => count + 1);
    };

    return {
      players,
      setPlayers,
      updatePlayer,
      updateLifeTotal,
      resetCurrentGame,
      gameResetCount,
      startingPlayerIndex,
      setStartingPlayerIndex: setStartingPlayerIndexAndLocalStorage,
    };
  }, [
    players,
    gameResetCount,
    startingPlayerIndex,
    setStartingPlayerIndexAndLocalStorage,
  ]);

  return (
    <PlayersContext.Provider value={ctxValue}>
      {children}
    </PlayersContext.Provider>
  );
};
