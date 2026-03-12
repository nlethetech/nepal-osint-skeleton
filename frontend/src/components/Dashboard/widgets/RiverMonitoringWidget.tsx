import { memo, useState, useMemo } from 'react';
import { Waves, Search, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from 'lucide-react';
import { Widget } from '../Widget';
import { useRiverStats, useRiverStations } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError, WidgetEmpty } from './shared';

const MAX_READING_AGE_HOURS = 72;
const MIN_REASONABLE_WATER_LEVEL = -2;
const MAX_REASONABLE_WATER_LEVEL = 200;

const getTrendIcon = (trend: string | null) => {
  if (!trend) return <Minus size={10} />;
  const t = trend.toUpperCase();
  if (t === 'RISING') return <TrendingUp size={10} />;
  if (t === 'FALLING') return <TrendingDown size={10} />;
  return <Minus size={10} />;
};

// Calculate margin to warning level (positive = safe, negative = above warning)
const calculateMargin = (level: number | null, warningLevel: number | null): number | null => {
  if (level === null || warningLevel === null) return null;
  return warningLevel - level;
};

const parseReadingTime = (raw: string | null | undefined): number | null => {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
};

const isStaleReading = (readingAt: string | null | undefined): boolean => {
  const ts = parseReadingTime(readingAt);
  if (ts === null) return true;
  return (Date.now() - ts) > MAX_READING_AGE_HOURS * 60 * 60 * 1000;
};

const isSensorError = (
  level: number | null,
  warningLevel: number | null,
  dangerLevel: number | null,
): boolean => {
  if (level === null) return false;
  if (!Number.isFinite(level)) return true;
  if (level < MIN_REASONABLE_WATER_LEVEL) return true;

  let dynamicCeiling = MAX_REASONABLE_WATER_LEVEL;
  const thresholds = [warningLevel, dangerLevel].filter((v): v is number => v !== null && v > 0);
  if (thresholds.length > 0) {
    dynamicCeiling = Math.max(dynamicCeiling, Math.max(...thresholds) * 8);
  }

  return level > dynamicCeiling;
};

// Get status from margin
const getMarginStatus = (margin: number | null, status: string | null): 'danger' | 'warning' | 'safe' => {
  // Use API status if available
  if (status) {
    const s = status.toUpperCase();
    if (s === 'DANGER') return 'danger';
    if (s === 'WARNING') return 'warning';
  }
  // Fallback to margin calculation
  if (margin === null) return 'safe';
  if (margin < 0) return 'danger';
  if (margin < 0.5) return 'warning';
  return 'safe';
};

const getStatusColor = (status: 'danger' | 'warning' | 'safe'): string => {
  if (status === 'danger') return 'var(--status-critical)';
  if (status === 'warning') return 'var(--status-high)';
  return 'var(--status-low)';
};

const getStatusBg = (status: 'danger' | 'warning' | 'safe'): string => {
  if (status === 'danger') return 'rgba(196, 80, 80, 0.15)';
  if (status === 'warning') return 'rgba(200, 112, 64, 0.15)';
  return 'rgba(64, 136, 80, 0.08)';
};

export const RiverMonitoringWidget = memo(function RiverMonitoringWidget() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: stats, isLoading: statsLoading, error: statsError, refetch } = useRiverStats();
  const { data: stations, isLoading: stationsLoading, error: stationsError } = useRiverStations();

  const isLoading = statsLoading || stationsLoading;
  const error = statsError || stationsError;

  // Filter and sort stations
  const filteredStations = useMemo(() => {
    if (!stations) return [];

    let filtered = stations;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.title.toLowerCase().includes(query) ||
        (s.basin && s.basin.toLowerCase().includes(query))
      );
    }

    // Sort by margin (smallest/negative first = most critical)
    return [...filtered].sort((a, b) => {
      const aIssue = isStaleReading(a.latest_reading?.reading_at ?? a.latest_observed_at) ||
        isSensorError(a.current_level, a.warning_level, a.danger_level);
      const bIssue = isStaleReading(b.latest_reading?.reading_at ?? b.latest_observed_at) ||
        isSensorError(b.current_level, b.warning_level, b.danger_level);

      if (aIssue !== bIssue) return aIssue ? 1 : -1;

      const marginA = calculateMargin(a.current_level, a.warning_level) ?? Number.POSITIVE_INFINITY;
      const marginB = calculateMargin(b.current_level, b.warning_level) ?? Number.POSITIVE_INFINITY;
      return marginA - marginB;
    });
  }, [stations, searchQuery]);

  if (isLoading) {
    return (
      <Widget id="rivers" icon={<Waves size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error) {
    return (
      <Widget id="rivers" icon={<Waves size={14} />}>
        <WidgetError message="Failed to load river data" onRetry={() => refetch()} />
      </Widget>
    );
  }

  return (
    <Widget
      id="rivers"
      icon={<Waves size={14} />}
      badge={stats?.danger_count ? `${stats.danger_count} DANGER` : `${stats?.total_stations || 0} stations`}
      badgeVariant={stats?.danger_count ? 'critical' : 'default'}
    >
      {/* Search Bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)'
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search river or basin..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '12px',
              color: 'var(--text-primary)',
              fontFamily: 'inherit'
            }}
          />
          {searchQuery && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {filteredStations.length} found
            </span>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{
        display: 'flex',
        padding: '10px 12px',
        gap: '12px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: '11px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: stats?.danger_count ? 'rgba(196, 80, 80, 0.15)' : 'var(--bg-active)',
          borderRadius: '4px'
        }}>
          <AlertTriangle size={12} style={{ color: 'var(--status-critical)' }} />
          <span style={{ fontWeight: 600, color: 'var(--status-critical)' }}>{stats?.danger_count ?? 0}</span>
          <span style={{ color: 'var(--text-muted)' }}>Danger</span>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: stats?.warning_count ? 'rgba(200, 112, 64, 0.15)' : 'var(--bg-active)',
          borderRadius: '4px'
        }}>
          <span style={{ fontWeight: 600, color: 'var(--status-high)' }}>{stats?.warning_count ?? 0}</span>
          <span style={{ color: 'var(--text-muted)' }}>Warning</span>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: 'var(--bg-active)',
          borderRadius: '4px'
        }}>
          <CheckCircle size={12} style={{ color: 'var(--status-low)' }} />
          <span style={{ fontWeight: 600, color: 'var(--status-low)' }}>{stats?.normal_count ?? 0}</span>
          <span style={{ color: 'var(--text-muted)' }}>Safe</span>
        </div>
      </div>

      {/* River List */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '280px',
        overflowY: 'auto'
      }}>
        {filteredStations.length === 0 ? (
          <WidgetEmpty message={searchQuery ? "No rivers match your search" : "No river data available"} />
        ) : (
          filteredStations.slice(0, 15).map((station) => {
            const stale = isStaleReading(station.latest_reading?.reading_at ?? station.latest_observed_at);
            const sensorError = isSensorError(station.current_level, station.warning_level, station.danger_level);
            const dataIssue = stale || sensorError;
            const margin = dataIssue ? null : calculateMargin(station.current_level, station.warning_level);
            const status = dataIssue ? 'warning' : getMarginStatus(margin, station.current_status);
            const statusColor = getStatusColor(status);
            const statusBg = getStatusBg(status);

            return (
              <div key={station.id} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                gap: '12px',
                background: status !== 'safe' ? statusBg : 'transparent'
              }}>
                {/* Status indicator */}
                <div style={{
                  width: '4px',
                  height: '36px',
                  background: statusColor,
                  borderRadius: '2px',
                  flexShrink: 0
                }} />

                {/* River Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {station.title}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    marginTop: '2px'
                  }}>
                    {station.basin || 'Unknown Basin'}
                  </div>
                </div>

                {/* Margin display */}
                <div style={{
                  textAlign: 'right',
                  flexShrink: 0
                }}>
                  {stale ? (
                    <>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--text-muted)'
                      }}>
                        STALE
                      </div>
                      <div style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        marginTop: '2px'
                      }}>
                        reading too old
                      </div>
                    </>
                  ) : sensorError ? (
                    <>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--status-critical)'
                      }}>
                        ERROR
                      </div>
                      <div style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        marginTop: '2px'
                      }}>
                        sensor anomaly
                      </div>
                    </>
                  ) : margin !== null ? (
                    <>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: statusColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '4px'
                      }}>
                        {margin >= 0 ? (
                          <>
                            <span style={{ fontSize: '10px', opacity: 0.7 }}>▼</span>
                            {margin.toFixed(1)}m
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: '10px' }}>▲</span>
                            +{Math.abs(margin).toFixed(1)}m
                          </>
                        )}
                      </div>
                      <div style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        marginTop: '2px'
                      }}>
                        {margin >= 0 ? 'below warning' : 'ABOVE warning'}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No data</span>
                  )}
                </div>

                {/* Trend */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: '24px',
                  flexShrink: 0,
                  color: dataIssue
                    ? 'var(--text-muted)'
                    : station.current_trend?.toUpperCase() === 'RISING'
                    ? 'var(--status-high)'
                    : station.current_trend?.toUpperCase() === 'FALLING'
                      ? 'var(--status-low)'
                      : 'var(--text-muted)'
                }}>
                  {dataIssue ? <AlertTriangle size={10} /> : getTrendIcon(station.current_trend)}
                  <span style={{ fontSize: '8px', marginTop: '2px' }}>
                    {dataIssue ? 'ERR' :
                     station.current_trend?.toUpperCase() === 'RISING' ? 'UP' :
                     station.current_trend?.toUpperCase() === 'FALLING' ? 'DN' : '—'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Widget>
  );
});
