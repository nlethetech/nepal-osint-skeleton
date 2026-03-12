/**
 * BillTrackerWidget — Parliamentary Bills Tracker
 *
 * Shows current bills in parliament with status pipeline,
 * presenter info, timeline dates, and ministry assignment.
 */
import { memo, useState, useEffect, useMemo } from 'react';
import { Widget } from '../Widget';
import { ScrollText, ChevronRight, ExternalLink, User, Calendar, ArrowRight } from 'lucide-react';
import axios from 'axios';
import { useAuthStore } from '../../../store/slices/authSlice';

interface Bill {
  id: string;
  external_id: string | null;
  title_en: string;
  title_ne: string | null;
  bill_type: string | null;
  status: string | null;
  presented_date: string | null;
  ministry: string | null;
  summary: string | null;
  presented_by?: string | null;
  ai_analysis?: string | null;
  chamber: string | null;
}

interface AIAnalysis {
  summary?: string;
  key_provisions?: string[];
  sectors_affected?: string[];
  significance?: string;
  significance_reason?: string;
  amendment_of?: string | null;
}

function parseAIAnalysis(raw: string | null): AIAnalysis | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return null; }
}

/** Parse structured summary field into presenter, category, type, timeline */
function parseSummary(summary: string | null): {
  presenter: string | null;
  category: string | null;
  origType: string | null;
  presentedDate: string | null;
  timeline: { stage: string; date: string }[];
} {
  if (!summary) return { presenter: null, category: null, origType: null, presentedDate: null, timeline: [] };
  const lines = summary.split('\n');
  let presenter: string | null = null;
  let category: string | null = null;
  let origType: string | null = null;
  let presentedDate: string | null = null;
  const timeline: { stage: string; date: string }[] = [];

  for (const line of lines) {
    if (line.startsWith('Presenter:')) presenter = line.replace('Presenter:', '').trim();
    else if (line.startsWith('Presented:')) presentedDate = line.replace('Presented:', '').trim();
    else if (line.startsWith('Category:')) category = line.replace('Category:', '').trim();
    else if (line.startsWith('Type:')) origType = line.replace('Type:', '').trim();
    else if (line.startsWith('Timeline:')) {
      const parts = line.replace('Timeline:', '').trim().split(' → ');
      for (const p of parts) {
        const colonIdx = p.lastIndexOf(':');
        if (colonIdx > 0) {
          timeline.push({
            stage: p.slice(0, colonIdx).trim(),
            date: p.slice(colonIdx + 1).trim(),
          });
        }
      }
    }
  }
  return { presenter, category, origType, presentedDate, timeline };
}

const STATUS_PIPELINE = [
  { key: 'registered', label: 'Registered', color: '#5C7080', tip: 'Bill has been formally introduced in parliament' },
  { key: 'first_reading', label: 'General Discussion', color: '#D1980B', tip: 'First reading — MPs debate the bill\'s general principles' },
  { key: 'committee', label: 'Committee', color: '#2D72D2', tip: 'Bill is being reviewed by a parliamentary committee' },
  { key: 'second_reading', label: 'House Discussion', color: '#9179F2', tip: 'Second reading — clause-by-clause discussion in the House' },
  { key: 'passed', label: 'Passed', color: '#238551', tip: 'Bill has been approved by parliament' },
] as const;

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  government: { label: 'Govt', color: '#2D72D2' },
  private_member: { label: 'Private', color: '#9179F2' },
  money: { label: 'Money', color: '#D1980B' },
  amendment: { label: 'Amendment', color: '#C87619' },
};

// Fallback data (real bills from hr.parliament.gov.np as of 2082)
const FALLBACK_BILLS: Bill[] = [
  { id: '1', external_id: 'njBRB4qb', title_en: 'Information Technology and Cyber Security Bill, 2082', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2082-02-28', ministry: 'Ministry of Communications and Information Technology', summary: null, chamber: 'hor' },
  { id: '2', external_id: 'vlo1HxCh', title_en: 'Industrial Property Bill, 2082', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2082-02-23', ministry: 'Ministry of Industry, Commerce and Supplies', summary: null, chamber: 'hor' },
  { id: '3', external_id: 'tNnK3bl5', title_en: 'Children (First Amendment) Bill, 2082', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2082-02-07', ministry: 'Ministry of Women, Children and Senior Citizens', summary: null, chamber: 'hor' },
  { id: '4', external_id: 'ZJUoPgYB', title_en: 'Bill to amend certain Nepal Acts relating to land, 2082', title_ne: null, bill_type: 'government', status: 'passed', presented_date: '2082-01-23', ministry: 'Ministry of Land Management', summary: null, chamber: 'hor' },
  { id: '5', external_id: 'bMRO6EoX', title_en: 'Alternative Development Finance Mobilization Bill, 2081', title_ne: null, bill_type: 'government', status: 'passed', presented_date: '2082-01-05', ministry: 'Ministry of Finance', summary: null, chamber: 'hor' },
  { id: '6', external_id: 'qWUsRk1l', title_en: 'Bill to amend the Human Trafficking and Smuggling (Control) Act, 2064', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2081-12-11', ministry: null, summary: null, chamber: 'hor' },
  { id: '7', external_id: '8dczslHF', title_en: 'Nepal Police Bill, 2081', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2081-10-15', ministry: 'Ministry of Home Affairs', summary: null, chamber: 'hor' },
  { id: '8', external_id: 'OwkNlOti', title_en: 'Armed Police Force, Nepal Bill, 2081', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2081-10-15', ministry: 'Ministry of Home Affairs', summary: null, chamber: 'hor' },
  { id: '9', external_id: 'IqpALy3E', title_en: 'Export Imports (Regulation) Bill, 2081', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2081-10-20', ministry: 'Ministry of Industry, Commerce and Supply', summary: null, chamber: 'hor' },
  { id: '10', external_id: 'Dg0r9fXm', title_en: 'Nepal Civil Aviation Authority Bill, 2081', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2081-10-19', ministry: 'Ministry of Culture, Tourism and Civil Aviation', summary: null, chamber: 'hor' },
  { id: '11', external_id: '9akb4gZO', title_en: 'National Sports Development (First Amendment) Bill, 2082', title_ne: null, bill_type: 'government', status: 'committee', presented_date: '2082-02-30', ministry: 'Ministry of Youth and Sports', summary: null, chamber: 'hor' },
  { id: '12', external_id: 'PfzGSahf', title_en: 'Nepal Veterinary Medicine (First Amendment) Bill, 2082', title_ne: null, bill_type: 'government', status: 'first_reading', presented_date: '2082-03-29', ministry: 'Ministry of Agriculture and Livestock Development', summary: null, chamber: 'hor' },
  { id: '13', external_id: '6UPMDYL3', title_en: 'Discrimination on the Basis of Caste, Colour, Region (Offences and Punishments) Bill, 2081', title_ne: null, bill_type: 'private_member', status: 'registered', presented_date: '2081-10-21', ministry: null, summary: 'Presenter: Hon. Dr Chandra Kanta Raut\nTimeline: Distribution to member: 2081-10-21', chamber: 'hor' },
  { id: '14', external_id: '1MrL02gZ', title_en: 'The Securities (First Amendment) Bill, 2081', title_ne: null, bill_type: 'government', status: 'passed', presented_date: '2081-04-32', ministry: 'Ministry of Finance', summary: 'Presenter: Hon. Bisnu Prasad Poudel\nTimeline: Distribution to member: 2081-04-32 → General Discussion: 2081-05-15 → Passed by House: 2081-06-28', chamber: 'hor' },
];

export const BillTrackerWidget = memo(function BillTrackerWidget() {
  const [bills, setBills] = useState<Bill[]>(FALLBACK_BILLS);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const token = useAuthStore(s => s.token);

  useEffect(() => {
    if (!token) return;
    const api = axios.create({
      baseURL: import.meta.env.VITE_API_URL || '/api/v1',
      headers: { Authorization: `Bearer ${token}` },
    });
    api.get('/parliament/bills', { params: { per_page: 50 } })
      .then(r => {
        if (r.data?.items?.length > 0) setBills(r.data.items);
      })
      .catch(() => {});
  }, [token]);

  const statusCounts = STATUS_PIPELINE.map(s => ({
    ...s,
    count: bills.filter(b => b.status === s.key).length,
  }));

  const filtered = filterStatus
    ? bills.filter(b => b.status === filterStatus)
    : bills;

  return (
    <Widget id="bill-tracker" icon={<ScrollText size={14} />}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Status Pipeline Bar */}
        <div style={{
          display: 'flex', gap: 2, padding: '8px 12px 6px', borderBottom: '1px solid var(--border-primary)',
        }}>
          {statusCounts.map(s => (
            <button
              key={s.key}
              onClick={() => setFilterStatus(filterStatus === s.key ? null : s.key)}
              title={s.tip}
              style={{
                flex: 1, padding: '6px 2px', textAlign: 'center', cursor: 'pointer',
                minHeight: 44,
                background: filterStatus === s.key ? `${s.color}22` : 'transparent',
                border: `1px solid ${filterStatus === s.key ? s.color : 'transparent'}`,
                borderRadius: 4, transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {s.label}
              </div>
            </button>
          ))}
        </div>

        {/* Bills List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {filtered.map(bill => {
            const type = TYPE_LABELS[bill.bill_type || ''] || { label: 'Bill', color: '#5C7080' };
            const statusInfo = STATUS_PIPELINE.find(s => s.key === bill.status);
            const isExpanded = expandedId === bill.id;
            const parsed = parseSummary(bill.summary);
            const ai = parseAIAnalysis(bill.ai_analysis ?? null);
            const presenter = bill.presented_by || parsed.presenter;

            return (
              <div
                key={bill.id}
                onClick={() => setExpandedId(isExpanded ? null : bill.id)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border-primary)',
                  background: isExpanded ? 'var(--bg-surface)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <ChevronRight
                    size={12}
                    style={{
                      marginTop: 3, color: 'var(--text-muted)', flexShrink: 0,
                      transform: isExpanded ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      {bill.title_en}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 8, fontWeight: 700, padding: '1px 5px',
                        background: `${type.color}18`, color: type.color,
                        borderRadius: 3, textTransform: 'uppercase',
                      }}>
                        {type.label}
                      </span>
                      {statusInfo && (
                        <span style={{
                          fontSize: 8, fontWeight: 600, padding: '1px 5px',
                          background: `${statusInfo.color}18`, color: statusInfo.color,
                          borderRadius: 3,
                        }}>
                          {statusInfo.label}
                        </span>
                      )}
                      {ai?.significance && (
                        <span style={{
                          fontSize: 8, fontWeight: 700, padding: '1px 5px',
                          background: ai.significance === 'high' ? '#CD424618' : ai.significance === 'medium' ? '#D1980B18' : '#5C708018',
                          color: ai.significance === 'high' ? '#CD4246' : ai.significance === 'medium' ? '#D1980B' : '#5C7080',
                          borderRadius: 3, textTransform: 'uppercase',
                        }}>
                          {ai.significance}
                        </span>
                      )}
                      {presenter && (
                        <span style={{ fontSize: 9, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <User size={8} style={{ opacity: 0.6 }} />
                          {presenter}
                        </span>
                      )}
                      {(() => {
                        const passedDate = bill.status === 'passed'
                          ? parsed.timeline.find(t => t.stage === 'Passed by House' || t.stage === 'Authenticated')?.date
                          : null;
                        const displayDate = passedDate || bill.presented_date || parsed.presentedDate || parsed.timeline[0]?.date;
                        if (!displayDate) return null;
                        return (
                          <span style={{ fontSize: 9, color: passedDate ? '#238551' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            <Calendar size={8} style={{ opacity: 0.5 }} />
                            {passedDate ? `Passed ${passedDate}` : displayDate}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 8, marginLeft: 20, fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {ai?.summary && (
                      <div style={{
                        marginBottom: 8, padding: '6px 8px', borderRadius: 4,
                        background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
                        fontSize: 10, lineHeight: 1.5, color: 'var(--text-primary)',
                      }}>
                        {ai.summary}
                      </div>
                    )}
                    {ai?.key_provisions && ai.key_provisions.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>
                          Key Provisions
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 14, fontSize: 9, lineHeight: 1.5 }}>
                          {ai.key_provisions.slice(0, 4).map((p, i) => (
                            <li key={i} style={{ marginBottom: 2 }}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {ai?.sectors_affected && ai.sectors_affected.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                        {ai.sectors_affected.map((s, i) => (
                          <span key={i} style={{
                            fontSize: 8, padding: '1px 5px', borderRadius: 3,
                            background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
                            color: 'var(--text-secondary)',
                          }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {bill.ministry && (
                      <div style={{ marginBottom: 4 }}><strong>Ministry:</strong> {bill.ministry}</div>
                    )}
                    {parsed.category && (
                      <div style={{ marginBottom: 4 }}><strong>Category:</strong> {parsed.category}</div>
                    )}
                    {parsed.origType && (
                      <div style={{ marginBottom: 4 }}><strong>Type:</strong> {parsed.origType}</div>
                    )}
                    {ai?.amendment_of && (
                      <div style={{ marginBottom: 4 }}><strong>Amends:</strong> {ai.amendment_of}</div>
                    )}

                    {/* Status Timeline */}
                    {parsed.timeline.length > 0 && (
                      <div style={{ marginTop: 6, marginBottom: 6 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                          Progress Timeline
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {parsed.timeline.map((step, i) => {
                            const stageStatus = STATUS_PIPELINE.find(s =>
                              step.stage.toLowerCase().includes(s.label.toLowerCase()) ||
                              s.label.toLowerCase().includes(step.stage.toLowerCase().split(' ')[0])
                            );
                            const color = stageStatus?.color || '#5C7080';
                            return (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: color, flexShrink: 0,
                                }} />
                                <span style={{ fontSize: 9, color: 'var(--text-secondary)', minWidth: 90 }}>
                                  {step.date}
                                </span>
                                <span style={{ fontSize: 9, color: 'var(--text-primary)' }}>
                                  {step.stage}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {bill.external_id && (
                      <a
                        href={`https://hr.parliament.gov.np/en/bills/${bill.external_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          marginTop: 4, fontSize: 9, color: 'var(--accent-primary)',
                          textDecoration: 'none',
                        }}
                      >
                        View on Parliament Website <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '4px 12px', borderTop: '1px solid var(--border-primary)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {bills.length} bills tracked • House of Representatives
          </span>
          <a
            href="https://hr.parliament.gov.np/en/bills?type=state&ref=BILL"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 9, color: 'var(--accent-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}
          >
            Parliament Site <ExternalLink size={8} />
          </a>
        </div>
      </div>
    </Widget>
  );
});
