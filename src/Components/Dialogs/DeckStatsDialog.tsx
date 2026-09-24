import { useMemo, useRef } from 'react';
import { Dialog } from './Dialog';
import { useGlobalSettings } from '../../Hooks/useGlobalSettings';
import { useAnalytics } from '../../Hooks/useAnalytics';
import { DeckStat, deckWinRate } from '../../Types/DeckStats';
import { deckStatsToCsv, parseDeckStatsCsv } from '../../Utils/deckStatsCsv';

const secondaryButtonClass =
  'px-3 py-1.5 text-sm border border-divider text-text-primary rounded-md hover:bg-background-paper transition-colors';

const todayStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

const formatAvgPod = (stat: DeckStat) => {
  if (stat.gamesPlayed === 0) return '-';
  const avgOpponents = stat.opponentsFaced / stat.gamesPlayed;
  return (avgOpponents + 1).toFixed(1);
};

export const DeckStatsDialog: React.FC<{
  dialogRef: React.MutableRefObject<HTMLDialogElement | null>;
}> = ({ dialogRef }) => {
  const { deckStats, clearDeckStats, deleteDeck, replaceDeckStats } =
    useGlobalSettings();
  const analytics = useAnalytics();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(() => {
    return Object.entries(deckStats)
      .map(([key, stat]) => ({ key, stat }))
      .sort((a, b) => {
        if (b.stat.gamesPlayed !== a.stat.gamesPlayed) {
          return b.stat.gamesPlayed - a.stat.gamesPlayed;
        }
        return deckWinRate(b.stat) - deckWinRate(a.stat);
      });
  }, [deckStats]);

  const handleClearAll = () => {
    if (confirm('Delete stats for every deck? This cannot be undone.')) {
      clearDeckStats();
      analytics.trackEvent('deck_stats_cleared');
    }
  };

  const handleExport = () => {
    // The BOM makes Excel read the file as UTF-8 (umlauts in deck names).
    const blob = new Blob(['\uFEFF', deckStatsToCsv(deckStats)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lifetrinket-deck-stats-${todayStamp()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = '';
    if (!file) return;

    const result = parseDeckStatsCsv(await file.text());
    if (!result.ok) {
      alert(`Couldn't import ${file.name}:\n\n${result.error}`);
      return;
    }

    const count = Object.keys(result.stats).length;
    if (
      rows.length > 0 &&
      !confirm(
        `Replace the stats for ${rows.length} ${rows.length === 1 ? 'deck' : 'decks'} on this device with the ${count} ${count === 1 ? 'deck' : 'decks'} in ${file.name}?`
      )
    ) {
      return;
    }
    replaceDeckStats(result.stats);
  };

  const importButton = (
    <button
      onClick={() => fileInputRef.current?.click()}
      className={secondaryButtonClass}
    >
      Import
    </button>
  );

  const handleDelete = (key: string, name: string) => {
    if (confirm(`Delete stats for "${name}"?`)) {
      // `key` is already the normalized deck name (deckStats is keyed by it).
      deleteDeck(key);
    }
  };

  return (
    <Dialog id="deck-stats-dialog" title="Deck Stats" dialogRef={dialogRef}>
      <div className="flex flex-col gap-4 py-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportFile}
          className="hidden"
        />
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <svg
              className="w-16 h-16 text-text-secondary opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-text-secondary text-center">
              No deck stats yet.
              <br />
              Name a deck in a player&apos;s menu, then finish a game with the
              match score enabled.
            </p>
            {importButton}
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center">
              <p className="text-sm text-text-secondary">
                {rows.length} {rows.length === 1 ? 'deck' : 'decks'}
              </p>
              <div className="flex gap-2">
                <button onClick={handleExport} className={secondaryButtonClass}>
                  Export
                </button>
                {importButton}
                <button
                  onClick={handleClearAll}
                  className="px-3 py-1.5 text-sm bg-primary-main text-white rounded-md hover:bg-primary-dark transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-text-secondary text-left">
                    <th className="py-2 pr-2 font-medium">Deck</th>
                    <th className="py-2 px-2 font-medium text-right">GP</th>
                    <th className="py-2 px-2 font-medium text-right">W</th>
                    <th className="py-2 px-2 font-medium text-right">L</th>
                    <th className="py-2 px-2 font-medium text-right">Win%</th>
                    <th className="py-2 px-2 font-medium text-right">Opp</th>
                    <th className="py-2 px-2 font-medium text-right">Pod</th>
                    <th className="py-2 pl-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ key, stat }) => (
                    <tr
                      key={key}
                      className="border-t border-divider align-middle"
                    >
                      <td className="py-2 pr-2 font-medium break-words max-w-[10rem]">
                        {stat.name}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {stat.gamesPlayed}
                      </td>
                      <td className="py-2 px-2 text-right text-green-500">
                        {stat.wins}
                      </td>
                      <td className="py-2 px-2 text-right text-red-500">
                        {stat.losses}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {formatPercent(deckWinRate(stat))}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {stat.opponentsFaced}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {formatAvgPod(stat)}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <button
                          onClick={() => handleDelete(key, stat.name)}
                          aria-label={`Delete ${stat.name}`}
                          className="text-text-secondary hover:text-red-500 transition-colors px-1"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-background-paper border border-divider p-3 rounded-lg">
              <p className="text-xs text-text-secondary">
                <strong className="text-text-primary">GP</strong> games played,{' '}
                <strong className="text-text-primary">Opp</strong> total
                opponents faced across all games,{' '}
                <strong className="text-text-primary">Pod</strong> average
                players per game. Stats are stored only on this device. Export
                them as a CSV to back them up or fix them in a spreadsheet;
                importing a CSV replaces all stats.
              </p>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
