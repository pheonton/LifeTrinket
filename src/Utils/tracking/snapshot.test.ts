import { describe, it, expect } from 'vitest';
import { toSeatStates, diffSeats, toSeatScores } from './snapshot';
import { CounterType, Rotation, type Player } from '../../Types/Player';

const makePlayer = (over: Partial<Player> = {}): Player => ({
  lifeTotal: 20,
  index: 0,
  color: '#ffffff',
  iconTheme: 'dark',
  settings: {
    rotation: Rotation.Normal,
    useCommanderDamage: false,
    usePartner: false,
    usePoison: false,
    useEnergy: false,
    useExperience: false,
  },
  commanderDamage: [],
  extraCounters: [],
  isStartingPlayer: false,
  isMonarch: false,
  hasLost: false,
  isSide: false,
  name: 'Player',
  ...over,
});

describe('toSeatStates', () => {
  it('reports life only when no counter is enabled', () => {
    expect(toSeatStates([makePlayer(), makePlayer({ lifeTotal: 17 })])).toEqual([
      { l: 20 },
      { l: 17 },
    ]);
  });

  it('reports poison only when poison is enabled', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, usePoison: true },
      extraCounters: [{ type: CounterType.Poison, value: 4 }],
    });
    expect(toSeatStates([player])).toEqual([{ l: 20, poi: 4 }]);
  });

  it('reports poison as 0 when the counter is enabled but absent', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, usePoison: true },
    });
    expect(toSeatStates([player])).toEqual([{ l: 20, poi: 0 }]);
  });

  it('reports the highest commander damage across every source', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, useCommanderDamage: true },
      commanderDamage: [
        { source: 1, damageTotal: 7, partnerDamageTotal: 2 },
        { source: 2, damageTotal: 3, partnerDamageTotal: 12 },
      ],
    });
    expect(toSeatStates([player])).toEqual([{ l: 20, cmd: 12 }]);
  });
});

describe('diffSeats', () => {
  const two = [{ l: 20 }, { l: 20 }];

  it('produces every path when there is no previous state', () => {
    expect(diffSeats(null, two)).toEqual({ 'p/0/l': 20, 'p/1/l': 20 });
  });

  it('produces nothing when nothing changed', () => {
    expect(diffSeats(two, [{ l: 20 }, { l: 20 }])).toEqual({});
  });

  it('produces only the path that changed', () => {
    expect(diffSeats(two, [{ l: 20 }, { l: 17 }])).toEqual({ 'p/1/l': 17 });
  });

  it('produces a poison path when poison changed', () => {
    expect(diffSeats([{ l: 20, poi: 1 }], [{ l: 20, poi: 2 }])).toEqual({ 'p/0/poi': 2 });
  });

  it('clears a field that disappeared from the next state', () => {
    expect(diffSeats([{ l: 20, poi: 1 }], [{ l: 20 }])).toEqual({ 'p/0/poi': null });
  });

  it('produces nothing for a field absent from both prev and next', () => {
    expect(diffSeats([{ l: 20 }], [{ l: 20 }])).toEqual({});
  });
});

describe('toSeatScores', () => {
  it('defaults every seat to 0 for an empty score', () => {
    expect(toSeatScores({}, 2)).toEqual([0, 0]);
  });

  it('fills in only the seats present in a partial score', () => {
    expect(toSeatScores({ 1: 2 }, 3)).toEqual([0, 2, 0]);
  });

  it('reports a full score for every seat', () => {
    expect(toSeatScores({ 0: 1, 1: 2 }, 2)).toEqual([1, 2]);
  });

  it('ignores entries beyond the number of players', () => {
    expect(toSeatScores({ 0: 1, 1: 2, 5: 9 }, 2)).toEqual([1, 2]);
  });
});
