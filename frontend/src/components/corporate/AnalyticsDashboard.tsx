import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Tag,
  Intent,
  Spinner,
  HTMLTable,
  Icon,
  Collapse,
  Button,
  NonIdealState,
} from '@blueprintjs/core';
import {
  getBeneficialOwners,
  getShellScores,
  getTaxCompliance,
  getRegistrationPatterns,
  type BeneficialOwner,
  type ShellCompanyScore,
  type TaxComplianceStats,
  type RegistrationPatterns,
} from '../../api/corporate';

// ── Props ──────────────────────────────────────────────────────

interface AnalyticsDashboardProps {
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────

function LoadingPane() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 280 }}>
      <Spinner intent={Intent.PRIMARY} size={36} />
    </div>
  );
}

function ErrorPane({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 280 }}>
      <NonIdealState
        icon="error"
        title="Error"
        description={message}
      />
    </div>
  );
}

function PanelHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon icon={icon as any} size={16} className="text-bp-primary" />
        <span className="text-sm font-semibold text-bp-text">{title}</span>
      </div>
      <span className="text-xs text-bp-text-muted">{subtitle}</span>
    </div>
  );
}

// ── Panel: Beneficial Ownership ───────────────────────────────

function BeneficialOwnershipPanel({
  onCompanyClick,
}: {
  onCompanyClick?: (id: string) => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-beneficial-owners'],
    queryFn: () => getBeneficialOwners(3, 50),
    staleTime: 5 * 60 * 1000,
  });

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (isLoading) return <LoadingPane />;
  if (isError || !data) return <ErrorPane message="Failed to load beneficial owners" />;

  const owners: BeneficialOwner[] = data.owners;

  if (owners.length === 0) {
    return (
      <NonIdealState
        icon="person"
        title="No Beneficial Owners Found"
        description="No persons found directing 3+ companies"
      />
    );
  }

  return (
    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
      <HTMLTable
        bordered
        compact
        striped
        interactive
        className="w-full text-xs"
      >
        <thead>
          <tr>
            <th className="text-bp-text-muted px-2 py-1.5">Name</th>
            <th className="text-bp-text-muted px-2 py-1.5">Citizenship #</th>
            <th className="text-bp-text-muted px-2 py-1.5 text-center">Companies</th>
            <th className="text-bp-text-muted px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {owners.map((owner, idx) => (
            <BeneficialOwnerRow
              key={`${owner.name}-${idx}`}
              owner={owner}
              isExpanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              onCompanyClick={onCompanyClick}
            />
          ))}
        </tbody>
      </HTMLTable>
      <div className="px-2 py-1.5 text-xs text-bp-text-muted">
        Showing {owners.length} of {data.total} potential beneficial owners
      </div>
    </div>
  );
}

function BeneficialOwnerRow({
  owner,
  isExpanded,
  onToggle,
  onCompanyClick,
}: {
  owner: BeneficialOwner;
  isExpanded: boolean;
  onToggle: () => void;
  onCompanyClick?: (id: string) => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer"
        onClick={onToggle}
      >
        <td className="text-bp-text px-2 py-1.5">
          {owner.name}
          {owner.match_type === 'name_en' && (
            <Tag minimal intent={Intent.WARNING} className="ml-1.5 text-[10px]">name match</Tag>
          )}
        </td>
        <td className="text-bp-text-secondary px-2 py-1.5 font-mono text-xs">
          {owner.citizenship_no || '--'}
        </td>
        <td className="text-center px-2 py-1.5">
          <Tag
            intent={owner.total_companies >= 5 ? Intent.DANGER : Intent.PRIMARY}
            round
            minimal
          >
            {owner.total_companies}
          </Tag>
        </td>
        <td className="px-2 py-1.5">
          <Icon
            icon={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            className="text-bp-text-muted"
          />
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={4} className="!p-0 !border-none">
            <Collapse isOpen={true}>
              <div className="px-4 py-2 bg-bp-surface">
                {owner.companies.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex items-center gap-2 py-1 border-b border-bp-border text-xs"
                  >
                    <span
                      className="text-bp-primary cursor-pointer"
                      style={{ cursor: onCompanyClick ? 'pointer' : 'default' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompanyClick?.(comp.id);
                      }}
                    >
                      {comp.name_english}
                    </span>
                    {comp.role && (
                      <Tag minimal className="text-[10px]">{comp.role}</Tag>
                    )}
                    {comp.district && (
                      <span className="text-bp-text-muted text-[10px] ml-auto">
                        {comp.district}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Collapse>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Panel: Shell Company Risk ─────────────────────────────────

function ShellRiskPanel({
  onCompanyClick,
}: {
  onCompanyClick?: (id: string) => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-shell-scores'],
    queryFn: () => getShellScores(100),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <LoadingPane />;
  if (isError || !data) return <ErrorPane message="Failed to load shell company scores" />;

  const companies: ShellCompanyScore[] = data.companies;

  if (companies.length === 0) {
    return (
      <NonIdealState
        icon="shield"
        title="No Shell Company Signals"
        description="No companies scored above threshold"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" style={{ maxHeight: 380, overflowY: 'auto' }}>
      {companies.slice(0, 30).map((comp) => {
        const scoreColorClass = comp.score >= 75 ? 'text-severity-critical' : comp.score >= 50 ? 'text-severity-high' : 'text-bp-primary';
        const scoreBorderClass = comp.score >= 75 ? 'border-severity-critical' : comp.score >= 50 ? 'border-severity-high' : 'border-bp-primary';
        const scoreBg = comp.score >= 75 ? 'bg-severity-critical/10' : comp.score >= 50 ? 'bg-severity-high/10' : 'bg-bp-primary/10';

        return (
          <div
            key={comp.id}
            className={`${scoreBg} border border-bp-border rounded-md px-3 py-2.5 flex items-start gap-3`}
          >
            {/* Score circle */}
            <div
              className={`bg-bp-card ${scoreBorderClass} border-2 rounded-full flex items-center justify-center shrink-0`}
              style={{ minWidth: 48, height: 48 }}
            >
              <span className={`text-lg font-bold ${scoreColorClass}`}>
                {comp.score}
              </span>
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-semibold text-bp-text mb-1 whitespace-nowrap overflow-hidden text-ellipsis"
                style={{ cursor: onCompanyClick ? 'pointer' : 'default' }}
                onClick={() => onCompanyClick?.(comp.id)}
              >
                {comp.name_english}
              </div>

              {comp.district && (
                <span className="text-[10px] text-bp-text-muted mb-1 block">
                  {comp.district}
                  {comp.pan && ` | PAN: ${comp.pan}`}
                </span>
              )}

              <div className="flex flex-wrap gap-1 mt-1">
                {comp.factors.map((factor, i) => {
                  const intent: Intent =
                    factor.includes('Non-filer') ? Intent.DANGER :
                    factor.includes('Address') ? Intent.WARNING :
                    factor.includes('Same-day') ? Intent.WARNING :
                    factor.includes('Director') ? Intent.PRIMARY :
                    Intent.NONE;
                  return (
                    <Tag key={i} minimal intent={intent} className="text-[10px]">
                      {factor}
                    </Tag>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      <div className="py-1.5 text-xs text-bp-text-muted text-center">
        {data.total_scored} companies scored
      </div>
    </div>
  );
}

// ── Panel: Tax Compliance ─────────────────────────────────────

function TaxCompliancePanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-tax-compliance'],
    queryFn: getTaxCompliance,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <LoadingPane />;
  if (isError || !data) return <ErrorPane message="Failed to load tax compliance stats" />;

  const stats: TaxComplianceStats = data;
  const total = stats.active_filers + stats.non_filers + stats.cancelled + stats.unknown;

  // Donut chart data — keep raw hex for conic gradient (CSS requirement)
  const segments = [
    { label: 'Active', value: stats.active_filers, color: '#238551', twClass: 'bg-bp-success' },
    { label: 'Non-filer', value: stats.non_filers, color: '#CD4246', twClass: 'bg-bp-danger' },
    { label: 'Cancelled', value: stats.cancelled, color: '#C87619', twClass: 'bg-bp-warning' },
    { label: 'Unknown', value: stats.unknown, color: '#738091', twClass: 'bg-bp-text-muted' },
  ].filter(s => s.value > 0);

  // Build conic gradient for donut
  let gradientParts: string[] = [];
  let cumPct = 0;
  for (const seg of segments) {
    const pct = total > 0 ? (seg.value / total) * 100 : 0;
    gradientParts.push(`${seg.color} ${cumPct}% ${cumPct + pct}%`);
    cumPct += pct;
  }
  const gradient = `conic-gradient(${gradientParts.join(', ')})`;

  return (
    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
      {/* Donut + legend row */}
      <div className="flex items-start gap-4 mb-4">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
          <div
            className="rounded-full"
            style={{ width: 120, height: 120, background: gradient }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bp-card flex items-center justify-center flex-col"
            style={{ width: 60, height: 60 }}
          >
            <span className="text-base font-bold text-bp-text">{total}</span>
            <span className="text-[9px] text-bp-text-muted">PANs</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-1.5">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center gap-2">
              <div className="shrink-0 rounded-sm" style={{ width: 10, height: 10, backgroundColor: seg.color }} />
              <span className="text-xs text-bp-text">{seg.label}</span>
              <span className="text-xs text-bp-text-muted ml-1">
                {seg.value.toLocaleString()}
                <span className="text-[10px] ml-0.5">
                  ({total > 0 ? Math.round((seg.value / total) * 100) : 0}%)
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* District breakdown table */}
      {stats.by_district.length > 0 && (
        <>
          <div className="text-xs font-semibold text-bp-text-secondary mb-1.5">
            Top Districts by IRD Coverage
          </div>
          <HTMLTable bordered compact striped className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-bp-text-muted px-1.5 py-1">District</th>
                <th className="text-bp-text-muted px-1.5 py-1 text-right">Total</th>
                <th className="text-bp-text-muted px-1.5 py-1 text-right">Non-filers</th>
                <th className="text-bp-text-muted px-1.5 py-1 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.by_district.slice(0, 10).map((d) => {
                const rate = d.total > 0 ? Math.round((d.nonfiler_count / d.total) * 100) : 0;
                return (
                  <tr key={d.district}>
                    <td className="text-bp-text px-1.5 py-1">{d.district}</td>
                    <td className="text-bp-text-secondary px-1.5 py-1 text-right">{d.total}</td>
                    <td className={`px-1.5 py-1 text-right ${d.nonfiler_count > 0 ? 'text-severity-critical' : 'text-bp-text-secondary'}`}>
                      {d.nonfiler_count}
                    </td>
                    <td className="px-1.5 py-1 text-right">
                      <Tag
                        minimal
                        intent={rate >= 50 ? Intent.DANGER : rate >= 25 ? Intent.WARNING : Intent.SUCCESS}
                        className="text-[10px]"
                      >
                        {rate}%
                      </Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </HTMLTable>
        </>
      )}
    </div>
  );
}

// ── Panel: Registration Patterns ──────────────────────────────

function RegistrationPatternsPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-registration-patterns'],
    queryFn: getRegistrationPatterns,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <LoadingPane />;
  if (isError || !data) return <ErrorPane message="Failed to load registration patterns" />;

  const patterns: RegistrationPatterns = data;
  const yearly = patterns.yearly;
  const threshold = patterns.anomaly_threshold;

  if (yearly.length === 0) {
    return (
      <NonIdealState
        icon="timeline-bar-chart"
        title="No Registration Data"
        description="No registration date data available"
      />
    );
  }

  const maxCount = Math.max(...yearly.map((y) => y.count));

  return (
    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
      {/* Bar chart title */}
      <div className="text-xs font-semibold text-bp-text-secondary mb-2">
        Registrations by Year
        {threshold > 0 && (
          <span className="text-[10px] text-bp-text-muted ml-2">
            Anomaly threshold: {Math.round(threshold)}
          </span>
        )}
      </div>

      {/* CSS bar chart */}
      <div className="flex flex-col gap-[3px]">
        {yearly.map((y) => {
          const pct = maxCount > 0 ? (y.count / maxCount) * 100 : 0;
          const isAnomaly = threshold > 0 && y.count > threshold;

          return (
            <div
              key={y.year}
              className="flex items-center gap-2 text-xs"
            >
              <span className="text-bp-text-muted text-right shrink-0" style={{ width: 40 }}>
                {y.year}
              </span>
              <div className="flex-1 bg-bp-surface rounded-sm overflow-hidden relative" style={{ height: 16 }}>
                <div
                  className="h-full rounded-sm transition-[width] duration-300 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isAnomaly ? '#CD4246' : '#2D72D2',
                    minWidth: y.count > 0 ? 2 : 0,
                  }}
                />
                {isAnomaly && (
                  <Icon
                    icon="warning-sign"
                    size={10}
                    className="absolute right-1 top-[3px] text-severity-high"
                  />
                )}
              </div>
              <span
                className={`shrink-0 text-right text-[10px] ${isAnomaly ? 'text-severity-critical font-semibold' : 'text-bp-text-secondary'}`}
                style={{ width: 50 }}
              >
                {y.count.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Peak dates */}
      {patterns.peak_dates.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-bp-text-secondary mb-1.5">
            Peak Registration Dates
          </div>
          <div className="flex flex-wrap gap-1">
            {patterns.peak_dates.slice(0, 10).map((pd, i) => (
              <Tag
                key={i}
                minimal
                intent={i < 3 ? Intent.DANGER : Intent.NONE}
                className="text-[10px]"
              >
                {pd.date}: {pd.count}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* Same-day clusters */}
      {patterns.same_day_clusters.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-bp-text-secondary mb-1.5">
            Same-Day Registration Clusters
          </div>
          <HTMLTable bordered compact striped className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-bp-text-muted px-1.5 py-1">Address</th>
                <th className="text-bp-text-muted px-1.5 py-1">Date</th>
                <th className="text-bp-text-muted px-1.5 py-1 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {patterns.same_day_clusters.slice(0, 10).map((cl, i) => (
                <tr key={i}>
                  <td className="text-bp-text px-1.5 py-1 max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis">
                    {cl.address}
                  </td>
                  <td className="text-bp-text-secondary px-1.5 py-1 font-mono text-[10px]">
                    {cl.date}
                  </td>
                  <td className="text-right px-1.5 py-1">
                    <Tag minimal intent={cl.count >= 10 ? Intent.DANGER : Intent.WARNING} className="text-[10px]">
                      {cl.count}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────

export function AnalyticsDashboard({ onCompanyClick, onPANClick }: AnalyticsDashboardProps) {
  return (
    <div className="bp6-dark bg-bp-bg min-h-full p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Icon icon="chart" size={20} className="text-bp-primary" />
        <span className="text-lg font-bold text-bp-text">Advanced Corporate Analytics</span>
        <Tag minimal intent={Intent.PRIMARY} className="text-[10px]">NARADA v6</Tag>
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top-Left: Beneficial Ownership */}
        <Card className="bg-bp-card border border-bp-border p-4 overflow-hidden">
          <PanelHeader
            title="Beneficial Ownership"
            subtitle="Persons directing 3+ companies"
            icon="people"
          />
          <BeneficialOwnershipPanel onCompanyClick={onCompanyClick} />
        </Card>

        {/* Top-Right: Shell Company Risk */}
        <Card className="bg-bp-card border border-bp-border p-4 overflow-hidden">
          <PanelHeader
            title="Shell Company Risk"
            subtitle="Companies scored by risk signals"
            icon="shield"
          />
          <ShellRiskPanel onCompanyClick={onCompanyClick} />
        </Card>

        {/* Bottom-Left: Tax Compliance */}
        <Card className="bg-bp-card border border-bp-border p-4 overflow-hidden">
          <PanelHeader
            title="Tax Compliance"
            subtitle="IRD filing status overview"
            icon="bank-account"
          />
          <TaxCompliancePanel />
        </Card>

        {/* Bottom-Right: Registration Patterns */}
        <Card className="bg-bp-card border border-bp-border p-4 overflow-hidden">
          <PanelHeader
            title="Registration Patterns"
            subtitle="Temporal analysis of company registrations"
            icon="timeline-bar-chart"
          />
          <RegistrationPatternsPanel />
        </Card>
      </div>
    </div>
  );
}
