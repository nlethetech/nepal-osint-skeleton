// P0 Widget exports (connected to backend)
export { MapWidget } from './MapWidget';
export { ElectionMapWidget } from './ElectionMapWidget';
export { KPIWidget } from './KPIWidget';
export { StoriesWidget } from './StoriesWidget';
export { NewsFeedWidget } from './NewsFeedWidget';
export { DisastersWidget } from './DisastersWidget';
export { ThreatsWidget } from './ThreatsWidget';
export { ElectionsWidget } from './ElectionsWidget';
export { KnowYourNetaWidget } from './KnowYourNetaWidget';

// Election Monitor Widgets (Palantir-style modular)
export { ElectionStatusWidget } from './ElectionStatusWidget';
export { SwingAnalysisWidget } from './SwingAnalysisWidget';
export { CloseRacesWidget } from './CloseRacesWidget';
export { IncumbencyWidget } from './IncumbencyWidget';
export { CandidatesWidget } from './CandidatesWidget';
export { PartySwitchWidget } from './PartySwitchWidget';

// Situation Brief (Narada Analyst Agent)
export { SituationBriefWidget } from './SituationBriefWidget';

export { ElectionLiveWidget } from './ElectionLiveWidget';
export { ElectionPRWidget } from './ElectionPRWidget';
export { ElectionSeatsWidget } from './ElectionSeatsWidget';

// Situation Monitor Widgets
export { IntelBriefHeroWidget } from './IntelBriefHeroWidget';
export { PoliticalPulseWidget } from './PoliticalPulseWidget';
export { ProvinceMonitorWidget } from './ProvinceMonitorWidget';
export { NarrativeTrackerWidget } from './NarrativeTrackerWidget';
export { DevelopingStoriesWidget } from './DevelopingStoriesWidget';

// Fact-Check Widget (user-requested verification)
export { FactCheckWidget } from './FactCheckWidget';

// Promise Tracker (RSP Manifesto Accountability)
export { PromiseTrackerWidget } from './PromiseTrackerWidget';

// Parliament Session Summary
export { ParliamentSessionWidget } from './ParliamentSessionWidget';

// Government Decisions
export { GovtDecisionsWidget } from './GovtDecisionsWidget';

// Bills Tracker (Parliamentary Bills Pipeline)
export { BillTrackerWidget } from './BillTrackerWidget';

// Parliamentary Activity (Verbatim Speech Analysis)
export { ParliamentaryActivityWidget } from './ParliamentaryActivityWidget';


// P1-P3 widgets (still using mock data, to be connected)
export { WeatherWidget } from './WeatherWidget';
export { AnnouncementsWidget } from './AnnouncementsWidget';

// Placeholder widgets - will be fully implemented in later phases
import React, { useState } from 'react';
import { Widget } from '../Widget';
import {
  TrendingUp, Users, FileText, MessageSquare, Building2,
  Droplets, Activity, Newspaper,
  MapPinned, AlertCircle, RefreshCw, Fuel, Hash, UserCheck,
  Search, Repeat2, Heart, MapPin, ChevronRight, Camera
} from 'lucide-react';
import { useMarketSummary, useSeismicStats, useTweets, useSearchTweets } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError } from './shared';

export function MarketWidget() {
  const { data, isLoading, error } = useMarketSummary();
  const regionalFuelBands = [
    { label: 'Kathmandu · Pokhara · Dipayal', petrol: 157, diesel: 142 },
    { label: 'Surkhet · Dang', petrol: 156, diesel: 141 },
    { label: 'Birgunj · Biratnagar · Nepalgunj', petrol: 154.5, diesel: 139.5 },
  ];
  const nationalFuelAverage = regionalFuelBands.reduce(
    (totals, band) => ({
      petrol: totals.petrol + band.petrol,
      diesel: totals.diesel + band.diesel,
    }),
    { petrol: 0, diesel: 0 },
  );
  const averagePetrol = nationalFuelAverage.petrol / regionalFuelBands.length;
  const averageDiesel = nationalFuelAverage.diesel / regionalFuelBands.length;

  // Format number with commas
  const formatValue = (value: number, unit: string): string => {
    if (unit === 'points') {
      return value.toLocaleString('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (unit === 'NPR') {
      return value.toFixed(2);
    }
    if (unit === 'NPR/tola') {
      return `NRS ${value.toLocaleString('en-NP', { maximumFractionDigits: 0 })}`;
    }
    if (unit === 'NPR/litre') {
      return `NRS ${value.toFixed(2)}`;
    }
    return value.toString();
  };

  // Format change percentage
  const formatChange = (change: number): string => {
    const prefix = change >= 0 ? '+' : '';
    return `${prefix}${change.toFixed(2)}%`;
  };

  // Build market indicators from API data
  const indicators = data ? [
    { label: 'NEPSE', value: data.nepse ? formatValue(data.nepse.value, data.nepse.unit) : '--', change: data.nepse ? formatChange(data.nepse.change) : '--', up: (data.nepse?.change ?? 0) >= 0 },
    { label: 'USD/NPR', value: data.usd_npr ? formatValue(data.usd_npr.value, data.usd_npr.unit) : '--', change: data.usd_npr ? formatChange(data.usd_npr.change) : '--', up: (data.usd_npr?.change ?? 0) >= 0 },
    { label: 'Gold/Tola', value: data.gold ? formatValue(data.gold.value, data.gold.unit) : '--', change: data.gold ? formatChange(data.gold.change) : '--', up: (data.gold?.change ?? 0) >= 0 },
    { label: 'Silver/Tola', value: data.silver ? formatValue(data.silver.value, data.silver.unit) : '--', change: data.silver ? formatChange(data.silver.change) : '--', up: (data.silver?.change ?? 0) >= 0 },
    { label: 'Petrol/L', value: formatValue(averagePetrol, 'NPR/litre'), change: data.petrol ? formatChange(data.petrol.change) : '--', up: (data.petrol?.change ?? 0) >= 0, icon: <Fuel size={10} />, sublabel: 'NOC national avg' },
    { label: 'Diesel/L', value: formatValue(averageDiesel, 'NPR/litre'), change: data.diesel ? formatChange(data.diesel.change) : '--', up: (data.diesel?.change ?? 0) >= 0, icon: <Fuel size={10} />, sublabel: 'NOC national avg' },
  ] : [];

  if (isLoading) {
    return (
      <Widget id="market" icon={<TrendingUp size={14} />}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
          <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ marginLeft: '8px', fontSize: '12px' }}>Loading market data...</span>
        </div>
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="market" icon={<TrendingUp size={14} />}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--status-critical)', fontSize: '12px' }}>
          Failed to load market data
        </div>
      </Widget>
    );
  }

  return (
    <Widget id="market" icon={<TrendingUp size={14} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'var(--border-subtle)', height: '100%' }}>
        {indicators.map((m, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {m.label}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 600 }}>{m.value}</div>
            {m.sublabel ? (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {m.sublabel}
              </div>
            ) : null}
            <div style={{ fontSize: '10px', color: m.up ? 'var(--status-low)' : 'var(--status-critical)', marginTop: m.sublabel ? '2px' : '4px' }}>{m.change}</div>
          </div>
        ))}
      </div>
      {data?.updated_at && (
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '4px 8px', textAlign: 'right', borderTop: '1px solid var(--border-subtle)' }}>
          Updated: {new Date(data.updated_at).toLocaleTimeString()}
        </div>
      )}
    </Widget>
  );
}

export function EntitiesWidget() {
  return (
    <Widget id="entities" icon={<Users size={14} />}>
      <div style={{ padding: '12px' }}>
        {['PM KP Sharma Oli', 'Election Commission', 'Nepal Army', 'NEOC'].map((e, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '12px' }}>{e}</span>
            <span style={{ fontSize: '11px', color: 'var(--status-low)' }}>+{[15, 8, 5, 12][i]}%</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}

export function BriefingWidget() {
  return (
    <Widget id="briefing" icon={<FileText size={14} />}>
      <div style={{ padding: '16px' }}>
        <div style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Intelligence Assessment</div>
        <div style={{ background: 'var(--bg-elevated)', borderLeft: '3px solid var(--status-medium)', padding: '12px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--status-medium)', marginBottom: '6px' }}>ELEVATED RISK</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Multiple converging factors suggest elevated situational awareness required. Monsoon flooding combined with election tensions create compound risk scenarios.
          </div>
        </div>
      </div>
    </Widget>
  );
}

type SocialCategory = 'all' | 'political' | 'economic' | 'security' | 'disaster' | 'social';
type SocialSource = 'all' | 'accounts' | 'hashtags';
type SocialHours = 24 | 72 | 168;

const CATEGORY_OPTIONS: { key: SocialCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'political', label: 'Political' },
  { key: 'economic', label: 'Economic' },
  { key: 'security', label: 'Security' },
  { key: 'disaster', label: 'Disaster' },
  { key: 'social', label: 'Social' },
];

const SOURCE_OPTIONS: { key: SocialSource; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All', icon: <MessageSquare size={10} /> },
  { key: 'accounts', label: 'Accounts', icon: <UserCheck size={10} /> },
  { key: 'hashtags', label: 'Hashtags', icon: <Hash size={10} /> },
];

const TIME_OPTIONS: { key: SocialHours; label: string }[] = [
  { key: 24, label: '24h' },
  { key: 72, label: '3d' },
  { key: 168, label: '7d' },
];

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  critical: { bg: 'rgba(205,66,70,0.2)', color: '#CD4246' },
  high: { bg: 'rgba(200,118,25,0.2)', color: '#C87619' },
  medium: { bg: 'rgba(209,152,11,0.2)', color: '#D1980B' },
  low: { bg: 'rgba(35,133,81,0.2)', color: '#238551' },
};

export function SocialWidget() {
  const [activeCategory, setActiveCategory] = useState<SocialCategory>('all');
  const [activeSource, setActiveSource] = useState<SocialSource>('all');
  const [activeHours, setActiveHours] = useState<SocialHours>(72);
  const [nepalOnly, setNepalOnly] = useState(false);
  const [groundReports, setGroundReports] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isSearching = debouncedSearch.length >= 2;

  // Build query params for non-search mode
  const tweetParams = {
    limit: 500,
    hours: activeHours,
    ...(activeCategory !== 'all' ? { category: activeCategory } : {}),
    ...(activeSource !== 'all' ? { source: activeSource as 'accounts' | 'hashtags' } : {}),
    ...(nepalOnly ? { relevant_only: true } : {}),
    ...(groundReports ? { ground_reports: true } : {}),
  };

  const tweetsQuery = useTweets(isSearching ? { limit: 0, hours: 1 } : tweetParams);
  const searchResults = useSearchTweets(debouncedSearch, { limit: 500, hours: activeHours });

  const activeQuery = isSearching ? searchResults : tweetsQuery;
  const { data, isLoading, error } = activeQuery;

  const formatTimeAgo = (dateString: string | null): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getSourceTag = (tweet: any): string | null => {
    const sq = tweet.source_query as string | undefined;
    if (!sq) return null;
    if (sq.startsWith('nitter:#')) return `#${sq.slice(8)}`;
    if (sq.startsWith('nitter:')) return `@${sq.slice(7)}`;
    return null;
  };

  // Pill button style helper
  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 8px', fontSize: '10px', fontWeight: 500,
    borderRadius: '3px', border: 'none', cursor: 'pointer',
    transition: 'all 0.15s',
    background: active ? 'var(--accent-primary, #2D72D2)' : 'var(--bg-active, rgba(255,255,255,0.04))',
    color: active ? '#fff' : 'var(--text-muted, rgba(255,255,255,0.5))',
  });

  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '3px',
    padding: '2px 6px', fontSize: '9px', fontWeight: 500,
    borderRadius: '3px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-primary, #2D72D2)' : 'var(--bg-active, rgba(255,255,255,0.04))',
    color: active ? '#fff' : 'var(--text-muted, rgba(255,255,255,0.5))',
  });

  // Badge text
  const totalInPeriod = data?.total_in_period;
  const count = data?.count ?? 0;
  const badgeText = totalInPeriod && totalInPeriod > count
    ? `${count} of ${totalInPeriod}`
    : count > 0 ? `${count}` : undefined;

  // Loading
  if (isLoading) {
    return (
      <Widget id="social" icon={<MessageSquare size={14} />}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
          <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ marginLeft: '8px', fontSize: '12px' }}>Loading tweets...</span>
        </div>
      </Widget>
    );
  }

  // Error
  if (error) {
    return (
      <Widget id="social" icon={<MessageSquare size={14} />}>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
          <AlertCircle size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
          <div>Twitter feed unavailable</div>
        </div>
      </Widget>
    );
  }

  return (
    <Widget id="social" icon={<MessageSquare size={14} />} badge={badgeText}>
      {/* Single filter row */}
      <div style={{ display: 'flex', gap: '3px', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.06))', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 100, flexShrink: 0 }}>
          <Search size={9} style={{ position: 'absolute', left: '5px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            style={{
              width: '100%', padding: '2px 4px 2px 18px', fontSize: '8px',
              background: 'var(--bg-active, rgba(255,255,255,0.04))',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
              color: 'var(--text-primary, #F6F7F9)', outline: 'none',
              borderRadius: '3px',
            }}
          />
        </div>
        {CATEGORY_OPTIONS.map(({ key, label }) => (
          <button key={key} onClick={() => setActiveCategory(key)} style={{ ...pillStyle(activeCategory === key), fontSize: '8px', padding: '1px 5px' }}>
            {label}
          </button>
        ))}
        <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle, rgba(255,255,255,0.1))' }} />
        {SOURCE_OPTIONS.map(({ key, label, icon }) => (
          <button key={key} onClick={() => setActiveSource(key)} style={{ ...chipStyle(activeSource === key), fontSize: '8px', padding: '1px 4px' }}>
            {icon}{label}
          </button>
        ))}
        <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle, rgba(255,255,255,0.1))' }} />
        {TIME_OPTIONS.map(({ key, label }) => (
          <button key={key} onClick={() => setActiveHours(key)} style={{ ...chipStyle(activeHours === key), fontSize: '8px', padding: '1px 4px' }}>
            {label}
          </button>
        ))}
        <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle, rgba(255,255,255,0.1))' }} />
        <button onClick={() => setNepalOnly(!nepalOnly)} style={{ ...chipStyle(nepalOnly), fontSize: '8px', padding: '1px 4px', gap: '2px' }}>
          🇳🇵{nepalOnly ? '✓' : ''}
        </button>
        <button
          onClick={() => setGroundReports(!groundReports)}
          style={{
            display: 'flex', alignItems: 'center', gap: '2px',
            padding: '1px 4px', fontSize: '8px', fontWeight: 500,
            borderRadius: '3px', border: 'none', cursor: 'pointer',
            background: groundReports ? 'rgba(35,133,81,0.3)' : 'var(--bg-active, rgba(255,255,255,0.04))',
            color: groundReports ? '#43BF75' : 'var(--text-muted, rgba(255,255,255,0.5))',
          }}
        >
          <Camera size={7} />📍{groundReports ? '✓' : ''}
        </button>
        {totalInPeriod != null && (
          <span style={{ fontSize: '7px', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            {totalInPeriod > count ? `${count}/${totalInPeriod}` : `${count}`}
          </span>
        )}
      </div>

      {/* Tweet list */}
      {!data?.tweets || data.tweets.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
          <MessageSquare size={20} style={{ marginBottom: '6px', opacity: 0.4 }} />
          <div>No tweets found</div>
          <div style={{ fontSize: '10px', marginTop: '2px', opacity: 0.6 }}>
            {isSearching ? 'No results for your search' : 'Try adjusting your filters'}
          </div>
        </div>
      ) : (
        <div className="feed-list" style={{ marginTop: '4px', flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}>
          {(() => {
            // Group tweets by cluster_id
            const grouped = new Map<string, typeof data.tweets>();
            for (const tweet of data.tweets) {
              const key = tweet.tweet_cluster_id || `standalone_${tweet.id}`;
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(tweet);
            }

            // Sort groups by most recent tweet
            const sortedGroups = Array.from(grouped.entries()).sort((a, b) => {
              const aTime = a[1][0]?.tweeted_at || '';
              const bTime = b[1][0]?.tweeted_at || '';
              return bTime.localeCompare(aTime);
            });

            return sortedGroups.map(([clusterId, clusterTweets]) => {
              // Pick representative: first tweet (already sorted by time desc from API)
              const representative = clusterTweets[0];
              const similarCount = clusterTweets.length - 1;
              const isExpanded = expandedClusters.has(clusterId);
              const isStandalone = clusterId.startsWith('standalone_');

              const renderTweetCard = (tweet: typeof representative, isChild = false) => {
                const sourceTag = getSourceTag(tweet);
                const sevStyle = tweet.severity ? SEVERITY_COLORS[tweet.severity] : null;
                return (
                  <div
                    key={tweet.id}
                    className="feed-item"
                    style={isChild ? { paddingLeft: '20px', borderLeft: '2px solid var(--border-subtle, rgba(255,255,255,0.06))' } : undefined}
                  >
                    <div className="feed-content">
                      {/* Author + time */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                          @{tweet.author_username || 'unknown'}
                        </span>
                        <span className="feed-time" style={{ marginLeft: 'auto' }}>{formatTimeAgo(tweet.tweeted_at)}</span>
                      </div>

                      {/* Promoted location badge */}
                      {tweet.districts && tweet.districts.length > 0 && (
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                          background: 'rgba(35,133,81,0.15)', color: '#43BF75',
                          marginBottom: '4px',
                          border: groundReports ? '1px solid rgba(67,191,117,0.4)' : '1px solid transparent',
                        }}>
                          <MapPin size={10} />
                          {tweet.districts.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}
                          {tweet.provinces && tweet.provinces.length > 0 && (
                            <span style={{ opacity: 0.6, fontSize: '9px' }}>{tweet.provinces.join(', ')}</span>
                          )}
                        </div>
                      )}

                      {/* Tweet text */}
                      <div className="feed-title" style={{ lineHeight: 1.4 }}>{tweet.text}</div>

                      {/* Image thumbnails */}
                      {tweet.media_urls && tweet.media_urls.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                          {tweet.media_urls.slice(0, 4).map((url: string, i: number) => (
                            <a href={url} target="_blank" rel="noopener noreferrer" key={i}>
                              <img
                                src={url}
                                alt=""
                                style={{
                                  width: 80, height: 60, objectFit: 'cover', borderRadius: 4,
                                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                                }}
                                loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Tags row: category, severity, hashtags */}
                      <div style={{ display: 'flex', gap: '4px', marginTop: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {tweet.category && (
                          <span style={{
                            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                            background: 'rgba(45,114,210,0.15)', color: '#4C9AFF',
                            fontWeight: 600, textTransform: 'uppercase',
                          }}>{tweet.category}</span>
                        )}
                        {tweet.severity && sevStyle && (
                          <span style={{
                            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                            background: sevStyle.bg, color: sevStyle.color,
                            fontWeight: 600, textTransform: 'uppercase',
                          }}>{tweet.severity}</span>
                        )}
                        {tweet.hashtags && tweet.hashtags.length > 0 && tweet.hashtags.slice(0, 3).map((ht: string) => (
                          <span key={ht} style={{
                            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                            background: 'rgba(45,114,210,0.08)', color: 'rgba(76,154,255,0.7)',
                          }}>#{ht}</span>
                        ))}
                      </div>

                      {/* Engagement row */}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '4px', alignItems: 'center', fontSize: '10px', color: 'var(--text-muted)' }}>
                        {tweet.retweet_count > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Repeat2 size={11} />{tweet.retweet_count}
                          </span>
                        )}
                        {tweet.reply_count > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <MessageSquare size={11} />{tweet.reply_count}
                          </span>
                        )}
                        {tweet.like_count > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Heart size={11} />{tweet.like_count}
                          </span>
                        )}
                        {tweet.nepal_relevance && (
                          <>
                            <span style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />
                            <span style={{ textTransform: 'uppercase', fontSize: '9px' }}>{tweet.nepal_relevance}</span>
                          </>
                        )}
                        {sourceTag && (
                          <>
                            <span style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />
                            <span style={{
                              fontSize: '9px',
                              color: sourceTag.startsWith('#') ? '#4C9AFF' : '#43BF75',
                            }}>via {sourceTag}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <React.Fragment key={clusterId}>
                  {renderTweetCard(representative)}
                  {/* Similar tweets toggle */}
                  {!isStandalone && similarCount > 0 && (
                    <>
                      <button
                        onClick={() => {
                          setExpandedClusters(prev => {
                            const next = new Set(prev);
                            if (next.has(clusterId)) next.delete(clusterId);
                            else next.add(clusterId);
                            return next;
                          });
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          width: '100%', padding: '4px 12px',
                          fontSize: '10px', color: 'var(--text-muted)',
                          background: 'var(--bg-active, rgba(255,255,255,0.02))',
                          border: 'none', borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
                          cursor: 'pointer',
                        }}
                      >
                        <ChevronRight
                          size={10}
                          style={{
                            transition: 'transform 0.15s',
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}
                        />
                        {similarCount} similar tweet{similarCount > 1 ? 's' : ''}
                      </button>
                      {isExpanded && clusterTweets.slice(1).map(t => renderTweetCard(t, true))}
                    </>
                  )}
                </React.Fragment>
              );
            });
          })()}
        </div>
      )}
    </Widget>
  );
}

export function GovtWidget() {
  return (
    <Widget id="govt" icon={<Building2 size={14} />}>
      <div className="feed-list">
        {[
          { source: 'PMO', title: 'Cabinet meeting scheduled for flood response', time: '1h' },
          { source: 'MoHA', title: 'Security forces deployed to flood-affected areas', time: '3h' },
          { source: 'MoF', title: 'Emergency relief fund released', time: '5h' },
        ].map((a, i) => (
          <div key={i} className="feed-item">
            <div className="feed-content">
              <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>{a.source}</div>
              <div className="feed-title">{a.title}</div>
              <div className="feed-time">{a.time} ago</div>
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}


export function RiversWidget() {
  return (
    <Widget id="rivers" icon={<Droplets size={14} />} badge="2 ALERT" badgeVariant="critical">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {[
          { name: 'Koshi River', loc: 'Chatara', level: '8.2m', danger: '7.5m', trend: '↑ +0.4m/h', critical: true },
          { name: 'Narayani River', loc: 'Narayanghat', level: '6.8m', danger: '7.0m', trend: '↑ +0.2m/h', critical: false },
          { name: 'Bagmati River', loc: 'Sundarijal', level: '3.4m', danger: '4.5m', trend: '→ 0.0m/h', critical: false },
        ].map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '12px', borderBottom: '1px solid var(--border-subtle)', gap: '12px' }}>
            <div style={{ width: '8px', height: '40px', background: r.critical ? 'var(--status-critical)' : 'var(--status-medium)' }}></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: 500 }}>{r.name}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{r.loc}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 600 }}>{r.level}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Danger: {r.danger}</div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: r.trend.includes('↑') ? 'var(--status-critical)' : 'var(--text-muted)', width: '70px', textAlign: 'right' }}>{r.trend}</div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

export function SeismicWidget() {
  const { data, isLoading, error, refetch } = useSeismicStats(24, 0);

  // Loading state
  if (isLoading) {
    return (
      <Widget id="seismic" icon={<Activity size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  // Error state
  if (error) {
    return (
      <Widget id="seismic" icon={<Activity size={14} />}>
        <WidgetError message="Failed to load seismic data" onRetry={() => refetch()} />
      </Widget>
    );
  }

  // Format time ago for earthquake events
  const formatTimeAgo = (dateString: string | null): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get magnitude level for styling
  const getMagnitudeLevel = (mag: number | null): 'critical' | 'high' | 'moderate' | 'light' => {
    if (!mag) return 'light';
    if (mag >= 6.0) return 'critical';
    if (mag >= 5.0) return 'high';
    if (mag >= 4.0) return 'moderate';
    return 'light';
  };

  // Get status badge color
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CRITICAL':
        return { bg: 'var(--status-critical)', color: 'white' };
      case 'HIGH':
        return { bg: 'var(--status-high)', color: 'black' };
      case 'ELEVATED':
        return { bg: 'var(--status-medium)', color: 'black' };
      default:
        return null;
    }
  };

  const statusBadge = data ? getStatusBadge(data.status) : null;

  // Summary stats
  const stats = data ? [
    { v: data.events_count, l: '24h Events' },
    { v: data.max_magnitude > 0 ? data.max_magnitude.toFixed(1) : '--', l: 'Max Mag' },
    { v: data.avg_depth_km > 0 ? `${Math.round(data.avg_depth_km)}km` : '--', l: 'Avg Depth' },
  ] : [];

  return (
    <Widget
      id="seismic"
      icon={<Activity size={14} />}
      badge={statusBadge ? data?.status : undefined}
      badgeVariant={data?.status === 'CRITICAL' ? 'critical' : data?.status === 'HIGH' ? 'high' : undefined}
    >
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        {stats.map((s, i) => (
          <div key={i} style={{ flex: 1, padding: '12px', textAlign: 'center', borderRight: i < 2 ? '1px solid var(--border-subtle)' : 'none' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', fontWeight: 600 }}>{s.v}</div>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div>
        {data?.recent_events && data.recent_events.length > 0 ? (
          data.recent_events.slice(0, 4).map((eq, i) => {
            const level = getMagnitudeLevel(eq.magnitude);
            const magColors = {
              critical: { bg: 'rgba(239,68,68,0.2)', color: 'var(--status-critical)' },
              high: { bg: 'rgba(249,115,22,0.2)', color: 'var(--status-high)' },
              moderate: { bg: 'rgba(234,179,8,0.2)', color: 'var(--status-medium)' },
              light: { bg: 'var(--bg-active)', color: 'var(--text-secondary)' },
            };
            return (
              <div key={eq.id || i} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', gap: '12px' }}>
                <div style={{
                  width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700,
                  background: magColors[level].bg,
                  color: magColors[level].color
                }}>{eq.magnitude?.toFixed(1) || '--'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>{eq.location || eq.district || 'Unknown location'}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Depth: {eq.depth_km ? `${Math.round(eq.depth_km)}km` : '--'}</div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatTimeAgo(eq.issued_at)}</div>
              </div>
            );
          })
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            No earthquakes recorded in the last 24 hours
          </div>
        )}
      </div>
      {data?.updated_at && (
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '4px 8px', textAlign: 'right', borderTop: '1px solid var(--border-subtle)' }}>
          Updated: {new Date(data.updated_at).toLocaleTimeString()}
        </div>
      )}
    </Widget>
  );
}



export function NewsWidget() {
  return (
    <Widget id="news" icon={<Newspaper size={14} />} actions={<><button className="widget-action active">All</button><button className="widget-action">Breaking</button></>}>
      <div className="feed-list">
        {[
          { source: 'Kathmandu Post', title: 'Government announces flood relief package for affected districts', time: '15 min', tag: 'Politics' },
          { source: 'Republica', title: 'Election Commission finalizes polling center security', time: '45 min', tag: 'Election' },
          { source: 'Kantipur', title: 'Nepal Rastra Bank maintains interest rate unchanged', time: '1h', tag: 'Economy' },
        ].map((n, i) => (
          <div key={i} className="feed-item">
            <div className="feed-content">
              <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>{n.source}</div>
              <div className="feed-title">{n.title}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <span className="feed-time">{n.time} ago</span>
                <span className="feed-tag">{n.tag}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}





// ============================================
// COLLABORATION WIDGETS (Palantir-grade OSINT)
// ============================================

import {
  Briefcase, Activity as ActivityIcon, CheckCircle, Eye, StickyNote,
  Shield, Trophy, Plus, Clock, User, Circle, CheckCircle2, XCircle, HelpCircle
} from 'lucide-react';
import {
  useCases, useActivityFeed, useVerificationQueue, useLeaderboard, useCastVote,
  useWatchlists, useWatchlistItems, useNotes, useCreateNote, useSources
} from '../../../api/hooks';
import type { Case, Activity as ActivityType, VerificationRequest, LeaderboardEntry, Note, SourceReliability } from '../../../api/collaboration';

// Utility function to format relative time
function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * ActiveCasesWidget - Shows open investigations for user/team
 */
export function ActiveCasesWidget() {
  const { data, isLoading, error } = useCases({ limit: 10 });
  const cases = data?.items || [];

  // Mock data fallback when API unavailable
  const mockCases = [
    { id: '1', title: 'Border smuggling network - Birgunj', status: 'active' as const, priority: 'high' as const, assignee: 'You', evidence_count: 12, updated_at: new Date(Date.now() - 2 * 3600000).toISOString() },
    { id: '2', title: 'Election misinformation campaign', status: 'active' as const, priority: 'critical' as const, assignee: 'Team', evidence_count: 28, updated_at: new Date(Date.now() - 30 * 60000).toISOString() },
    { id: '3', title: 'Flood damage assessment - Koshi', status: 'review' as const, priority: 'medium' as const, assignee: 'You', evidence_count: 8, updated_at: new Date(Date.now() - 24 * 3600000).toISOString() },
  ];

  const displayCases = cases.length > 0 ? cases : mockCases;
  const activeCasesCount = displayCases.filter(c => c.status === 'active').length;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'active': return { bg: 'var(--status-low)', color: 'black' };
      case 'review': return { bg: 'var(--status-medium)', color: 'black' };
      case 'draft': return { bg: 'var(--bg-active)', color: 'var(--text-secondary)' };
      default: return { bg: 'var(--bg-active)', color: 'var(--text-secondary)' };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'var(--status-critical)';
      case 'high': return 'var(--status-high)';
      case 'medium': return 'var(--status-medium)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <Widget id="cases-active" icon={<Briefcase size={14} />} badge={activeCasesCount || undefined}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Quick actions header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ fontSize: '10px', padding: '4px 8px', background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Plus size={12} /> New Case
            </button>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading...' : `${displayCases.length} total`}
          </span>
        </div>

        {/* Error state */}
        {error && (
          <div style={{ padding: '12px', color: 'var(--status-critical)', fontSize: '11px' }}>
            Unable to load cases. Using demo data.
          </div>
        )}

        {/* Cases list */}
        {displayCases.map((c: any) => (
          <div key={c.id} style={{ padding: '12px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="hover:bg-[var(--bg-hover)]">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ width: '4px', height: '40px', background: getPriorityColor(c.priority), flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 6px', textTransform: 'uppercase', background: getStatusStyle(c.status).bg, color: getStatusStyle(c.status).color }}>{c.status}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{c.evidence_count} items</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>• {c.assigned_to?.full_name || c.assignee || 'Unassigned'}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatTimeAgo(c.updated_at)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/**
 * CollaborationFeedWidget - Real-time team activity feed
 */
export function CollaborationFeedWidget() {
  const { data, isLoading } = useActivityFeed({ limit: 10 });
  const activities = data?.items || [];

  // Mock data fallback
  const mockActivities = [
    { id: '1', user: { full_name: 'Sarah K.' }, activity_type: 'verification_voted', description: 'verified Flood damage report - Sunsari', created_at: new Date(Date.now() - 2 * 60000).toISOString() },
    { id: '2', user: { full_name: 'John M.' }, activity_type: 'evidence_added', description: 'added evidence to Election monitoring case', created_at: new Date(Date.now() - 5 * 60000).toISOString() },
    { id: '3', user: { full_name: 'Priya S.' }, activity_type: 'case_created', description: 'created case Market manipulation signals', created_at: new Date(Date.now() - 25 * 60000).toISOString() },
    { id: '4', user: { full_name: 'Ram B.' }, activity_type: 'verification_voted', description: 'disagreed on Source reliability rating', created_at: new Date(Date.now() - 3600000).toISOString() },
  ];

  const displayActivities = activities.length > 0 ? activities : mockActivities;

  const getActionColor = (type: string) => {
    if (type.includes('verification')) return 'var(--status-low)';
    if (type.includes('case') || type.includes('evidence')) return 'var(--accent-primary)';
    if (type.includes('flag')) return 'var(--status-medium)';
    return 'var(--text-secondary)';
  };

  const formatAction = (activity: any) => {
    if (activity.description) return activity.description;
    switch (activity.activity_type) {
      case 'verification_voted': return 'voted on verification';
      case 'case_created': return 'created a case';
      case 'evidence_added': return 'added evidence';
      case 'comment_posted': return 'posted a comment';
      default: return activity.activity_type.replace(/_/g, ' ');
    }
  };

  return (
    <Widget id="collab-feed" icon={<ActivityIcon size={14} />} badge="LIVE">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Online status bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-low)', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {isLoading ? 'Connecting...' : `${displayActivities.length} recent activities`}
          </span>
        </div>

        {/* Activity feed */}
        {displayActivities.map((a: any) => (
          <div key={a.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <User size={14} color="var(--text-secondary)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11px', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.user?.full_name || a.user?.email || 'Unknown'}</span>
                  {' '}<span style={{ color: getActionColor(a.activity_type) }}>{formatAction(a)}</span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{formatTimeAgo(a.created_at)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/**
 * VerificationQueueWidget - Items pending peer review
 */
export function VerificationQueueWidget() {
  const { data, isLoading } = useVerificationQueue({ limit: 5 });
  const castVoteMutation = useCastVote();
  const items = data?.items || [];

  // Mock data fallback
  const mockItems = [
    { id: '1', claim: 'Dam breach rumor - FALSE classification', requested_by: { full_name: 'Sarah K.' }, agree_count: 2, disagree_count: 0, needs_info_count: 1, item_type: 'classification', priority: 'urgent' },
    { id: '2', claim: 'Entity merge: PM Oli aliases', requested_by: { full_name: 'John M.' }, agree_count: 1, disagree_count: 1, needs_info_count: 1, item_type: 'entity', priority: 'normal' },
    { id: '3', claim: 'Source reliability: KathmanduPost.com', requested_by: { full_name: 'Analyst' }, agree_count: 0, disagree_count: 0, needs_info_count: 3, item_type: 'source', priority: 'low' },
  ];

  const displayItems = items.length > 0 ? items : mockItems;

  const getUrgencyColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'var(--status-high)';
      case 'normal': return 'var(--status-medium)';
      default: return 'var(--text-muted)';
    }
  };

  const handleVote = async (requestId: string, choice: 'agree' | 'disagree') => {
    try {
      await castVoteMutation.mutateAsync({ requestId, vote: { choice } });
    } catch (err) {
      console.error('Vote failed:', err);
    }
  };

  return (
    <Widget id="verification-queue" icon={<CheckCircle size={14} />} badge={displayItems.length || undefined}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Header with filter */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading...' : 'Awaiting your vote'}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--accent-primary)', cursor: 'pointer' }}>View all →</span>
        </div>

        {/* Verification items */}
        {displayItems.map((item: any) => (
          <div key={item.id} style={{ padding: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ width: '4px', height: '50px', background: getUrgencyColor(item.priority), flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>{item.claim}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Requested by {item.requested_by?.full_name || 'Unknown'} • {item.item_type}
                </div>
                {/* Voting status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={14} color="var(--status-low)" />
                    <span style={{ fontSize: '10px' }}>{item.agree_count}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <XCircle size={14} color="var(--status-critical)" />
                    <span style={{ fontSize: '10px' }}>{item.disagree_count}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <HelpCircle size={14} color="var(--text-muted)" />
                    <span style={{ fontSize: '10px' }}>{item.needs_info_count}</span>
                  </div>
                  {/* Quick vote buttons */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => handleVote(item.id, 'agree')}
                      disabled={castVoteMutation.isPending}
                      style={{ padding: '4px 8px', fontSize: '10px', background: 'var(--status-low)', color: 'black', border: 'none', cursor: 'pointer' }}
                    >
                      Agree
                    </button>
                    <button
                      onClick={() => handleVote(item.id, 'disagree')}
                      disabled={castVoteMutation.isPending}
                      style={{ padding: '4px 8px', fontSize: '10px', background: 'var(--bg-active)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                    >
                      Disagree
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/**
 * EntityWatchlistWidget - Personal/team entity monitoring
 */
export function EntityWatchlistWidget() {
  const { data: watchlists, isLoading } = useWatchlists();
  const defaultWatchlistId = watchlists?.[0]?.id;
  const { data: items } = useWatchlistItems(defaultWatchlistId || '');

  // Mock data fallback
  const mockEntities = [
    { id: '1', value: 'KP Sharma Oli', item_type: 'person', match_count: 24, last_match_at: new Date(Date.now() - 5 * 60000).toISOString() },
    { id: '2', value: 'Election Commission', item_type: 'organization', match_count: 18, last_match_at: new Date(Date.now() - 12 * 60000).toISOString() },
    { id: '3', value: 'Koshi River', item_type: 'location', match_count: 31, last_match_at: new Date(Date.now() - 2 * 60000).toISOString() },
    { id: '4', value: 'Nepal Army', item_type: 'organization', match_count: 7, last_match_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  ];

  const displayItems = items && items.length > 0 ? items : mockEntities;

  const getSeverityColor = (matchCount: number) => {
    if (matchCount >= 30) return 'var(--status-critical)';
    if (matchCount >= 20) return 'var(--status-high)';
    if (matchCount >= 10) return 'var(--status-medium)';
    return 'var(--text-muted)';
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'person': return <User size={12} />;
      case 'organization': return <Building2 size={12} />;
      default: return <MapPinned size={12} />;
    }
  };

  const formatLastMatch = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return formatTimeAgo(dateStr);
  };

  return (
    <Widget id="entity-watchlist" icon={<Eye size={14} />} badge={displayItems.length || undefined}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading...' : `${watchlists?.length || 0} watchlist${watchlists?.length !== 1 ? 's' : ''}`}
          </span>
          <button style={{ fontSize: '10px', padding: '4px 8px', background: 'var(--bg-active)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={12} /> Add
          </button>
        </div>

        {/* Entity list */}
        {displayItems.map((entity: any) => (
          <div key={entity.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="hover:bg-[var(--bg-hover)]">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '4px', height: '36px', background: getSeverityColor(entity.match_count), flexShrink: 0 }} />
              <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'var(--bg-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                {getTypeIcon(entity.item_type)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 500 }}>{entity.value}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{entity.item_type?.toUpperCase()} • {formatLastMatch(entity.last_match_at)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 600 }}>{entity.match_count}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>matches</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/**
 * AnalystNotesWidget - Quick notepad with linking
 */
export function AnalystNotesWidget() {
  const { data: notesData, isLoading } = useNotes({ limit: 10 });
  const createNoteMutation = useCreateNote();
  const [newNote, setNewNote] = React.useState('');

  // Mock data fallback
  const mockNotes = [
    { id: '1', content: 'Check Koshi river levels correlation with border activity', linked_items: [{ type: 'case', id: '2' }], is_pinned: true, updated_at: new Date(Date.now() - 10 * 60000).toISOString() },
    { id: '2', content: 'PM speech at 3pm - monitor social media reaction', linked_items: [], is_pinned: false, updated_at: new Date(Date.now() - 2 * 3600000).toISOString() },
    { id: '3', content: 'Follow up on election commission source verification', linked_items: [{ type: 'story', id: '145' }], is_pinned: false, updated_at: new Date(Date.now() - 24 * 3600000).toISOString() },
  ];

  const displayNotes = notesData && notesData.length > 0 ? notesData : mockNotes;

  const handleSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newNote.trim()) {
      try {
        await createNoteMutation.mutateAsync({ content: newNote.trim() });
        setNewNote('');
      } catch (err) {
        console.error('Failed to create note:', err);
      }
    }
  };

  return (
    <Widget id="analyst-notes" icon={<StickyNote size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Quick add area */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={handleSubmit}
            placeholder="Quick note... (Enter to save)"
            disabled={createNoteMutation.isPending}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '11px',
              background: 'var(--bg-active)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              outline: 'none',
              opacity: createNoteMutation.isPending ? 0.5 : 1,
            }}
          />
        </div>

        {/* Notes list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
              Loading notes...
            </div>
          ) : (
            displayNotes.map((note: any) => (
              <div key={note.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  {note.is_pinned && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-primary)', marginTop: '4px', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    {note.title && (
                      <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>{note.title}</div>
                    )}
                    <div style={{ fontSize: '11px', lineHeight: 1.5, color: 'var(--text-primary)' }}>{note.content}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatTimeAgo(note.updated_at)}</span>
                      {note.linked_items && note.linked_items.length > 0 && (
                        <span style={{ fontSize: '9px', padding: '2px 6px', background: 'var(--bg-active)', color: 'var(--accent-primary)' }}>
                          {note.linked_items.length} linked
                        </span>
                      )}
                      {note.category && (
                        <span style={{ fontSize: '9px', padding: '2px 6px', background: 'var(--bg-active)', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          {note.category}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Widget>
  );
}

/**
 * SourceReliabilityWidget - Source confidence ranking using Admiralty System
 */
export function SourceReliabilityWidget() {
  const { data: sourcesData, isLoading } = useSources({ sort_by: 'confidence', limit: 10 });

  // Mock data fallback
  const mockSources = [
    { source_id: '1', source_name: 'Kathmandu Post', confidence_score: 92, admiralty_code: 'A2', total_stories: 156 },
    { source_id: '2', source_name: 'Republica', confidence_score: 88, admiralty_code: 'B2', total_stories: 124 },
    { source_id: '3', source_name: 'Kantipur', confidence_score: 85, admiralty_code: 'B3', total_stories: 198 },
    { source_id: '4', source_name: 'Nepal Police Twitter', confidence_score: 78, admiralty_code: 'B4', total_stories: 42 },
    { source_id: '5', source_name: 'Unnamed Social Media', confidence_score: 45, admiralty_code: 'D5', total_stories: 89 },
  ];

  const displaySources = sourcesData && sourcesData.length > 0 ? sourcesData : mockSources;

  const getGradeColor = (admiraltyCode: string) => {
    const grade = admiraltyCode?.charAt(0) || 'F';
    if (grade === 'A') return 'var(--status-low)';
    if (grade === 'B') return 'var(--status-medium)';
    if (grade === 'C') return 'var(--status-high)';
    return 'var(--status-critical)';
  };

  const getGradeTextColor = (admiraltyCode: string) => {
    const grade = admiraltyCode?.charAt(0) || 'F';
    if (grade === 'A' || grade === 'B') return 'black';
    return 'white';
  };

  return (
    <Widget id="source-reliability" icon={<Shield size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading...' : 'Admiralty Rating'}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Confidence</span>
        </div>

        {/* Source list */}
        {displaySources.map((source: any) => (
          <div key={source.source_id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '11px',
                background: getGradeColor(source.admiralty_code),
                color: getGradeTextColor(source.admiralty_code)
              }}>
                {source.admiralty_code}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11px', fontWeight: 500 }}>{source.source_name}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{source.total_stories} stories</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600 }}>{source.confidence_score}%</div>
              </div>
            </div>
            {/* Confidence bar */}
            <div style={{ height: '3px', background: 'var(--bg-active)', marginTop: '8px' }}>
              <div style={{ height: '100%', width: `${source.confidence_score}%`, background: getGradeColor(source.admiralty_code), transition: 'width 0.3s ease' }} />
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/**
 * AnalystLeaderboardWidget - Accuracy scores and contributions
 */
export function AnalystLeaderboardWidget() {
  const { data, isLoading } = useLeaderboard('reputation', 5);
  const entries = data?.entries || [];

  // Mock data fallback
  const mockAnalysts = [
    { rank: 1, user: { full_name: 'Sarah K.' }, verification_accuracy: 0.94, total_cases: 156, badges: ['top-verifier', 'early-adopter'] },
    { rank: 2, user: { full_name: 'John M.' }, verification_accuracy: 0.91, total_cases: 134, badges: ['case-closer'] },
    { rank: 3, user: { full_name: 'Priya S.' }, verification_accuracy: 0.87, total_cases: 112, badges: [] },
    { rank: 4, user: { full_name: 'Ram B.' }, verification_accuracy: 0.82, total_cases: 67, badges: [] },
  ];

  const displayAnalysts = entries.length > 0 ? entries : mockAnalysts;

  return (
    <Widget id="analyst-leaderboard" icon={<Trophy size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading...' : `Top ${displayAnalysts.length} Analysts`}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--accent-primary)', cursor: 'pointer' }}>All Time →</span>
        </div>

        {/* Leaderboard */}
        {displayAnalysts.map((analyst: any, index: number) => {
          const accuracy = analyst.verification_accuracy ? Math.round(analyst.verification_accuracy * 100) : null;
          const name = analyst.user?.full_name || analyst.user?.email || 'Unknown';
          const rank = analyst.rank || index + 1;

          return (
            <div key={analyst.user?.id || index} style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'transparent'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '12px',
                  background: rank <= 3 ? 'var(--accent-primary)' : 'var(--bg-active)',
                  color: rank <= 3 ? 'white' : 'var(--text-secondary)'
                }}>
                  {rank}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{analyst.total_cases} cases</span>
                    {analyst.badges?.length > 0 && (
                      <span style={{ fontSize: '9px', padding: '1px 4px', background: 'var(--status-medium)', color: 'black' }}>
                        {analyst.badges[0]}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {accuracy !== null ? (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 600, color: accuracy >= 90 ? 'var(--status-low)' : 'var(--text-primary)' }}>
                        {accuracy}%
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>accuracy</div>
                    </>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}
