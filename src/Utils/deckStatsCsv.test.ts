import { describe, expect, it } from 'vitest';
import { deckStatsToCsv, parseDeckStatsCsv } from './deckStatsCsv';
import type { DeckStats } from '../Types/DeckStats';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

const stats: DeckStats = {
  goblins: {
    name: 'Goblins',
    gamesPlayed: 3,
    wins: 2,
    losses: 1,
    opponentsFaced: 7,
    lastPlayed: at(2026, 9, 24, 21, 15),
  },
  'krenko, "mob boss"': {
    name: 'Krenko, "Mob Boss"',
    gamesPlayed: 1,
    wins: 0,
    losses: 1,
    opponentsFaced: 3,
    lastPlayed: at(2026, 9, 1, 9, 5),
  },
};

const parse = (csv: string) => {
  const result = parseDeckStatsCsv(csv);
  if (!result.ok) throw new Error(result.error);
  return result.stats;
};

const errorOf = (csv: string) => {
  const result = parseDeckStatsCsv(csv);
  return result.ok ? null : result.error;
};

describe('deckStatsToCsv', () => {
  it('writes a header and one row per deck, sorted by name', () => {
    expect(deckStatsToCsv(stats).split('\r\n')).toEqual([
      'deck,games,wins,losses,opponents_faced,last_played',
      'Goblins,3,2,1,7,2026-09-24 21:15',
      '"Krenko, ""Mob Boss""",1,0,1,3,2026-09-01 09:05',
      '',
    ]);
  });
});

describe('parseDeckStatsCsv', () => {
  it('round-trips an export', () => {
    expect(parse(deckStatsToCsv(stats))).toEqual(stats);
  });

  it('reads a semicolon file with a BOM, as a German spreadsheet saves it', () => {
    const csv =
      '\uFEFFdeck;games;wins;losses;opponents_faced;last_played\n' +
      'Goblins;3;2;1;7;24.09.2026 21:15\n';
    expect(parse(csv).goblins).toEqual(stats.goblins);
  });

  it('matches columns by name, ignores extra ones, and allows no date', () => {
    const csv =
      'Wins,Deck,Notes,Losses,Games,Opponents_Faced\n' +
      '1,Elves,added by hand,1,2,6\n';
    expect(parse(csv)).toEqual({
      elves: {
        name: 'Elves',
        gamesPlayed: 2,
        wins: 1,
        losses: 1,
        opponentsFaced: 6,
        lastPlayed: 0,
      },
    });
  });

  it('skips blank rows', () => {
    const csv = 'deck,games,wins,losses,opponents_faced\n,,,,\nElves,1,1,0,3\n\n';
    expect(Object.keys(parse(csv))).toEqual(['elves']);
  });

  it('rejects a missing column', () => {
    expect(errorOf('deck,games,wins\nElves,1,1\n')).toMatch(
      /Missing columns: losses, opponents_faced/
    );
  });

  it('rejects a count that is not a whole number, naming the row', () => {
    expect(
      errorOf('deck,games,wins,losses,opponents_faced\nElves,1,1,0,3\nGoblins,two,1,1,3\n')
    ).toMatch(/^Row 3 \("Goblins"\): games/);
  });

  it('rejects wins and losses that do not add up to games', () => {
    expect(
      errorOf('deck,games,wins,losses,opponents_faced\nElves,5,3,1,12\n')
    ).toMatch(/wins \(3\) \+ losses \(1\) must equal games \(5\)/);
  });

  it('rejects the same deck twice, however it is spelled', () => {
    expect(
      errorOf('deck,games,wins,losses,opponents_faced\nElves,1,1,0,3\n elves ,1,0,1,3\n')
    ).toMatch(/Row 3: "elves" is listed more than once/);
  });

  it('rejects a row with numbers but no deck name', () => {
    expect(errorOf('deck,games,wins,losses,opponents_faced\n,1,1,0,3\n')).toMatch(
      /Row 2: the deck name is empty/
    );
  });

  it('rejects a file without decks', () => {
    expect(errorOf('deck,games,wins,losses,opponents_faced\n')).toMatch(/no decks/);
    expect(errorOf('')).toMatch(/empty/);
  });
});
