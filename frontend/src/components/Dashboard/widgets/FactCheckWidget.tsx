/**
 * FactCheckWidget — Fact-check results presented with the same feed language
 * as the stories widget for consistent dashboard rhythm.
 */
import { memo, useState } from 'react';
import { Widget } from '../Widget';
import { ShieldCheck, ExternalLink, AlertTriangle, CheckCircle, XCircle, HelpCircle, ChevronDown } from 'lucide-react';
import { useFactCheckResults } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError, WidgetEmpty } from './shared';
import type { FactCheckResult } from '../../../api/factCheck';

const VERDICT_CONFIG: Record<string, { label: string; className: string; icon: typeof CheckCircle }> = {
  true:           { label: 'TRUE',         className: 'low',      icon: CheckCircle },
  mostly_true:    { label: 'MOSTLY TRUE',  className: 'low',      icon: CheckCircle },
  partially_true: { label: 'PARTLY TRUE',  className: 'medium',   icon: HelpCircle },
  misleading:     { label: 'MISLEADING',   className: 'high',     icon: AlertTriangle },
  false:          { label: 'FALSE',        className: 'critical', icon: XCircle },
  unverifiable:   { label: 'UNVERIFIABLE', className: 'medium',   icon: HelpCircle },
  satire:         { label: 'SATIRE',       className: 'medium',   icon: HelpCircle },
};

function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function FactCheckCard({ result }: { result: FactCheckResult }) {
  const [expanded, setExpanded] = useState(false);
  const config = VERDICT_CONFIG[result.verdict] || VERDICT_CONFIG.unverifiable;
  const confidence = `${Math.round(result.confidence * 100)}% confidence`;
  const summary = result.key_finding || result.verdict_summary || result.context || '';
  const title = result.story_title || 'Untitled Story';
  const sourceName = result.story_source || 'Fact check';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 0.15s',
      }}
    >
      <div
        className="feed-item cluster-item"
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '3px 1fr 16px',
          gap: '10px',
          alignItems: 'start',
        }}
      >
        <div className={`feed-indicator ${config.className}`} style={{ margin: '2px 0' }} />
        <div className="feed-content">
          <div className="feed-meta">
            <span className={`feed-badge ${config.className}`}>{config.label}</span>
            <span className="source-count-badge">{confidence}</span>
            <span className="source-count-badge">{sourceName}</span>
          </div>

          {result.story_url ? (
            <a
              href={result.story_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="feed-title feed-title-link text-left w-full hover:text-blue-400 transition-colors group"
            >
              <span className="group-hover:underline">{title}</span>
              <ExternalLink size={12} className="inline-block ml-2 opacity-0 group-hover:opacity-100 text-blue-400 transition-opacity" />
            </a>
          ) : (
            <div className="feed-title">{title}</div>
          )}

          {summary && (
            <div
              className="feed-time"
              style={{
                marginTop: '4px',
                display: '-webkit-box',
                WebkitLineClamp: expanded ? 'unset' : 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                whiteSpace: 'normal',
                lineHeight: 1.45,
              }}
            >
              {summary}
            </div>
          )}

          <div className="feed-time" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{formatTimeAgo(result.checked_at)}</span>
            {typeof result.claims_analyzed?.length === 'number' && result.claims_analyzed.length > 0 ? (
              <span className="source-count-badge">{result.claims_analyzed.length} claims</span>
            ) : (
              <span className="source-count-badge">Fact-checked</span>
            )}
          </div>
        </div>
        <ChevronDown
          size={10}
          style={{
            color: 'var(--text-muted)',
            marginTop: '4px',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {expanded && (
        <div
          style={{
            padding: '0 12px 10px 23px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {result.verdict_summary && result.verdict_summary !== summary && (
            <div
              style={{
                fontSize: '10px',
                lineHeight: 1.45,
                color: 'var(--text-secondary)',
                padding: '8px 0 6px',
              }}
            >
              {result.verdict_summary}
            </div>
          )}

          {result.key_finding && result.key_finding !== summary && (
            <div
              style={{
                fontSize: '10px',
                lineHeight: 1.45,
                color: 'var(--text-secondary)',
                padding: '0 0 8px',
              }}
            >
              {result.key_finding}
            </div>
          )}

          {result.claims_analyzed?.slice(0, 5).map((claim, index) => {
            const claimConfig = VERDICT_CONFIG[claim.verdict] || VERDICT_CONFIG.unverifiable;
            return (
              <div
                key={`${result.id}-claim-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  padding: '4px 0',
                  fontSize: '10px',
                }}
              >
                <span
                  className={`feed-badge ${claimConfig.className}`}
                  style={{ flexShrink: 0, padding: '0 4px', minWidth: 'auto' }}
                >
                  {claimConfig.label}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', lineHeight: 1.45 }}>
                    {claim.claim}
                  </div>
                  {claim.evidence && (
                    <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '2px' }}>
                      {claim.evidence}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {result.context && (
            <div
              style={{
                fontSize: '10px',
                lineHeight: 1.45,
                color: 'var(--text-muted)',
                paddingTop: '6px',
              }}
            >
              Missing context: {result.context}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const FactCheckWidget = memo(function FactCheckWidget() {
  const { data, isLoading, error, refetch } = useFactCheckResults({ limit: 20, hours: 168 });

  if (isLoading) {
    return (
      <Widget id="fact-check" icon={<ShieldCheck size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="fact-check" icon={<ShieldCheck size={14} />}>
        <WidgetError message="Failed to load fact-checks" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const results = data || [];

  if (results.length === 0) {
    return (
      <Widget id="fact-check" icon={<ShieldCheck size={14} />}>
        <WidgetEmpty message="No fact-checks yet. Request one from the live feed!" />
      </Widget>
    );
  }

  // Count verdicts
  const falseCount = results.filter(r => r.verdict === 'false' || r.verdict === 'misleading').length;

  return (
    <Widget
      id="fact-check"
      icon={<ShieldCheck size={14} />}
      badge={falseCount > 0 ? `${falseCount} flagged` : `${results.length}`}
    >
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {results.map(result => (
          <FactCheckCard key={result.id} result={result} />
        ))}
      </div>
    </Widget>
  );
});
