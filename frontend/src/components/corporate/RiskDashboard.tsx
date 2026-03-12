import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Tag,
  Intent,
  Card,
  Spinner,
  NonIdealState,
  Button,
  ButtonGroup,
  Icon,
} from '@blueprintjs/core';
import { getRiskFlags, type RiskFlag } from '../../api/corporate';
import { SeverityBadge, NoPanBadge } from '../ui/narada-ui';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface RiskDashboardProps {
  onPANClick?: (pan: string) => void;
  onCompanyClick?: (id: string) => void;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const SEVERITY_LEVELS: Array<Severity | 'ALL'> = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const FILTER_INTENT: Record<string, Intent> = {
  ALL: Intent.NONE,
  CRITICAL: Intent.DANGER,
  HIGH: Intent.WARNING,
  MEDIUM: Intent.PRIMARY,
  LOW: Intent.NONE,
};

export function RiskDashboard({ onPANClick, onCompanyClick }: RiskDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<Severity | 'ALL'>('ALL');

  const { data: riskFlags, isLoading, isError, error } = useQuery<RiskFlag[]>({
    queryKey: ['corporate-risk-flags'],
    queryFn: () => getRiskFlags(),
  });

  const severityCounts = useMemo(() => {
    if (!riskFlags) return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    return riskFlags.reduce(
      (acc, flag) => {
        acc[flag.severity] = (acc[flag.severity] || 0) + 1;
        return acc;
      },
      { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Severity, number>,
    );
  }, [riskFlags]);

  const filteredAndSorted = useMemo(() => {
    if (!riskFlags) return [];
    const filtered =
      activeFilter === 'ALL'
        ? riskFlags
        : riskFlags.filter((f) => f.severity === activeFilter);
    return [...filtered].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }, [riskFlags, activeFilter]);

  if (isLoading) {
    return (
      <div className="bp6-dark flex items-center justify-center p-16 bg-bp-bg">
        <Spinner intent={Intent.PRIMARY} size={48} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bp6-dark p-8 bg-bp-bg">
        <NonIdealState
          icon="error"
          title="Failed to load risk flags"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
        />
      </div>
    );
  }

  if (!riskFlags || riskFlags.length === 0) {
    return (
      <div className="bp6-dark p-8 bg-bp-bg">
        <NonIdealState
          icon="tick-circle"
          title="No risk flags"
          description="No corporate risk flags have been detected."
        />
      </div>
    );
  }

  return (
    <div className="bp6-dark flex flex-col gap-4 p-6 bg-bp-bg text-bp-text">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon icon="warning-sign" size={20} intent={Intent.WARNING} />
          <h2 className="m-0 text-lg font-semibold text-bp-text">
            Corporate Risk Dashboard
          </h2>
          <Tag minimal round className="bg-bp-surface text-bp-text-secondary">
            {riskFlags.length} total
          </Tag>
        </div>

        {/* Severity count tags */}
        <div className="flex items-center gap-2">
          <Tag intent={Intent.DANGER} round minimal>
            {severityCounts.CRITICAL} Critical
          </Tag>
          <Tag intent={Intent.WARNING} round minimal>
            {severityCounts.HIGH} High
          </Tag>
          <Tag intent={Intent.PRIMARY} round minimal>
            {severityCounts.MEDIUM} Medium
          </Tag>
          <Tag round minimal>
            {severityCounts.LOW} Low
          </Tag>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-3 border-b border-bp-border pb-3">
        <ButtonGroup>
          {SEVERITY_LEVELS.map((level) => (
            <Button
              key={level}
              text={level}
              intent={activeFilter === level ? FILTER_INTENT[level] : Intent.NONE}
              active={activeFilter === level}
              onClick={() => setActiveFilter(level)}
              small
            />
          ))}
        </ButtonGroup>
        <span className="text-sm text-bp-text-secondary">
          Showing {filteredAndSorted.length} of {riskFlags.length} flags
        </span>
      </div>

      {/* Risk flag cards */}
      <div className="flex flex-col gap-3">
        {filteredAndSorted.length === 0 ? (
          <NonIdealState
            icon="filter-remove"
            title="No matching flags"
            description={`No risk flags with ${activeFilter} severity.`}
          />
        ) : (
          filteredAndSorted.map((flag, idx) => (
            <Card
              key={`${flag.company_id}-${flag.flag_type}-${idx}`}
              interactive={false}
              className={`bg-bp-card border border-bp-border border-l-[3px] px-4 py-3 ${
                flag.severity === 'CRITICAL'
                  ? 'border-l-severity-critical'
                  : flag.severity === 'HIGH'
                    ? 'border-l-severity-high'
                    : flag.severity === 'MEDIUM'
                      ? 'border-l-severity-medium'
                      : 'border-l-severity-low'
              }`}
            >
              <div className="flex items-center gap-4">
                {/* Left: severity tag */}
                <div className="flex-shrink-0 min-w-[80px]">
                  <SeverityBadge severity={flag.severity} minimal={false} className="text-sm font-semibold" />
                </div>

                {/* Center: company info */}
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="cursor-pointer text-base font-bold text-bp-text"
                      onClick={() => onCompanyClick?.(flag.company_id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          onCompanyClick?.(flag.company_id);
                        }
                      }}
                    >
                      {flag.company_name}
                    </span>
                    <span className="text-xs text-bp-text-secondary">
                      {flag.flag_type}
                    </span>
                  </div>
                  <span className="text-sm text-bp-text-muted">
                    {flag.description}
                  </span>
                </div>

                {/* Right: PAN tag */}
                <div className="flex-shrink-0">
                  {flag.pan ? (
                    <Tag
                      intent={Intent.PRIMARY}
                      interactive
                      onClick={() => onPANClick?.(flag.pan!)}
                      className="cursor-pointer"
                    >
                      PAN: {flag.pan}
                    </Tag>
                  ) : (
                    <NoPanBadge />
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
