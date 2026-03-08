/**
 * Election Status Widget
 *
 * Compact Palantir-style widget showing:
 * - Election year & status
 * - Declared/Counting/Pending counts
 * - Party standings with progress bars
 * - Turnout indicator
 */

import { memo, useEffect, useState, useCallback } from 'react';
import { Vote, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Widget } from '../Widget';
import { useElectionStore } from '../../../stores/electionStore';
import axios from 'axios';
import { getPartyColor, getPartyShortLabel } from '../../../utils/partyColors';

interface PartySeat {
  party: string;
  seats: number;
  won: number;
  leading: number;
  votePct: number;
}

interface Summary {
  declared: number;
  counting: number;
  pending: number;
  total: number;
  turnout: number;
  leadingParty: string;
  leadingSeats: number;
  totalVotes: number;
}

export const ElectionStatusWidget = memo(function ElectionStatusWidget() {
  const { electionYear, setElectionYear, availableYears } = useElectionStore();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [partySeats, setPartySeats] = useState<PartySeat[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get('/api/v1/election-results/live-snapshot');
      const ns = res.data?.national_summary;
      if (ns) {
        setSummary({
          declared: ns.declared || 0,
          counting: ns.counting || 0,
          pending: ns.pending || 0,
          total: ns.total_constituencies || 165,
          turnout: ns.turnout_pct || 0,
          leadingParty: ns.leading_party || '',
          leadingSeats: ns.leading_party_seats || 0,
          totalVotes: ns.total_votes_cast || 0,
        });
        const seats = (ns.party_seats || [])
          .sort((a: any, b: any) => (b.seats || 0) - (a.seats || 0))
          .slice(0, 8)
          .map((p: any) => ({
            party: p.party,
            seats: p.seats || 0,
            won: p.won ?? p.seats ?? 0,
            leading: p.leading ?? 0,
            votePct: 0,
          }));
        setPartySeats(seats);
      }
    } catch {
      // keep old data
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const progressPct = summary ? (summary.declared / summary.total) * 100 : 0;
  const maxSeats = partySeats[0]?.seats || 1;

  return (
    <Widget
      id="election-status"
      icon={<Vote size={14} />}
      actions={
        <select
          value={electionYear}
          onChange={(e) => setElectionYear(Number(e.target.value))}
          className="text-[10px] font-semibold bg-[#141619] border border-white/10 rounded px-2 py-0.5 text-slate-300"
        >
          {availableYears.map(y => (
            <option key={y} value={y}>{y} BS</option>
          ))}
        </select>
      }
    >
      <div className="flex flex-col p-3">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Status Counts */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="text-center p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <CheckCircle size={10} className="text-emerald-500" />
                  <span className="text-[8px] text-emerald-500 font-semibold uppercase tracking-wide">Declared</span>
                </div>
                <div className="text-lg font-bold text-emerald-400 font-mono">{summary?.declared || 0}</div>
              </div>
              <div className="text-center p-2 rounded bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock size={10} className="text-amber-500" />
                  <span className="text-[8px] text-amber-500 font-semibold uppercase tracking-wide">Counting</span>
                </div>
                <div className="text-lg font-bold text-amber-400 font-mono">{summary?.counting || 0}</div>
              </div>
              <div className="text-center p-2 rounded bg-slate-500/10 border border-slate-500/20">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <AlertCircle size={10} className="text-slate-500" />
                  <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wide">Pending</span>
                </div>
                <div className="text-lg font-bold text-slate-400 font-mono">{summary?.pending || 0}</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-slate-500 uppercase tracking-wide">Progress</span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {summary?.declared || 0}/{summary?.total || 165}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Leading Party */}
            {summary?.leadingParty && (
              <div className="flex items-center gap-2 mb-4 p-2 rounded bg-white/[0.02] border border-white/5">
                <div
                  className="w-3 h-3 rounded"
                  style={{ background: getPartyColor(summary.leadingParty) }}
                />
                <div className="flex-1">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide">Leading</div>
                  <div className="text-xs font-semibold text-slate-200">{summary.leadingParty}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold font-mono" style={{ color: getPartyColor(summary.leadingParty) }}>
                    {summary.leadingSeats}
                  </div>
                  <div className="text-[9px] text-slate-500">seats</div>
                </div>
              </div>
            )}

            {/* Party Standings */}
            <div>
              <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">Party Standings (FPTP)</div>
              {/* Use grid layout for pixel-perfect column alignment */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 72px 56px', gap: 0 }}>
                {/* Header row */}
                <div className="text-slate-500 text-left font-medium" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Party</div>
                <div className="text-slate-500 text-right font-medium" style={{ padding: '6px 8px 6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Won</div>
                <div className="text-slate-500 text-right font-medium" style={{ padding: '6px 8px 6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Leading</div>
                <div className="text-slate-500 text-right font-medium" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Total</div>

                {/* Data rows */}
                {partySeats.map((ps) => {
                  const color = getPartyColor(ps.party);
                  return (
                    <div key={ps.party} style={{ display: 'contents' }}>
                      <div style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                        <span className="font-medium text-slate-300">{getPartyShortLabel(ps.party)}</span>
                      </div>
                      <div className="font-mono font-semibold text-emerald-400 text-right" style={{ padding: '8px 8px 8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        {ps.won}
                      </div>
                      <div className="font-mono text-blue-400 text-right" style={{ padding: '8px 8px 8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        {ps.leading}
                      </div>
                      <div className="font-mono font-bold text-right" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', color }}>
                        {ps.seats}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Turnout */}
            {summary && summary.turnout > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500 uppercase tracking-wide">National Turnout</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">
                    {summary.turnout.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Widget>
  );
});
