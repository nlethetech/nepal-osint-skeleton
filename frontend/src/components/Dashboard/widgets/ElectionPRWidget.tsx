/**
 * ElectionPRWidget — Proportional Representation seat projection.
 * Fetches PR vote data from ECN via backend, shows party vote shares
 * and projected seat allocation using Modified Sainte-Laguë method.
 */
import { memo, useState, useEffect, useCallback } from 'react';
import { Widget } from '../Widget';
import { PieChart, RefreshCw } from 'lucide-react';
import axios from 'axios';
import { getPartyColor, getPartyShortLabel } from '../../../utils/partyColors';

interface PRParty {
  party: string;
  votes: number;
  vote_pct: number;
  pr_seats: number;
  qualifies: boolean;
  symbol_id?: number;
}

interface PRData {
  parties: PRParty[];
  total_votes: number;
  total_pr_seats: number;
  threshold_pct: number;
  method: string;
  note?: string;
  error?: string;
}

export const ElectionPRWidget = memo(function ElectionPRWidget() {
  const [data, setData] = useState<PRData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get<PRData>('/api/v1/election-results/pr-votes');
      setData(res.data);
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const qualifying = data?.parties.filter(p => p.qualifies) || [];
  const totalSeatsAllocated = qualifying.reduce((s, p) => s + p.pr_seats, 0);

  return (
    <Widget id="election-pr" icon={<PieChart size={14} />} badge="PR">
      <div style={{ padding: '8px 12px', height: '100%', overflow: 'auto', color: '#F6F7F9', fontSize: 12 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>समानुपातिक सिट प्रक्षेपण</span>
            <span style={{ color: '#9CA3AF', marginLeft: 6, fontSize: 11 }}>PR Seat Projection</span>
          </div>
          <button onClick={fetchData} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 2 }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Summary row */}
        {data && (
          <div style={{
            display: 'flex', gap: 12, marginBottom: 10, padding: '6px 8px',
            background: '#1C2127', borderRadius: 4, fontSize: 11
          }}>
            <div><span style={{ color: '#9CA3AF' }}>Total PR Votes:</span> <span style={{ fontWeight: 600 }}>{(data.total_votes || 0).toLocaleString()}</span></div>
            <div><span style={{ color: '#9CA3AF' }}>Seats:</span> <span style={{ fontWeight: 600 }}>{totalSeatsAllocated}/{data.total_pr_seats}</span></div>
            <div><span style={{ color: '#9CA3AF' }}>Threshold:</span> <span style={{ fontWeight: 600 }}>{data.threshold_pct}%</span></div>
            <div><span style={{ color: '#9CA3AF' }}>Method:</span> <span style={{ fontWeight: 600 }}>Sainte-Laguë</span></div>
          </div>
        )}

        {/* Seat bar visualization */}
        {qualifying.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', height: 20, borderRadius: 3, overflow: 'hidden', background: '#252A31' }}>
              {qualifying.filter(p => p.pr_seats > 0).map((p, i) => {
                const pct = (p.pr_seats / (data?.total_pr_seats || 110)) * 100;
                return (
                  <div
                    key={p.party}
                    title={`${getPartyShortLabel(p.party)}: ${p.pr_seats} seats`}
                    style={{
                      width: `${pct}%`,
                      background: getPartyColor(p.party),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 600, color: '#fff',
                      minWidth: pct > 3 ? undefined : 0,
                      borderRight: '1px solid #111418',
                    }}
                  >
                    {pct > 5 ? `${getPartyShortLabel(p.party)} ${p.pr_seats}` : pct > 3 ? p.pr_seats : ''}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Party table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #2F343C' }}>
              <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 500 }}>Party</th>
              <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 500 }}>Votes</th>
              <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 500 }}>%</th>
              <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>PR Seats</th>
            </tr>
          </thead>
          <tbody>
            {(data?.parties || []).filter(p => p.votes > 0).slice(0, 20).map((p, i) => (
              <tr
                key={p.party}
                style={{
                  borderBottom: '1px solid #1C2127',
                  opacity: p.qualifies ? 1 : 0.5,
                }}
              >
                <td style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: getPartyColor(p.party), display: 'inline-block', flexShrink: 0
                  }} />
                  <span style={{ fontWeight: p.qualifies ? 500 : 400 }}>
                    {getPartyShortLabel(p.party)}
                  </span>
                  {!p.qualifies && <span style={{ color: '#EF4444', fontSize: 9 }}>below 3%</span>}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 4px', fontVariantNumeric: 'tabular-nums' }}>
                  {p.votes.toLocaleString()}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 4px', fontVariantNumeric: 'tabular-nums' }}>
                  {p.vote_pct.toFixed(1)}%
                </td>
                <td style={{
                  textAlign: 'right', padding: '4px 0', fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: p.pr_seats > 0 ? '#10B981' : '#6B7280'
                }}>
                  {p.pr_seats}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Note */}
        {data?.note && (
          <div style={{ marginTop: 8, fontSize: 10, color: '#6B7280', fontStyle: 'italic' }}>
            {data.note}
          </div>
        )}
      </div>
    </Widget>
  );
});
