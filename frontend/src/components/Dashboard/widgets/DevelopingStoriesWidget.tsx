/**
 * DevelopingStoriesWidget — Intelligence-grade developing stories feed.
 * Shows top evolving events with Haiku-generated BLUFs, development stage
 * indicators, source corroboration, and compact chronological timelines.
 */
import { memo, useState } from 'react';
import { Widget } from '../Widget';
import {
  Activity, ExternalLink, ChevronDown, Clock, Layers, Globe,
  TrendingUp, AlertTriangle, CheckCircle, Radio, ShieldCheck,
} from 'lucide-react';
import { useDevelopingStories } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError, SeverityBadge, formatTimeAgo } from './shared';
import type { ClusterTimelineEntry } from '../../../api/situationMonitor';

const STAGE_CONFIG: Record<string, { label: string; color: string; icon: typeof Radio }> = {
  emerging:   { label: 'EMERGING',   color: '#D1980B', icon: Radio },
  developing: { label: 'DEVELOPING', color: '#C87619', icon: TrendingUp },
  mature:     { label: 'CONFIRMED',  color: '#238551', icon: CheckCircle },
  resolved:   { label: 'RESOLVED',   color: '#6b7280', icon: CheckCircle },
};

const CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
  highly_corroborated: { label: 'VERIFIED', color: '#238551' },
  well_corroborated:   { label: 'SUPPORTED', color: '#238551' },
  corroborated:        { label: 'PARTIAL', color: '#D1980B' },
  single_source:       { label: 'SINGLE SRC', color: '#C87619' },
};

function isRecentlyUpdated(lastUpdated: string | null): boolean {
  if (!lastUpdated) return false;
  return Date.now() - new Date(lastUpdated).getTime() < 2 * 60 * 60 * 1000;
}

function hasMultipleLanguages(timeline: ClusterTimelineEntry['timeline']): boolean {
  const sources = timeline.map(s => s.source_name?.toLowerCase() || '');
  const nepaliSources = ['onlinekhabar', 'ratopati', 'setopati', 'nagarik', 'kantipur', 'ujyaalo'];
  const englishSources = ['the kathmandu post', 'himalayan times', 'republica', 'myrepublica', 'tkp'];
  const hasNepali = sources.some(s => nepaliSources.some(ns => s.includes(ns)));
  const hasEnglish = sources.some(s => englishSources.some(es => s.includes(es)));
  return hasNepali && hasEnglish;
}

function DevelopingCard({ cluster }: { cluster: ClusterTimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const stage = STAGE_CONFIG[cluster.development_stage || 'emerging'] || STAGE_CONFIG.emerging;
  const conf = CONFIDENCE_LABELS[cluster.confidence_level || ''] || null;
  const isDeveloping = isRecentlyUpdated(cluster.last_updated);
  const crossLingual = hasMultipleLanguages(cluster.timeline);
  const StageIcon = stage.icon;

  const timelineDesc = [...cluster.timeline].reverse();

  // Time since last update
  const lastUpdateText = cluster.last_updated ? formatTimeAgo(cluster.last_updated) : '--';

  return (
    <div style={{
      borderBottom: '1px solid var(--border-subtle)',
      padding: '10px 12px',
      transition: 'background 0.15s',
      cursor: 'pointer',
    }}
      onClick={() => setExpanded(!expanded)}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.03))')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Row 1: Stage + Severity + Time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
        {/* Development stage pill */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '3px',
          fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
          padding: '2px 6px', borderRadius: '3px',
          background: `${stage.color}18`, color: stage.color,
        }}>
          <StageIcon size={9} />
          {stage.label}
        </span>

        <SeverityBadge severity={cluster.severity || 'low'} />

        {cluster.category && (
          <span style={{
            fontSize: '9px', padding: '1px 6px',
            background: 'var(--bg-active)', color: 'var(--text-secondary)',
            textTransform: 'uppercase', fontWeight: 500, borderRadius: '2px',
          }}>
            {cluster.category}
          </span>
        )}

        {crossLingual && (
          <span title="Cross-lingual coverage"><Globe size={10} style={{ color: 'var(--accent-primary)', opacity: 0.7 }} /></span>
        )}

        <div style={{ flex: 1 }} />

        {/* Live pulse + time */}
        <span style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: '10px', color: isDeveloping ? '#238551' : 'var(--text-muted)',
          fontWeight: isDeveloping ? 600 : 400,
        }}>
          {isDeveloping && <span style={{
            width: '5px', height: '5px', borderRadius: '50%', background: '#238551',
            animation: 'pulse 2s ease-in-out infinite',
          }} />}
          {lastUpdateText}
        </span>
      </div>

      {/* Row 2: Headline */}
      <div style={{
        fontSize: '12px', fontWeight: 500, lineHeight: 1.4, color: 'var(--text-primary)',
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        marginBottom: cluster.bluf ? '4px' : '6px',
      }}>
        {cluster.headline}
      </div>

      {/* Row 3: BLUF (if available) */}
      {cluster.bluf && (
        <div style={{
          fontSize: '11px', lineHeight: 1.4, color: 'var(--text-secondary)',
          marginBottom: '6px', fontStyle: 'italic',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: expanded ? 5 : 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          {cluster.bluf}
        </div>
      )}

      {/* Row 4: Corroboration bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Layers size={9} />
          {cluster.source_count} sources
        </span>

        {/* Multi-source verified tick */}
        {cluster.source_count >= 2 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '2px',
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.3px',
            padding: '1px 5px', borderRadius: '2px',
            background: '#23855118', color: '#238551',
          }}>
            <CheckCircle size={8} />
            VERIFIED
          </span>
        )}

        {/* Fact-checked badge (3+ sources = cross-checked) */}
        {cluster.source_count >= 3 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '2px',
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.3px',
            padding: '1px 5px', borderRadius: '2px',
            background: '#2D72D218', color: '#2D72D2',
          }}>
            <ShieldCheck size={8} />
            FACT-CHECKED
          </span>
        )}

        <div style={{ flex: 1 }} />

        <ChevronDown size={11} style={{
          color: 'var(--text-muted)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }} />
      </div>

      {/* Expanded: Source Timeline */}
      {expanded && (
        <div style={{
          marginTop: '8px', paddingTop: '8px',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {timelineDesc.slice(0, 8).map((story, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              padding: '3px 0',
              fontSize: '10px',
            }}>
              <span style={{
                width: '4px', height: '4px', borderRadius: '50%',
                background: i === 0 ? '#238551' : 'var(--text-muted)',
                flexShrink: 0, marginTop: '5px',
              }} />
              <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: '28px' }}>
                {formatTimeAgo(story.published_at)}
              </span>
              {story.source_name && (
                <span style={{
                  fontSize: '9px', padding: '0px 4px', fontWeight: 600, flexShrink: 0,
                  background: 'var(--bg-active)', color: 'var(--accent-primary)',
                  borderRadius: '2px',
                }}>
                  {story.source_name}
                </span>
              )}
              <span style={{
                color: 'var(--text-secondary)', flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {story.title}
              </span>
              {story.url && (
                <a
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ flexShrink: 0, color: 'var(--text-muted)', padding: '0 2px' }}
                >
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          ))}
          {timelineDesc.length > 8 && (
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', paddingTop: '4px', textAlign: 'center' }}>
              +{timelineDesc.length - 8} more sources
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const DevelopingStoriesWidget = memo(function DevelopingStoriesWidget() {
  const { data, isLoading, error, refetch } = useDevelopingStories();

  if (isLoading) {
    return (
      <Widget id="developing-stories" icon={<Activity size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="developing-stories" icon={<Activity size={14} />}>
        <WidgetError message="Failed to load developing stories" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const clusters = data || [];

  // Priority keywords — election stories (Jhapa-5, Balen vs Oli, leading/results) float to top
  const PRIORITY_KEYWORDS = /jhapa|balen|oli|election.*result|vote.*count|leading|निर्वाचन|मतगणना|बालेन|ओली|झापा/i;

  const isElectionPriority = (c: typeof clusters[0]) => {
    const text = `${c.headline || ''} ${c.bluf || ''}`;
    return PRIORITY_KEYWORDS.test(text);
  };

  // Sort: priority election stories first, then active stage, then recency
  const sorted = [...clusters].sort((a, b) => {
    const aPriority = isElectionPriority(a) ? 0 : 1;
    const bPriority = isElectionPriority(b) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const stageOrder: Record<string, number> = { emerging: 0, developing: 1, mature: 2, resolved: 3 };
    const aStage = stageOrder[a.development_stage || 'emerging'] ?? 2;
    const bStage = stageOrder[b.development_stage || 'emerging'] ?? 2;
    if (aStage !== bStage) return aStage - bStage;
    const aTime = a.last_updated ? new Date(a.last_updated).getTime() : 0;
    const bTime = b.last_updated ? new Date(b.last_updated).getTime() : 0;
    return bTime - aTime;
  });

  if (sorted.length === 0) {
    return (
      <Widget id="developing-stories" icon={<Activity size={14} />}>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
          No developing stories in the last 72 hours
        </div>
      </Widget>
    );
  }

  const activeCount = sorted.filter(c =>
    c.development_stage === 'emerging' || c.development_stage === 'developing'
  ).length;

  return (
    <Widget
      id="developing-stories"
      icon={<Activity size={14} />}
      badge={activeCount > 0 ? `${activeCount} active` : `${sorted.length}`}
    >
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {sorted.map(cluster => (
          <DevelopingCard key={cluster.cluster_id} cluster={cluster} />
        ))}
      </div>
    </Widget>
  );
});
