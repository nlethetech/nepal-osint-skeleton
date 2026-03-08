import React from 'react';
import { Tag, Intent, HTMLTable, Icon, type IconName } from '@blueprintjs/core';
import CountUp from 'react-countup';
import { motion } from 'framer-motion';

/* ============================================================
   NepalOSINT UI — Shared primitives for the platform
   All colors use Tailwind bp-* tokens. No inline hex.
   ============================================================ */

// ─── Severity Badge ──────────────────────────────────────────

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

const SEVERITY_INTENT: Record<SeverityLevel, Intent> = {
  critical: Intent.DANGER,
  high: Intent.WARNING,
  medium: Intent.WARNING,
  low: Intent.SUCCESS,
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

interface SeverityBadgeProps {
  severity: SeverityLevel | string;
  className?: string;
  minimal?: boolean;
}

export const SeverityBadge = React.memo(function SeverityBadge({
  severity,
  className = '',
  minimal = true,
}: SeverityBadgeProps) {
  const s = severity.toLowerCase() as SeverityLevel;
  const intent = SEVERITY_INTENT[s] ?? Intent.NONE;
  const label = SEVERITY_LABELS[s] ?? severity.toUpperCase();
  return (
    <Tag
      intent={intent}
      minimal={minimal}
      className={`text-xs font-semibold ${className}`}
    >
      {label}
    </Tag>
  );
});

// ─── Status Tag ──────────────────────────────────────────────

type StatusType = 'active' | 'inactive' | 'pending' | 'nonfiler' | 'filer' | 'success' | 'error'
  | 'completed' | 'running' | 'queued' | 'processing' | 'failed';

const STATUS_CONFIG: Record<StatusType, { intent: Intent; label: string }> = {
  active:     { intent: Intent.SUCCESS, label: 'Active' },
  inactive:   { intent: Intent.NONE,    label: 'Inactive' },
  pending:    { intent: Intent.WARNING, label: 'Pending' },
  nonfiler:   { intent: Intent.DANGER,  label: 'Non-Filer' },
  filer:      { intent: Intent.SUCCESS, label: 'Filer' },
  success:    { intent: Intent.SUCCESS, label: 'Success' },
  error:      { intent: Intent.DANGER,  label: 'Error' },
  completed:  { intent: Intent.SUCCESS, label: 'Completed' },
  running:    { intent: Intent.WARNING, label: 'Running' },
  queued:     { intent: Intent.WARNING, label: 'Queued' },
  processing: { intent: Intent.WARNING, label: 'Processing' },
  failed:     { intent: Intent.DANGER,  label: 'Failed' },
};

interface StatusTagProps {
  status: StatusType | string;
  className?: string;
}

export const StatusTag = React.memo(function StatusTag({ status, className = '' }: StatusTagProps) {
  const s = status.toLowerCase() as StatusType;
  const config = STATUS_CONFIG[s] ?? { intent: Intent.NONE, label: status };
  return (
    <Tag intent={config.intent} minimal className={`text-xs ${className}`}>
      {config.label}
    </Tag>
  );
});

// ─── No PAN Badge ────────────────────────────────────────────

export const NoPanBadge = React.memo(function NoPanBadge({ className = '' }: { className?: string }) {
  return (
    <Tag intent={Intent.DANGER} minimal className={`text-xs ${className}`}>
      No PAN
    </Tag>
  );
});

// ─── Metric Card ─────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: number | string;
  icon?: IconName;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  className?: string;
  animate?: boolean;
}

export const MetricCard = React.memo(function MetricCard({
  label,
  value,
  icon,
  trend,
  trendValue,
  className = '',
  animate = true,
}: MetricCardProps) {
  const trendColor =
    trend === 'up' ? 'text-severity-critical' :
    trend === 'down' ? 'text-bp-success' :
    'text-bp-text-muted';
  const trendIcon =
    trend === 'up' ? '\u25B2' :
    trend === 'down' ? '\u25BC' :
    '';

  return (
    <motion.div
      className={`bg-bp-card border border-bp-border rounded p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${className}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && <Icon icon={icon} size={14} className="text-bp-text-muted" />}
        <span className="bp-section-header">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold text-bp-text tabular-nums">
          {animate && typeof value === 'number' ? (
            <CountUp end={value} duration={1.5} separator="," />
          ) : (
            value
          )}
        </span>
        {trend && trendValue && (
          <span className={`text-xs font-medium ${trendColor}`}>
            {trendIcon} {trendValue}
          </span>
        )}
      </div>
    </motion.div>
  );
});

// ─── Section Header ──────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  count?: number;
  className?: string;
  action?: React.ReactNode;
}

export const SectionHeader = React.memo(function SectionHeader({
  title,
  count,
  className = '',
  action,
}: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-2 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="bp-section-header">{title}</span>
        {count !== undefined && (
          <Tag minimal className="text-xs">
            {count.toLocaleString()}
          </Tag>
        )}
      </div>
      {action}
    </div>
  );
});

export type UiSemanticRole = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'muted';

const PANEL_ROLE_CLASS: Record<UiSemanticRole, string> = {
  default: 'border-bp-border bg-bp-card',
  primary: 'border-bp-primary/40 bg-bp-card',
  success: 'border-bp-success/40 bg-bp-card',
  warning: 'border-bp-warning/40 bg-bp-card',
  danger: 'border-severity-critical/40 bg-bp-card',
  muted: 'border-bp-border bg-bp-surface',
};

interface PanelFrameProps {
  children: React.ReactNode;
  className?: string;
  role?: UiSemanticRole;
}

export const PanelFrame = React.memo(function PanelFrame({
  children,
  className = '',
  role = 'default',
}: PanelFrameProps) {
  return (
    <div className={`rounded border p-3 ${PANEL_ROLE_CLASS[role]} ${className}`}>
      {children}
    </div>
  );
});

interface SectionTitleProps {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const SectionTitle = React.memo(function SectionTitle({
  title,
  subtitle,
  action,
  className = '',
}: SectionTitleProps) {
  return (
    <div className={`mb-2 flex items-start justify-between gap-3 ${className}`}>
      <div>
        <p className="bp-section-header">{title}</p>
        {subtitle && <div className="mt-1 text-xs text-bp-text-muted">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
});

export interface DataValueRow {
  label: React.ReactNode;
  value: React.ReactNode;
  labelClassName?: string;
  valueClassName?: string;
}

interface DataValueGridProps {
  rows: DataValueRow[];
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
  valueColorClassName?: string;
}

export const DataValueGrid = React.memo(function DataValueGrid({
  rows,
  className = '',
  labelClassName = '',
  valueClassName = '',
  valueColorClassName = '',
}: DataValueGridProps) {
  return (
    <div className={`grid grid-cols-2 gap-y-2 text-sm ${className}`}>
      {rows.map((row, index) => (
        <React.Fragment key={index}>
          <span className={`text-bp-text-muted ${labelClassName} ${row.labelClassName || ''}`}>{row.label}</span>
          <span className={`${valueColorClassName} ${valueClassName} ${row.valueClassName || ''}`}>{row.value}</span>
        </React.Fragment>
      ))}
    </div>
  );
});

interface EmptyStateInlineProps {
  title: string;
  description?: string;
  icon?: IconName;
  className?: string;
}

export const EmptyStateInline = React.memo(function EmptyStateInline({
  title,
  description,
  icon = 'search',
  className = '',
}: EmptyStateInlineProps) {
  return (
    <PanelFrame role="muted" className={`text-center ${className}`}>
      <div className="flex items-center justify-center gap-2 text-bp-text-muted">
        <Icon icon={icon} size={14} />
        <span className="text-sm font-medium text-bp-text">{title}</span>
      </div>
      {description && <p className="mt-1 text-xs text-bp-text-muted">{description}</p>}
    </PanelFrame>
  );
});

interface ErrorInlineProps {
  message: string;
  title?: string;
  className?: string;
}

export const ErrorInline = React.memo(function ErrorInline({
  message,
  title = 'Unable to load data',
  className = '',
}: ErrorInlineProps) {
  return (
    <PanelFrame role="danger" className={className}>
      <div className="flex items-start gap-2">
        <Icon icon="error" size={14} className="mt-0.5 text-severity-critical" />
        <div>
          <p className="text-sm font-medium text-severity-critical">{title}</p>
          <p className="text-xs text-bp-text-muted">{message}</p>
        </div>
      </div>
    </PanelFrame>
  );
});

// ─── Compact Table ───────────────────────────────────────────

interface CompactTableProps {
  headers: string[];
  rows: React.ReactNode[][];
  striped?: boolean;
  className?: string;
}

export const CompactTable = React.memo(function CompactTable({
  headers,
  rows,
  striped = true,
  className = '',
}: CompactTableProps) {
  return (
    <div className={`overflow-auto ${className}`}>
      <HTMLTable
        compact
        striped={striped}
        className="w-full text-sm"
      >
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-xs font-semibold uppercase tracking-wider text-bp-text-muted bg-bp-surface">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="text-bp-text">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
});

// ─── Skeleton Loader ─────────────────────────────────────────

interface SkeletonProps {
  lines?: number;
  className?: string;
}

export function Skeleton({ lines = 3, className = '' }: SkeletonProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-bp-surface rounded animate-pulse"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}

// ─── Staggered Container ─────────────────────────────────────

interface StaggeredContainerProps {
  children: React.ReactNode;
  className?: string;
  staggerDelay?: number;
}

export function StaggeredContainer({
  children,
  className = '',
  staggerDelay = 0.08,
}: StaggeredContainerProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export const staggerChild = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};
