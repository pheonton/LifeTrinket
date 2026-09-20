import type { GameScore } from '../../Contexts/GlobalSettingsContext';

/** The seat count and win count the live node's database rules allow. */
const MAX_SEATS = 6;
const MAX_WINS = 99;

export type ScoreAdoption = {
  /**
   * True once the node has been read. Writes omit `gs` while this is false,
   * and carry it from here on. It never goes back to false for a game: the
   * question is asked once, and one answer settles it.
   */
  resolved: boolean;
  /** The score to take from the node, or null to keep what this device has. */
  adopt: GameScore | null;
};

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
 * this it would publish 0-0 for a match already in progress and wipe a real
 * tournament score. Only the score is decided here. Life totals are a live
 * reading, not a result, and are never adopted.
 */
export function planScoreAdoption({
  resolved,
  localScore,
  nodeValue,
}: {
  resolved: boolean;
  localScore: GameScore;
  nodeValue: unknown;
}): ScoreAdoption {
  // Asked and answered. A later read must not fight the local score, which by
  // now includes anything the first read adopted.
  if (resolved) {
    return { resolved: true, adopt: null };
  }

  const nodeScore = readNodeScore(nodeValue);

  // Nothing to take, or a real result of our own to defend. Either way the
  // question is settled and writes may carry `gs` from here on.
  if (!nodeScore || holdsOwnScore(localScore)) {
    return { resolved: true, adopt: null };
  }

  const adopt: GameScore = {};
  nodeScore.forEach((wins, seat) => {
    adopt[seat] = wins;
  });

  return { resolved: true, adopt };
}
