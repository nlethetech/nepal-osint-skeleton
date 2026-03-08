/**
 * PromiseTrackerWidget — RSP Official Manifesto (2082) Promise Tracker
 *
 * Fetches promise data from the API (updated nightly by local Sonnet agent).
 * Falls back to hardcoded seed data if API returns empty.
 */
import { memo, useState, useMemo, useEffect } from 'react';
import { Widget } from '../Widget';
import { ClipboardCheck, ChevronDown, ChevronUp, Filter, RefreshCw } from 'lucide-react';
import apiClient from '../../../api/client';

type PromiseStatus = 'not_started' | 'in_progress' | 'partially_fulfilled' | 'fulfilled' | 'stalled';

interface ManifestoPromise {
  promise_id: string;
  promise: string;
  category: string;
  status: PromiseStatus;
  detail?: string;
  source?: string;
  status_detail?: string;
  last_checked_at?: string;
  status_changed_at?: string;
}

const STATUS_CONFIG: Record<PromiseStatus, { label: string; color: string; bg: string }> = {
  not_started:         { label: 'Not Started',   color: 'var(--text-muted)',     bg: 'rgba(113,113,122,0.12)' },
  in_progress:         { label: 'In Progress',   color: 'var(--accent-primary)', bg: 'rgba(59,130,246,0.12)' },
  partially_fulfilled: { label: 'Partial',       color: 'var(--status-medium)',  bg: 'rgba(234,179,8,0.12)' },
  fulfilled:           { label: 'Fulfilled',     color: 'var(--status-low)',     bg: 'rgba(34,197,94,0.12)' },
  stalled:             { label: 'Stalled',       color: 'var(--status-high)',    bg: 'rgba(249,115,22,0.12)' },
};

const CATEGORIES = [
  'Governance', 'Anti-Corruption', 'Judiciary', 'Economy',
  'Digital & IT', 'Financial Sector', 'Social', 'Infrastructure', 'Trade & Investment',
] as const;

// ── Hardcoded fallback — VERIFIED against RSP Manifesto (वाचा पत्र 2082) PDF ──
const FALLBACK_PROMISES: ManifestoPromise[] = [
  // Governance
  { promise_id: 'G1', category: 'Governance', status: 'not_started', promise: 'Constitutional amendment discussion paper', detail: 'Prepare a discussion paper (बहस पत्र) for national consensus on constitutional amendments. Topics: directly elected executive, proportional parliament, MPs not becoming ministers, non-partisan local govt, reformed provinces.', source: 'Point 10' },
  { promise_id: 'G2', category: 'Governance', status: 'not_started', promise: 'Limit federal ministries to 18 with expert ministers', detail: 'Cap ministries at 18. Establish specialist (विज्ञ) ministers and expertise-based civil service administration.', source: 'Point 17' },
  { promise_id: 'G3', category: 'Governance', status: 'not_started', promise: 'Party leader term limited to two terms', detail: 'Party president cannot hold the top party position for more than two consecutive terms.', source: 'Point 15' },
  { promise_id: 'G4', category: 'Governance', status: 'not_started', promise: 'Reform National Planning Commission into think-tank', detail: 'Transform NPC from traditional format into modern policy research, data, and monitoring-focused think-tank.', source: 'Point 18' },
  { promise_id: 'G5', category: 'Governance', status: 'not_started', promise: 'Professionalize civil service, end political unions in bureaucracy', detail: 'Abolish partisan trade unions in civil service. Make administration fully professional, impartial, and accountable.', source: 'Point 7' },
  { promise_id: 'G6', category: 'Governance', status: 'not_started', promise: 'End nepotism in personal secretary appointments', detail: 'Bar officials from appointing family members to positions like personal secretary (स्वकीय सचिव).', source: 'Point 16' },
  { promise_id: 'G7', category: 'Governance', status: 'not_started', promise: 'Classify & reform public institutions', detail: 'Classify public enterprises: merge some, PPP for some, strategic partners for others, decentralize others.', source: 'Point 26' },
  { promise_id: 'G8', category: 'Governance', status: 'not_started', promise: 'Mission-mode (मिसन मोड) public organizations', detail: 'Run public projects with clear objectives, fixed budgets, time limits, qualified HR, and results-based targets.', source: 'Point 27' },
  // Anti-Corruption
  { promise_id: 'AC1', category: 'Anti-Corruption', status: 'not_started', promise: 'Mandatory asset disclosure before and after office', detail: 'Full asset disclosure before taking office and independent audit of wealth change after term, for officials and families.', source: 'Point 16' },
  { promise_id: 'AC2', category: 'Anti-Corruption', status: 'not_started', promise: 'Digital governance with mandatory e-signatures', detail: 'Make digital signatures legally mandatory. Digitize all govt memos (tippani.gov.np) and directives (paripatra.gov.np).', source: 'Point 5' },
  { promise_id: 'AC3', category: 'Anti-Corruption', status: 'not_started', promise: 'Amend CIAA Act 2048, Constitutional Council Act 2066, Judicial Council Act 2073', detail: 'Strengthen independence of constitutional bodies by amending their governing acts.', source: 'Point 11' },
  { promise_id: 'AC4', category: 'Anti-Corruption', status: 'not_started', promise: 'Political party funding from public funds based on vote share', detail: 'Annual public funding to parties based on vote share. Reform Political Party Act and election laws.', source: 'Point 15' },
  { promise_id: 'AC5', category: 'Anti-Corruption', status: 'not_started', promise: 'End cartel pricing and rent-seeking via independent regulators', detail: 'Create independent, professional regulators to control cartels, unhealthy competition, and rent-seeking.', source: 'Point 20' },
  // Judiciary
  { promise_id: 'J1', category: 'Judiciary', status: 'not_started', promise: 'Merit-based judicial appointments', detail: 'End political influence in Supreme/High Court appointments. Shift to meritocracy and competitive system.', source: 'Point 13' },
  { promise_id: 'J2', category: 'Judiciary', status: 'not_started', promise: 'Clear judicial backlog, amend Judicial Code 2046', detail: 'Fast-track pending transitional justice cases. Implement Judicial Code of 2046 immediately.', source: 'Point 12' },
  { promise_id: 'J3', category: 'Judiciary', status: 'not_started', promise: 'Study live broadcast of court proceedings', detail: 'Study options for live or recorded broadcasting of court proceedings for judicial transparency.', source: 'Point 14' },
  { promise_id: 'J4', category: 'Judiciary', status: 'not_started', promise: 'Define usury and unfair transactions as economic crimes', detail: 'Legally classify meter-byaj (usury) and unfair financial transactions as economic crimes. Dismantle networks in 5 years.', source: 'Point 32' },
  { promise_id: 'J5', category: 'Judiciary', status: 'not_started', promise: 'End caste-based discrimination via enforcement', detail: 'Address historical injustice against Dalit communities through state policy, legal reform, and active enforcement.', source: 'Point 1' },
  // Economy
  { promise_id: 'E1', category: 'Economy', status: 'not_started', promise: '$3,000 per-capita income and $100B economy target', detail: 'Raise per-capita income to minimum $3,000 and grow economy to $100B (7% real annual growth).', source: 'Citizen Contract §2' },
  { promise_id: 'E2', category: 'Economy', status: 'not_started', promise: 'Progressive tax reform to reduce middle-class burden', detail: 'Review family burden tax threshold. End retroactive tax rules. Stop tax evasion with enforcement.', source: 'Point 22' },
  { promise_id: 'E3', category: 'Economy', status: 'not_started', promise: 'Create 12 lakh new formal jobs', detail: 'Generate 1.2 million new jobs in IT, construction, tourism, agriculture, mining, sports, and trade.', source: 'Citizen Contract §3' },
  { promise_id: 'E4', category: 'Economy', status: 'not_started', promise: 'Break cartels and monopolies', detail: 'Build independent regulators to eliminate cartel pricing, rent-seeking, and regulatory capture.', source: 'Point 20' },
  { promise_id: 'E5', category: 'Economy', status: 'not_started', promise: 'Review Indian rupee peg policy', detail: 'Study with international experts on the decades-old fixed NPR-INR exchange rate.', source: 'Point 23' },
  { promise_id: 'E6', category: 'Economy', status: 'not_started', promise: 'Export electricity, agriculture & computation', detail: 'Transform from raw electricity exporter to also exporting AI/computation, leveraging cold climate for data centers.', source: 'Point 39' },
  // Digital & IT
  { promise_id: 'D1', category: 'Digital & IT', status: 'not_started', promise: 'National digital ID for all citizens', detail: 'Issue national identity card to every citizen, build unified database, link to all govt services.', source: 'Point 4' },
  { promise_id: 'D2', category: 'Digital & IT', status: 'not_started', promise: 'Digitize tippani.gov.np & paripatra.gov.np', detail: 'All government memos and official directives issued and tracked digitally.', source: 'Point 5' },
  { promise_id: 'D3', category: 'Digital & IT', status: 'not_started', promise: 'Complete government file digitization', detail: 'End manual file routing. Every file tracked digitally with process audit trail (प्रक्रिया लेखाजोखा).', source: 'Point 9' },
  { promise_id: 'D4', category: 'Digital & IT', status: 'not_started', promise: 'Digital Parks in all 7 provinces, $30B IT export target', detail: 'Declare IT as national strategic industry. Digital parks in all 7 provinces. Grow IT exports from $1.5B to $30B in 10 years.', source: 'Point 36' },
  { promise_id: 'D5', category: 'Digital & IT', status: 'not_started', promise: 'Comprehensive digital infrastructure & cybersecurity', detail: 'Build complete digital ecosystem: data centers, cloud, cybersecurity framework, privacy laws, high-speed connectivity.', source: 'Point 37' },
  { promise_id: 'D6', category: 'Digital & IT', status: 'not_started', promise: 'International payment gateway & Digital-First nation', detail: 'Remove barriers for startups to access international payment gateways. Transform Nepal into Digital-First nation.', source: 'Point 38' },
  // Financial Sector
  { promise_id: 'F1', category: 'Financial Sector', status: 'not_started', promise: 'Cooperative & microfinance regulation under NRB', detail: 'Bring all cooperatives and microfinance with 50Cr+ transactions under direct Nepal Rastra Bank supervision.', source: 'Points 29, 30' },
  { promise_id: 'F2', category: 'Financial Sector', status: 'not_started', promise: 'NEPSE restructuring & capital market reform', detail: 'Restructure Nepal Stock Exchange and CDS. Increase private sector share. Develop competitive depository services.', source: 'Point 33' },
  { promise_id: 'F3', category: 'Financial Sector', status: 'not_started', promise: 'Grow institutional investors', detail: 'Expand pension funds, insurance, mutual funds. Build insider trading regulation framework.', source: 'Point 34' },
  // Social
  { promise_id: 'S1', category: 'Social', status: 'not_started', promise: 'End caste, ethnic, and gender discrimination', detail: 'Address systemic discrimination against Dalits and marginalized communities through policy, law, and social reform.', source: 'Point 1' },
  { promise_id: 'S2', category: 'Social', status: 'not_started', promise: 'Fundamental reform of public education system', detail: 'Overhaul public education quality, access, and competitiveness. Reform teacher evaluation, curriculum, school governance.', source: 'Points 62-65' },
  { promise_id: 'S3', category: 'Social', status: 'not_started', promise: 'Universal health insurance expansion', detail: 'Strengthen and expand health insurance model to ensure quality healthcare reaches every citizen.', source: 'Citizen Contract §2, Point 71' },
  { promise_id: 'S4', category: 'Social', status: 'not_started', promise: 'Diaspora voting rights & engagement', detail: 'Grant online voting rights to Nepalis abroad. Universal diaspora fund. One-time Nepali, always Nepali policy.', source: 'Citizen Contract §5, Point 99' },
  // Infrastructure
  { promise_id: 'I1', category: 'Infrastructure', status: 'not_started', promise: '15,000 MW installed hydropower capacity', detail: 'Establish 15,000 MW capacity and Smart National Grid. Make Nepal an energy export hub.', source: 'Citizen Contract §4' },
  { promise_id: 'I2', category: 'Infrastructure', status: 'not_started', promise: 'High-speed internet to all settlements', detail: 'Extend high-speed affordable internet to every settlement. Build 30,000 km national fiber-optic highway.', source: 'Citizen Contract §4' },
  { promise_id: 'I3', category: 'Infrastructure', status: 'not_started', promise: 'Integrated connectivity: roads, rail, and air', detail: 'Build 15,000 km quality roads, 10 national highway upgrades, railway masterplan, signature infrastructure projects.', source: 'Citizen Contract §4, Point 57' },
  // Trade & Investment
  { promise_id: 'T1', category: 'Trade & Investment', status: 'not_started', promise: 'One-stop shop for investment (वान-स्टप सेवा केन्द्र)', detail: 'Single window for all domestic and foreign investment approvals. File once, no running between agencies.', source: 'Point 24' },
  { promise_id: 'T2', category: 'Trade & Investment', status: 'not_started', promise: 'Reduce import dependence via domestic production', detail: 'Shift from remittance-dependent consumption economy to production-oriented economy.', source: 'Point 35, Citizen Contract §3' },
  { promise_id: 'T3', category: 'Trade & Investment', status: 'not_started', promise: 'Investment-friendly regulatory framework', detail: 'Transparent, predictable regulations. Strengthen NEPSE, build competitive financial markets.', source: 'Points 24, 33' },
];

export const PromiseTrackerWidget = memo(function PromiseTrackerWidget() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promises, setPromises] = useState<ManifestoPromise[]>(FALLBACK_PROMISES);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    const fetchPromises = async () => {
      try {
        const res = await apiClient.get('/promises/summary', {
          params: { party: 'RSP', election_year: '2082' },
        });
        const data = res.data;
        if (data.promises && data.promises.length > 0) {
          setPromises(data.promises);
          // Find most recent last_checked_at
          const checked = data.promises
            .map((p: any) => p.last_checked_at)
            .filter(Boolean)
            .sort()
            .pop();
          if (checked) setLastChecked(checked);
        }
      } catch {
        // Use fallback data
      }
      setLoading(false);
    };
    fetchPromises();
  }, []);

  const filtered = selectedCategory
    ? promises.filter(p => p.category === selectedCategory)
    : promises;

  const total = promises.length;
  const byStatus = useMemo(() => promises.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [promises]);

  const fulfilled = byStatus.fulfilled || 0;
  const inProgress = byStatus.in_progress || 0;
  const notStarted = byStatus.not_started || 0;
  const partial = byStatus.partially_fulfilled || 0;
  const stalled = byStatus.stalled || 0;

  const progressPct = Math.round(((fulfilled * 1 + inProgress * 0.3 + partial * 0.5) / total) * 100);

  return (
    <Widget id="promise-tracker" icon={<ClipboardCheck size={14} />}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Summary Bar */}
        <div style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {/* Party badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#38BDF8',
              boxShadow: '0 0 6px rgba(56,189,248,0.4)',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#38BDF8', letterSpacing: '0.04em' }}>RSP</span>
            <span style={{ fontSize: 9, color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>2082</span>
          </div>

          {/* Progress bar */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Manifesto Progress
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {progressPct}%
              </span>
            </div>
            <div style={{
              height: 4, borderRadius: 2,
              background: 'var(--bg-active)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #38BDF8, #22C55E)',
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>

          {/* Stats chips */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {[
              { label: 'Done', value: fulfilled, color: 'var(--status-low)' },
              { label: 'Active', value: inProgress, color: 'var(--accent-primary)' },
              { label: 'Stalled', value: stalled, color: 'var(--status-high)' },
              { label: 'Pending', value: notStarted, color: 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 10, color: s.color, fontFamily: 'var(--font-mono)',
              }}>
                <span style={{ fontWeight: 700 }}>{s.value}</span>
                <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category Filter */}
        <div style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <Filter size={10} style={{ color: 'var(--text-disabled)', marginRight: 2 }} />
          <button
            onClick={() => setSelectedCategory(null)}
            style={{
              padding: '2px 8px', fontSize: 10, fontWeight: 500,
              background: !selectedCategory ? 'var(--accent-primary)' : 'var(--bg-elevated)',
              color: !selectedCategory ? 'white' : 'var(--text-muted)',
              border: `1px solid ${!selectedCategory ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            All ({total})
          </button>
          {CATEGORIES.map(cat => {
            const count = promises.filter(p => p.category === cat).length;
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(active ? null : cat)}
                style={{
                  padding: '2px 8px', fontSize: 10, fontWeight: 500,
                  background: active ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: active ? 'white' : 'var(--text-muted)',
                  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Promise List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filtered.map(p => {
            const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.not_started;
            const expanded = expandedId === p.promise_id;
            return (
              <div
                key={p.promise_id}
                onClick={() => setExpandedId(expanded ? null : p.promise_id)}
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {/* Status dot */}
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: cfg.color,
                    marginTop: 5, flexShrink: 0,
                  }} />

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        {p.promise}
                      </span>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 4 }}>
                        {p.detail && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {p.detail}
                          </div>
                        )}
                        {p.status_detail && (
                          <div style={{
                            fontSize: 10, color: 'var(--accent-primary)', lineHeight: 1.4, marginTop: 4,
                            padding: '4px 8px', background: 'rgba(59,130,246,0.08)',
                            border: '1px solid rgba(59,130,246,0.15)',
                          }}>
                            <RefreshCw size={9} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                            {p.status_detail}
                          </div>
                        )}
                        {p.source && (
                          <div style={{
                            fontSize: 9, color: 'var(--text-disabled)',
                            fontFamily: 'var(--font-mono)', marginTop: 4,
                          }}>
                            Ref: {p.source}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right side: category tag + status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 8, color: 'var(--text-disabled)',
                      fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      {p.promise_id}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, color: cfg.color,
                      background: cfg.bg, padding: '1px 6px',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}>
                      {cfg.label}
                    </span>
                    {expanded ? (
                      <ChevronUp size={12} style={{ color: 'var(--text-disabled)' }} />
                    ) : (
                      <ChevronDown size={12} style={{ color: 'var(--text-disabled)' }} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>
            Source: RSP Official Manifesto 2082 ({total} promises tracked)
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
            {lastChecked
              ? `Checked ${new Date(lastChecked).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : `${filtered.length} shown`
            }
          </span>
        </div>
      </div>
    </Widget>
  );
});
