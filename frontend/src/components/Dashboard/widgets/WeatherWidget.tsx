import { memo, useState } from 'react';
import { Cloud, Sun, CloudSun, CloudRain, CloudDrizzle, CloudLightning, CloudFog, Snowflake, AlertTriangle, RefreshCw } from 'lucide-react';
import { Widget } from '../Widget';
import { useWeatherSummary } from '../../../api/hooks/useWeather';

// Map icon codes from backend to Lucide components
const WEATHER_ICONS: Record<string, { component: React.ComponentType<any>; color: string }> = {
  'sun': { component: Sun, color: '#fbbf24' },
  'cloud-sun': { component: CloudSun, color: '#94a3b8' },
  'cloud': { component: Cloud, color: '#64748b' },
  'cloud-rain': { component: CloudRain, color: '#3b82f6' },
  'cloud-drizzle': { component: CloudDrizzle, color: '#60a5fa' },
  'cloud-lightning': { component: CloudLightning, color: '#fbbf24' },
  'cloud-fog': { component: CloudFog, color: '#94a3b8' },
  'snowflake': { component: Snowflake, color: '#e0f2fe' },
};

function getWeatherIcon(iconCode: string) {
  return WEATHER_ICONS[iconCode] || WEATHER_ICONS['cloud'];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return formatDate(dateString);
  }
}

// Loading skeleton
function WeatherSkeleton() {
  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', gap: '16px' }}>
        <div style={{
          width: '64px',
          height: '64px',
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          animation: 'pulse 1.5s infinite',
        }} />
        <div style={{ flex: 1 }}>
          <div style={{
            width: '60%',
            height: '20px',
            background: 'var(--bg-tertiary)',
            borderRadius: '4px',
            marginBottom: '8px',
            animation: 'pulse 1.5s infinite',
          }} />
          <div style={{
            width: '40%',
            height: '14px',
            background: 'var(--bg-tertiary)',
            borderRadius: '4px',
            animation: 'pulse 1.5s infinite',
          }} />
        </div>
      </div>
      <div style={{
        marginTop: '16px',
        height: '60px',
        background: 'var(--bg-tertiary)',
        borderRadius: '4px',
        animation: 'pulse 1.5s infinite',
      }} />
    </div>
  );
}

// Error state
function WeatherError({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{
      padding: '24px',
      textAlign: 'center',
      color: 'var(--text-secondary)',
    }}>
      <AlertTriangle size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
      <div style={{ fontSize: '12px', marginBottom: '12px' }}>
        Weather data unavailable
      </div>
      <button
        onClick={onRetry}
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          padding: '6px 12px',
          fontSize: '11px',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <RefreshCw size={12} />
        Retry
      </button>
    </div>
  );
}

export const WeatherWidget = memo(function WeatherWidget() {
  const [activeTab, setActiveTab] = useState<'today' | 'tomorrow'>('today');
  const { data: weather, isLoading, isError, refetch } = useWeatherSummary();

  if (isLoading) {
    return (
      <Widget id="weather" icon={<Cloud size={14} />}>
        <WeatherSkeleton />
      </Widget>
    );
  }

  if (isError || !weather) {
    return (
      <Widget id="weather" icon={<Cloud size={14} />}>
        <WeatherError onRetry={() => refetch()} />
      </Widget>
    );
  }

  const iconInfo = getWeatherIcon(weather.condition.icon);
  const IconComponent = iconInfo.component;
  const forecastText = activeTab === 'today'
    ? weather.forecast_today_en
    : weather.forecast_tomorrow_en;

  return (
    <Widget id="weather" icon={<Cloud size={14} />}>
      {/* Special warning notice */}
      {weather.special_notice && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          borderLeft: '3px solid var(--status-critical)',
          padding: '8px 12px',
          fontSize: '11px',
          color: 'var(--status-critical)',
        }}>
          <AlertTriangle size={12} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          {weather.special_notice}
        </div>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: weather.special_notice ? 'calc(100% - 40px)' : '100%',
      }}>
        {/* Header: Icon + Condition + Tabs */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          gap: '16px',
        }}>
          {/* Weather icon and condition */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1,
          }}>
            <IconComponent size={36} color={iconInfo.color} />
            <div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '18px',
                fontWeight: 600,
              }}>
                {weather.condition.condition}
              </div>
              <div style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
              }}>
                {formatDate(weather.issue_date)}
                {weather.condition.regions_affected.length > 0 && (
                  <span> · {weather.condition.regions_affected.slice(0, 2).join(', ')}</span>
                )}
              </div>
            </div>
          </div>

          {/* Tab buttons */}
          <div style={{
            display: 'flex',
            background: 'var(--bg-tertiary)',
            borderRadius: '6px',
            padding: '2px',
          }}>
            <button
              onClick={() => setActiveTab('today')}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: activeTab === 'today' ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === 'today' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: activeTab === 'today' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Today
            </button>
            <button
              onClick={() => setActiveTab('tomorrow')}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: activeTab === 'tomorrow' ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === 'tomorrow' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: activeTab === 'tomorrow' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Tomorrow
            </button>
          </div>
        </div>

        {/* Forecast content */}
        <div style={{
          flex: 1,
          padding: '16px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          lineHeight: '1.6',
        }}>
          {forecastText || 'No forecast available'}
        </div>

        {/* Footer with source attribution */}
        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '6px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '9px',
          color: 'var(--text-muted)',
        }}>
          <span>
            Source: {weather.data_source}
            {weather.issued_by && ` (${weather.issued_by})`}
          </span>
          <span>
            Updated: {getTimeAgo(weather.last_updated)}
          </span>
        </div>
      </div>
    </Widget>
  );
});
