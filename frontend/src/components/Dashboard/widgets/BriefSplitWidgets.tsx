import { createContext, useContext, type ReactNode } from 'react';
import { AlertTriangle, Clock3, FileText, Layers3, MapPin, ShieldAlert } from 'lucide-react';
import { Widget } from '../Widget';
import { useLatestBrief } from '../../../api/hooks';
import type { BriefDetail, BriefHotspot, ProvinceSitrep } from '../../../api/briefs';
import { WidgetError, WidgetSkeleton, formatTimeAgo } from './shared';

type BriefContextValue = {
  brief: BriefDetail | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
};

const BriefContext = createContext<BriefContextValue | null>(null);

function hotspotLabel(hotspot: BriefHotspot) {
  return hotspot.district || hotspot.province || hotspot.description || 'Area of concern';
}

function normalizeTrendLabel(trend?: string) {
  if (!trend) return 'Stable';
  return trend.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function severityClass(level?: string) {
  const normalized = (level || 'low').toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'elevated' || normalized === 'high') return 'high';
  if (normalized === 'guarded' || normalized === 'medium') return 'medium';
  return 'low';
}

function BriefCardState({ children }: { children: ReactNode }) {
  return <div className="uitest-brief-card">{children}</div>;
}

function useBriefCard() {
  const context = useContext(BriefContext);
  if (!context) {
    throw new Error('Brief widgets must be used inside BriefDataProvider');
  }
  return context;
}

function BriefLoading() {
  return (
    <BriefCardState>
      <WidgetSkeleton />
    </BriefCardState>
  );
}

function BriefFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <BriefCardState>
      <WidgetError message="National assessment unavailable" onRetry={onRetry} />
    </BriefCardState>
  );
}

function BriefBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <BriefCardState>
      <div className={`uitest-brief-body ${className}`.trim()}>{children}</div>
    </BriefCardState>
  );
}

function ProvinceRow({ province }: { province: ProvinceSitrep }) {
  const status = severityClass(province.threat_level);

  return (
    <div className="uitest-brief-province-row">
      <div className={`uitest-brief-dot ${status}`} />
      <div className="uitest-brief-province-copy">
        <div className="uitest-brief-province-name">{province.province_name}</div>
        <div className="uitest-brief-province-summary">
          {province.bluf || 'No provincial summary available for this run.'}
        </div>
      </div>
      <div className="uitest-brief-province-meta">
        <span className={`uitest-brief-pill ${status}`}>{province.threat_level || 'low'}</span>
        <span>{province.story_count} stories</span>
      </div>
    </div>
  );
}

function BriefSummaryContent() {
  const { brief, isLoading, error, refetch } = useBriefCard();
  if (isLoading) return <BriefLoading />;
  if (error || !brief) return <BriefFailure onRetry={refetch} />;

  return (
    <BriefBody>
      <div className="uitest-brief-kicker">National brief</div>
      <div className="uitest-brief-text uitest-brief-text-lg">
        {brief.national_summary || 'No summary available for this run.'}
      </div>
      <div className="uitest-brief-footer">
        <span>Updated {formatTimeAgo(brief.created_at)}</span>
        <span>Run #{brief.run_number}</span>
      </div>
    </BriefBody>
  );
}

function BriefFindingsContent() {
  const { brief, isLoading, error, refetch } = useBriefCard();
  if (isLoading) return <BriefLoading />;
  if (error || !brief) return <BriefFailure onRetry={refetch} />;

  return (
    <BriefBody>
      <div className="uitest-brief-kicker">Key findings</div>
      <div className="uitest-brief-text uitest-brief-text-full">
        {brief.key_judgment || brief.national_summary || 'No analytical findings available for this run.'}
      </div>
      <div className="uitest-brief-footer">
        <span>{brief.stories_analyzed} stories analyzed</span>
        <span>{brief.clusters_analyzed} clusters</span>
      </div>
    </BriefBody>
  );
}

function BriefStatusContent() {
  const { brief, isLoading, error, refetch } = useBriefCard();
  if (isLoading) return <BriefLoading />;
  if (error || !brief) return <BriefFailure onRetry={refetch} />;

  const items = [
    { label: 'Freshness', value: formatTimeAgo(brief.created_at) },
    { label: 'Trend', value: normalizeTrendLabel(brief.trend_vs_previous) },
    { label: 'Run', value: `#${brief.run_number}` },
    { label: 'Claude calls', value: String(brief.claude_calls) },
  ];

  return (
    <BriefBody>
      <div className="uitest-brief-kicker">Current status</div>
      <div className="uitest-brief-stat-list">
        {items.map((item) => (
          <div key={item.label} className="uitest-brief-stat-row">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </BriefBody>
  );
}

function BriefSnapshotContent() {
  const { brief, isLoading, error, refetch } = useBriefCard();
  if (isLoading) return <BriefLoading />;
  if (error || !brief) return <BriefFailure onRetry={refetch} />;

  const hotspots = (brief.hotspots || []).slice(0, 5);
  const metrics = [
    { label: 'Stories', value: brief.stories_analyzed },
    { label: 'Clusters', value: brief.clusters_analyzed },
    { label: 'Provinces', value: brief.province_sitreps.length },
  ];

  return (
    <BriefBody>
      <div className="uitest-brief-kicker">Operational snapshot</div>
      <div className="uitest-brief-snapshot">
        <div>
          <div className="uitest-brief-subsection">Areas of concern</div>
          {hotspots.length > 0 ? (
            <div className="uitest-brief-pill-row">
              {hotspots.map((hotspot, index) => (
                <span key={`${hotspotLabel(hotspot)}-${index}`} className={`uitest-brief-pill ${severityClass(hotspot.severity)}`}>
                  <MapPin size={10} />
                  {hotspotLabel(hotspot)}
                </span>
              ))}
            </div>
          ) : (
            <div className="uitest-brief-empty">No flagged hotspots in this run.</div>
          )}
        </div>
        <div className="uitest-brief-metric-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="uitest-brief-metric-card">
              <div className="uitest-brief-metric-label">{metric.label}</div>
              <div className="uitest-brief-metric-value">{metric.value}</div>
            </div>
          ))}
        </div>
      </div>
    </BriefBody>
  );
}

function BriefContextContent() {
  const { brief, isLoading, error, refetch } = useBriefCard();
  if (isLoading) return <BriefLoading />;
  if (error || !brief) return <BriefFailure onRetry={refetch} />;

  return (
    <BriefBody className="uitest-brief-body-scroll">
      <div className="uitest-brief-kicker">National context</div>
      <div className="uitest-brief-text uitest-brief-text-scroll">
        {brief.national_summary || brief.key_judgment || 'No national context available for this run.'}
      </div>
    </BriefBody>
  );
}

function BriefProvinceContent() {
  const { brief, isLoading, error, refetch } = useBriefCard();
  if (isLoading) return <BriefLoading />;
  if (error || !brief) return <BriefFailure onRetry={refetch} />;

  const provinces = [...brief.province_sitreps]
    .sort((a, b) => b.story_count - a.story_count)
    .slice(0, 5);

  return (
    <BriefBody>
      <div className="uitest-brief-kicker">Province watchlist</div>
      {provinces.length > 0 ? (
        <div className="uitest-brief-province-list">
          {provinces.map((province) => <ProvinceRow key={province.id} province={province} />)}
        </div>
      ) : (
        <div className="uitest-brief-empty">No province reports available for this run.</div>
      )}
    </BriefBody>
  );
}

export function BriefDataProvider({ children }: { children: ReactNode }) {
  const query = useLatestBrief();

  return (
    <BriefContext.Provider
      value={{
        brief: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error,
        refetch: () => { void query.refetch(); },
      }}
    >
      {children}
    </BriefContext.Provider>
  );
}

export function BriefSummaryWidget() {
  return (
    <Widget id="brief-summary-card" title="National Brief" icon={<FileText size={14} />}>
      <BriefSummaryContent />
    </Widget>
  );
}

export function BriefFindingsWidget() {
  return (
    <Widget id="brief-findings-card" title="Key Briefing" icon={<ShieldAlert size={14} />}>
      <BriefFindingsContent />
    </Widget>
  );
}

export function BriefStatusWidget() {
  return (
    <Widget id="brief-status-card" title="Brief Status" icon={<Clock3 size={14} />}>
      <BriefStatusContent />
    </Widget>
  );
}

export function BriefSnapshotWidget() {
  return (
    <Widget id="brief-snapshot-card" title="Operational Snapshot" icon={<AlertTriangle size={14} />}>
      <BriefSnapshotContent />
    </Widget>
  );
}

export function BriefContextWidget() {
  return (
    <Widget id="brief-context-card" title="National Context" icon={<Layers3 size={14} />}>
      <BriefContextContent />
    </Widget>
  );
}

export function BriefProvinceWidget() {
  return (
    <Widget id="brief-provinces-card" title="Province Watchlist" icon={<MapPin size={14} />}>
      <BriefProvinceContent />
    </Widget>
  );
}
