/**
 * Incumbency Widget
 *
 * Shows anti-incumbency analysis:
 * - Retention rate (party kept seat)
 * - Major incumbent losses
 * - Comparison with previous election
 */

import { memo, useEffect, useState } from 'react';
import { RefreshCw, TrendingDown, TrendingUp, UserX, Shield } from 'lucide-react';
import { Widget } from '../Widget';
import { useElectionStore } from '../../../stores/electionStore';
import { loadElectionData } from '../../elections/electionDataLoader';
import { computeIncumbency, type IncumbencyResult } from '../../elections/electionAnalytics';
import { getPartyColor, getPartyShortLabel } from '../../../lib/partyColors';
import { PROVINCES, type Province } from '../../../data/districts';

type IncumbencyData = IncumbencyResult;

export const IncumbencyWidget = memo(function IncumbencyWidget() {
  const { electionYear, setMapViewLevel, selectProvince, selectDistrict, selectConstituency } = useElectionStore();
  const [data, setData] = useState<IncumbencyData | null>(null);
  const [comparisonYear, setComparisonYear] = useState<number | null>(null);
  const [displayYear, setDisplayYear] = useState<number>(electionYear);
  const [isLoading, setIsLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const focusConstituency = (constituencyId: string, district: string, province: string | null) => {
    setMapViewLevel('constituency');
    if (province && (PROVINCES as readonly string[]).includes(province)) {
      selectProvince(province as Province);
    }
    selectDistrict(district);
    selectConstituency(constituencyId);
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setNote(null);
      try {
        const currentData = await loadElectionData(electionYear);

        // Check if current election has declared results
        const declaredCount = currentData?.constituencies.filter(c => c.status === 'declared').length || 0;

        // Determine which years to compare
        let compareYear: number | null;
        let baseYear: number;

        const hasResults = declaredCount > 0 || (currentData?.results?.some(r => r.total_votes > 0) ?? false);
        if (hasResults) {
          // Current election has results, compare with previous
          baseYear = electionYear;
          compareYear = electionYear === 2082 ? 2079 : electionYear === 2079 ? 2074 : null;
        } else {
          // No results yet, fall back to 2079 vs 2074
          baseYear = 2079;
          compareYear = 2074;
          if (electionYear === 2082) {
            setNote('2082 has no declared results yet. Showing last completed incumbency comparison (2079 vs 2074).');
          }
        }

        setDisplayYear(baseYear);
        setComparisonYear(compareYear);

        if (compareYear) {
          const baseData = baseYear === electionYear ? currentData : await loadElectionData(baseYear);
          const prevData = await loadElectionData(compareYear);
          if (baseData && prevData) {
            const result = computeIncumbency(baseData, prevData);
            setData(result);
          } else {
            setData(null);
          }
        } else {
          setData(null);
        }
      } catch (err) {
        console.error('Failed to load incumbency data:', err);
        setData(null);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [electionYear]);

  return (
    <Widget
      id="incumbency"
      icon={<RefreshCw size={14} />}
      badge={comparisonYear ? `${displayYear} vs ${comparisonYear}` : undefined}
    >
      <div className="h-full flex flex-col p-3 overflow-hidden">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !data ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <RefreshCw size={24} className="text-slate-600 mb-2" />
            <div className="text-xs text-slate-500">No comparison data</div>
            <div className="text-[10px] text-slate-600 mt-1">Select an election with previous data</div>
          </div>
        ) : (
          <>
            {note && (
              <div className="mb-3 p-2 rounded bg-white/[0.02] border border-white/5 text-[10px] text-slate-500">
                {note}
              </div>
            )}
            {/* Retention Rate */}
            <div className="mb-4 p-3 rounded-lg bg-gradient-to-br from-white/[0.02] to-transparent border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] text-slate-500 uppercase tracking-wide">Party Retention Rate</span>
                <div className="flex items-center gap-1">
                  {data.retentionRate >= 50 ? (
                    <Shield size={12} className="text-emerald-500" />
                  ) : (
                    <UserX size={12} className="text-red-500" />
                  )}
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div
                  className="text-3xl font-bold font-mono"
                  style={{ color: data.retentionRate >= 50 ? '#22c55e' : '#ef4444' }}
                >
                  {data.retentionRate.toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-500 mb-1">
                  ({data.retained}/{data.total} seats)
                </div>
              </div>
              <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${data.retentionRate}%` }}
                />
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${100 - data.retentionRate}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[9px]">
                <span className="text-emerald-400">{data.retained} Retained</span>
                <span className="text-red-400">{data.lost} Lost</span>
              </div>
            </div>

            {/* Party-wise Retention */}
            {data.partyRetention.length > 0 && (
              <div className="mb-4">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">By Party</div>
                <div className="space-y-2">
                  {data.partyRetention.slice(0, 5).map((pr) => {
                    const color = getPartyColor(pr.party);
                    return (
                      <div key={pr.party} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                        <span className="text-[10px] text-slate-300 w-12">{getPartyShortLabel(pr.party)}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-emerald-500/70"
                            style={{ width: `${pr.rate}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-400 w-14 text-right">
                          {pr.retained}/{pr.retained + pr.lost}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Major Losses */}
            {data.majorLosses.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">
                  Notable Seat Changes
                </div>
                <div className="space-y-2">
                  {data.majorLosses.slice(0, 8).map((loss, idx) => (
                    <button
                      key={idx}
                      onClick={() => focusConstituency(loss.constituencyId, loss.district, typeof loss.province === 'string' ? loss.province : String(loss.province))}
                      className="w-full text-left p-2 rounded bg-red-500/5 border border-red-500/20 hover:border-red-500/40 transition-colors"
                    >
                      <div className="text-[10px] font-medium text-slate-200 mb-1">{loss.constituency}</div>
                      <div className="flex items-center gap-1 text-[9px]">
                        <div
                          className="w-2 h-2 rounded-sm"
                          style={{ background: getPartyColor(loss.prevParty) }}
                        />
                        <span style={{ color: getPartyColor(loss.prevParty) }}>
                          {getPartyShortLabel(loss.prevParty)}
                        </span>
                        <TrendingDown size={10} className="text-red-500 mx-1" />
                        <div
                          className="w-2 h-2 rounded-sm"
                          style={{ background: getPartyColor(loss.newParty) }}
                        />
                        <span style={{ color: getPartyColor(loss.newParty) }}>
                          {getPartyShortLabel(loss.newParty)}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1">{loss.district}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Widget>
  );
});
