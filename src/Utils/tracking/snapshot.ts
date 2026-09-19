import { CounterType, type Player } from '../../Types/Player';
import type { SeatState } from '../../Types/Tracking';

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
 * Returns the Realtime Database paths that changed, ready for a
 * partial-path update. An empty result means no write is needed.
 */
export function diffSeats(
  prev: SeatState[] | null,
  next: SeatState[]
): Record<string, number> {
  const changes: Record<string, number> = {};

  next.forEach((seat, index) => {
    const before = prev?.[index];

    TRACKED_KEYS.forEach((key) => {
      const value = seat[key];
      if (value === undefined) {
        return;
      }
      if (before?.[key] !== value) {
        changes[`p/${index}/${key}`] = value;
      }
    });
  });

  return changes;
}
