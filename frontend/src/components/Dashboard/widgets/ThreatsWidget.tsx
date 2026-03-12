import { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Widget } from '../Widget';
import { useThreatMatrix } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError } from './shared';

export const ThreatsWidget = memo(function ThreatsWidget() {
  const { data: threatMatrix, isLoading, error, refetch } = useThreatMatrix(24);

  if (isLoading) {
    return (
      <Widget id="threats" icon={<AlertTriangle size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error || !threatMatrix) {
    return (
      <Widget id="threats" icon={<AlertTriangle size={14} />}>
        <WidgetError message="Failed to load threat matrix" onRetry={() => refetch()} />
      </Widget>
    );
  }

  // Map threat level to severity class
  const getLevelClass = (level: string): string => {
    const map: Record<string, string> = {
      critical: 'critical',
      elevated: 'high',
      guarded: 'medium',
      low: 'low',
    };
    return map[level.toLowerCase()] || 'low';
  };

  // Calculate percentage for progress bar based on event count
  const getPercentage = (cell: typeof threatMatrix.matrix[0]): number => {
    const { severity_breakdown } = cell;
    const total = severity_breakdown.critical + severity_breakdown.high + severity_breakdown.medium + severity_breakdown.low;
    if (total === 0) return 0;
    // Weight: critical=4, high=3, medium=2, low=1
    const weighted = severity_breakdown.critical * 4 + severity_breakdown.high * 3 + severity_breakdown.medium * 2 + severity_breakdown.low;
    return Math.min(100, Math.round((weighted / (total * 4)) * 100));
  };

  // Take top 4 threat categories
  const displayCells = threatMatrix.matrix.slice(0, 4);

  return (
    <Widget id="threats" icon={<AlertTriangle size={14} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '12px' }}>
        {displayCells.map((cell, i) => {
          const levelClass = getLevelClass(cell.level);
          const pct = getPercentage(cell);

          return (
            <div key={i} style={{ padding: '12px', background: 'var(--bg-elevated)' }}>
              <div style={{ fontSize: '12px', marginBottom: '8px', textTransform: 'capitalize' }}>
                {cell.category.replace(/_/g, ' ')}
              </div>
              <div style={{
                fontSize: '10px',
                fontWeight: 600,
                color: `var(--status-${levelClass})`,
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {cell.level.toUpperCase()}
                {cell.trend && (
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>
                    {cell.trend === 'escalating' ? '↑' : cell.trend === 'deescalating' ? '↓' : '→'}
                  </span>
                )}
              </div>
              <div style={{ height: '4px', background: 'var(--bg-active)' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: `var(--status-${levelClass})`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{
                fontSize: '9px',
                color: 'var(--text-muted)',
                marginTop: '4px'
              }}>
                {cell.event_count} events
              </div>
            </div>
          );
        })}
      </div>
    </Widget>
  );
});
