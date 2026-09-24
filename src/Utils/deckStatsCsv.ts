import { DeckStat, DeckStats, normalizeDeckName } from '../Types/DeckStats';

/**
 * CSV import/export for deck stats, so they can be backed up and corrected in
 * a spreadsheet (e.g. to add a game that wasn't recorded).
 *
 * Import is deliberately forgiving about what spreadsheets do to a file on
 * re-save (`;` delimiters in German locales, a UTF-8 BOM, reordered or extra
 * columns, reformatted dates) and strict about the numbers.
 */

const COLUMNS = [
  'deck',
  'games',
  'wins',
  'losses',
  'opponents_faced',
  'last_played',
] as const;

const COUNT_COLUMNS = ['games', 'wins', 'losses', 'opponents_faced'] as const;
const REQUIRED_COLUMNS = ['deck', ...COUNT_COLUMNS] as const;

const pad = (n: number) => String(n).padStart(2, '0');

const formatDate = (epochMs: number): string => {
  if (!epochMs) return '';
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// Local time, matching formatDate. Accepts ISO-style and German (DD.MM.YYYY)
// dates; anything else reads as "never", since it only orders deck chips.
const parseDate = (raw: string): number => {
  const value = raw.trim();
  const time = (h?: string, m?: string, s?: string) =>
    [Number(h ?? 0), Number(m ?? 0), Number(s ?? 0)] as const;

  const iso = value.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    return new Date(Number(y), Number(mo) - 1, Number(d), ...time(h, mi, s)).getTime();
  }

  const de = value.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}),? *(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (de) {
    const [, d, mo, y, h, mi, s] = de;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return new Date(year, Number(mo) - 1, Number(d), ...time(h, mi, s)).getTime();
  }

  return 0;
};

const escapeCell = (value: string): string =>
  /[",;\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const deckStatsToCsv = (stats: DeckStats): string => {
  const rows = Object.values(stats)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((stat) =>
      [
        escapeCell(stat.name),
        stat.gamesPlayed,
        stat.wins,
        stat.losses,
        stat.opponentsFaced,
        formatDate(stat.lastPlayed),
      ].join(',')
    );
  return [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
};

const detectDelimiter = (headerLine: string): string => {
  const counts = [',', ';', '\t'].map((d) => ({
    d,
    n: headerLine.split(d).length,
  }));
  return counts.sort((a, b) => b.n - a.n)[0].d;
};

// RFC 4180: quoted cells may contain the delimiter, newlines and "" escapes.
const parseCsv = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

export type DeckStatsImportResult =
  | { ok: true; stats: DeckStats }
  | { ok: false; error: string };

export const parseDeckStatsCsv = (input: string): DeckStatsImportResult => {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const [header, ...body] = parseCsv(text, detectDelimiter(firstLine));

  if (!header) {
    return { ok: false, error: 'The file is empty.' };
  }

  const columnIndex = new Map(
    header.map((name, i) => [name.trim().toLowerCase(), i])
  );
  const missing = REQUIRED_COLUMNS.filter((c) => !columnIndex.has(c));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected: ${COLUMNS.join(', ')}.`,
    };
  }

  const cellOf = (row: string[], column: (typeof COLUMNS)[number]) => {
    const i = columnIndex.get(column);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const stats: DeckStats = {};

  for (const [i, row] of body.entries()) {
    // Spreadsheet row number: the header is row 1.
    const rowNumber = i + 2;
    const name = cellOf(row, 'deck').replace(/\s+/g, ' ');

    if (!name) {
      if (row.some((cell) => cell.trim() !== '')) {
        return { ok: false, error: `Row ${rowNumber}: the deck name is empty.` };
      }
      continue;
    }

    const counts = {} as Record<(typeof COUNT_COLUMNS)[number], number>;
    for (const column of COUNT_COLUMNS) {
      const raw = cellOf(row, column);
      if (!/^\d+$/.test(raw)) {
        return {
          ok: false,
          error: `Row ${rowNumber} ("${name}"): ${column} must be a whole number of 0 or more, got "${raw}".`,
        };
      }
      counts[column] = Number(raw);
    }

    const stat: DeckStat = {
      name,
      gamesPlayed: counts.games,
      wins: counts.wins,
      losses: counts.losses,
      opponentsFaced: counts.opponents_faced,
      lastPlayed: parseDate(cellOf(row, 'last_played')),
    };

    if (stat.wins + stat.losses !== stat.gamesPlayed) {
      return {
        ok: false,
        error: `Row ${rowNumber} ("${name}"): wins (${stat.wins}) + losses (${stat.losses}) must equal games (${stat.gamesPlayed}).`,
      };
    }

    const key = normalizeDeckName(name);
    if (key in stats) {
      return {
        ok: false,
        error: `Row ${rowNumber}: "${name}" is listed more than once.`,
      };
    }
    stats[key] = stat;
  }

  if (Object.keys(stats).length === 0) {
    return { ok: false, error: 'The file contains no decks.' };
  }

  return { ok: true, stats };
};
