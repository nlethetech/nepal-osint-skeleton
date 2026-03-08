import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import apiClient from '../../api/client';

interface TickerItem {
  id: string;
  type: 'elected' | 'leading' | 'pr' | 'breaking';
  headline: string;
  timestamp: Date;
}

interface Candidate {
  name_en: string;
  party: string;
  votes: number;
  is_winner?: boolean;
  vote_pct?: number;
}

interface Constituency {
  constituency_id: string;
  name_en: string;
  district: string;
  province: string;
  status: 'declared' | 'counting' | 'pending';
  winner_party: string | null;
  winner_name: string | null;
  total_votes: number;
  candidates: Candidate[];
  last_updated?: string | null;
}

interface PartySeat {
  party: string;
  seats: number;
  won: number;
  leading: number;
}

interface NationalSummary {
  total_constituencies: number;
  declared: number;
  counting: number;
  pending: number;
  total_votes_cast: number;
  leading_party: string | null;
  leading_party_seats: number;
  party_seats: PartySeat[];
}

interface LiveSnapshot {
  results: Constituency[];
  national_summary: NationalSummary;
}

// Well-known close/hot races to always highlight when counting
const HOT_SEATS = new Set([
  'Jhapa-5', 'Sarlahi-4', 'Kathmandu-1', 'Kathmandu-2', 'Kathmandu-3',
  'Kathmandu-4', 'Lalitpur-1', 'Lalitpur-2', 'Lalitpur-3',
  'Chitwan-1', 'Chitwan-2', 'Kaski-1', 'Kaski-2',
  'Morang-1', 'Morang-2', 'Sunsari-1', 'Sunsari-2',
  'Rupandehi-1', 'Rupandehi-2', 'Banke-1',
]);

// Party short names for PR ticker
const PARTY_SHORT: Record<string, string> = {
  'CPN (UML)': 'UML',
  'Nepali Congress': 'NC',
  'CPN (Maoist Centre)': 'MC',
  'Rastriya Swatantra Party': 'RSP',
  'Rastriya Prajatantra Party': 'RPP',
  'Janata Samajwadi Party': 'JSP',
  'Janamat Party': 'JMP',
  'Loktantrik Samajwadi Party': 'LSP',
  'Nagarik Unmukti Party': 'NUP',
  'CPN (Unified Socialist)': 'CPN-US',
  'Nepal Workers Peasants Party': 'NWPP',
  'Independent': 'IND',
};

function getPartyShort(party: string): string {
  return PARTY_SHORT[party] || party.slice(0, 8);
}

function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0 || diff < 60_000) return 'NOW';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Category styling
const CATEGORY_STYLES: Record<string, { color: string; bg: string }> = {
  elected: { color: '#10B981', bg: '#10B981' },
  leading: { color: '#F59E0B', bg: '#F59E0B' },
  pr: { color: '#3B82F6', bg: '#3B82F6' },
  breaking: { color: '#EF4444', bg: '#EF4444' },
};

const CATEGORY_LABELS: Record<string, string> = {
  elected: 'ELECTED',
  leading: 'LEADING',
  pr: 'PR TRACKER',
  breaking: 'BREAKING',
};

interface AlertTickerProps {
  onAlertClick?: (alert: TickerItem) => void;
}

export function AlertTicker({ onAlertClick }: AlertTickerProps) {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const prevDeclaredRef = useRef<Set<string>>(new Set());

  const buildTickerItems = useCallback((data: LiveSnapshot): TickerItem[] => {
    const ticker: TickerItem[] = [];
    const now = new Date();

    if (!data?.results) return ticker;

    const { results, national_summary } = data;

    // 1. ELECTED — declared winners (newest first based on seenWinners tracking)
    const newlyDeclared: Constituency[] = [];
    const allDeclared: Constituency[] = [];

    for (const c of results) {
      if (c.status !== 'declared' || !c.winner_name || !c.winner_party) continue;
      allDeclared.push(c);
      if (!prevDeclaredRef.current.has(c.constituency_id)) {
        newlyDeclared.push(c);
      }
    }

    // Update seen set
    for (const c of allDeclared) {
      prevDeclaredRef.current.add(c.constituency_id);
    }

    // Show newly declared first, then recent declared (up to 15 total)
    const electedToShow = [
      ...newlyDeclared,
      ...allDeclared.filter(c => !newlyDeclared.includes(c)),
    ].slice(0, 15);

    for (const c of electedToShow) {
      const sorted = [...c.candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
      const totalVotes = c.total_votes || sorted.reduce((s, x) => s + (x.votes || 0), 0);
      const marginVotes = sorted.length >= 2 ? sorted[0].votes - sorted[1].votes : null;
      const marginPct = marginVotes !== null && totalVotes > 0
        ? ((marginVotes / totalVotes) * 100).toFixed(1)
        : null;
      const marginStr = marginPct ? ` (+${marginPct}%)` : '';

      ticker.push({
        id: `elected-${c.constituency_id}`,
        type: 'elected',
        headline: `${c.winner_name} (${getPartyShort(c.winner_party!)}) wins ${c.name_en}, ${c.district}${marginStr}`,
        timestamp: c.last_updated ? new Date(c.last_updated) : now,
      });
    }

    // 2. LEADING — close races / hot seats that are counting
    const countingRaces = results.filter(c => c.status === 'counting' && c.candidates?.length >= 2);

    // Sort by closeness (smallest margin) and hot-seat priority
    const scoredRaces = countingRaces.map(c => {
      const sorted = [...c.candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
      const lead = sorted[0];
      const runner = sorted[1];
      const marginVotes = (lead?.votes || 0) - (runner?.votes || 0);
      const totalVotes = c.total_votes || sorted.reduce((s, x) => s + (x.votes || 0), 0);
      const isHot = HOT_SEATS.has(c.name_en);
      // Score: hot seats get priority, then sort by closeness (lower margin = more interesting)
      const score = (isHot ? 10000 : 0) + Math.max(0, 5000 - marginVotes);
      return { c, lead, runner, marginVotes, totalVotes, score };
    }).sort((a, b) => b.score - a.score);

    // Show top 10 counting races
    for (const { c, lead, runner, marginVotes, totalVotes } of scoredRaces.slice(0, 10)) {
      if (!lead || !runner) continue;
      const leadPct = totalVotes > 0 ? ((lead.votes / totalVotes) * 100).toFixed(1) : '0';
      ticker.push({
        id: `leading-${c.constituency_id}`,
        type: 'leading',
        headline: `${lead.name_en} (${getPartyShort(lead.party)}) leads ${c.name_en} — ${lead.votes.toLocaleString()} vs ${runner.name_en} ${runner.votes.toLocaleString()} (+${marginVotes.toLocaleString()})`,
        timestamp: c.last_updated ? new Date(c.last_updated) : now,
      });
    }

    // 3. PR TRACKER — party proportional representation percentages
    if (national_summary?.party_seats?.length > 0) {
      const topParties = national_summary.party_seats.slice(0, 6);
      const prLine = topParties
        .map(p => `${getPartyShort(p.party)} ${p.won}W+${p.leading}L`)
        .join('  |  ');

      ticker.push({
        id: 'pr-summary',
        type: 'pr',
        headline: `FPTP Seats (${national_summary.declared}/${national_summary.total_constituencies} declared): ${prLine}`,
        timestamp: now,
      });

      // Overall progress item
      const totalSeats = national_summary.total_constituencies;
      const declared = national_summary.declared;
      const counting = national_summary.counting;
      ticker.push({
        id: 'progress-summary',
        type: 'pr',
        headline: `${declared} declared, ${counting} counting, ${totalSeats - declared - counting} pending — ${national_summary.total_votes_cast?.toLocaleString() || '0'} total votes cast`,
        timestamp: now,
      });
    }

    return ticker;
  }, []);

  // Fetch election data and build ticker
  const fetchData = useCallback(async () => {
    try {
      const [snapshotRes, aiBreakingRes, storiesRes] = await Promise.all([
        apiClient.get('/election-results/live-snapshot'),
        // AI agent breaking alerts
        apiClient.get('/election-results/ticker/breaking').catch(() => ({ data: [] })),
        // Also fetch breaking election stories/tweets
        apiClient.get('/stories/recent', {
          params: { hours: 1, limit: 10 }
        }).catch(() => ({ data: [] })),
      ]);

      const snapshot: LiveSnapshot = snapshotRes.data;
      const electionItems = buildTickerItems(snapshot);

      // AI agent breaking alerts (highest priority)
      const aiAlerts: TickerItem[] = ((aiBreakingRes.data || []) as Array<{
        id: string; type: string; headline: string; timestamp: string;
      }>).map(a => ({
        id: `ai-${a.id}`,
        type: 'breaking' as const,
        headline: a.headline,
        timestamp: new Date(a.timestamp),
      }));

      // Add breaking election news from stories (filtered to election-related)
      const stories = (storiesRes.data || []) as Array<{
        id: string; title: string; severity: string; category: string;
        published_at: string | null; created_at: string;
      }>;

      const electionKeywords = /election|vote|ballot|counting|poll|candidate|winner|constituency|FPTP|PR seat|निर्वाचन|मतगणना/i;
      const breakingNews: TickerItem[] = stories
        .filter(s => (s.severity === 'critical' || s.severity === 'high') && electionKeywords.test(s.title))
        .slice(0, 5)
        .map(s => ({
          id: `breaking-${s.id}`,
          type: 'breaking' as const,
          headline: s.title,
          timestamp: new Date(s.published_at || s.created_at),
        }));

      const combined = [...aiAlerts, ...electionItems, ...breakingNews];
      if (combined.length > 0) {
        setItems(combined);
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [buildTickerItems]);

  // Fetch every 30 seconds for live election data
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Duplicate for seamless scroll
  const tickerContent = useMemo(() => {
    if (items.length === 0) return [];
    const copies = items.length >= 12 ? 2 : 3;
    return Array.from({ length: copies }, () => items).flat();
  }, [items]);

  if (loading) {
    return (
      <div className="bloomberg-ticker">
        <div className="bloomberg-ticker-track" style={{ animation: 'none', justifyContent: 'center' }}>
          <span style={{ color: 'var(--pro-text-muted)', fontSize: '11px' }}>
            Loading election data...
          </span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bloomberg-ticker">
        <div className="bloomberg-ticker-track" style={{ animation: 'none', justifyContent: 'center' }}>
          <span style={{ color: 'var(--pro-text-muted)', fontSize: '11px' }}>
            Waiting for election results...
          </span>
        </div>
      </div>
    );
  }

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const animationDuration = Math.max(50, items.length * (isMobile ? 12 : 6));

  return (
    <div
      className="bloomberg-ticker"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className="bloomberg-ticker-track"
        style={{
          animationPlayState: isPaused ? 'paused' : 'running',
          animationDuration: `${animationDuration}s`,
          willChange: 'transform',
        }}
      >
        {tickerContent.map((item, index) => {
          const style = CATEGORY_STYLES[item.type] || CATEGORY_STYLES.breaking;
          const label = CATEGORY_LABELS[item.type] || 'NEWS';
          return (
            <div
              key={`${item.id}-${index}`}
              className="bloomberg-ticker-item"
              onClick={() => onAlertClick?.(item)}
            >
              <span
                className="ticker-severity"
                style={{ background: style.bg, borderRadius: 1 }}
              />
              <span
                className="ticker-category"
                style={{ color: style.color, fontWeight: 700 }}
              >
                {label}
              </span>
              <span className="ticker-headline">
                {item.headline}
              </span>
              <span className="ticker-time" style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: '10px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                marginLeft: '6px',
              }}>
                {formatTime(item.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact banner showing election progress
export function AlertTickerBanner() {
  const [declared, setDeclared] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await apiClient.get('/election-results/live-snapshot');
        setDeclared(res.data?.national_summary?.declared || 0);
      } catch {
        // Silently handled
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

  if (declared === 0) return null;

  return (
    <div
      style={{
        height: '28px',
        background: 'linear-gradient(90deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.05) 100%)',
        borderBottom: '1px solid rgba(16,185,129,0.3)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: '8px',
      }}
    >
      <AlertTriangle size={12} style={{ color: '#10B981' }} />
      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: '#10B981',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {declared}/165 FPTP Seats Declared
      </span>
    </div>
  );
}
