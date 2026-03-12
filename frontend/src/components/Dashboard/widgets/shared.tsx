import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Widget loading skeleton - shows animated placeholder
 */
export function WidgetSkeleton() {
  return (
    <div className="animate-pulse p-4 h-full">
      <div className="h-4 bg-[var(--bg-active)] rounded w-3/4 mb-4" />
      <div className="space-y-3">
        <div className="h-3 bg-[var(--bg-active)] rounded w-full" />
        <div className="h-3 bg-[var(--bg-active)] rounded w-5/6" />
        <div className="h-3 bg-[var(--bg-active)] rounded w-4/6" />
      </div>
    </div>
  );
}

/**
 * Widget error state - shows error message with retry button
 */
export function WidgetError({
  message = 'Failed to load data',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
      <AlertTriangle size={20} className="text-[var(--status-high)] mb-2" />
      <p className="text-[11px] text-[var(--text-muted)] mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 text-[10px] text-[var(--accent-primary)] hover:underline"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Widget empty state - shows when no data available
 */
export function WidgetEmpty({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <p className="text-[11px] text-[var(--text-muted)]">{message}</p>
    </div>
  );
}

/**
 * Severity badge component
 */
export function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-[var(--status-critical)] text-white',
    high: 'bg-[var(--status-high)] text-black',
    medium: 'bg-[var(--status-medium)] text-black',
    low: 'bg-[var(--status-low)] text-black',
    danger: 'bg-[var(--status-critical)] text-white',
    warning: 'bg-[var(--status-high)] text-black',
    watch: 'bg-[var(--status-medium)] text-black',
  };

  return (
    <span
      className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase ${colors[severity] || 'bg-[var(--bg-active)] text-[var(--text-secondary)]'}`}
    >
      {severity}
    </span>
  );
}

/**
 * Time ago formatter
 */
export function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
