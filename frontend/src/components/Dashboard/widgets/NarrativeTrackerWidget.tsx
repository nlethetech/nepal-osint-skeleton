/**
 * NarrativeTrackerWidget — Story Tracker showing cluster evolution.
 * Visualizes how stories develop over time with source momentum,
 * corroboration progress bars, and category breakdown.
 */
import { memo, useState } from 'react';
import { Widget } from '../Widget';
import { Layers, ChevronDown, CheckCircle, ShieldCheck } from 'lucide-react';
import { useStoryTracker } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError, formatTimeAgo } from './shared';
import type { StoryTrackerEntry } from '../../../api/situationMonitor';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#CD4246',
  high: '#C87619',
  medium: '#D1980B',
  low: '#238551',
};

const CATEGORY_COLORS: Record<string, string> = {
  political: '#2D72D2',
  security: '#CD4246',
  economic: '#D1980B',
  social: '#9D3FE7',
  disaster: '#C87619',
};

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  emerging:   { label: 'NEW',       color: '#D1980B' },
  developing: { label: 'ACTIVE',    color: '#C87619' },
  mature:     { label: 'CONFIRMED', color: '#238551' },
  resolved:   { label: 'CLOSED',    color: '#6b7280' },
};

function SourceBar({ narrative }: { narrative: StoryTrackerEntry }) {
  // Narrative momentum — visual bar showing how many clusters support the storyline
  const maxSources = 8;
  const filled = Math.min(narrative.cluster_count, maxSources);
  return (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
      {Array.from({ length: maxSources }).map((_, i) => (
        <div key={i} style={{
          width: '12px', height: '4px', borderRadius: '1px',
          background: i < filled
            ? '#2D72D2'
            : 'rgba(255,255,255,0.06)',
          transition: 'background 0.3s',
        }} />
      ))}
      <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '4px' }}>
        {narrative.cluster_count}
      </span>
    </div>
  );
}

function StoryRow({ narrative, rank }: { narrative: StoryTrackerEntry; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const directionLabel = (narrative.direction || 'stable').toUpperCase();
  const directionColor = directionLabel === 'RISING' ? '#C87619' : directionLabel === 'FRAGMENTING' ? '#CD4246' : directionLabel === 'COOLING' ? '#6b7280' : '#238551';
  const catColor = CATEGORY_COLORS[narrative.category || ''] || 'var(--text-muted)';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 0.15s',
      }}
    >
      {/* Main row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'grid',
          gridTemplateColumns: '24px 1fr 80px 100px 20px',
          gap: '8px',
          alignItems: 'center',
          padding: '8px 10px',
          cursor: 'pointer',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.03))')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Rank */}
        <div style={{
          fontSize: '11px', fontWeight: 700, textAlign: 'center',
          color: rank <= 3 ? directionColor : 'var(--text-muted)',
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          {rank}
        </div>

        {/* Headline + meta */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
            {/* Severity dot */}
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
              background: catColor,
            }} />
            <span style={{
              fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {narrative.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '11px' }}>
            {/* Category */}
            <span style={{
              fontSize: '8px', fontWeight: 600, letterSpacing: '0.3px',
              color: catColor, textTransform: 'uppercase',
            }}>
              {narrative.category || 'general'}
            </span>
            {/* Direction */}
            <span style={{
              fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px',
              padding: '0px 4px', borderRadius: '2px',
              background: `${directionColor}18`, color: directionColor,
            }}>
              {directionLabel}
            </span>
            {narrative.cluster_count >= 2 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '2px',
                fontSize: '8px', fontWeight: 700,
                color: '#238551',
              }}>
                <CheckCircle size={8} />
              </span>
            )}
            {narrative.confidence && narrative.confidence >= 0.7 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '2px',
                fontSize: '8px', fontWeight: 700,
                color: '#2D72D2',
              }}>
                <ShieldCheck size={8} />
              </span>
            )}
            {narrative.thesis && (
              <span style={{
                fontSize: '9px', color: 'var(--text-muted)', fontStyle: 'italic',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, minWidth: 0,
              }}>
                {narrative.thesis}
              </span>
            )}
          </div>
        </div>

        <SourceBar narrative={narrative} />

        {/* Time */}
        <span style={{
          fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right',
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          {formatTimeAgo(narrative.last_updated)}
        </span>

        {/* Expand indicator */}
        <ChevronDown size={10} style={{
          color: 'var(--text-muted)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }} />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: '0 10px 10px 42px',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {/* BLUF */}
          {narrative.thesis && (
            <div style={{
              fontSize: '11px', lineHeight: 1.4, color: 'var(--text-secondary)',
              padding: '8px 0 6px', fontStyle: 'italic',
            }}>
              {narrative.thesis}
            </div>
          )}

          {narrative.lead_regions.length > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '4px 0 8px' }}>
              {narrative.lead_regions.join(' • ')}
            </div>
          )}

          {narrative.clusters.slice(0, 6).map((cluster, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '3px 0', fontSize: '10px',
            }}>
              <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-muted)', minWidth: '26px', flexShrink: 0 }}>
                {cluster.last_updated ? formatTimeAgo(cluster.last_updated) : '--'}
              </span>
              <span style={{
                fontSize: '9px', padding: '0 3px', fontWeight: 600, flexShrink: 0,
                color: 'var(--accent-primary)', background: 'var(--bg-active)', borderRadius: '2px',
              }}>
                {cluster.source_count} src
              </span>
              <span style={{
                color: 'var(--text-secondary)', flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {cluster.headline}
              </span>
            </div>
          ))}
          {narrative.clusters.length > 6 && (
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', paddingTop: '3px' }}>
              +{narrative.clusters.length - 6} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const NarrativeTrackerWidget = memo(function NarrativeTrackerWidget() {
  const { data, isLoading, error, refetch } = useStoryTracker({
    hours: 72,
    limit: 20,
  });

  if (isLoading) {
    return (
      <Widget id="narrative-tracker" icon={<Layers size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="narrative-tracker" icon={<Layers size={14} />}>
        <WidgetError message="Failed to load story tracker" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const narratives = data || [];

  if (narratives.length === 0) {
    return (
      <Widget id="narrative-tracker" icon={<Layers size={14} />}>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
          No tracked narratives in the last 72 hours
        </div>
      </Widget>
    );
  }

  // Category stats for header
  const catCounts: Record<string, number> = {};
  narratives.forEach(c => {
    const cat = c.category || 'general';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  const critCount = narratives.filter(c => c.direction === 'rising').length;

  return (
    <Widget
      id="narrative-tracker"
      icon={<Layers size={14} />}
      badge={critCount > 0 ? `${critCount} rising` : `${narratives.length} tracked`}
    >
      {/* Header stats bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
        fontSize: '9px', color: 'var(--text-muted)',
      }}>
        <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {narratives.length} narratives tracked
        </span>
        <div style={{ flex: 1 }} />
        {Object.entries(catCounts).slice(0, 4).map(([cat, count]) => (
          <span key={cat} style={{
            display: 'flex', alignItems: 'center', gap: '3px',
          }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '1px',
              background: CATEGORY_COLORS[cat] || 'var(--text-muted)',
            }} />
            {cat} {count}
          </span>
        ))}
      </div>

      {/* Column header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 80px 100px 20px',
        gap: '8px',
        padding: '4px 10px',
        fontSize: '8px',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <span>#</span>
        <span>NARRATIVE</span>
        <span>CLUSTERS</span>
        <span style={{ textAlign: 'right' }}>UPDATED</span>
        <span />
      </div>

      {/* Story list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {narratives.map((narrative, i) => (
          <StoryRow key={narrative.narrative_id} narrative={narrative} rank={i + 1} />
        ))}
      </div>
    </Widget>
  );
});
