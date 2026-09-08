import { z } from 'zod';

export const deckStatSchema = z.object({
  // Display name, with the casing it was first entered in.
  name: z.string(),
  gamesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  // Cumulative across all games: for each game, the number of other seats in
  // the pod that were not playing this same deck.
  opponentsFaced: z.number().int().nonnegative(),
  // Epoch milliseconds of the most recent game recorded for this deck.
  lastPlayed: z.number(),
});

export type DeckStat = z.infer<typeof deckStatSchema>;

// Keyed by the normalized deck name (see normalizeDeckName).
export const deckStatsSchema = z.record(z.string(), deckStatSchema);

export type DeckStats = z.infer<typeof deckStatsSchema>;

export const normalizeDeckName = (raw: string): string =>
  raw.trim().replace(/\s+/g, ' ').toLowerCase();

export const deckWinRate = (stat: DeckStat): number =>
  stat.gamesPlayed === 0 ? 0 : stat.wins / stat.gamesPlayed;

type RecordablePlayer = {
  index: number;
  deckName: string;
};

/**
 * Fold a finished game into the deck stats.
 *
 * Players without a deck name are ignored. Multiple seats sharing the same
 * (normalized) deck name are treated as one deck for that game: it gets a
 * single game/win/loss, and opponentsFaced counts every seat that wasn't
 * playing it.
 */
export const recordGameToDeckStats = (
  prev: DeckStats,
  players: RecordablePlayer[],
  winnerIndex: number
): DeckStats => {
  const now = Date.now();
  const winner = players.find((p) => p.index === winnerIndex);
  const winnerDeck = winner ? normalizeDeckName(winner.deckName) : '';

  // Group seats by normalized deck name, skipping blanks.
  const seatsByDeck = new Map<string, { display: string; count: number }>();
  for (const player of players) {
    const key = normalizeDeckName(player.deckName);
    if (!key) {
      continue;
    }
    const existing = seatsByDeck.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      seatsByDeck.set(key, { display: player.deckName.trim(), count: 1 });
    }
  }

  if (seatsByDeck.size === 0) {
    return prev;
  }

  const next: DeckStats = { ...prev };

  for (const [key, { display, count }] of seatsByDeck) {
    const current: DeckStat = next[key] ?? {
      name: display,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      opponentsFaced: 0,
      lastPlayed: now,
    };

    const isWinner = winnerDeck !== '' && key === winnerDeck;

    next[key] = {
      name: current.name,
      gamesPlayed: current.gamesPlayed + 1,
      wins: current.wins + (isWinner ? 1 : 0),
      losses: current.losses + (isWinner ? 0 : 1),
      opponentsFaced: current.opponentsFaced + (players.length - count),
      lastPlayed: now,
    };
  }

  return next;
};
