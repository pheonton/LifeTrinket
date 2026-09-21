import { describe, it, expect } from 'vitest';
import { planGameAdoption, readNodeScore, readNodeSeats } from './joinAdoption';
import { toSeatScores } from './snapshot';

const liveNode = (over: Record<string, unknown> = {}) => ({
  v: 1,
  st: 'live',
  t0: 1,
  exp: 2,
  up: 3,
  wr: 'other',
  p: [{ l: 20 }, { l: 18 }],
  ...over,
});

/** The common case: a phone that has just scanned the link, at a two-seat table. */
const joining = {
  resolved: false,
  joining: true,
  localScore: {},
  seatCount: 2,
};

describe('readNodeScore', () => {
  it('reads a well formed seat-indexed score', () => {
    expect(readNodeScore(liveNode({ gs: [1, 1] }))).toEqual([1, 1]);
  });

  it('returns null for a node that carries no score', () => {
    expect(readNodeScore(liveNode())).toBeNull();
  });

  it('returns null when there is no node at all', () => {
    expect(readNodeScore(null)).toBeNull();
    expect(readNodeScore(undefined)).toBeNull();
  });

  it('returns null for a score that is all zeroes', () => {
    expect(readNodeScore(liveNode({ gs: [0, 0] }))).toBeNull();
  });

  it('refuses a score that is not an array', () => {
    expect(readNodeScore(liveNode({ gs: 1 }))).toBeNull();
    expect(readNodeScore(liveNode({ gs: { 0: 1, 1: 0 } }))).toBeNull();
  });

  it('refuses a score with an entry the database rules could not hold', () => {
    expect(readNodeScore(liveNode({ gs: [1, -1] }))).toBeNull();
    expect(readNodeScore(liveNode({ gs: [1, 1.5] }))).toBeNull();
    expect(readNodeScore(liveNode({ gs: [1, 100] }))).toBeNull();
    expect(readNodeScore(liveNode({ gs: [1, '1'] }))).toBeNull();
    expect(readNodeScore(liveNode({ gs: [1, null] }))).toBeNull();
  });

  it('refuses a score with no seats, or more seats than a game can have', () => {
    expect(readNodeScore(liveNode({ gs: [] }))).toBeNull();
    expect(readNodeScore(liveNode({ gs: [1, 0, 0, 0, 0, 0, 0] }))).toBeNull();
  });
});

describe('readNodeSeats', () => {
  it('reads the life totals a live node carries', () => {
    expect(readNodeSeats(liveNode(), 2)).toEqual([{ l: 20 }, { l: 18 }]);
  });

  it('reads the per-seat counters alongside the life totals', () => {
    expect(
      readNodeSeats(liveNode({ p: [{ l: 14, poi: 3 }, { l: 9, cmd: 18 }] }), 2)
    ).toEqual([
      { l: 14, poi: 3 },
      { l: 9, cmd: 18 },
    ]);
  });

  it('returns null when there is no node at all', () => {
    expect(readNodeSeats(null, 2)).toBeNull();
    expect(readNodeSeats(undefined, 2)).toBeNull();
    expect(readNodeSeats('not a node', 2)).toBeNull();
  });

  it('returns null for a node with no seats', () => {
    expect(readNodeSeats(liveNode({ p: undefined }), 2)).toBeNull();
    expect(readNodeSeats(liveNode({ p: [] }), 0)).toBeNull();
    expect(readNodeSeats(liveNode({ p: { 0: { l: 20 } } }), 1)).toBeNull();
  });

  // Requirement 6: a node of a different shape is a different table.
  it('refuses a node with fewer seats than this table', () => {
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }] }), 2)).toBeNull();
  });

  it('refuses a node with more seats than this table', () => {
    expect(
      readNodeSeats(liveNode({ p: [{ l: 14 }, { l: 9 }, { l: 20 }] }), 2)
    ).toBeNull();
  });

  it('refuses a seat that carries no life total', () => {
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }, { poi: 2 }] }), 2)).toBeNull();
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }, null] }), 2)).toBeNull();
  });

  it('refuses a value the database rules could not hold', () => {
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }, { l: '9' }] }), 2)).toBeNull();
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }, { l: 9.5 }] }), 2)).toBeNull();
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }, { l: -1000 }] }), 2)).toBeNull();
    expect(readNodeSeats(liveNode({ p: [{ l: 14 }, { l: 10000 }] }), 2)).toBeNull();
    expect(
      readNodeSeats(liveNode({ p: [{ l: 14 }, { l: 9, poi: -1 }] }), 2)
    ).toBeNull();
    expect(
      readNodeSeats(liveNode({ p: [{ l: 14 }, { l: 9, cmd: 1000 }] }), 2)
    ).toBeNull();
  });

  it('ignores a child the node has no business carrying', () => {
    expect(
      readNodeSeats(liveNode({ p: [{ l: 14, junk: 1 }, { l: 9 }] }), 2)
    ).toEqual([{ l: 14 }, { l: 9 }]);
  });
});

describe('planGameAdoption', () => {
  // Requirement 1: a device joining a game in progress takes its life totals.
  it('adopts the life totals when this device is joining', () => {
    expect(
      planGameAdoption({ ...joining, nodeValue: liveNode() })
    ).toEqual({ resolved: true, score: null, seats: [{ l: 20 }, { l: 18 }] });
  });

  it('adopts the life totals and the score together', () => {
    expect(
      planGameAdoption({
        ...joining,
        nodeValue: liveNode({ p: [{ l: 14 }, { l: 9 }], gs: [1, 1] }),
      })
    ).toEqual({
      resolved: true,
      score: { 0: 1, 1: 1 },
      seats: [{ l: 14 }, { l: 9 }],
    });
  });

  it('adopts the per-seat counters the node carries', () => {
    expect(
      planGameAdoption({
        ...joining,
        nodeValue: liveNode({ p: [{ l: 14, poi: 3 }, { l: 9, cmd: 18 }] }),
      }).seats
    ).toEqual([
      { l: 14, poi: 3 },
      { l: 9, cmd: 18 },
    ]);
  });

  // Requirement 3: a device that already holds this game keeps everything.
  it('adopts no life totals on a reload of a game this device holds', () => {
    expect(
      planGameAdoption({
        ...joining,
        joining: false,
        nodeValue: liveNode({ p: [{ l: 20 }, { l: 20 }] }),
      }).seats
    ).toBeNull();
  });

  it('keeps its own life totals even when the node is further along', () => {
    expect(
      planGameAdoption({
        ...joining,
        joining: false,
        nodeValue: liveNode({ p: [{ l: 3 }, { l: 1 }], gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, score: { 0: 1, 1: 1 }, seats: null });
  });

  // Requirement 4: a genuinely new game is unaffected.
  it('adopts nothing when there is no node', () => {
    expect(planGameAdoption({ ...joining, nodeValue: null })).toEqual({
      resolved: true,
      score: null,
      seats: null,
    });
  });

  it('adopts nothing from a node that does not parse', () => {
    expect(planGameAdoption({ ...joining, nodeValue: 'not a node' })).toEqual({
      resolved: true,
      score: null,
      seats: null,
    });
  });

  // Requirement 6: a node built for another table must not reach this one.
  it('adopts no life totals when the node seats a different table', () => {
    expect(
      planGameAdoption({
        ...joining,
        nodeValue: liveNode({ p: [{ l: 14 }, { l: 9 }, { l: 20 }] }),
      }).seats
    ).toBeNull();
  });

  it('still adopts the score from a node that seats a different table', () => {
    expect(
      planGameAdoption({
        ...joining,
        nodeValue: liveNode({ p: [{ l: 14 }], gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, score: { 0: 1, 1: 1 }, seats: null });
  });

  // The question is asked once per connected game.
  it('adopts nothing once the question has been answered', () => {
    expect(
      planGameAdoption({
        ...joining,
        resolved: true,
        nodeValue: liveNode({ p: [{ l: 14 }, { l: 9 }], gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, score: null, seats: null });
  });

  it('resolves on every outcome, so writes stop omitting the score', () => {
    const nodes = [null, liveNode(), liveNode({ gs: [1, 1] }), { junk: true }];
    nodes.forEach((nodeValue) => {
      expect(planGameAdoption({ ...joining, nodeValue }).resolved).toBe(true);
    });
  });
});

// Requirement 2: the score decision is the one that was verified against the
// live database, and it is unchanged. Its gate stays the score this device
// holds, not the game -- a device reloading mid-first-game holds no score yet.
describe('planGameAdoption: the score, unchanged', () => {
  it('adopts the node score when this device has none', () => {
    expect(
      planGameAdoption({ ...joining, nodeValue: liveNode({ gs: [1, 1] }) }).score
    ).toEqual({ 0: 1, 1: 1 });
  });

  it('treats an all-zero local score as no score of its own', () => {
    expect(
      planGameAdoption({
        ...joining,
        localScore: { 0: 0, 1: 0 },
        nodeValue: liveNode({ gs: [0, 2] }),
      }).score
    ).toEqual({ 0: 0, 1: 2 });
  });

  it('publishes exactly what it adopted, not zero', () => {
    const plan = planGameAdoption({
      ...joining,
      nodeValue: liveNode({ gs: [1, 1] }),
    });
    expect(plan.score).not.toBeNull();
    expect(toSeatScores(plan.score!, 2)).toEqual([1, 1]);
  });

  it('adopts nothing when the node carries no score', () => {
    expect(planGameAdoption({ ...joining, nodeValue: liveNode() }).score).toBeNull();
  });

  it('adopts nothing from a node whose score is all zeroes', () => {
    expect(
      planGameAdoption({ ...joining, nodeValue: liveNode({ gs: [0, 0] }) }).score
    ).toBeNull();
  });

  it('never overwrites a score this device already holds', () => {
    expect(
      planGameAdoption({
        ...joining,
        localScore: { 0: 2, 1: 1 },
        nodeValue: liveNode({ gs: [1, 1] }),
      }).score
    ).toBeNull();
  });

  it('keeps its own score even when the node claims more wins', () => {
    expect(
      planGameAdoption({
        ...joining,
        localScore: { 1: 1 },
        nodeValue: liveNode({ gs: [2, 0] }),
      }).score
    ).toBeNull();
  });

  it('adopts the score on a rejoin even though the life totals are kept', () => {
    expect(
      planGameAdoption({
        ...joining,
        joining: false,
        nodeValue: liveNode({ gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, score: { 0: 1, 1: 1 }, seats: null });
  });
});
