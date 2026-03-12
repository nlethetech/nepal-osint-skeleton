/**
 * ElectionSeatsWidget — Combined FPTP + PR seat tracker with majority/2/3 thresholds.
 * HOR: 275 total (165 FPTP + 110 PR). Majority: 138. Two-thirds: 184.
 */
import { memo, useState, useEffect, useCallback } from 'react';
import { Widget } from '../Widget';
import { BarChart3 } from 'lucide-react';
import axios from 'axios';
import { getPartyColor, getPartyShortLabel } from '../../../utils/partyColors';

const TOTAL_SEATS = 275;
const FPTP_SEATS = 165;
const PR_SEATS = 110;
const MAJORITY = 138;
const TWO_THIRDS = 184;

interface PartySeats {
  party: string;
  fptp_won: number;
  fptp_leading: number;
  pr_projected: number;
  total: number;        // won + leading + pr
  total_confirmed: number; // won + pr (no leading)
}

export const ElectionSeatsWidget = memo(function ElectionSeatsWidget() {
  const [parties, setParties] = useState<PartySeats[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [snapRes, prRes] = await Promise.all([
        axios.get('/api/v1/election-results/live-snapshot'),
        axios.get('/api/v1/election-results/pr-votes'),
      ]);

      // FPTP data from live-snapshot
      const fptpParties: Record<string, { won: number; leading: number }> = {};
      for (const p of snapRes.data?.national_summary?.party_seats || []) {
        const key = p.party;
        fptpParties[key] = { won: p.won || 0, leading: p.leading || 0 };
      }

      // PR data
      const prParties: Record<string, number> = {};
      for (const p of prRes.data?.parties || []) {
        if (p.pr_seats > 0) {
          prParties[p.party] = p.pr_seats;
        }
      }

      // Merge — normalize by short name
      const merged: Record<string, PartySeats> = {};

      for (const [name, fptp] of Object.entries(fptpParties)) {
        const short = getPartyShortLabel(name);
        if (!merged[short]) {
          merged[short] = { party: name, fptp_won: 0, fptp_leading: 0, pr_projected: 0, total: 0, total_confirmed: 0 };
        }
        merged[short].fptp_won += fptp.won;
        merged[short].fptp_leading += fptp.leading;
      }

      for (const [name, seats] of Object.entries(prParties)) {
        const short = getPartyShortLabel(name);
        if (!merged[short]) {
          merged[short] = { party: name, fptp_won: 0, fptp_leading: 0, pr_projected: 0, total: 0, total_confirmed: 0 };
        }
        merged[short].pr_projected = seats;
      }

      // Calculate totals
      const result = Object.values(merged).map(p => ({
        ...p,
        total: p.fptp_won + p.fptp_leading + p.pr_projected,
        total_confirmed: p.fptp_won + p.pr_projected,
      }));

      result.sort((a, b) => b.total - a.total);
      setParties(result);
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

  const topParty = parties[0];
  const topTotal = topParty?.total || 0;

  return (
    <Widget id="election-seats" icon={<BarChart3 size={14} />} badge="SEATS">
      <div style={{ padding: '8px 12px', height: '100%', overflow: 'auto', color: '#F6F7F9', fontSize: 12 }}>
        {/* Header */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>प्रतिनिधि सभा सिट ट्र्याकर</span>
          <span style={{ color: '#9CA3AF', marginLeft: 6, fontSize: 11 }}>HOR Seat Tracker</span>
        </div>

        {/* Threshold bar */}
        <div style={{ marginBottom: 12 }}>
          {/* Threshold labels above the bar */}
          <div style={{ position: 'relative', height: 12, marginBottom: 2 }}>
            <div style={{
              position: 'absolute',
              left: `${(MAJORITY / TOTAL_SEATS) * 100}%`,
              transform: 'translateX(-50%)',
              fontSize: 9, color: '#FCD34D', fontWeight: 700,
              whiteSpace: 'nowrap',
            }}>
              138
            </div>
            <div style={{
              position: 'absolute',
              left: `${(TWO_THIRDS / TOTAL_SEATS) * 100}%`,
              transform: 'translateX(-50%)',
              fontSize: 9, color: '#F87171', fontWeight: 700,
              whiteSpace: 'nowrap',
            }}>
              184
            </div>
          </div>
          <div style={{ position: 'relative', height: 28, background: '#1C2127', borderRadius: 4, overflow: 'hidden' }}>
            {/* Stacked party segments */}
            {(() => {
              let offset = 0;
              return parties.filter(p => p.total > 0).map(p => {
                const pct = (p.total / TOTAL_SEATS) * 100;
                const el = (
                  <div
                    key={getPartyShortLabel(p.party)}
                    title={`${getPartyShortLabel(p.party)}: ${p.total} seats (${p.fptp_won}W + ${p.fptp_leading}L + ${p.pr_projected}PR)`}
                    style={{
                      position: 'absolute',
                      left: `${offset}%`,
                      width: `${pct}%`,
                      height: '100%',
                      background: getPartyColor(p.party),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 600, color: '#fff',
                      borderRight: '1px solid #111418',
                    }}
                  >
                    {pct > 4 ? `${getPartyShortLabel(p.party)} ${p.total}` : ''}
                  </div>
                );
                offset += pct;
                return el;
              });
            })()}

            {/* Majority line */}
            <div style={{
              position: 'absolute',
              left: `${(MAJORITY / TOTAL_SEATS) * 100}%`,
              top: 0, bottom: 0, width: 2,
              background: '#FCD34D',
              zIndex: 5,
            }} />

            {/* 2/3 line */}
            <div style={{
              position: 'absolute',
              left: `${(TWO_THIRDS / TOTAL_SEATS) * 100}%`,
              top: 0, bottom: 0, width: 2,
              background: '#F87171',
              zIndex: 5,
            }} />
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#9CA3AF' }}>
            <span>0</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: '#FCD34D' }}>
                Majority (138) {topTotal >= MAJORITY ? '✓' : ''}
              </span>
              <span style={{ color: '#F87171' }}>
                ⅔ Supermajority (184) {topTotal >= TWO_THIRDS ? '✓' : ''}
              </span>
            </span>
            <span>275</span>
          </div>
        </div>

        {/* Status badges */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {topParty && (
            <div style={{
              padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: topTotal >= MAJORITY ? '#065F46' : '#1C2127',
              color: topTotal >= MAJORITY ? '#6EE7B7' : '#9CA3AF',
              border: `1px solid ${topTotal >= MAJORITY ? '#10B981' : '#2F343C'}`,
            }}>
              {topTotal >= TWO_THIRDS
                ? `${getPartyShortLabel(topParty.party)} has ⅔ SUPERMAJORITY`
                : topTotal >= MAJORITY
                  ? `${getPartyShortLabel(topParty.party)} CROSSES MAJORITY`
                  : `${getPartyShortLabel(topParty.party)} needs ${MAJORITY - topTotal} more for majority`
              }
            </div>
          )}
          <div style={{
            padding: '4px 10px', borderRadius: 4, fontSize: 11,
            background: '#1C2127', color: '#9CA3AF',
            border: '1px solid #2F343C',
          }}>
            {FPTP_SEATS} FPTP + {PR_SEATS} PR = {TOTAL_SEATS} Total
          </div>
        </div>

        {/* Party table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #2F343C' }}>
              <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 500 }}>Party</th>
              <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 500 }}>FPTP Won</th>
              <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 500 }}>FPTP Lead</th>
              <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 500 }}>PR Proj.</th>
              <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {parties.filter(p => p.total > 0).map(p => {
              const short = getPartyShortLabel(p.party);
              return (
                <tr key={short} style={{ borderBottom: '1px solid #1C2127' }}>
                  <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: getPartyColor(p.party), display: 'inline-block', flexShrink: 0
                    }} />
                    <span style={{ fontWeight: 500 }}>{short}</span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 4px', fontVariantNumeric: 'tabular-nums', color: '#10B981', fontWeight: 600 }}>
                    {p.fptp_won}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 4px', fontVariantNumeric: 'tabular-nums', color: '#60A5FA' }}>
                    {p.fptp_leading}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 4px', fontVariantNumeric: 'tabular-nums', color: '#A78BFA' }}>
                    {p.pr_projected}
                  </td>
                  <td style={{
                    textAlign: 'right', padding: '5px 0', fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums', fontSize: 12,
                    color: p.total >= MAJORITY ? '#FCD34D' : '#F6F7F9',
                  }}>
                    {p.total}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr style={{ borderTop: '2px solid #404854' }}>
              <td style={{ padding: '5px 0', fontWeight: 600, color: '#9CA3AF' }}>Total</td>
              <td style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 600, color: '#9CA3AF' }}>
                {parties.reduce((s, p) => s + p.fptp_won, 0)}
              </td>
              <td style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 600, color: '#9CA3AF' }}>
                {parties.reduce((s, p) => s + p.fptp_leading, 0)}
              </td>
              <td style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 600, color: '#9CA3AF' }}>
                {parties.reduce((s, p) => s + p.pr_projected, 0)}
              </td>
              <td style={{ textAlign: 'right', padding: '5px 0', fontWeight: 700, color: '#9CA3AF' }}>
                {parties.reduce((s, p) => s + p.total, 0)}/{TOTAL_SEATS}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 8, fontSize: 10, color: '#6B7280', fontStyle: 'italic' }}>
          PR seats projected via Modified Sainte-Laguë (3% threshold). FPTP leading = not yet declared.
        </div>
      </div>
    </Widget>
  );
});
