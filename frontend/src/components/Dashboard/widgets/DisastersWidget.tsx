import { memo, useState } from 'react';
import { AlertTriangle, Flame, Droplets, Mountain, Zap, Activity, Wind, Snowflake, Bug, AlertCircle } from 'lucide-react';
import { Widget } from '../Widget';
import { useDisasterStats, useDisasterAlerts } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError, WidgetEmpty, formatTimeAgo } from './shared';
import { formatHazardType } from '../../../api/disasterAlerts';

// Professional hazard icons using Lucide
const getHazardLucideIcon = (hazardType: string | null) => {
  const iconProps = { size: 16, strokeWidth: 1.5 };
  switch (hazardType) {
    case 'fire': return <Flame {...iconProps} />;
    case 'flood': return <Droplets {...iconProps} />;
    case 'landslide': return <Mountain {...iconProps} />;
    case 'earthquake': return <Activity {...iconProps} />;
    case 'lightning': return <Zap {...iconProps} />;
    case 'windstorm': return <Wind {...iconProps} />;
    case 'cold_wave': return <Snowflake {...iconProps} />;
    case 'avalanche': return <Mountain {...iconProps} />;
    case 'epidemic': return <Bug {...iconProps} />;
    default: return <AlertCircle {...iconProps} />;
  }
};

const TIME_OPTIONS = [
  { label: '1H', hours: 1 },
  { label: '24H', hours: 24 },
  { label: '48H', hours: 48 },
  { label: '72H', hours: 72 },
];

export const DisastersWidget = memo(function DisastersWidget() {
  const [selectedHours, setSelectedHours] = useState(72);
  const { data: stats, isLoading: statsLoading, error: statsError, refetch } = useDisasterStats(selectedHours);
  const { data: alerts, isLoading: alertsLoading, error: alertsError } = useDisasterAlerts(20, selectedHours);

  const isLoading = statsLoading || alertsLoading;
  const error = statsError || alertsError;

  if (isLoading) {
    return (
      <Widget id="disasters" icon={<AlertTriangle size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="disasters" icon={<AlertTriangle size={14} />}>
        <WidgetError message="Failed to load disaster data" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const quickStats = [
    { value: stats?.danger_alerts ?? 0, label: 'CRITICAL', className: 'critical' },
    { value: stats?.active_alerts ?? 0, label: 'ACTIVE', className: 'high' },
    { value: stats?.incidents_in_window ?? 0, label: `${selectedHours}H INCIDENTS`, className: 'medium' },
  ];

  const getSeverityStyle = (severity: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      danger: { bg: 'var(--status-critical)', color: 'white' },
      warning: { bg: 'var(--status-high)', color: 'black' },
      watch: { bg: 'var(--status-medium)', color: 'black' },
      normal: { bg: 'var(--bg-active)', color: 'var(--text-secondary)' },
    };
    return styles[severity] || styles.normal;
  };

  return (
    <Widget
      id="disasters"
      icon={<AlertTriangle size={14} />}
      badge={stats?.active_alerts ? `${stats.active_alerts} ACTIVE` : undefined}
      badgeVariant={stats?.danger_alerts ? 'critical' : 'default'}
    >
      {/* Time Filter */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)'
      }}>
        {TIME_OPTIONS.map((opt) => (
          <button
            key={opt.hours}
            onClick={() => setSelectedHours(opt.hours)}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: '10px',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              border: 'none',
              cursor: 'pointer',
              background: selectedHours === opt.hours ? 'var(--accent-primary)' : 'var(--bg-active)',
              color: selectedHours === opt.hours ? 'white' : 'var(--text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Stats Row */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        {quickStats.map((stat, i) => (
          <div key={i} style={{
            flex: 1,
            padding: '10px 12px',
            textAlign: 'center',
            borderRight: i < quickStats.length - 1 ? '1px solid var(--border-subtle)' : 'none'
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '18px',
              fontWeight: 600,
              color: `var(--status-${stat.className})`
            }}>{stat.value}</div>
            <div style={{
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted)'
            }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Alerts List */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {(!alerts || alerts.length === 0) ? (
          <WidgetEmpty message="No active disaster alerts" />
        ) : (
          alerts.map((alert) => {
            const severityStyle = getSeverityStyle(alert.severity);
            return (
              <div key={alert.id} style={{
                display: 'flex',
                gap: '12px',
                padding: '12px',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: 'pointer'
              }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: severityStyle.bg,
                  flexShrink: 0
                }}>
                  {getHazardLucideIcon(alert.hazard_type)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      textTransform: 'uppercase',
                      background: severityStyle.bg,
                      color: severityStyle.color
                    }}>
                      {alert.severity.toUpperCase()}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {alert.district || formatHazardType(alert.hazard_type)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    marginBottom: '4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {alert.title}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--text-disabled)' }}>
                    <span>{formatTimeAgo(alert.started_at || alert.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Widget>
  );
});
