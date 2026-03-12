/**
 * SituationBriefWidget — fixed-footprint national brief monitor.
 *
 * The widget keeps a stable height and routes full detail into an inspector
 * pane instead of expanding rows inline.
 *
 * Now includes a history selector to view past assessments.
 */
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  History,
  MapPin,
  Minus,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import CountUp from 'react-countup';
import { Widget } from '../Widget';
import { useLatestBrief, useBriefById, useBriefHistory } from '../../../api/hooks';
import { formatTimeAgo, WidgetError } from './shared';
import type { BriefDetail, BriefHotspot, BriefSummary } from '../../../api/briefs';

type SummaryStat = {
  label: string;
  value: number;
};

const THREAT_BADGE: Record<string, { text: string; className: string }> = {
  critical: { text: 'CRITICAL', className: 'critical' },
  elevated: { text: 'HIGH', className: 'high' },
  guarded: { text: 'MEDIUM', className: 'medium' },
  low: { text: 'LOW', className: 'low' },
};

const THREAT_INDICATOR: Record<string, string> = {
  critical: 'var(--status-critical)',
  elevated: 'var(--status-high)',
  guarded: 'var(--status-medium)',
  low: 'var(--status-low)',
};

function TrendTag({ trajectory }: { trajectory?: string }) {
  if (!trajectory) return null;

  const config: Record<string, { Icon: typeof TrendingUp; label: string; className: string }> = {
    escalating: { Icon: TrendingUp, label: 'Worsening', className: 'tag-security' },
    'de-escalating': { Icon: TrendingDown, label: 'Improving', className: 'tag-economic' },
    stable: { Icon: Minus, label: 'Stable', className: '' },
  };

  const trend = config[trajectory] || config.stable;

  return (
    <span className={`feed-tag ${trend.className} brief-inline-tag`}>
      <trend.Icon size={10} />
      {trend.label}
    </span>
  );
}

function hotspotLabel(hotspot: BriefHotspot) {
  return hotspot.district || hotspot.province || hotspot.description || 'Hotspot';
}

function normalizeTrendLabel(trend?: string) {
  if (!trend) return 'stable';
  return trend.replace(/_/g, ' ').replace(/-/g, ' ');
}

function SummaryCard({
  title,
  copy,
  icon,
}: {
  title: string;
  copy?: string;
  icon?: ReactNode;
}) {
  return (
    <article className="brief-summary-card">
      <div className="brief-summary-card-title">
        {icon}
        {title}
      </div>
      <p className="brief-summary-card-copy">{copy || 'No detail available for this run.'}</p>
    </article>
  );
}

function HistorySelector({
  history,
  selectedBriefId,
  isViewingHistory,
  onSelect,
  onBackToLatest,
}: {
  history: BriefSummary[];
  selectedBriefId: string | null;
  isViewingHistory: boolean;
  onSelect: (id: string) => void;
  onBackToLatest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`widget-action ${isViewingHistory ? 'brief-history-active' : ''}`}
        title="View past assessments"
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        <History size={12} />
        {isViewingHistory && <span style={{ fontSize: '9px', fontWeight: 600 }}>PAST</span>}
      </button>

      {open && (
        <div className="brief-history-dropdown">
          <div className="brief-history-header">
            <span>Past Assessments</span>
            {isViewingHistory && (
              <button
                type="button"
                className="brief-history-back"
                onClick={() => { onBackToLatest(); setOpen(false); }}
              >
                Back to latest
              </button>
            )}
          </div>
          <div className="brief-history-list">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`brief-history-item ${selectedBriefId === item.id ? 'selected' : ''}`}
                onClick={() => { onSelect(item.id); setOpen(false); }}
              >
                <div className="brief-history-item-top">
                  <span className="brief-history-run">Run #{item.run_number}</span>
                  <TrendTag trajectory={item.trend_vs_previous} />
                </div>
                <div className="brief-history-item-time">
                  {formatTimeAgo(item.created_at)}
                  <span style={{ marginLeft: 'auto', color: 'var(--pro-text-muted)' }}>
                    {item.stories_analyzed} stories
                  </span>
                </div>
                {item.national_summary && (
                  <div className="brief-history-item-summary">
                    {item.national_summary.slice(0, 120)}...
                  </div>
                )}
              </button>
            ))}
            {history.length === 0 && (
              <div style={{ padding: '12px', color: 'var(--pro-text-muted)', fontSize: '11px', textAlign: 'center' }}>
                No past assessments yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryBand({
  runNumber,
  createdAt,
  trend,
  summary,
  assessment,
  hotspots,
  stats,
  isHistorical,
}: {
  runNumber: number;
  createdAt: string;
  trend?: string;
  summary?: string;
  assessment?: string;
  hotspots: BriefHotspot[];
  stats: SummaryStat[];
  isHistorical: boolean;
}) {
  return (
    <section className="brief-summary-band">
      <div className="brief-section-title">
        <div />
        <div className="brief-heading-actions">
          {isHistorical && (
            <span className="brief-historical-badge">
              <History size={9} />
              HISTORICAL
            </span>
          )}
          <span className="source-count-badge">Run #{runNumber}</span>
          <span className="brief-section-meta">
            <Clock size={10} />
            {formatTimeAgo(createdAt)}
          </span>
        </div>
      </div>

      <div className="brief-summary-layout brief-summary-layout-expanded">
        <div className="brief-meta-row brief-summary-meta">
          <span className="source-count-badge">{isHistorical ? 'Past report' : 'Latest report'}</span>
          <TrendTag trajectory={trend} />
        </div>

        <SummaryCard
          title="Summary"
          copy={summary}
        />

        <SummaryCard
          title="Key Findings"
          copy={assessment}
          icon={<ShieldAlert size={12} />}
        />

        <aside className="brief-side-card brief-status-card">
          <div className="brief-side-title">Current Status</div>
          <div className="brief-status-list">
            <div className="brief-status-row">
              <span>Update freshness</span>
              <strong>{formatTimeAgo(createdAt)}</strong>
            </div>
            <div className="brief-status-row">
              <span>Trend direction</span>
              <strong>{normalizeTrendLabel(trend)}</strong>
            </div>
            <div className="brief-status-row">
              <span>Brief run</span>
              <strong>#{runNumber}</strong>
            </div>
          </div>
        </aside>

        <div className="brief-side-card brief-ops-card">
          <div className="brief-side-title">Operational Snapshot</div>
          <div className="brief-ops-layout">
            <div className="brief-hotspot-group">
              <div className="brief-inline-section-label">Areas of Concern</div>
              {hotspots.length > 0 ? (
                <div className="brief-hotspots">
                  {hotspots.slice(0, 4).map((hotspot, index) => (
                    <span key={`${hotspotLabel(hotspot)}-${index}`} className="brief-hotspot-pill">
                      <MapPin
                        size={10}
                        style={{
                          color: THREAT_INDICATOR[hotspot.severity || 'low'] || THREAT_INDICATOR.low,
                        }}
                      />
                      {hotspotLabel(hotspot)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="brief-empty-inline">No areas of concern identified</div>
              )}
            </div>

            <div className="brief-metrics-grid brief-metrics-grid-compact">
              {stats.map((stat) => (
                <div key={stat.label} className="brief-metric">
                  <div className="brief-metric-label">{stat.label}</div>
                  <div className="brief-metric-value">
                    <CountUp end={stat.value} duration={1.1} separator="," />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SituationBriefStyles() {
  return (
    <style>{`
      .widget.widget-command[data-widget-id="situation-brief"] {
        grid-row: span 9;
      }

      .widget[data-widget-id="situation-brief"] .widget-body {
        overflow: hidden;
      }

      .brief-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--pro-bg-surface);
        font-family: var(--font-widget-sans);
        font-size: var(--widget-text-sm);
      }

      .brief-summary-band {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .brief-section-title,
      .brief-pane-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px 4px;
        background: var(--pro-bg-elevated);
        border-bottom: 1px solid var(--pro-border-subtle);
        min-height: 36px;
      }

      .brief-section-heading,
      .brief-pane-kicker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-secondary);
      }

      .brief-section-heading svg {
        color: var(--pro-text-muted);
      }

      .brief-heading-actions,
      .brief-pane-header-meta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .brief-section-meta {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--pro-text-muted);
      }

      .brief-pane-title {
        margin-top: 2px;
        font-size: 14px;
        font-weight: 600;
        color: var(--pro-text-primary);
        line-height: 1.3;
      }

      .brief-summary-layout {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        padding: 12px;
        flex: 1 1 auto;
        align-content: start;
      }

      .brief-summary-layout-expanded {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1.35fr) minmax(260px, 0.9fr);
        grid-auto-rows: minmax(0, auto);
      }

      .brief-summary-meta {
        grid-column: 1 / -1;
        padding: 0 2px;
        margin-bottom: -2px;
      }

      .brief-status-card {
        min-height: 100%;
      }

      .brief-meta-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        grid-column: 1 / -1;
      }

      .brief-inline-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .brief-summary-card,
      .brief-side-card,
      .brief-inspector-block {
        padding: 14px;
        border: 1px solid var(--pro-border-default);
        border-radius: var(--pro-radius-lg);
        background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
        min-width: 0;
      }

      .brief-summary-card.selected {
        border-color: rgba(99, 102, 241, 0.24);
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.16);
      }

      .brief-summary-card-title,
      .brief-side-title,
      .brief-inspector-block-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
        font-size: var(--widget-text-sm);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-secondary);
      }

      .brief-summary-card-copy {
        margin: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 8;
        overflow: hidden;
        font-size: var(--widget-text-md);
        line-height: 1.6;
        color: var(--pro-text-primary);
      }

      .brief-copy-full {
        margin: 0;
        font-size: 12px;
        line-height: 1.6;
        color: var(--pro-text-primary);
      }

      .brief-status-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .brief-status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: var(--widget-text-md);
        color: var(--pro-text-secondary);
        padding-bottom: 8px;
        border-bottom: 1px solid var(--pro-border-subtle);
      }

      .brief-status-row:last-child {
        padding-bottom: 0;
        border-bottom: none;
      }

      .brief-status-row strong {
        color: var(--pro-text-primary);
        font-weight: 600;
        text-transform: capitalize;
      }

      .brief-hotspots {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .brief-hotspot-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border: 1px solid var(--pro-border-default);
        border-radius: var(--pro-radius-sm);
        background: rgba(255, 255, 255, 0.04);
        color: var(--pro-text-secondary);
        font-size: var(--widget-text-sm);
      }

      .brief-empty-inline {
        font-size: var(--widget-text-md);
        color: var(--pro-text-muted);
      }

      .brief-inline-section-label {
        margin-bottom: 8px;
        font-size: var(--widget-text-sm);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-muted);
      }

      .brief-ops-card {
        grid-column: 1 / -1;
      }

      .brief-ops-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
        gap: 12px;
        align-items: start;
      }

      .brief-hotspot-group {
        min-width: 0;
      }

      .brief-metrics-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1px;
        background: var(--pro-border-subtle);
        border: 1px solid var(--pro-border-subtle);
        border-radius: var(--pro-radius-md);
        overflow: hidden;
      }

      .brief-metrics-grid-compact {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .brief-metrics-grid-wide {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .brief-metric {
        padding: 10px 12px;
        background: rgba(255,255,255,0.015);
      }

      .brief-metric-label {
        font-size: var(--widget-text-sm);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-muted);
      }

      .brief-metric-value {
        margin-top: 6px;
        font-size: 16px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--pro-text-primary);
      }

      .brief-empty-pane,
      .brief-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 100%;
        padding: 20px;
        color: var(--pro-text-muted);
        text-align: center;
      }

      .brief-empty-pane p,
      .brief-empty p,
      .brief-empty small {
        margin: 0;
      }

      .brief-empty small {
        font-size: var(--widget-text-sm);
        color: var(--pro-text-disabled);
      }

      /* Historical badge */
      .brief-historical-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: var(--pro-radius-sm);
        background: rgba(200, 118, 25, 0.15);
        border: 1px solid rgba(200, 118, 25, 0.3);
        color: #C87619;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
      }

      .brief-history-active {
        color: #C87619 !important;
      }

      /* History dropdown */
      .brief-history-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        width: 340px;
        max-height: 400px;
        background: var(--pro-bg-elevated);
        border: 1px solid var(--pro-border-default);
        border-radius: var(--pro-radius-md);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 100;
        display: flex;
        flex-direction: column;
      }

      .brief-history-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid var(--pro-border-subtle);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--pro-text-secondary);
      }

      .brief-history-back {
        padding: 2px 8px;
        border: 1px solid var(--pro-border-subtle);
        border-radius: var(--pro-radius-sm);
        background: transparent;
        color: var(--pro-accent);
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        text-transform: none;
        letter-spacing: normal;
      }

      .brief-history-back:hover {
        background: var(--pro-bg-hover);
      }

      .brief-history-list {
        overflow-y: auto;
        max-height: 340px;
      }

      .brief-history-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        padding: 10px 12px;
        border: none;
        border-bottom: 1px solid var(--pro-border-subtle);
        background: transparent;
        text-align: left;
        font: inherit;
        cursor: pointer;
        transition: background 0.1s;
      }

      .brief-history-item:hover {
        background: var(--pro-bg-hover);
      }

      .brief-history-item.selected {
        background: rgba(99, 102, 241, 0.08);
        box-shadow: inset 2px 0 0 var(--pro-accent);
      }

      .brief-history-item-top {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .brief-history-run {
        font-size: var(--widget-text-md);
        font-weight: 600;
        color: var(--pro-text-primary);
      }

      .brief-history-item-time {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--widget-text-sm);
        color: var(--pro-text-muted);
      }

      .brief-history-item-summary {
        font-size: var(--widget-text-md);
        line-height: 1.4;
        color: var(--pro-text-secondary);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .brief-summary-band .source-count-badge {
        background: rgba(255,255,255,0.05);
        color: var(--pro-text-secondary);
        border-radius: 999px;
        padding: 3px 8px;
      }

      @media (max-width: 1200px) {
        .brief-summary-layout {
          grid-template-columns: 1fr;
        }

        .brief-ops-layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 768px) {
        .brief-section-title,
        .brief-pane-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .brief-heading-actions,
        .brief-pane-header-meta {
          justify-content: flex-start;
        }
      }
    `}</style>
  );
}

export const SituationBriefWidget = memo(function SituationBriefWidget() {
  const { data: latestBrief, isLoading, error, refetch } = useLatestBrief();
  const { data: history } = useBriefHistory(20);
  const [historicalBriefId, setHistoricalBriefId] = useState<string | null>(null);
  const { data: historicalBrief } = useBriefById(historicalBriefId);

  // Use historical brief if selected, otherwise latest
  const isViewingHistory = historicalBriefId !== null;
  const brief: BriefDetail | null | undefined = isViewingHistory ? historicalBrief : latestBrief;

  const provinceCount = brief?.province_sitreps?.length || 0;

  const stats: SummaryStat[] = [
    { label: 'Stories', value: brief?.stories_analyzed || 0 },
    { label: 'Clusters', value: brief?.clusters_analyzed || 0 },
    { label: 'Provinces', value: provinceCount },
  ];

  if (isLoading) {
    return (
      <Widget id="situation-brief" icon={<FileText size={14} />}>
        <div className="animate-pulse" style={{ padding: 12 }}>
          {[1, 2, 3, 4].map((index) => (
            <div
              key={index}
              style={{
                height: 14,
                background: 'var(--pro-bg-active)',
                borderRadius: 4,
                marginBottom: 10,
                width: `${100 - index * 12}%`,
              }}
            />
          ))}
        </div>
        <SituationBriefStyles />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="situation-brief" icon={<FileText size={14} />}>
        <WidgetError message="Failed to load analysis report" onRetry={() => refetch()} />
        <SituationBriefStyles />
      </Widget>
    );
  }

  if (!brief) {
    return (
      <Widget id="situation-brief" icon={<FileText size={14} />}>
        <div className="brief-empty">
          <Eye size={24} />
          <p>No analysis report available yet.</p>
          <small>The analysis agent runs every 4 hours.</small>
        </div>
        <SituationBriefStyles />
      </Widget>
    );
  }
  return (
    <Widget
      id="situation-brief"
      icon={<FileText size={14} />}
      badge={`Run #${brief.run_number}`}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <HistorySelector
            history={history || []}
            selectedBriefId={historicalBriefId}
            isViewingHistory={isViewingHistory}
            onSelect={(id) => setHistoricalBriefId(id)}
            onBackToLatest={() => setHistoricalBriefId(null)}
          />
          <button type="button" onClick={() => refetch()} className="widget-action" title="Refresh brief">
            <RefreshCw size={12} />
          </button>
        </div>
      }
    >
      <div className="brief-shell">
        <SummaryBand
          runNumber={brief.run_number}
          createdAt={brief.created_at}
          trend={brief.trend_vs_previous}
          summary={brief.national_summary}
          assessment={brief.key_judgment}
          hotspots={brief.hotspots || []}
          stats={stats}
          isHistorical={isViewingHistory}
        />
      </div>
      <SituationBriefStyles />
    </Widget>
  );
});
