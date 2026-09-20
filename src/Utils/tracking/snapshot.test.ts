import { describe, it, expect } from 'vitest';
import {
  toSeatStates,
  diffSeats,
  toSeatScores,
  applySeatStates,
} from './snapshot';
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

describe('applySeatStates', () => {
  const table = () => [
    makePlayer({ index: 0 }),
    makePlayer({ index: 1, lifeTotal: 20 }),
  ];

  it('takes the life total of every seat', () => {
    const adopted = applySeatStates(table(), [{ l: 14 }, { l: 9 }]);
    expect(adopted.map((p) => p.lifeTotal)).toEqual([14, 9]);
  });

  it('changes nothing else about a player', () => {
    const before = table();
    const [adopted] = applySeatStates(before, [{ l: 14 }, { l: 9 }]);
    expect({ ...adopted, lifeTotal: 20 }).toEqual(before[0]);
  });

  it('leaves the players it was given untouched', () => {
    const before = table();
    applySeatStates(before, [{ l: 14 }, { l: 9 }]);
    expect(before.map((p) => p.lifeTotal)).toEqual([20, 20]);
  });

  it('takes poison, and shows the counter the node says is in play', () => {
    const [adopted] = applySeatStates(table(), [
      { l: 14, poi: 3 },
      { l: 9 },
    ]);
    expect(adopted.settings.usePoison).toBe(true);
    expect(adopted.extraCounters).toEqual([{ type: CounterType.Poison, value: 3 }]);
  });

  it('takes poison into a counter the player already has', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, usePoison: true },
      extraCounters: [
        { type: CounterType.Energy, value: 2 },
        { type: CounterType.Poison, value: 1 },
      ],
    });
    const [adopted] = applySeatStates([player], [{ l: 14, poi: 5 }]);
    expect(adopted.extraCounters).toEqual([
      { type: CounterType.Energy, value: 2 },
      { type: CounterType.Poison, value: 5 },
    ]);
  });

  it('leaves poison alone when the node carries none', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, usePoison: true },
      extraCounters: [{ type: CounterType.Poison, value: 4 }],
    });
    const [adopted] = applySeatStates([player], [{ l: 14 }]);
    expect(adopted.settings.usePoison).toBe(true);
    expect(adopted.extraCounters).toEqual([{ type: CounterType.Poison, value: 4 }]);
  });

  // A tracked game starts as a non-commander game, but the node is the
  // record of what is being played, and it overturns that.
  const commanderTable = () => [
    makePlayer({
      index: 0,
      commanderDamage: [
        { source: 0, damageTotal: 0, partnerDamageTotal: 0 },
        { source: 1, damageTotal: 0, partnerDamageTotal: 0 },
      ],
    }),
    makePlayer({
      index: 1,
      commanderDamage: [
        { source: 0, damageTotal: 0, partnerDamageTotal: 0 },
        { source: 1, damageTotal: 0, partnerDamageTotal: 0 },
      ],
    }),
  ];

  it('takes commander damage onto the opponent that can have dealt it', () => {
    const [adopted] = applySeatStates(commanderTable(), [
      { l: 14, cmd: 18 },
      { l: 9, cmd: 0 },
    ]);
    expect(adopted.commanderDamage).toEqual([
      { source: 0, damageTotal: 0, partnerDamageTotal: 0 },
      { source: 1, damageTotal: 18, partnerDamageTotal: 0 },
    ]);
  });

  it('shows commander damage at every seat once the node carries any', () => {
    const adopted = applySeatStates(commanderTable(), [
      { l: 14, cmd: 18 },
      { l: 9 },
    ]);
    expect(adopted.map((p) => p.settings.useCommanderDamage)).toEqual([
      true,
      true,
    ]);
  });

  it('leaves the format alone for a node whose damage is all zeroes', () => {
    const adopted = applySeatStates(commanderTable(), [
      { l: 14, cmd: 0 },
      { l: 9, cmd: 0 },
    ]);
    expect(adopted.map((p) => p.settings.useCommanderDamage)).toEqual([
      false,
      false,
    ]);
    expect(adopted[0].commanderDamage).toEqual(commanderTable()[0].commanderDamage);
  });

  it('leaves the format alone for a node that carries no damage at all', () => {
    const adopted = applySeatStates(commanderTable(), [{ l: 14 }, { l: 9 }]);
    expect(adopted.map((p) => p.settings.useCommanderDamage)).toEqual([
      false,
      false,
    ]);
  });

  it('survives a player with no opponents to place damage on', () => {
    const [adopted] = applySeatStates(
      [makePlayer({ index: 0, commanderDamage: [] })],
      [{ l: 14, cmd: 18 }]
    );
    expect(adopted.settings.useCommanderDamage).toBe(true);
    expect(adopted.commanderDamage).toEqual([]);
  });

  it('refuses a seat list that is not this table', () => {
    const before = table();
    expect(applySeatStates(before, [{ l: 14 }])).toBe(before);
    expect(applySeatStates(before, [{ l: 14 }, { l: 9 }, { l: 4 }])).toBe(before);
  });
});
