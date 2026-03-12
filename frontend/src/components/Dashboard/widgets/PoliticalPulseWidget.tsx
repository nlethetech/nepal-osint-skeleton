/**
 * PoliticalPulseWidget — Live grid of political account activity.
 * Uses existing useTweets() hook + PARTY_MAP. Zero additional API cost.
 */
import { memo, useState, useMemo } from 'react';
import { Widget } from '../Widget';
import { Users, Clock, VolumeX } from 'lucide-react';
import { useTweets } from '../../../api/hooks';
import { PARTY_MAP, getPartyInfo } from './PARTY_MAP';
import type { AccountCategory } from './PARTY_MAP';
import { WidgetSkeleton, WidgetError } from './shared';

type FilterKey = 'all' | 'elected' | 'politician' | 'journalist' | 'silent';
type SortKey = 'recent' | 'engagement';

interface AccountData {
  username: string;
  displayName: string;
  party: string;
  color: string;
  category: AccountCategory;
  latestText: string;
  latestTime: string | null;
  isSilent: boolean;
  totalEngagement: number;
  tweetCount: number;
}

const SILENT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return '--';
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export const PoliticalPulseWidget = memo(function PoliticalPulseWidget() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  const { data, isLoading, error, refetch } = useTweets({
    source: 'accounts',
    limit: 200,
    hours: 72,
  });

  // Group tweets by author_username
  const accounts: AccountData[] = useMemo(() => {
    if (!data?.tweets) return [];

    const grouped = new Map<string, typeof data.tweets>();
    for (const tweet of data.tweets) {
      const username = tweet.source_query?.replace('nitter:', '') || tweet.author_username || 'unknown';
      if (!grouped.has(username)) grouped.set(username, []);
      grouped.get(username)!.push(tweet);
    }

    const now = Date.now();
    const result: AccountData[] = [];

    // Include all known accounts, even those with no tweets
    const allUsernames = new Set([...Object.keys(PARTY_MAP), ...grouped.keys()]);

    for (const username of allUsernames) {
      const info = getPartyInfo(username);
      const tweets = grouped.get(username) || [];

      const latest = tweets[0]; // already sorted by recency from API
      const latestTime = latest?.tweeted_at || null;
      const isSilent = !latestTime || (now - new Date(latestTime).getTime()) > SILENT_THRESHOLD_MS;
      const totalEngagement = tweets.reduce(
        (sum, t) => sum + (t.retweet_count || 0) + (t.reply_count || 0) + (t.like_count || 0),
        0,
      );

      result.push({
        username,
        displayName: info.displayName || `@${username}`,
        party: info.shortName,
        color: info.color,
        category: info.category,
        latestText: latest?.text?.slice(0, 120) || '',
        latestTime,
        isSilent,
        totalEngagement,
        tweetCount: tweets.length,
      });
    }

    return result;
  }, [data]);

  // Filter
  const filtered = useMemo(() => {
    let list = accounts;
    if (filter === 'elected') list = list.filter(a => a.category === 'politician' || a.category === 'party');
    else if (filter === 'politician') list = list.filter(a => a.category === 'politician' || a.category === 'party' || a.category === 'official');
    else if (filter === 'journalist') list = list.filter(a => a.category === 'journalist');
    else if (filter === 'silent') list = list.filter(a => a.isSilent);

    // Sort
    if (sort === 'engagement') {
      list = [...list].sort((a, b) => b.totalEngagement - a.totalEngagement);
    } else {
      list = [...list].sort((a, b) => {
        if (!a.latestTime) return 1;
        if (!b.latestTime) return -1;
        return new Date(b.latestTime).getTime() - new Date(a.latestTime).getTime();
      });
    }

    return list;
  }, [accounts, filter, sort]);

  const silentCount = accounts.filter(a => a.isSilent).length;

  if (isLoading) {
    return (
      <Widget id="political-pulse" icon={<Users size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="political-pulse" icon={<Users size={14} />}>
        <WidgetError message="Failed to load political feed" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'elected', label: 'Elected Officials' },
    { key: 'politician', label: 'Political' },
    { key: 'journalist', label: 'Media' },
    { key: 'silent', label: `Silent (${silentCount})` },
  ];

  return (
    <Widget id="political-pulse" icon={<Users size={14} />} badge={`${accounts.length}`}>
      {/* Header: Filters + Sort */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0 0 8px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: 500,
                borderRadius: '4px', border: 'none', cursor: 'pointer',
                background: filter === f.key ? 'var(--accent-primary)' : 'var(--bg-active)',
                color: filter === f.key ? '#fff' : 'var(--text-muted)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          style={{
            fontSize: '10px', padding: '3px 6px', background: 'var(--bg-active)',
            color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
          }}
        >
          <option value="recent">Most recent</option>
          <option value="engagement">Engagement</option>
        </select>
      </div>

      {/* Account grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '1px', background: 'var(--border-subtle)',
        maxHeight: '420px', overflowY: 'auto', marginTop: '4px',
      }}>
        {filtered.map(account => (
          <div
            key={account.username}
            style={{
              background: 'var(--bg-surface)', padding: '10px 12px',
              opacity: account.isSilent ? 0.5 : 1,
              position: 'relative',
            }}
          >
            {/* Party color bar */}
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '3px', height: '100%',
              background: account.color,
            }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', paddingLeft: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {account.displayName}
              </span>
              <span style={{
                fontSize: '8px', fontWeight: 700, padding: '1px 4px',
                background: account.color, color: '#fff', borderRadius: '2px',
              }}>
                {account.party}
              </span>
            </div>

            {/* Latest tweet preview */}
            {account.latestText ? (
              <div style={{
                fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                paddingLeft: '6px',
              }}>
                {account.latestText}
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', paddingLeft: '6px', fontStyle: 'italic' }}>
                No recent tweets
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', paddingLeft: '6px' }}>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Clock size={9} />
                {formatTimeAgo(account.latestTime)}
              </span>
              {account.isSilent && (
                <span style={{
                  fontSize: '8px', fontWeight: 600, padding: '1px 5px',
                  background: 'rgba(205,66,70,0.15)', color: 'var(--status-critical)',
                  display: 'flex', alignItems: 'center', gap: '3px',
                }}>
                  <VolumeX size={8} /> SILENT
                </span>
              )}
              {account.tweetCount > 0 && (
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {account.tweetCount} tweets
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
});
