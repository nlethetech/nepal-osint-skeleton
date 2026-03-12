/**
 * GovtDecisionsWidget — Government Decisions Tracker
 *
 * Shows recent cabinet decisions, government orders, and policy announcements.
 * Sources from the announcements/govt API (OPMCM, MoHA, etc.)
 */
import { memo, useMemo, useState } from 'react';
import { Widget } from '../Widget';
import { Gavel, Clock, ExternalLink, ChevronDown, ChevronUp, Building2 } from 'lucide-react';
import { useAnnouncementSummary } from '../../../api/hooks/useAnnouncements';
import { WidgetSkeleton, WidgetError } from './shared';

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SOURCE_LABELS: Record<string, string> = {
  opmcm: 'Cabinet / OPMCM',
  moha: 'Home Ministry',
  mofa: 'Foreign Ministry',
  mof: 'Finance Ministry',
};

export const GovtDecisionsWidget = memo(function GovtDecisionsWidget() {
  const { data, isLoading, error, refetch } = useAnnouncementSummary(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const announcements = useMemo(() => {
    if (!data?.latest) return [];
    return data.latest.slice(0, 30);
  }, [data]);

  if (isLoading) {
    return (
      <Widget id="govt-decisions" icon={<Gavel size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error || (!isLoading && announcements.length === 0)) {
    return (
      <Widget id="govt-decisions" icon={<Gavel size={14} />}>
        <div style={{
          height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 24, textAlign: 'center', gap: 10,
        }}>
          <Gavel size={20} style={{ color: 'var(--text-muted)' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            New Government Forming
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 240 }}>
            The newly elected government has not yet been formed. Cabinet decisions and government orders will appear here once the new administration begins operations.
          </div>
        </div>
      </Widget>
    );
  }

  return (
    <Widget id="govt-decisions" icon={<Gavel size={14} />} badge={announcements.length}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Latest Government Actions
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
            {announcements.length} items
          </span>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {announcements.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
              No recent government decisions
            </div>
          ) : announcements.map((item) => {
            const expanded = expandedId === item.id;
            const sourceLabel = SOURCE_LABELS[item.source?.toLowerCase()] || item.source_name || item.source || '';
            return (
              <div
                key={item.id}
                onClick={() => setExpandedId(expanded ? null : item.id)}
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
                  <Building2 size={12} style={{ color: 'var(--text-disabled)', marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      {item.title || 'Untitled'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      {sourceLabel && (
                        <span style={{
                          fontSize: 8, fontWeight: 600, padding: '1px 5px',
                          background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                          border: '1px solid var(--border-subtle)',
                          textTransform: 'uppercase', letterSpacing: '0.03em',
                        }}>
                          {sourceLabel}
                        </span>
                      )}
                      {(item.published_at || item.created_at) && (
                        <span style={{ fontSize: 9, color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={8} />
                          {getTimeAgo(item.published_at || item.created_at)}
                        </span>
                      )}
                    </div>
                    {expanded && item.content && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                        {item.content}
                      </div>
                    )}
                    {expanded && item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 9, color: 'var(--accent-primary)', marginTop: 4,
                          textDecoration: 'none',
                        }}
                      >
                        View source <ExternalLink size={8} />
                      </a>
                    )}
                  </div>
                  {expanded
                    ? <ChevronUp size={12} style={{ color: 'var(--text-disabled)', flexShrink: 0, marginTop: 2 }} />
                    : <ChevronDown size={12} style={{ color: 'var(--text-disabled)', flexShrink: 0, marginTop: 2 }} />
                  }
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Widget>
  );
});
