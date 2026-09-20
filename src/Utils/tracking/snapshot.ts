import { CounterType, type Player } from '../../Types/Player';
import type { SeatState } from '../../Types/Tracking';
import type { GameScore } from '../../Contexts/GlobalSettingsContext';

const TRACKED_KEYS = ['l', 'poi', 'cmd'] as const;

/**
 * Builds the seat state the live node carries. It holds no names, because
 * EventTrinket labels the seats from its own pairing data.
 */
export function toSeatStates(players: Player[]): SeatState[] {
  return players.map((player) => {
    const seat: SeatState = { l: player.lifeTotal };

    if (player.settings.usePoison) {
      seat.poi =
        player.extraCounters.find((c) => c.type === CounterType.Poison)?.value ?? 0;
    }

    if (player.settings.useCommanderDamage) {
      seat.cmd = player.commanderDamage.reduce(
        (highest, damage) =>
          Math.max(highest, damage.damageTotal, damage.partnerDamageTotal),
        0
      );
    }

    return seat;
  });
}

/**
 * The inverse of `toSeatStates`, for a device joining a game in progress:
 * the node's seat states written back into this device's players.
 *
 * Spec 17. It takes what the node can say without guessing:
 *
 * - `l` is the life total, one number to one number.
 * - `poi` is the poison counter, likewise -- and it switches the counter on,
 *   because a node that carries poison is a game being played with poison,
 *   and a counter left hidden here would be deleted from the node by this
 *   device's next snapshot.
 * - `cmd` is commander damage, and it overturns the format a tracked game
 *   starts in. A game built from a track link has commander damage off, but
 *   the node is the record of what is actually being played: damage another
 *   device is tracking must not be hidden here, or this device shows a false
 *   life state. Damage switches it on for the whole table, because the
 *   damage bar reads every opponent's flag, not just its own. Damage means a
 *   value above zero: `cmd` present and zero is a commander game with nothing
 *   dealt yet, and `cmd` absent is not a commander game. Neither is damage.
 *
 * `cmd` is the one field that cannot be put back exactly. The node carries
 * the highest damage across every opponent and partner, so the total is
 * faithful but its source is not recoverable. It goes on the lowest-indexed
 * opponent: exact at the two-seat table every tournament pairing is, and a
 * placement rather than an attribution at a larger one.
 *
 * Nothing else the node holds belongs to a seat. It returns the players it
 * was given, unchanged, for a seat list that is not this table -- the caller
 * has already refused that node, and this is the second lock on the same door.
 */
export function applySeatStates(
  players: Player[],
  seats: SeatState[]
): Player[] {
  if (seats.length !== players.length) {
    return players;
  }

  const commanderGame = seats.some((seat) => (seat.cmd ?? 0) > 0);

  return players.map((player, seat) => {
    const state = seats[seat];
    const adopted: Player = { ...player, lifeTotal: state.l };
    const settings = { ...player.settings };

    if (state.poi !== undefined) {
      settings.usePoison = true;
      adopted.extraCounters = player.extraCounters.some(
        (counter) => counter.type === CounterType.Poison
      )
        ? player.extraCounters.map((counter) =>
            counter.type === CounterType.Poison
              ? { ...counter, value: state.poi as number }
              : counter
          )
        : [...player.extraCounters, { type: CounterType.Poison, value: state.poi }];
    }

    if (commanderGame) {
      settings.useCommanderDamage = true;
      const opponent = player.commanderDamage.find(
        (damage) => damage.source !== player.index
      );
      adopted.commanderDamage = player.commanderDamage.map((damage) =>
        damage === opponent
          ? { ...damage, damageTotal: state.cmd ?? 0 }
          : damage
      );
    }

    adopted.settings = settings;
    return adopted;
  });
}

/**
 * Builds the `gs` field the full snapshot carries: a dense, seat-indexed
 * array of games won, one entry per player, defaulting to 0. `gameScore` is
 * a sparse record keyed by player index, so a player who has not won a game
 * yet has no entry at all.
 */
export function toSeatScores(gameScore: GameScore, playerCount: number): number[] {
  return Array.from({ length: playerCount }, (_, index) => gameScore[index] ?? 0);
}

/**
 * Returns the Realtime Database paths that changed, ready for a
 * partial-path update. An empty result means no write is needed.
 * Emits null to delete a path when a field disappears from next.
 */
export function diffSeats(
  prev: SeatState[] | null,
  next: SeatState[]
): Record<string, number | null> {
  const changes: Record<string, number | null> = {};

  next.forEach((seat, index) => {
    const before = prev?.[index];

    TRACKED_KEYS.forEach((key) => {
      const value = seat[key];
      if (value !== undefined) {
        if (before?.[key] !== value) {
          changes[`p/${index}/${key}`] = value;
        }
      } else if (before?.[key] !== undefined) {
        changes[`p/${index}/${key}`] = null;
      }
    });
  });

  return changes;
}
