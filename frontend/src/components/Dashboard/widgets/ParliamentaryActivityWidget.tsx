/**
 * ParliamentaryActivityWidget — Parliamentary Accountability
 *
 * Shows session summaries with agendas, debate analysis, and MP scoreboard.
 * Scoring is formula-based from raw speech data (no AI bias).
 * Data from hr.parliament.gov.np verbatim PDFs.
 */
import { memo, useState, useEffect } from 'react';
import { Widget } from '../Widget';
import {
  Mic2, Trophy, CalendarDays, Info,
  ChevronDown, ChevronUp, Flame, Minus, Snowflake,
} from 'lucide-react';
import axios from 'axios';
import { useAuthStore } from '../../../store/slices/authSlice';

// ─── Types ───────────────────────────────────────────────

interface MPScore {
  name_ne: string;
  party_ne: string | null;
  party_en: string | null;
  sessions_active: number;
  total_speeches: number;
  total_words: number;
  avg_words_per_speech: number;
  participation_rate: number;
  activity_score: number;
  quality_score: number;
  quality_source: string;
  overall_score: number;
  key_contributions?: string[];
}

interface SessionSummary {
  id: string;
  title_ne: string | null;
  session_date: string | null;
  session_date_bs: string | null;
  meeting_no: number | null;
  speech_count: number;
  session_summary: string | null;
  key_topics: string[] | null;
  agenda_items: any[] | null;
  speaker_scores: any[] | null;
  is_analyzed: boolean;
  chamber: string | null;
}

interface VerbatimSummary {
  total_sessions: number;
  analyzed_sessions: number;
  total_speeches: number;
  unique_speakers: number;
  total_words: number;
  top_speakers: any[];
  recent_sessions: SessionSummary[];
}

// ─── Constants ───────────────────────────────────────────

const PARTY_COLORS: Record<string, string> = {
  'Nepali Congress': '#E74C3C',
  'Nepal Communist Party (UML)': '#D63031',
  'Nepal Communist Party (Maoist Center)': '#E17055',
  'Rastriya Swotantra Party': '#0984E3',
  'Communist Party of Nepal (Unified Socialist)': '#6C5CE7',
  'Janata Samajbadi Party Nepal': '#00B894',
  'Loktantrik Samajwadi Party Nepal': '#FDCB6E',
  'Rastriya Prajatantra Party': '#2D3436',
  'Janamat Party': '#55A3F1',
  'Nepal Workers Peasants Party': '#8B4513',
  'Rastriya Janamorcha': '#4A6741',
};

function pc(partyEn: string | null, partyNe: string | null): string {
  if (partyEn && PARTY_COLORS[partyEn]) return PARTY_COLORS[partyEn];
  if (!partyNe) return '#5C7080';
  // Fuzzy match Nepali party names
  if (partyNe.includes('काँग्रेस') || partyNe.includes('कांग्रेस')) return '#E74C3C';
  if (partyNe.includes('एमाले')) return '#D63031';
  if (partyNe.includes('माओवाद')) return '#E17055';
  if (partyNe.includes('स्वतन्त्र')) return '#0984E3';
  if (partyNe.includes('एकीकृत समाजवादी') || partyNe.includes('एकȧकृत')) return '#6C5CE7';
  if (partyNe.includes('जनता समाज')) return '#00B894';
  if (partyNe.includes('जनमोर्चा') || partyNe.includes('जनमोचा')) return '#4A6741';
  return '#5C7080';
}

const CHAMBER_LABELS: Record<string, { short: string; full: string; ne: string; color: string }> = {
  hor: { short: 'HoR', full: 'House of Representatives', ne: 'प्रतिनिधि सभा', color: '#2D72D2' },
  na: { short: 'NA', full: 'National Assembly', ne: 'राष्ट्रिय सभा', color: '#9179F2' },
};

const INTENSITY_CONFIG = {
  high: { icon: Flame, color: '#CD4246', bg: 'rgba(205,66,70,0.1)', label: 'Heated' },
  medium: { icon: Minus, color: '#C87619', bg: 'rgba(200,118,25,0.1)', label: 'Moderate' },
  low: { icon: Snowflake, color: '#238551', bg: 'rgba(35,133,81,0.1)', label: 'Calm' },
};

// ─── Component ───────────────────────────────────────────

type Tab = 'sessions' | 'scoreboard' | 'methodology';

export const ParliamentaryActivityWidget = memo(function ParliamentaryActivityWidget() {
  const [summary, setSummary] = useState<VerbatimSummary | null>(null);
  const [qaSessions, setQaSessions] = useState<SessionSummary[]>([]);
  const [scoreboard, setScoreboard] = useState<MPScore[]>([]);
  const [methodology, setMethodology] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('sessions');
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [chamberFilter, setChamberFilter] = useState<string>('');
  const token = useAuthStore(s => s.token);

  useEffect(() => {
    if (!token) return;
    const api = axios.create({
      baseURL: import.meta.env.VITE_API_URL || '/api/v1',
      headers: { Authorization: `Bearer ${token}` },
    });

    api.get('/verbatim/summary').then(r => {
      if (r.data?.total_sessions > 0) setSummary(r.data);
    }).catch(() => {});

    const scoreParams: any = { limit: 30 };
    if (chamberFilter) scoreParams.chamber = chamberFilter;
    api.get('/verbatim/scoreboard', { params: scoreParams }).then(r => {
      if (r.data?.items?.length > 0) {
        setScoreboard(r.data.items);
        if (r.data.methodology) setMethodology(r.data.methodology);
      } else {
        setScoreboard([]);
      }
    }).catch(() => {});

    // Fetch Q&A as sessions (merged into Sessions tab)
    api.get('/parliament/questions/as-sessions').then(r => {
      if (r.data?.sessions?.length > 0) setQaSessions(r.data.sessions);
    }).catch(() => {});
  }, [token, chamberFilter]);

  const totalSessions = summary?.total_sessions || 0;
  const analyzedSessions = summary?.analyzed_sessions || 0;
  const totalSpeeches = summary?.total_speeches || 0;

  // Merge verbatim sessions + Q&A sessions
  const allSessions: SessionSummary[] = [
    ...(summary?.recent_sessions || []),
    ...qaSessions,
  ];

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'sessions', label: 'Sessions', icon: CalendarDays },
    { key: 'scoreboard', label: 'Scoreboard', icon: Trophy },
    { key: 'methodology', label: 'How We Score', icon: Info },
  ];

  return (
    <Widget id="parliament-activity" icon={<Mic2 size={14} />}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* KPI Bar */}
        <div style={{
          display: 'flex', gap: 0, padding: '6px 8px 4px',
          borderBottom: '1px solid var(--border-primary)',
        }}>
          {[
            { label: 'Sessions', value: totalSessions + qaSessions.length, color: '#2D72D2' },
            { label: 'Analyzed', value: analyzedSessions, color: '#238551' },
            { label: 'Speeches', value: totalSpeeches, color: '#9179F2' },
            { label: 'MPs Ranked', value: scoreboard.length, color: '#C87619' },
          ].map(kpi => (
            <div key={kpi.label} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: kpi.color }}>
                {kpi.value.toLocaleString()}
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {kpi.label}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)' }}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: '5px 0', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 4, cursor: 'pointer',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  borderBottom: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  border: 'none', borderLeft: 'none', borderRight: 'none', borderTop: 'none',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: 10, fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={11} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Chamber Filter (not for Q&A — HoR only) */}
        {(activeTab === 'sessions' || activeTab === 'scoreboard') && (
          <div style={{
            display: 'flex', gap: 4, padding: '4px 8px',
            borderBottom: '1px solid var(--border-primary)',
            background: 'var(--bg-surface)',
          }}>
            {[
              { value: '', label: 'All Chambers' },
              { value: 'na', label: 'National Assembly' },
              { value: 'hor', label: 'House of Representatives' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setChamberFilter(opt.value)}
                style={{
                  flex: 1, padding: '3px 0', fontSize: 9, fontWeight: chamberFilter === opt.value ? 600 : 400,
                  background: chamberFilter === opt.value ? 'rgba(45,114,210,0.12)' : 'transparent',
                  border: chamberFilter === opt.value ? '1px solid rgba(45,114,210,0.3)' : '1px solid transparent',
                  borderRadius: 4, cursor: 'pointer',
                  color: chamberFilter === opt.value ? '#2D72D2' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>

          {/* ─── Sessions Tab ─── */}
          {activeTab === 'sessions' && (
            <>
              {(allSessions.length === 0) ? (
                <EmptyState sessions={totalSessions} />
              ) : (
                allSessions
                  .filter(s => !chamberFilter || s.chamber === chamberFilter)
                  .map(session => {
                  const isExpanded = expandedSession === session.id;
                  const chamberInfo = session.chamber ? CHAMBER_LABELS[session.chamber] : null;
                  return (
                    <div key={session.id} style={{
                      borderBottom: '1px solid var(--border-primary)',
                      background: isExpanded ? 'var(--bg-surface)' : 'transparent',
                    }}>
                      <div
                        onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {session.meeting_no ? `Meeting ${session.meeting_no}` : session.title_ne || 'Session'}
                              {chamberInfo && (
                                <span
                                  title={`${chamberInfo.full} (${chamberInfo.ne})`}
                                  style={{
                                    fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                    background: `${chamberInfo.color}18`,
                                    color: chamberInfo.color,
                                    border: `1px solid ${chamberInfo.color}30`,
                                    textTransform: 'uppercase', letterSpacing: '0.5px',
                                    cursor: 'help',
                                  }}
                                >
                                  {chamberInfo.short}
                                </span>
                              )}
                              {(session.session_date || session.session_date_bs) && (
                                <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>
                                  {session.session_date || session.session_date_bs}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 9, color: 'var(--text-muted)' }}>
                              <span>{session.speech_count} {(session as any).session_type === 'qa' ? 'questions' : 'speeches'}</span>
                              {session.is_analyzed ? (
                                <span style={{ color: '#238551', fontWeight: 600 }}>Analyzed</span>
                              ) : (
                                <span style={{ color: '#C87619' }}>Pending</span>
                              )}
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </div>

                        {!isExpanded && session.session_summary && (
                          <div style={{
                            marginTop: 4, fontSize: 10, color: 'var(--text-secondary)',
                            lineHeight: 1.5, overflow: 'hidden',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                          }}>
                            {session.session_summary}
                          </div>
                        )}
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '0 12px 10px' }}>
                          {session.session_summary && (
                            <div style={{
                              fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6,
                              marginBottom: 8, padding: '6px 8px',
                              background: 'rgba(45,114,210,0.04)', borderRadius: 4,
                              borderLeft: '2px solid #2D72D2',
                            }}>
                              {session.session_summary}
                            </div>
                          )}

                          {session.key_topics && session.key_topics.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                              {session.key_topics.map((t, i) => (
                                <span key={i} style={{
                                  fontSize: 8, padding: '2px 6px',
                                  background: 'rgba(45,114,210,0.1)',
                                  color: '#2D72D2', borderRadius: 3,
                                }}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}

                          {session.agenda_items && session.agenda_items.length > 0 && (
                            <div>
                              <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
                                Agenda Items
                              </div>
                              {session.agenda_items.map((agenda: any, idx: number) => {
                                const cfg = INTENSITY_CONFIG[agenda.intensity as keyof typeof INTENSITY_CONFIG] || INTENSITY_CONFIG.medium;
                                const IntIcon = cfg.icon;
                                return (
                                  <div key={idx} style={{
                                    padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                                    background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <IntIcon size={10} style={{ color: cfg.color }} />
                                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                                        {agenda.topic}
                                      </span>
                                      <span style={{
                                        fontSize: 7, padding: '1px 5px', borderRadius: 3,
                                        background: cfg.bg, color: cfg.color, fontWeight: 600, textTransform: 'uppercase',
                                      }}>
                                        {cfg.label}
                                      </span>
                                      {agenda.outcome && (
                                        <span style={{
                                          fontSize: 7, padding: '1px 5px', borderRadius: 3,
                                          background: agenda.outcome === 'passed' ? 'rgba(35,133,81,0.1)' :
                                            agenda.outcome === 'rejected' ? 'rgba(205,66,70,0.1)' :
                                            agenda.outcome === 'answered' ? 'rgba(35,133,81,0.1)' :
                                            agenda.outcome === 'unanswered' ? 'rgba(200,118,25,0.1)' : 'rgba(100,100,100,0.1)',
                                          color: agenda.outcome === 'passed' ? '#238551' :
                                            agenda.outcome === 'rejected' ? '#CD4246' :
                                            agenda.outcome === 'answered' ? '#238551' :
                                            agenda.outcome === 'unanswered' ? '#C87619' : 'var(--text-muted)',
                                          fontWeight: 600, textTransform: 'uppercase',
                                        }}>
                                          {agenda.outcome}
                                        </span>
                                      )}
                                      {agenda.questioner && (
                                        <span style={{
                                          fontSize: 7, padding: '1px 5px', borderRadius: 3,
                                          background: 'rgba(45,114,210,0.1)', color: '#2D72D2',
                                          fontWeight: 600,
                                        }}>
                                          {agenda.questioner}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
                                      {agenda.description}
                                    </div>
                                    {(agenda.supporters?.length > 0 || agenda.opponents?.length > 0) && (
                                      <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 8 }}>
                                        {agenda.supporters?.length > 0 && (
                                          <span style={{ color: '#238551' }}>For: {agenda.supporters.join(', ')}</span>
                                        )}
                                        {agenda.opponents?.length > 0 && (
                                          <span style={{ color: '#CD4246' }}>Against: {agenda.opponents.join(', ')}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* ─── Scoreboard Tab ─── */}
          {activeTab === 'scoreboard' && (
            <>
              {scoreboard.length === 0 ? (
                <EmptyState sessions={totalSessions} />
              ) : (
                scoreboard.map((mp, i) => {
                  const color = pc(mp.party_en, mp.party_ne);
                  return (
                    <div key={i} style={{
                      padding: '8px 12px', borderBottom: '1px solid var(--border-primary)',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: i < 3 ? `${['#FFD700', '#C0C0C0', '#CD7F32'][i]}22` : 'var(--bg-surface)',
                        border: i < 3 ? `1px solid ${['#FFD700', '#C0C0C0', '#CD7F32'][i]}44` : '1px solid var(--border-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700,
                        color: i < 3 ? ['#FFD700', '#999', '#CD7F32'][i] : 'var(--text-muted)',
                      }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{
                            fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {mp.name_ne || '—'}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#2D72D2', flexShrink: 0, marginLeft: 6 }}>
                            {mp.overall_score.toFixed(0)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
                          }} />
                          <span style={{ fontSize: 9, color, fontWeight: 500 }}>
                            {mp.party_ne || mp.party_en || '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 8, color: 'var(--text-muted)' }}>
                          <span>{mp.total_speeches} speeches</span>
                          <span>{mp.sessions_active} sessions</span>
                          <span>~{Math.round(mp.avg_words_per_speech)} words/speech</span>
                        </div>
                        {/* Score breakdown bars */}
                        <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                          <ScoreChip label="PAR" value={mp.participation_rate} color="#2D72D2" tip="Participation — % of sessions attended" />
                          <ScoreChip label="ACT" value={mp.activity_score} color="#238551" tip="Activity — how often they speak in parliament" />
                          <ScoreChip label="QTY" value={mp.quality_score} color={mp.quality_source === 'ai' ? '#9179F2' : '#5C7080'} tip={`Quality — substance of contributions (${mp.quality_source === 'ai' ? 'AI-scored' : 'data-based'})`} />
                        </div>
                        {mp.key_contributions?.[0] && (
                          <div style={{
                            marginTop: 4, fontSize: 8, color: 'var(--text-muted)',
                            fontStyle: 'italic', lineHeight: 1.4,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          }}>
                            {mp.key_contributions[0]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* ─── Methodology Tab ─── */}
          {activeTab === 'methodology' && (
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                Scoring Methodology
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.7,
                padding: '8px 10px', background: 'rgba(45,114,210,0.04)',
                borderRadius: 4, borderLeft: '2px solid #2D72D2', marginBottom: 12,
              }}>
                Scores combine <strong>quantitative data</strong> (speech counts, session participation) with
                <strong> AI quality analysis</strong> (Claude Haiku evaluates policy substance and debate quality).
                A concise, factual MP scores higher than a verbose one with low substance.
                Data from official parliamentary verbatim PDFs published by hr.parliament.gov.np.
              </div>

              {[
                {
                  name: 'Participation Rate (35%)',
                  formula: 'sessions_active / total_sessions × 100',
                  desc: 'How often the MP shows up and speaks across sessions.',
                  color: '#2D72D2',
                },
                {
                  name: 'Activity Score (25%)',
                  formula: 'Percentile rank of total speeches among all MPs',
                  desc: 'How many times they spoke compared to peers. An MP in the 80th percentile spoke more than 80% of other MPs.',
                  color: '#238551',
                },
                {
                  name: 'Quality Score (40%)',
                  formula: 'AI-assessed (relevance + engagement) / 2 → normalized 0-100',
                  desc: 'Claude Haiku analyzes each speech for policy substance, factual depth, and constructive engagement. Scored 1-10, averaged across sessions. Rewards concise, factual contributions over verbose procedural remarks.',
                  color: '#9179F2',
                },
                {
                  name: 'Overall Score',
                  formula: '(Participation × 0.35) + (Activity × 0.25) + (Quality × 0.40)',
                  desc: 'Weighted composite. Quality weighted highest because substantive debate matters most.',
                  color: '#C87619',
                },
              ].map((m, i) => (
                <div key={i} style={{
                  padding: '8px 10px', marginBottom: 8, borderRadius: 4,
                  background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: m.color }}>{m.name}</div>
                  <div style={{
                    fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)',
                    marginTop: 3, padding: '2px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: 3,
                    display: 'inline-block',
                  }}>
                    {m.formula}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                    {m.desc}
                  </div>
                </div>
              ))}

              <div style={{
                fontSize: 9, color: 'var(--text-muted)', marginTop: 12,
                padding: '6px 10px', background: 'rgba(35,133,81,0.05)',
                borderRadius: 4, borderLeft: '2px solid #238551',
              }}>
                <strong>Excludes:</strong> Chair speakers (सम्माननीय अध्यक्ष), speeches under 20 words (procedural).
                Only includes MPs who made substantive contributions.<br />
                <strong>AI Model:</strong> Claude Haiku — evaluates relevance (policy substance) and engagement (debate quality) on 1-10 scale per session. Falls back to word count percentile if no AI analysis available.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '4px 12px', borderTop: '1px solid var(--border-primary)',
          fontSize: 9, color: 'var(--text-muted)',
        }}>
          Source: hr.parliament.gov.np verbatim records
        </div>
      </div>
    </Widget>
  );
});

// ─── Helpers ─────────────────────────────────────────────

function ScoreChip({ label, value, color, tip }: { label: string; value: number; color: string; tip?: string }) {
  return (
    <div title={tip} style={{
      display: 'flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 3,
      background: `${color}15`,
      cursor: tip ? 'help' : 'default',
    }}>
      <span style={{ fontSize: 7, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
      <div style={{ width: 30, height: 3, borderRadius: 2, background: 'var(--border-primary)' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${Math.min(value, 100)}%`,
          background: color,
        }} />
      </div>
      <span style={{ fontSize: 7, color, fontWeight: 700 }}>{Math.round(value)}</span>
    </div>
  );
}

function EmptyState({ sessions }: { sessions: number }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      textAlign: 'center', gap: 8,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'rgba(45,114,210,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Mic2 size={18} style={{ color: '#2D72D2' }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
        Analysis In Progress
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 260 }}>
        {sessions} session PDFs scraped. Session summaries, agenda breakdowns,
        and MP scorecards will appear once analysis completes.
      </div>
    </div>
  );
}
