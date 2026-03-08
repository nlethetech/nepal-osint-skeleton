/**
 * Swing Analysis Widget
 *
 * Shows seat changes between elections:
 * - Gains and losses by party
 * - Net swing visualization
 * - Comparison selector
 */

import { memo, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Widget } from '../Widget';
import { useElectionStore } from '../../../stores/electionStore';
import { loadElectionData, type ElectionData } from '../../elections/electionDataLoader';
import { computeSwing, type SwingEntry as SwingEntryComputed } from '../../elections/electionAnalytics';
import { getPartyColor, getPartyShortLabel } from '../../../lib/partyColors';

type SwingEntry = SwingEntryComputed;

export const SwingAnalysisWidget = memo(function SwingAnalysisWidget() {
  const { electionYear } = useElectionStore();
  const [swingData, setSwingData] = useState<SwingEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [comparisonYear, setComparisonYear] = useState<number | null>(null);
  const [displayYear, setDisplayYear] = useState<number>(electionYear);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setNote(null);
      try {
        const currentData = await loadElectionData(electionYear);

        // Check if current election has declared results
        const declaredCount = currentData?.constituencies.filter(c => c.status === 'declared').length || 0;

        // Determine which years to compare
        let compareYear: number;
        let baseYear: number;

        const hasResults = declaredCount > 0 || (currentData?.results?.some(r => r.total_votes > 0) ?? false);
        if (hasResults) {
          // Current election has results, compare with previous
          baseYear = electionYear;
          compareYear = electionYear === 2082 ? 2079 : electionYear === 2079 ? 2074 : 0;
        } else {
          // No results yet, fall back to 2079 vs 2074
          baseYear = 2079;
          compareYear = 2074;
          if (electionYear === 2082) {
            setNote('2082 has no declared results yet. Showing last completed comparison (2079 vs 2074).');
          }
        }

        setDisplayYear(baseYear);
        setComparisonYear(compareYear);

        if (compareYear > 0) {
          const baseData = baseYear === electionYear ? currentData : await loadElectionData(baseYear);
          const prevData = await loadElectionData(compareYear);

          if (baseData && prevData) {
            setSwingData(computeSwing(baseData, prevData).slice(0, 10));
          } else {
            setSwingData([]);
          }
        } else {
          setSwingData([]);
        }
      } catch (err) {
        console.error('Failed to load swing data:', err);
        setSwingData([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [electionYear]);

  // Find top gainer and top loser
  const topGainer = swingData.filter(s => s.net > 0).sort((a, b) => b.net - a.net)[0];
  const topLoser = swingData.filter(s => s.net < 0).sort((a, b) => a.net - b.net)[0];
  const maxSwing = Math.max(...swingData.map(s => Math.abs(s.net)), 1);

  return (
    <Widget
      id="swing-analysis"
      icon={<TrendingUp size={14} />}
      badge={comparisonYear ? `${displayYear} vs ${comparisonYear}` : undefined}
    >
      <div className="h-full flex flex-col p-3 overflow-hidden">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : swingData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <TrendingUp size={24} className="mx-auto mb-2 text-slate-600" />
              <div className="text-xs text-slate-500">No comparison data available</div>
              <div className="text-[10px] text-slate-600 mt-1">Select an election with previous data</div>
            </div>
          </div>
        ) : (
          <>
            {note && (
              <div className="mb-3 p-2 rounded bg-white/[0.02] border border-white/5 text-[10px] text-slate-500">
                {note}
              </div>
            )}
            {/* Summary - Top Gainer & Top Loser */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-1 mb-1">
                  <ArrowUpRight size={10} className="text-emerald-500" />
                  <span className="text-[8px] text-emerald-500 font-semibold uppercase tracking-wide">Top Gainer</span>
                </div>
                {topGainer ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded"
                      style={{ background: getPartyColor(topGainer.party) }}
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">{getPartyShortLabel(topGainer.party)}</div>
                      <div className="text-lg font-bold text-emerald-400 font-mono">+{topGainer.net}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">—</div>
                )}
              </div>
              <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-1 mb-1">
                  <ArrowDownRight size={10} className="text-red-500" />
                  <span className="text-[8px] text-red-500 font-semibold uppercase tracking-wide">Top Loser</span>
                </div>
                {topLoser ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded"
                      style={{ background: getPartyColor(topLoser.party) }}
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">{getPartyShortLabel(topLoser.party)}</div>
                      <div className="text-lg font-bold text-red-400 font-mono">{topLoser.net}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">—</div>
                )}
              </div>
            </div>

            {/* Swing Bars */}
            <div className="flex-1 overflow-y-auto">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">Seat Changes by Party</div>
              <div className="space-y-3">
                {swingData.map((entry) => {
                  const color = getPartyColor(entry.party);
                  const widthPct = (Math.abs(entry.net) / maxSwing) * 50;
                  const isGain = entry.net > 0;
                  const isLoss = entry.net < 0;

                  return (
                    <div key={entry.party}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                          <span className="text-[10px] font-medium text-slate-300">
                            {getPartyShortLabel(entry.party)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {isGain && <ArrowUpRight size={10} className="text-emerald-500" />}
                          {isLoss && <ArrowDownRight size={10} className="text-red-500" />}
                          {entry.net === 0 && <Minus size={10} className="text-slate-500" />}
                          <span
                            className="text-[11px] font-bold font-mono"
                            style={{ color: isGain ? '#22c55e' : isLoss ? '#ef4444' : '#64748b' }}
                          >
                            {isGain ? '+' : ''}{entry.net}
                          </span>
                        </div>
                      </div>

                      {/* Bidirectional bar */}
                      <div className="flex items-center h-2 gap-0.5">
                        {/* Left side (losses) */}
                        <div className="flex-1 flex justify-end">
                          {isLoss && (
                            <div
                              className="h-full rounded-l bg-red-500/60"
                              style={{ width: `${widthPct}%` }}
                            />
                          )}
                        </div>
                        {/* Center line */}
                        <div className="w-px h-full bg-slate-600" />
                        {/* Right side (gains) */}
                        <div className="flex-1">
                          {isGain && (
                            <div
                              className="h-full rounded-r bg-emerald-500/60"
                              style={{ width: `${widthPct}%` }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Seats comparison */}
                      <div className="flex justify-between mt-0.5 text-[9px] text-slate-500">
                        <span>{comparisonYear}: {entry.previousSeats}</span>
                        <span>{displayYear}: {entry.currentSeats}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Widget>
  );
});
