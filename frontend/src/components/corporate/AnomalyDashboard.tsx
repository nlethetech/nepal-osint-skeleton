import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Tag,
  Intent,
  Card,
  Spinner,
  NonIdealState,
  Icon,
  Collapse,
  Button,
} from '@blueprintjs/core';
import {
  getAnomalySummary,
  getSameDayClusters,
  getRapidDirectorChanges,
  getNonFilerClusters,
  getPANAnomalies,
  type AnomalySummary,
  type AnomalySeverity,
  type SameDayCluster,
  type RapidDirectorChange,
  type NonFilerCluster,
  type PANAnomaly,
} from '../../api/anomalies';
import { InlinePagination } from './InlinePagination';

// ── Constants ──────────────────────────────────────────────────

const SEVERITY_INTENT: Record<AnomalySeverity, Intent> = {
  CRITICAL: Intent.DANGER,
  HIGH: Intent.WARNING,
  MEDIUM: Intent.PRIMARY,
  LOW: Intent.NONE,
};

const SEVERITY_BORDER_CLASS: Record<AnomalySeverity, string> = {
  CRITICAL: 'border-l-severity-critical',
  HIGH: 'border-l-severity-high',
  MEDIUM: 'border-l-bp-primary',
  LOW: 'border-l-bp-text-muted',
};

type TabId = 'same_day' | 'rapid_changes' | 'non_filer' | 'pan';

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
  summaryKey: keyof AnomalySummary;
}

const TABS: TabDef[] = [
  { id: 'same_day', label: 'Same-Day Clusters', icon: 'calendar', summaryKey: 'same_day_clusters' },
  { id: 'rapid_changes', label: 'Rapid Director Changes', icon: 'swap-horizontal', summaryKey: 'rapid_director_changes' },
  { id: 'non_filer', label: 'Non-Filer Clusters', icon: 'ban-circle', summaryKey: 'non_filer_clusters' },
  { id: 'pan', label: 'PAN Anomalies', icon: 'id-number', summaryKey: 'pan_anomalies' },
];

// ── Props ──────────────────────────────────────────────────────

interface AnomalyDashboardProps {
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}

// ── Component ──────────────────────────────────────────────────

export function AnomalyDashboard({ onCompanyClick, onPANClick }: AnomalyDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('same_day');

  // Summary query (fast, for badge counts)
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useQuery<AnomalySummary>({
    queryKey: ['anomaly-summary'],
    queryFn: getAnomalySummary,
  });

  return (
    <div className="bp6-dark flex flex-col gap-4 p-6 bg-bp-bg text-bp-text" style={{ minHeight: '400px' }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon icon="diagnosis" size={20} intent={Intent.DANGER} />
          <h2 className="m-0 text-lg font-semibold text-bp-text">
            Anomaly Detection Engine
          </h2>
          {summary && (
            <Tag minimal round className="bg-bp-surface text-bp-text-muted">
              {summary.total} anomalies detected
            </Tag>
          )}
        </div>
      </div>

      {/* ── Summary Bar ── */}
      <div className="flex items-center gap-4 rounded px-4 py-3 bg-bp-card border border-bp-border">
        {summaryLoading ? (
          <Spinner size={20} intent={Intent.PRIMARY} />
        ) : summaryError ? (
          <span className="text-bp-text-muted">Failed to load summary</span>
        ) : summary ? (
          <>
            <SummaryBadge
              icon="calendar"
              label="Same-Day Clusters"
              count={summary.same_day_clusters}
              intent={Intent.DANGER}
            />
            <SummaryBadge
              icon="swap-horizontal"
              label="Rapid Director Changes"
              count={summary.rapid_director_changes}
              intent={Intent.WARNING}
            />
            <SummaryBadge
              icon="ban-circle"
              label="Non-Filer Clusters"
              count={summary.non_filer_clusters}
              intent={Intent.PRIMARY}
            />
            <SummaryBadge
              icon="id-number"
              label="PAN Anomalies"
              count={summary.pan_anomalies}
              intent={Intent.WARNING}
            />
          </>
        ) : null}
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex items-center gap-1 border-b border-bp-border">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            minimal
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-t ${activeTab === tab.id ? 'bg-bp-card text-bp-text' : 'text-bp-text-muted'}`}
            style={{
              borderBottom: activeTab === tab.id ? '2px solid #2D72D2' : '2px solid transparent',
              borderRadius: '4px 4px 0 0',
            }}
          >
            <Icon icon={tab.icon as any} size={14} />
            {tab.label}
            {summary && (
              <Tag
                minimal
                round
                className={`bg-bp-surface text-xs ${activeTab === tab.id ? 'text-bp-text' : 'text-bp-text-muted'}`}
              >
                {summary[tab.summaryKey]}
              </Tag>
            )}
          </Button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div style={{ minHeight: '300px' }}>
        {activeTab === 'same_day' && (
          <SameDayClustersTab onCompanyClick={onCompanyClick} />
        )}
        {activeTab === 'rapid_changes' && (
          <RapidDirectorChangesTab onCompanyClick={onCompanyClick} />
        )}
        {activeTab === 'non_filer' && (
          <NonFilerClustersTab onCompanyClick={onCompanyClick} />
        )}
        {activeTab === 'pan' && (
          <PANAnomaliesTab onCompanyClick={onCompanyClick} onPANClick={onPANClick} />
        )}
      </div>
    </div>
  );
}

// ── Summary Badge ──────────────────────────────────────────────

function SummaryBadge({ icon, label, count, intent }: {
  icon: string;
  label: string;
  count: number;
  intent: Intent;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded px-3 py-2 bg-bp-bg">
      <Icon icon={icon as any} size={16} intent={intent} />
      <div className="flex flex-col">
        <span className="text-xs text-bp-text-muted">{label}</span>
        <span className="text-xl font-bold text-bp-text">{count}</span>
      </div>
    </div>
  );
}

// ── Severity Indicator ─────────────────────────────────────────

function SeverityTag({ severity }: { severity: AnomalySeverity }) {
  return (
    <Tag intent={SEVERITY_INTENT[severity]} className="font-semibold min-w-[72px] text-center">
      {severity}
    </Tag>
  );
}

// ── Tab 1: Same-Day Registration Clusters ──────────────────────

function SameDayClustersTab({ onCompanyClick }: { onCompanyClick?: (id: string) => void }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const { data: clusters, isLoading, isError, error } = useQuery<SameDayCluster[]>({
    queryKey: ['anomaly-same-day-clusters'],
    queryFn: () => getSameDayClusters(),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} />;
  if (!clusters || clusters.length === 0) return <EmptyState message="No same-day registration clusters detected." />;

  return (
    <div className="flex flex-col gap-3">
      {clusters.map((cluster, idx) => (
        <Card
          key={`${cluster.registration_date}-${cluster.address}-${idx}`}
          interactive={false}
          className={`bg-bp-card border border-bp-border border-l-[3px] ${SEVERITY_BORDER_CLASS[cluster.severity]} p-0`}
        >
          {/* Cluster header */}
          <div
            className="flex cursor-pointer items-center gap-4 px-4 py-3"
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setExpandedIdx(expandedIdx === idx ? null : idx);
            }}
          >
            <SeverityTag severity={cluster.severity} />
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-bold text-bp-text">
                {cluster.company_count} companies registered on {cluster.registration_date}
              </span>
              <span className="text-xs text-bp-text-secondary">
                {cluster.address}
              </span>
            </div>
            <Tag minimal round className="bg-bp-surface text-bp-text-muted">
              {cluster.company_count} companies
            </Tag>
            <Icon
              icon={expandedIdx === idx ? 'chevron-up' : 'chevron-down'}
              size={16}
              className="text-bp-text-muted"
            />
          </div>

          {/* Expanded company list */}
          <Collapse isOpen={expandedIdx === idx}>
            <div className="flex flex-col gap-1 px-4 pb-3 border-t border-bp-border">
              <div className="grid gap-2 pt-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {cluster.companies.map((company) => (
                  <div
                    key={company.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 transition-colors hover:opacity-80 bg-bp-bg border border-bp-border"
                    onClick={() => onCompanyClick?.(company.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onCompanyClick?.(company.id);
                    }}
                  >
                    <Icon icon="office" size={14} className="text-bp-text-muted" />
                    <div className="flex flex-1 flex-col">
                      <span className="text-xs font-medium text-bp-text">
                        {company.name_english}
                      </span>
                      <span className="text-xs text-bp-text-muted">
                        Reg #{company.registration_number}
                        {company.pan && ` | PAN: ${company.pan}`}
                      </span>
                    </div>
                    {company.company_type_category && (
                      <Tag minimal className="text-bp-text-muted text-[10px]">
                        {company.company_type_category}
                      </Tag>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Collapse>
        </Card>
      ))}
    </div>
  );
}

// ── Tab 2: Rapid Director Changes ──────────────────────────────

function RapidDirectorChangesTab({ onCompanyClick }: { onCompanyClick?: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: changes, isLoading, isError, error } = useQuery<RapidDirectorChange[]>({
    queryKey: ['anomaly-rapid-director-changes'],
    queryFn: () => getRapidDirectorChanges(),
  });

  const total = changes?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleChanges = changes?.slice((currentPage - 1) * pageSize, currentPage * pageSize) ?? [];

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} />;
  if (!changes || changes.length === 0) return <EmptyState message="No rapid director changes detected." />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col border border-bp-border rounded overflow-hidden">
        {/* Table header */}
        <div
          className="grid items-center gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wider bg-bp-card text-bp-text-muted border-b border-bp-border"
          style={{ gridTemplateColumns: '80px 1fr 1fr 120px 120px 80px' }}
        >
          <span>Severity</span>
          <span>Company</span>
          <span>Director</span>
          <span>Appointed</span>
          <span>Resigned</span>
          <span>Duration</span>
        </div>

        {/* Table rows */}
        {visibleChanges.map((change, idx) => (
          <div
            key={`${change.company_id}-${change.director_name}-${idx}`}
            className={`grid items-center gap-3 px-4 py-2 transition-colors border-b border-bp-border ${idx % 2 === 0 ? 'bg-bp-bg' : 'bg-bp-card'}`}
            style={{ gridTemplateColumns: '80px 1fr 1fr 120px 120px 80px' }}
          >
            <SeverityTag severity={change.severity} />
            <span
              className="cursor-pointer truncate text-sm font-medium hover:underline text-bp-text"
              onClick={() => onCompanyClick?.(change.company_id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onCompanyClick?.(change.company_id);
              }}
              title={change.company_name}
            >
              {change.company_name}
            </span>
            <div className="flex flex-col">
              <span className="truncate text-sm text-bp-text">{change.director_name}</span>
              {change.director_role && (
                <span className="text-xs text-bp-text-muted">{change.director_role}</span>
              )}
            </div>
            <span className="text-xs text-bp-text-secondary">
              {change.appointed_date || '-'}
            </span>
            <span className="text-xs text-bp-text-secondary">
              {change.resigned_date || '-'}
            </span>
            <Tag
              intent={change.duration_days <= 7 ? Intent.DANGER : change.duration_days <= 30 ? Intent.WARNING : Intent.NONE}
              minimal
              round
            >
              {change.duration_days}d
            </Tag>
          </div>
        ))}
      </div>
      <InlinePagination
        page={currentPage}
        pageSize={pageSize}
        total={changes.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[25, 50, 100]}
      />
    </div>
  );
}

// ── Tab 3: Non-Filer Clusters ──────────────────────────────────

function NonFilerClustersTab({ onCompanyClick }: { onCompanyClick?: (id: string) => void }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const { data: clusters, isLoading, isError, error } = useQuery<NonFilerCluster[]>({
    queryKey: ['anomaly-non-filer-clusters'],
    queryFn: () => getNonFilerClusters(),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} />;
  if (!clusters || clusters.length === 0) return <EmptyState message="No non-filer clusters detected." />;

  return (
    <div className="flex flex-col gap-3">
      {clusters.map((cluster, idx) => (
        <Card
          key={`${cluster.address}-${idx}`}
          interactive={false}
          className={`bg-bp-card border border-bp-border border-l-[3px] ${SEVERITY_BORDER_CLASS[cluster.severity]} p-0`}
        >
          {/* Cluster header */}
          <div
            className="flex cursor-pointer items-center gap-4 px-4 py-3"
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setExpandedIdx(expandedIdx === idx ? null : idx);
            }}
          >
            <SeverityTag severity={cluster.severity} />
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-bold text-bp-text">
                {cluster.address}
              </span>
              <span className="text-xs text-bp-text-secondary">
                {cluster.non_filer_count} of {cluster.total_companies} companies are non-filers
              </span>
            </div>

            {/* Stats bar */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="bg-bp-bg rounded-sm overflow-hidden" style={{ width: '100px', height: '6px' }}>
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${cluster.non_filer_pct}%`,
                      backgroundColor: cluster.non_filer_pct >= 90 ? '#CD4246' : cluster.non_filer_pct >= 75 ? '#C87619' : '#2D72D2',
                    }}
                  />
                </div>
                <span className="text-xs font-bold text-bp-text" style={{ minWidth: '40px', textAlign: 'right' }}>
                  {cluster.non_filer_pct.toFixed(0)}%
                </span>
              </div>
              <Icon
                icon={expandedIdx === idx ? 'chevron-up' : 'chevron-down'}
                size={16}
                className="text-bp-text-muted"
              />
            </div>
          </div>

          {/* Expanded company list */}
          <Collapse isOpen={expandedIdx === idx}>
            <div className="flex flex-col gap-1 px-4 pb-3 border-t border-bp-border">
              <div className="flex flex-col gap-1 pt-2">
                {cluster.companies.map((company) => (
                  <div
                    key={company.id}
                    className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 transition-colors hover:opacity-80 bg-bp-bg border border-bp-border"
                    onClick={() => onCompanyClick?.(company.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onCompanyClick?.(company.id);
                    }}
                  >
                    <Icon
                      icon={company.is_non_filer ? 'ban-circle' : 'tick-circle'}
                      size={14}
                      intent={company.is_non_filer ? Intent.DANGER : Intent.SUCCESS}
                    />
                    <span className="flex-1 text-xs font-medium text-bp-text">
                      {company.name_english}
                    </span>
                    {company.pan && (
                      <Tag minimal className="text-bp-text-muted text-[10px]">
                        PAN: {company.pan}
                      </Tag>
                    )}
                    <Tag
                      intent={company.is_non_filer ? Intent.DANGER : Intent.SUCCESS}
                      minimal
                    >
                      {company.is_non_filer ? 'Non-Filer' : 'Filer'}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          </Collapse>
        </Card>
      ))}
    </div>
  );
}

// ── Tab 4: PAN Anomalies ───────────────────────────────────────

function PANAnomaliesTab({ onCompanyClick, onPANClick }: {
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}) {
  const { data: anomalies, isLoading, isError, error } = useQuery<PANAnomaly[]>({
    queryKey: ['anomaly-pan-anomalies'],
    queryFn: () => getPANAnomalies(),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} />;
  if (!anomalies || anomalies.length === 0) return <EmptyState message="No PAN anomalies detected." />;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
      {anomalies.map((anomaly, idx) => (
        <Card
          key={`${anomaly.pan}-${idx}`}
          interactive={false}
          className={`bg-bp-card border border-bp-border border-l-[3px] ${SEVERITY_BORDER_CLASS[anomaly.severity]} p-4`}
        >
          {/* PAN header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SeverityTag severity={anomaly.severity} />
              <Tag
                intent={Intent.PRIMARY}
                interactive
                onClick={() => onPANClick?.(anomaly.pan)}
                className="cursor-pointer font-semibold"
              >
                PAN: {anomaly.pan}
              </Tag>
            </div>
            <Tag minimal round className="bg-bp-surface text-bp-text-muted">
              {anomaly.company_count} companies
            </Tag>
          </div>

          <p className="text-xs text-bp-text-secondary mb-3" style={{ margin: '0 0 12px 0' }}>
            {anomaly.description}
          </p>

          {/* Company list */}
          <div className="flex flex-col gap-1">
            {anomaly.companies.slice(0, 8).map((company) => (
              <div
                key={company.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:opacity-80 bg-bp-bg"
                onClick={() => onCompanyClick?.(company.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onCompanyClick?.(company.id);
                }}
              >
                <Icon icon="office" size={12} className="text-bp-text-muted" />
                <span className="flex-1 truncate text-xs text-bp-text">
                  {company.name_english}
                </span>
                <span className="text-xs text-bp-text-muted">
                  #{company.registration_number}
                </span>
              </div>
            ))}
            {anomaly.companies.length > 8 && (
              <Button
                minimal
                small
                text={`+${anomaly.companies.length - 8} more`}
                intent={Intent.PRIMARY}
                onClick={() => onPANClick?.(anomaly.pan)}
                className="self-start mt-1"
              />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Shared States ──────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-16">
      <Spinner intent={Intent.PRIMARY} size={48} />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-8">
      <NonIdealState
        icon="error"
        title="Failed to load anomaly data"
        description={message}
      />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-8">
      <NonIdealState
        icon="tick-circle"
        title="No anomalies"
        description={message}
      />
    </div>
  );
}
