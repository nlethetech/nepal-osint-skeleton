/**
 * SituationBriefWidget — fixed-footprint national brief monitor.
 *
 * The widget keeps a stable height and routes full detail into an inspector
 * pane instead of expanding rows inline.
 *
 * Now includes a history selector to view past assessments.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { AnimatePresence, motion } from 'framer-motion';
import CountUp from 'react-countup';
import { Widget } from '../Widget';
import { useLatestBrief, useBriefById, useBriefHistory } from '../../../api/hooks';
import { formatTimeAgo, WidgetError } from './shared';
import type { BriefDetail, BriefHotspot, BriefSummary, ProvinceSitrep } from '../../../api/briefs';

type BriefSelection =
  | { kind: 'national-summary' }
  | { kind: 'national-assessment' }
  | { kind: 'province'; id: string };

type SummaryStat = {
  label: string;
  value: number;
};

type InspectorModel =
  | {
      kind: 'national-summary';
      title: string;
      subtitle: string;
      timestamp: string;
      trend?: string;
      copy?: string;
      hotspots: BriefHotspot[];
      stats: SummaryStat[];
    }
  | {
      kind: 'national-assessment';
      title: string;
      subtitle: string;
      timestamp: string;
      trend?: string;
      copy?: string;
      hotspots: BriefHotspot[];
    }
  | {
      kind: 'province';
      title: string;
      subtitle: string;
      timestamp: string;
      sitrep: ProvinceSitrep;
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

const DOMAIN_SECTIONS = ['security', 'political', 'economic', 'disaster', 'election'] as const;

const inspectorVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' as const } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.12, ease: 'easeIn' as const } },
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

function getInspectorModel(
  selection: BriefSelection,
  brief: {
    created_at: string;
    national_summary?: string;
    key_judgment?: string;
    trend_vs_previous?: string;
    hotspots?: BriefHotspot[];
  },
  provinceById: Map<string, ProvinceSitrep>,
  stats: SummaryStat[],
): InspectorModel {
  if (selection.kind === 'province') {
    const sitrep = provinceById.get(selection.id);
    if (sitrep) {
      return {
        kind: 'province',
        title: sitrep.province_name,
        subtitle: 'National Report',
        timestamp: sitrep.created_at || brief.created_at,
        sitrep,
      };
    }
  }

  if (selection.kind === 'national-assessment') {
    return {
      kind: 'national-assessment',
      title: 'National Overview',
      subtitle: 'Key findings',
      timestamp: brief.created_at,
      trend: brief.trend_vs_previous,
      copy: brief.key_judgment,
      hotspots: brief.hotspots || [],
    };
  }

  return {
    kind: 'national-summary',
    title: 'Summary',
    subtitle: 'National context',
    timestamp: brief.created_at,
    trend: brief.trend_vs_previous,
    copy: brief.national_summary,
    hotspots: brief.hotspots || [],
    stats,
  };
}

function SummaryCard({
  title,
  copy,
  selected,
  icon,
  actionLabel,
  onSelect,
}: {
  title: string;
  copy?: string;
  selected: boolean;
  icon?: ReactNode;
  actionLabel: string;
  onSelect: () => void;
}) {
  return (
    <article className={`brief-summary-card ${selected ? 'selected' : ''}`}>
      <div className="brief-summary-card-title">
        {icon}
        {title}
      </div>
      <p className="brief-summary-card-copy">{copy || 'No detail available for this run.'}</p>
      <button type="button" className="brief-inline-action" onClick={onSelect}>
        {actionLabel}
      </button>
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
  selection,
  isHistorical,
  onSelectSummary,
  onSelectAssessment,
}: {
  runNumber: number;
  createdAt: string;
  trend?: string;
  summary?: string;
  assessment?: string;
  hotspots: BriefHotspot[];
  stats: SummaryStat[];
  selection: BriefSelection;
  isHistorical: boolean;
  onSelectSummary: () => void;
  onSelectAssessment: () => void;
}) {
  return (
    <section className="brief-summary-band">
      <div className="brief-section-title">
        <div className="brief-section-heading">
          <FileText size={12} />
          National Assessment
        </div>
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

      <div className="brief-summary-layout">
        <div className="brief-summary-main">
          <div className="brief-meta-row">
            <span className="source-count-badge">{isHistorical ? 'Past report' : 'Latest report'}</span>
            <TrendTag trajectory={trend} />
          </div>

          <SummaryCard
            title="Summary"
            copy={summary}
            selected={selection.kind === 'national-summary'}
            actionLabel="View in inspector"
            onSelect={onSelectSummary}
          />

          <SummaryCard
            title="Key Findings"
            copy={assessment}
            selected={selection.kind === 'national-assessment'}
            icon={<ShieldAlert size={12} />}
            actionLabel="View in inspector"
            onSelect={onSelectAssessment}
          />
        </div>

        <aside className="brief-summary-side">
          <div className="brief-side-card">
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
            </div>
          </div>

          <div className="brief-side-card">
            <div className="brief-side-title">Areas of Concern</div>
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

          <div className="brief-metrics-grid">
            {stats.map((stat) => (
              <div key={stat.label} className="brief-metric">
                <div className="brief-metric-label">{stat.label}</div>
                <div className="brief-metric-value">
                  <CountUp end={stat.value} duration={1.1} separator="," />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ProvinceQueueRow({
  sitrep,
  selected,
  onSelect,
}: {
  sitrep: ProvinceSitrep;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = THREAT_BADGE[sitrep.threat_level || 'low'] || THREAT_BADGE.low;
  const indicatorColor = THREAT_INDICATOR[sitrep.threat_level || 'low'] || THREAT_INDICATOR.low;

  return (
    <button type="button" className={`feed-item brief-queue-item ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="feed-indicator" style={{ background: indicatorColor }} />
      <div className="feed-content">
        <div className="feed-meta">
          <span className={`feed-badge ${badge.className}`}>{badge.text}</span>
          <TrendTag trajectory={sitrep.threat_trajectory} />
        </div>
        <div className="feed-title brief-queue-title">{sitrep.province_name}</div>
        <div className="feed-time brief-queue-meta">
          <span>{sitrep.story_count} stories</span>
          {sitrep.hotspots && sitrep.hotspots.length > 0 && (
            <span className="source-count-badge">{sitrep.hotspots.length} flagged areas</span>
          )}
        </div>
      </div>
    </button>
  );
}

function BriefQueue({
  selection,
  provinces,
  onSelectProvince,
}: {
  selection: BriefSelection;
  provinces: ProvinceSitrep[];
  onSelectProvince: (id: string) => void;
}) {
  return (
    <section className="brief-pane brief-queue-pane">
      <div className="brief-pane-header">
        <div>
          <div className="brief-pane-kicker">National Report</div>
          <div className="brief-pane-title">National assessments</div>
        </div>
        <span className="brief-pane-meta-badge">
          {provinces.length} provinces
        </span>
      </div>

      <div className="brief-pane-scroll">
        {provinces.length > 0 ? (
          <div className="feed-list">
            {provinces.map((sitrep) => (
              <ProvinceQueueRow
                key={sitrep.id}
                sitrep={sitrep}
                selected={selection.kind === 'province' && selection.id === sitrep.id}
                onSelect={() => onSelectProvince(sitrep.id)}
              />
            ))}
          </div>
        ) : (
          <div className="brief-empty-pane">
            <ShieldAlert size={18} />
            <p>No province reports available.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function InspectorBody({ model }: { model: InspectorModel }) {
  if (model.kind === 'province') {
    const badge = THREAT_BADGE[model.sitrep.threat_level || 'low'] || THREAT_BADGE.low;

    return (
      <div className="brief-inspector-stack">
        {model.sitrep.bluf && (
          <section className="brief-inspector-block">
            <div className="brief-inspector-block-title">Summary</div>
            <p className="brief-copy-full">{model.sitrep.bluf}</p>
          </section>
        )}

        <section className="brief-inspector-block">
          <div className="brief-inspector-block-title">Topic Analysis</div>
          <div className="brief-domain-grid">
            {DOMAIN_SECTIONS.map((domain) => {
              const content = model.sitrep[domain];
              if (!content) return null;
              return (
                <article key={domain} className="brief-domain-card">
                  <div className="brief-domain-label">{domain}</div>
                  <p className="brief-domain-copy">{content}</p>
                </article>
              );
            })}
          </div>
        </section>

        {model.sitrep.hotspots && model.sitrep.hotspots.length > 0 && (
          <section className="brief-inspector-block">
            <div className="brief-inspector-block-title">Areas of Concern</div>
            <div className="brief-hotspot-list">
              {model.sitrep.hotspots.map((hotspot, index) => (
                <div key={`${hotspotLabel(hotspot)}-${index}`} className="brief-hotspot-row">
                  <MapPin
                    size={10}
                    style={{
                      color: THREAT_INDICATOR[hotspot.severity || 'low'] || THREAT_INDICATOR.low,
                    }}
                  />
                  <span className="brief-hotspot-text">
                    {hotspot.district || hotspot.province}: {hotspot.description}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="brief-inspector-block brief-inspector-metrics">
          <div className="brief-inspector-meta-row">
            <span className={`feed-badge ${badge.className}`}>{badge.text}</span>
            <TrendTag trajectory={model.sitrep.threat_trajectory} />
            <span className="source-count-badge">{model.sitrep.story_count} stories analyzed</span>
          </div>
        </section>
      </div>
    );
  }

  if (model.kind === 'national-assessment') {
    return (
      <div className="brief-inspector-stack">
        <section className="brief-inspector-block">
          <div className="brief-inspector-meta-row">
            <TrendTag trajectory={model.trend} />
            <span className="source-count-badge">Key findings</span>
          </div>
          <p className="brief-copy-full">{model.copy || 'No analysis available for this run.'}</p>
        </section>

        {model.hotspots.length > 0 && (
          <section className="brief-inspector-block">
            <div className="brief-inspector-block-title">Areas of Concern</div>
            <div className="brief-hotspots">
              {model.hotspots.slice(0, 6).map((hotspot, index) => (
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
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="brief-inspector-stack">
      <section className="brief-inspector-block">
        <div className="brief-inspector-meta-row">
          <TrendTag trajectory={model.trend} />
          <span className="source-count-badge">National view</span>
        </div>
        <p className="brief-copy-full">{model.copy || 'No national summary available for this run.'}</p>
      </section>

      {model.hotspots.length > 0 && (
        <section className="brief-inspector-block">
          <div className="brief-inspector-block-title">Areas of Concern</div>
          <div className="brief-hotspots">
            {model.hotspots.slice(0, 6).map((hotspot, index) => (
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
        </section>
      )}

      <section className="brief-inspector-block">
        <div className="brief-inspector-block-title">High-level Stats</div>
        <div className="brief-metrics-grid brief-metrics-grid-wide">
          {model.stats.map((stat) => (
            <div key={stat.label} className="brief-metric">
              <div className="brief-metric-label">{stat.label}</div>
              <div className="brief-metric-value">
                <CountUp end={stat.value} duration={1.1} separator="," />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function BriefInspector({ model }: { model: InspectorModel }) {
  const inspectorBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inspectorBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [model.kind, model.title]);

  return (
    <section className="brief-pane brief-inspector-pane">
      <div className="brief-pane-header">
        <div>
          <div className="brief-pane-kicker">{model.subtitle}</div>
          <div className="brief-pane-title">{model.title}</div>
        </div>
        <div className="brief-pane-header-meta">
          {'trend' in model && model.trend ? <TrendTag trajectory={model.trend} /> : null}
          <span className="brief-section-meta">
            <Clock size={10} />
            {formatTimeAgo(model.timestamp)}
          </span>
        </div>
      </div>

      <div ref={inspectorBodyRef} className="brief-pane-scroll brief-inspector-scroll">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${model.kind}-${model.title}`}
            variants={inspectorVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="brief-inspector-motion"
          >
            <InspectorBody model={model} />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function SituationBriefStyles() {
  return (
    <style>{`
      .widget[data-widget-id="situation-brief"] .widget-body {
        overflow: hidden;
      }

      .brief-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--pro-bg-surface);
      }

      .brief-summary-band {
        flex: 0 0 auto;
        border-bottom: 1px solid var(--pro-border-subtle);
      }

      .brief-section-title,
      .brief-pane-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        background: var(--pro-bg-elevated);
        border-bottom: 1px solid var(--pro-border-subtle);
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
        grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.95fr);
        gap: 12px;
        padding: 12px;
      }

      .brief-summary-main,
      .brief-summary-side {
        display: grid;
        align-content: start;
        gap: 10px;
        min-width: 0;
      }

      .brief-summary-main {
        grid-template-columns: repeat(2, minmax(0, 1fr));
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
        padding: 10px 12px;
        border: 1px solid var(--pro-border-subtle);
        border-radius: var(--pro-radius-md);
        background: var(--pro-bg-elevated);
        min-width: 0;
      }

      .brief-summary-card.selected {
        border-color: var(--pro-border-focus);
        box-shadow: inset 0 0 0 1px var(--pro-accent-muted);
      }

      .brief-summary-card-title,
      .brief-side-title,
      .brief-inspector-block-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-secondary);
      }

      .brief-summary-card-copy {
        margin: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        font-size: 12px;
        line-height: 1.5;
        color: var(--pro-text-primary);
      }

      .brief-copy-full {
        margin: 0;
        font-size: 12px;
        line-height: 1.6;
        color: var(--pro-text-primary);
      }

      .brief-inline-action {
        margin-top: 8px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--pro-accent);
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
      }

      .brief-inline-action:hover {
        color: var(--pro-accent-hover);
      }

      .brief-status-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .brief-status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--pro-text-secondary);
      }

      .brief-status-row strong {
        color: var(--pro-text-primary);
        font-weight: 600;
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
        border: 1px solid var(--pro-border-subtle);
        border-radius: var(--pro-radius-sm);
        background: var(--pro-bg-active);
        color: var(--pro-text-secondary);
        font-size: 10px;
      }

      .brief-empty-inline {
        font-size: 11px;
        color: var(--pro-text-muted);
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

      .brief-metrics-grid-wide {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .brief-metric {
        padding: 10px 12px;
        background: var(--pro-bg-surface);
      }

      .brief-metric-label {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-muted);
      }

      .brief-metric-value {
        margin-top: 6px;
        font-size: 18px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--pro-text-primary);
      }

      .brief-workspace {
        display: grid;
        grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.55fr);
        flex: 1 1 auto;
        min-height: 0;
      }

      .brief-pane {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .brief-inspector-pane {
        border-left: 1px solid var(--pro-border-subtle);
      }

      .brief-pane-scroll {
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .brief-pane-scroll::-webkit-scrollbar {
        width: 6px;
      }

      .brief-pane-scroll::-webkit-scrollbar-thumb {
        background: var(--pro-bg-active);
        border-radius: 999px;
      }

      .brief-queue-item {
        width: 100%;
        border: none;
        background: transparent;
        text-align: left;
        font: inherit;
      }

      .brief-queue-item.selected {
        background: rgba(99, 102, 241, 0.08);
        box-shadow: inset 2px 0 0 var(--pro-accent);
      }

      .brief-queue-item:hover {
        background: var(--pro-bg-hover);
      }

      .brief-queue-title {
        font-weight: 500;
      }

      .brief-queue-title-clamp {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .brief-queue-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .brief-inspector-scroll {
        padding: 12px;
      }

      .brief-inspector-motion {
        min-height: 100%;
      }

      .brief-inspector-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .brief-inspector-meta-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }

      .brief-domain-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .brief-domain-card {
        padding: 8px 10px;
        border: 1px solid var(--pro-border-subtle);
        border-radius: var(--pro-radius-sm);
        background: var(--pro-bg-surface);
      }

      .brief-domain-label {
        margin-bottom: 4px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pro-text-muted);
      }

      .brief-domain-copy {
        margin: 0;
        font-size: 11px;
        line-height: 1.5;
        color: var(--pro-text-secondary);
      }

      .brief-hotspot-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .brief-hotspot-row {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 10px;
        color: var(--pro-text-secondary);
      }

      .brief-hotspot-text {
        line-height: 1.45;
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
        font-size: 10px;
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
        font-size: 11px;
        font-weight: 600;
        color: var(--pro-text-primary);
      }

      .brief-history-item-time {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10px;
        color: var(--pro-text-muted);
      }

      .brief-history-item-summary {
        font-size: 11px;
        line-height: 1.4;
        color: var(--pro-text-secondary);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .brief-tab-strip {
        display: none;
      }

      .brief-tab-count,
      .brief-pane-meta-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: var(--pro-radius-sm);
        background: var(--pro-bg-active);
        color: var(--pro-text-muted);
        font-size: 10px;
        font-weight: 600;
      }

      @media (max-width: 1200px) {
        .brief-summary-layout {
          grid-template-columns: 1fr;
        }

        .brief-summary-main {
          grid-template-columns: 1fr;
        }

        .brief-workspace {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(220px, 0.85fr) minmax(0, 1.15fr);
        }

        .brief-inspector-pane {
          border-left: none;
          border-top: 1px solid var(--pro-border-subtle);
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

        .brief-domain-grid,
        .brief-metrics-grid-wide {
          grid-template-columns: 1fr;
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

  const [selection, setSelection] = useState<BriefSelection>({ kind: 'national-summary' });

  const sitreps = useMemo(
    () =>
      [...(brief?.province_sitreps || [])].sort((a, b) => {
        const order: Record<string, number> = { critical: 0, elevated: 1, guarded: 2, low: 3 };
        return (order[a.threat_level || 'low'] ?? 3) - (order[b.threat_level || 'low'] ?? 3);
      }),
    [brief?.province_sitreps],
  );

  const provinceById = useMemo(() => new Map(sitreps.map((sitrep) => [sitrep.id, sitrep])), [sitreps]);

  const stats = useMemo<SummaryStat[]>(
    () => [
      { label: 'Stories', value: brief?.stories_analyzed || 0 },
      { label: 'Clusters', value: brief?.clusters_analyzed || 0 },
      { label: 'Provinces', value: sitreps.length },
    ],
    [brief?.stories_analyzed, brief?.clusters_analyzed, sitreps.length],
  );

  // Reset selection when brief changes
  useEffect(() => {
    setSelection({ kind: 'national-summary' });
  }, [brief?.id]);

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

  const inspectorModel = getInspectorModel(selection, brief, provinceById, stats);

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
          selection={selection}
          isHistorical={isViewingHistory}
          onSelectSummary={() => setSelection({ kind: 'national-summary' })}
          onSelectAssessment={() => setSelection({ kind: 'national-assessment' })}
        />

        <div className="brief-workspace">
          <BriefQueue
            selection={selection}
            provinces={sitreps}
            onSelectProvince={(id) => setSelection({ kind: 'province', id })}
          />

          <BriefInspector model={inspectorModel} />
        </div>
      </div>
      <SituationBriefStyles />
    </Widget>
  );
});
