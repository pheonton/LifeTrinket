import type { GameScore } from '../../Contexts/GlobalSettingsContext';
import type { SeatState } from '../../Types/Tracking';

/** The seat count and win count the live node's database rules allow. */
const MAX_SEATS = 6;
const MAX_WINS = 99;

/** The per-seat ranges the live node's database rules allow. */
const LIFE_RANGE = { min: -999, max: 9999 };
const COUNTER_RANGE = { min: 0, max: 999 };

export type GameAdoption = {
  /**
   * True once the node has been read. Writes omit `gs` while this is false,
   * and carry it from here on. It never goes back to false for a game: the
   * question is asked once, and one answer settles it.
   */
  resolved: boolean;
  /** The score to take from the node, or null to keep what this device has. */
  score: GameScore | null;
  /**
   * The seat states to take from the node, or null to keep what this device
   * shows. Seat-indexed, and always exactly as long as this device's table.
   */
  seats: SeatState[] | null;
};

function isCount(value: unknown, { min, max }: { min: number; max: number }) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/**
 * Reads the seat-indexed match score off a raw live-node value, or null when
 * there is nothing worth taking.
 *
 * It refuses anything the node's own rules could not hold, because the score
 * this returns is published back and then written into real tournament
 * standings. An all-zero score is nothing to take: adopting it would change
 * no counter and only cost a render.
 */
export function readNodeScore(nodeValue: unknown): number[] | null {
  if (typeof nodeValue !== 'object' || nodeValue === null) {
    return null;
  }

  const score = (nodeValue as { gs?: unknown }).gs;
  if (!Array.isArray(score) || score.length === 0 || score.length > MAX_SEATS) {
    return null;
  }

  const clean = score.every(
    (wins) =>
      typeof wins === 'number' &&
      Number.isInteger(wins) &&
      wins >= 0 &&
      wins <= MAX_WINS
  );
  if (!clean || score.every((wins) => wins === 0)) {
    return null;
  }

  return score as number[];
}

/**
 * Reads the seat states off a raw live-node value, or null when there is
 * nothing this table can safely take.
 *
 * `seatCount` is this device's own table, and a node that seats a different
 * number of players is refused whole. Seat `n` of a four-seat node is not
 * seat `n` of a two-seat one, and a table half from this game and half from
 * another is the disagreement this adoption exists to end, not a repair.
 *
 * A single value the node's own rules could not hold refuses the node whole,
 * for the same reason: it was written by something this device cannot model,
 * and taking the part that happens to parse is guessing.
 */
export function readNodeSeats(
  nodeValue: unknown,
  seatCount: number
): SeatState[] | null {
  if (typeof nodeValue !== 'object' || nodeValue === null) {
    return null;
  }

  const raw = (nodeValue as { p?: unknown }).p;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > MAX_SEATS ||
    raw.length !== seatCount
  ) {
    return null;
  }

  const seats: SeatState[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const { l, poi, cmd } = entry as {
      l?: unknown;
      poi?: unknown;
      cmd?: unknown;
    };
    if (!isCount(l, LIFE_RANGE)) {
      return null;
    }
    const seat: SeatState = { l: l as number };
    if (poi !== undefined) {
      if (!isCount(poi, COUNTER_RANGE)) {
        return null;
      }
      seat.poi = poi as number;
    }
    if (cmd !== undefined) {
      if (!isCount(cmd, COUNTER_RANGE)) {
        return null;
      }
      seat.cmd = cmd as number;
    }
    seats.push(seat);
  }

  return seats;
}

/**
 * True when this device holds a result of its own. A score that is empty, or
 * that is present but all zeroes, is a device that has won nothing yet -- it
 * has no result to defend, so it is free to take the node's.
 */
function holdsOwnScore(localScore: GameScore): boolean {
  return Object.values(localScore).some((wins) => wins > 0);
}

/**
 * Answers, once per game: given what this device holds and what the node
 * carries, what should this device publish?
 *
 * Spec 17. A device with nothing stored treats every link as new, so without
 * this it would publish 0-0 and 20-20 for a match already in progress -- it
 * would wipe a real tournament score, and show the players a game that has
 * not started while the board beside them shows the real one.
 *
 * The two answers have two different gates, because they defend two different
 * things:
 *
 * - The **score** is a result. The gate is a result of this device's own: a
 *   device that has won a game keeps its score, whatever the node says. This
 *   is the rule that was verified against the live database and it is
 *   unchanged.
 * - The **seat states** are the game itself. The gate is `joining`: whether
 *   this device holds this tracking id's game at all. It has to be the wider
 *   gate, because a device reloading in the middle of the first game of a
 *   match holds no score yet and would fail the narrower one -- and its life
 *   totals are the real ones, fresher than anything the node has seen.
 */
export function planGameAdoption({
  resolved,
  joining,
  localScore,
  seatCount,
  nodeValue,
}: {
  resolved: boolean;
  /**
   * True only for a device that has nothing of its own for this tracking id:
   * a phone that has just scanned the link. False on a reload of a game this
   * device has been playing.
   */
  joining: boolean;
  localScore: GameScore;
  /** This device's own seat count. A node that disagrees is refused. */
  seatCount: number;
  nodeValue: unknown;
}): GameAdoption {
  // Asked and answered. A later read must not fight the local state, which by
  // now includes anything the first read adopted.
  if (resolved) {
    return { resolved: true, score: null, seats: null };
  }

  const nodeScore = readNodeScore(nodeValue);
  const score =
    !nodeScore || holdsOwnScore(localScore) ? null : fromSeatScores(nodeScore);

  const seats = joining ? readNodeSeats(nodeValue, seatCount) : null;

  return { resolved: true, score, seats };
}

/** The sparse, index-keyed score the app holds, from the node's dense array. */
function fromSeatScores(nodeScore: number[]): GameScore {
  const score: GameScore = {};
  nodeScore.forEach((wins, seat) => {
    score[seat] = wins;
  });
  return score;
}
