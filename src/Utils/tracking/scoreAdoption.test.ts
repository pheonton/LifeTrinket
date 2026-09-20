import { describe, it, expect } from 'vitest';
import { planScoreAdoption, readNodeScore } from './scoreAdoption';
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

describe('planScoreAdoption', () => {
  // Requirement 1: a device joining a game in progress takes the node's score.
  it('adopts the node score when this device has none', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: {},
        nodeValue: liveNode({ gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, adopt: { 0: 1, 1: 1 } });
  });

  it('treats an all-zero local score as no score of its own', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: { 0: 0, 1: 0 },
        nodeValue: liveNode({ gs: [0, 2] }),
      })
    ).toEqual({ resolved: true, adopt: { 0: 0, 1: 2 } });
  });

  it('publishes exactly what it adopted, not zero', () => {
    const plan = planScoreAdoption({
      resolved: false,
      localScore: {},
      nodeValue: liveNode({ gs: [1, 1] }),
    });
    expect(plan.adopt).not.toBeNull();
    expect(toSeatScores(plan.adopt!, 2)).toEqual([1, 1]);
  });

  // Requirement 2: a genuinely new game is unaffected.
  it('adopts nothing when there is no node', () => {
    expect(
      planScoreAdoption({ resolved: false, localScore: {}, nodeValue: null })
    ).toEqual({ resolved: true, adopt: null });
  });

  it('adopts nothing when the node carries no score', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: {},
        nodeValue: liveNode(),
      })
    ).toEqual({ resolved: true, adopt: null });
  });

  it('adopts nothing from a node whose score is all zeroes', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: {},
        nodeValue: liveNode({ gs: [0, 0] }),
      })
    ).toEqual({ resolved: true, adopt: null });
  });

  // Requirement 3: this device's own score always wins.
  it('never overwrites a score this device already holds', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: { 0: 2, 1: 1 },
        nodeValue: liveNode({ gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, adopt: null });
  });

  it('keeps its own score even when the node claims more wins', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: { 1: 1 },
        nodeValue: liveNode({ gs: [2, 0] }),
      })
    ).toEqual({ resolved: true, adopt: null });
  });

  // Requirement 5: the question is asked once per connected game.
  it('adopts nothing once the score has already been resolved', () => {
    expect(
      planScoreAdoption({
        resolved: true,
        localScore: {},
        nodeValue: liveNode({ gs: [1, 1] }),
      })
    ).toEqual({ resolved: true, adopt: null });
  });

  it('resolves on every outcome, so writes stop omitting the score', () => {
    const nodes = [null, liveNode(), liveNode({ gs: [1, 1] }), { junk: true }];
    nodes.forEach((nodeValue) => {
      expect(
        planScoreAdoption({ resolved: false, localScore: {}, nodeValue })
          .resolved
      ).toBe(true);
    });
  });

  it('adopts nothing from a node that does not parse', () => {
    expect(
      planScoreAdoption({
        resolved: false,
        localScore: {},
        nodeValue: 'not a node',
      })
    ).toEqual({ resolved: true, adopt: null });
  });
});
