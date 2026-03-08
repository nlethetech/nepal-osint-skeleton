import { useState, useEffect, useCallback, useMemo, memo, useSyncExternalStore } from 'react';
import { Wifi, WifiOff, Database, Activity, Zap, AlertTriangle, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { useAuthStore } from '../../store/slices/authSlice';
import { useSettingsStore } from '../../store/slices/settingsSlice';
import { usePermissions } from '../../hooks/usePermissions';
import apiClient from '../../api/client';
import { subscribeViewerCount, getViewerCountSnapshot, getViewerCountServerSnapshot } from '../../api/websocket';

interface KPISnapshot {
  active_alerts: {
    count: number;
    by_severity: {
      critical: number;
      high: number;
    };
  };
  events_today: {
    total: number;
    trend: string;
  };
  threat_level: {
    level: string;
    score: number;
    trajectory: string;
  };
  source_coverage: {
    active_sources: number;
    total_sources: number;
    last_fetch_seconds_ago: number;
  };
  trend_velocity: {
    events_this_hour: number;
    direction: string;
  };
  data_freshness_seconds: number;
}

// Viewer count — server-authoritative, received via WebSocket
const ViewerCount = memo(function ViewerCount() {
  const viewers = useSyncExternalStore(subscribeViewerCount, getViewerCountSnapshot, getViewerCountServerSnapshot);

  return (
    <div className="status-section">
      <span className="status-label">ACTIVE VIEWERS</span>
      <span className="status-value" style={{ color: 'var(--bloomberg-teal)', fontVariantNumeric: 'tabular-nums' }}>
        {viewers > 0 ? viewers.toLocaleString() : '—'}
      </span>
    </div>
  );
});

// Extracted clock component — only this re-renders every second
const StatusClock = memo(function StatusClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).toUpperCase();
  };

  return (
    <div className="status-section">
      <span className="status-value">{formatDate(time)}</span>
      <span className="status-value" style={{ color: 'var(--bloomberg-orange)', fontWeight: 600 }}>
        {formatTime(time)}
      </span>
      <span className="status-label">{time.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop()}</span>
    </div>
  );
});

export const StatusBar = memo(function StatusBar() {
  const [isConnected, setIsConnected] = useState(true);
  const [kpi, setKpi] = useState<KPISnapshot | null>(null);
  const [latency, setLatency] = useState<number>(0);
  const { user } = useAuthStore();
  const { isConsumer } = usePermissions();

  // Get selected districts from settings store
  const { getSelectedDistricts } = useSettingsStore();
  const selectedDistricts = useMemo(() => getSelectedDistricts(), [getSelectedDistricts]);

  // Fetch real KPI data
  const fetchKPI = useCallback(async () => {
    const startTime = performance.now();
    try {
      const params: Record<string, unknown> = { hours: 6 };

      // Add districts filter if there are selected districts
      if (selectedDistricts.length > 0) {
        params.districts = selectedDistricts.join(',');
      }

      const response = await apiClient.get('/kpi/snapshot', { params });
      const endTime = performance.now();
      setLatency(Math.round(endTime - startTime));
      setKpi(response.data)
      setIsConnected(true)
    } catch {
      setIsConnected(false);
    }
  }, [selectedDistricts]);

  // Initial fetch and refresh every 30 seconds (was 10s — too frequent for status overview)
  useEffect(() => {
    fetchKPI();
    const interval = setInterval(fetchKPI, 30000);
    return () => clearInterval(interval);
  }, [fetchKPI]);

  // Check online status
  useEffect(() => {
    const handleOnline = () => setIsConnected(true);
    const handleOffline = () => setIsConnected(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? '\u2318' : 'Ctrl';

  // Get trend icon
  const getTrendIcon = (direction?: string) => {
    if (direction === 'UP') return <TrendingUp size={10} style={{ color: 'var(--pro-critical)' }} />;
    if (direction === 'DOWN') return <TrendingDown size={10} style={{ color: 'var(--bloomberg-teal)' }} />;
    return <Minus size={10} style={{ color: 'var(--pro-text-muted)' }} />;
  };

  // Get threat level color
  const getThreatColor = (level?: string) => {
    switch (level) {
      case 'CRITICAL': return 'var(--pro-critical)';
      case 'ELEVATED': return 'var(--bloomberg-orange)';
      case 'GUARDED': return 'var(--pro-medium)';
      default: return 'var(--bloomberg-teal)';
    }
  };

  // Simplified status bar for consumer role - only connection, user, time, and search hint
  if (isConsumer) {
    return (
      <div className="bloomberg-status-bar">
        {/* Connection Status */}
        <div className="status-section">
          {isConnected ? (
            <Wifi size={11} style={{ color: 'var(--bloomberg-teal)' }} />
          ) : (
            <WifiOff size={11} style={{ color: 'var(--pro-critical)' }} />
          )}
          <span className={`status-value ${isConnected ? 'live' : ''}`}>
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="status-separator" />

        {/* Live Viewer Count */}
        <ViewerCount />

        <div className="status-separator" />

        {/* User Role */}
        <div className="status-section">
          <span className="status-label">USER</span>
          <span className="status-value" style={{ textTransform: 'uppercase' }}>
            {user?.role || 'GUEST'}
          </span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Date/Time */}
        <StatusClock />

        <div className="status-separator" />

        {/* Keyboard Shortcut Hint */}
        <div className="shortcut-hint">
          <span className="shortcut-key">{cmdKey}</span>
          <span className="shortcut-key">K</span>
          <span style={{ marginLeft: '4px' }}>Search</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bloomberg-status-bar">
      {/* Connection Status */}
      <div className="status-section">
        {isConnected ? (
          <Wifi size={11} style={{ color: 'var(--bloomberg-teal)' }} />
        ) : (
          <WifiOff size={11} style={{ color: 'var(--pro-critical)' }} />
        )}
        <span className={`status-value ${isConnected ? 'live' : ''}`}>
          {isConnected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      <div className="status-separator" />

      {/* Live Viewer Count */}
      <ViewerCount />

      <div className="status-separator" />

      {/* API Latency */}
      <div className="status-section">
        <Activity size={10} />
        <span className="status-label">LAT</span>
        <span className={`status-value ${latency > 500 ? 'warning' : ''}`}>
          {latency}ms
        </span>
      </div>

      <div className="status-separator" />

      {/* Events Rate */}
      <div className="status-section">
        <Zap size={10} />
        <span className="status-label">RATE</span>
        <span className="status-value">
          {kpi?.trend_velocity?.events_this_hour ?? 0}/hr
        </span>
        {getTrendIcon(kpi?.trend_velocity?.direction)}
      </div>

      <div className="status-separator" />

      {/* Active Alerts */}
      <div className="status-section">
        <AlertTriangle size={10} style={{ color: kpi?.active_alerts?.by_severity?.critical ? 'var(--pro-critical)' : 'var(--pro-text-muted)' }} />
        <span className="status-label">ALERTS</span>
        <span className="status-value" style={{ color: kpi?.active_alerts?.by_severity?.critical ? 'var(--pro-critical)' : undefined }}>
          {kpi?.active_alerts?.count ?? 0}
        </span>
        {kpi?.active_alerts?.by_severity?.critical ? (
          <span style={{ fontSize: '9px', color: 'var(--pro-critical)', fontWeight: 600 }}>
            {kpi.active_alerts.by_severity.critical} CRIT
          </span>
        ) : null}
      </div>

      <div className="status-separator" />

      {/* Data Sources */}
      <div className="status-section">
        <Database size={10} />
        <span className="status-label">SOURCES</span>
        <span className="status-value">
          {kpi?.source_coverage?.active_sources ?? 0}/{kpi?.source_coverage?.total_sources ?? 0}
        </span>
      </div>

      <div className="status-separator" />

      {/* Threat Level */}
      <div className="status-section">
        <span className="status-label">THREAT</span>
        <span className="status-value" style={{ color: getThreatColor(kpi?.threat_level?.level), fontWeight: 600 }}>
          {kpi?.threat_level?.level ?? 'UNKNOWN'}
        </span>
      </div>

      <div className="status-separator" />

      {/* User Role */}
      <div className="status-section">
        <span className="status-label">USER</span>
        <span className="status-value" style={{ textTransform: 'uppercase' }}>
          {user?.role || 'GUEST'}
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Date/Time */}
      <StatusClock />

      <div className="status-separator" />

      {/* Keyboard Shortcut Hint */}
      <div className="shortcut-hint">
        <span className="shortcut-key">{cmdKey}</span>
        <span className="shortcut-key">K</span>
        <span style={{ marginLeft: '4px' }}>Search</span>
      </div>
    </div>
  );
});
