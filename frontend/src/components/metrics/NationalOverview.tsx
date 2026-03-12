/**
 * National Overview Component
 * Shows key national metrics with real-time updates and compact dashboard mode
 */
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Shield, Activity, DollarSign, Users } from 'lucide-react'
import { getNationalMetrics, type NationalSummary } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'

interface NationalOverviewProps {
  refreshKey?: number
  compact?: boolean
  autoRefresh?: boolean
  refreshInterval?: number
}

const RISK_COLORS = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
}

function MetricGauge({
  value,
  label,
  inverted = false,
  description,
  icon: Icon,
  compact = false,
}: {
  value: number
  label: string
  inverted?: boolean
  description?: string
  icon?: React.ElementType
  compact?: boolean
}) {
  // For inverted metrics (like crime/tension), higher is worse
  const displayValue = inverted ? value : 100 - value
  const color = displayValue < 30 ? RISK_COLORS.low :
    displayValue < 50 ? RISK_COLORS.medium :
    displayValue < 70 ? RISK_COLORS.high :
    RISK_COLORS.critical

  const gaugeSize = compact ? 'w-16 h-16' : 'w-24 h-24'
  const textSize = compact ? 'text-lg' : 'text-2xl'
  const radius = compact ? 28 : 40
  const circumference = 2 * Math.PI * radius
  const strokeWidth = compact ? 6 : 8
  const center = compact ? 32 : 48

  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${gaugeSize}`}>
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#2a2a3a"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={inverted ? color : (value > 70 ? RISK_COLORS.low : value > 50 ? RISK_COLORS.medium : RISK_COLORS.high)}
            strokeWidth={strokeWidth}
            strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${textSize} font-bold text-osint-text`}>
            {Math.round(value)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        {Icon && <Icon className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-osint-muted`} />}
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-osint-text`}>{label}</span>
      </div>
      {description && !compact && (
        <span className="text-xs text-osint-muted">{description}</span>
      )}
    </div>
  )
}

function StatCard({
  value,
  label,
  icon,
  color = 'text-osint-accent',
  compact = false,
}: {
  value: number | string
  label: string
  icon: React.ReactNode
  color?: string
  compact?: boolean
}) {
  return (
    <div className={`bg-osint-bg/50 rounded-lg ${compact ? 'p-2' : 'p-3'} flex items-center gap-3 border border-osint-border/50`}>
      <div className={`${compact ? 'p-1.5' : 'p-2'} bg-osint-card rounded-lg ${color}`}>
        {icon}
      </div>
      <div>
        <div className={`${compact ? 'text-lg' : 'text-xl'} font-bold text-osint-text`}>
          {value}
        </div>
        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-osint-muted`}>{label}</div>
      </div>
    </div>
  )
}

// Validate and cap unrealistic values from backend
function validateMetrics(metrics: NationalSummary): NationalSummary {
  return {
    ...metrics,
    murders_24h: Math.min(metrics.murders_24h, 50),
    violent_crimes_24h: Math.min(metrics.violent_crimes_24h, 200),
    avg_stability: Math.max(0, Math.min(100, metrics.avg_stability)),
    avg_communal_tension: Math.max(0, Math.min(100, metrics.avg_communal_tension)),
    avg_violent_crime: Math.max(0, Math.min(100, metrics.avg_violent_crime)),
    avg_economic_health: Math.max(0, Math.min(100, metrics.avg_economic_health)),
  }
}

export function NationalOverview({
  refreshKey = 0,
  compact = false,
  autoRefresh = true,
  refreshInterval = 60000, // 1 minute default
}: NationalOverviewProps) {
  const [data, setData] = useState<NationalSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setIsRefreshing(true)
    try {
      const result = await getNationalMetrics()
      setData(validateMetrics(result))
      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      setError('Failed to load national metrics')
      console.error(err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Initial fetch and refreshKey-based fetch
  useEffect(() => {
    fetchData(true)
  }, [fetchData, refreshKey])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchData(false)
    }, refreshInterval)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshInterval, fetchData])

  if (loading && !data) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} flex items-center justify-center min-h-[200px]`}>
        <LoadingSpinner message="Loading national metrics..." />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} text-center text-osint-muted`}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-500" />
        {error}
      </div>
    )
  }

  if (!data) return null

  const cardClass = compact
    ? "bg-osint-card rounded-lg border border-osint-border p-4"
    : "bg-osint-card rounded-xl border border-osint-border p-6"

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-osint-text flex items-center gap-2`}>
          <Activity className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
          National Overview
        </h2>
        <div className="flex items-center gap-2">
          {!compact && (
            <span className="text-xs text-osint-muted">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => fetchData(false)}
            disabled={isRefreshing}
            className="p-1 rounded hover:bg-osint-border transition-colors"
            title="Refresh data"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-osint-muted ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Metrics Grid */}
      <div className={`grid ${compact ? 'grid-cols-4 gap-3' : 'grid-cols-2 md:grid-cols-4 gap-6'} mb-4`}>
        <MetricGauge
          value={data.avg_stability}
          label="Overall Stability"
          description="Higher is better"
          icon={Shield}
          compact={compact}
        />
        <MetricGauge
          value={data.avg_communal_tension}
          label="Communal Tension"
          inverted
          description="Lower is better"
          icon={Users}
          compact={compact}
        />
        <MetricGauge
          value={data.avg_violent_crime}
          label="Crime Index"
          inverted
          description="Lower is better"
          icon={AlertTriangle}
          compact={compact}
        />
        <MetricGauge
          value={data.avg_economic_health}
          label="Economic Health"
          description="Higher is better"
          icon={DollarSign}
          compact={compact}
        />
      </div>

      {/* Stats Row */}
      <div className={`grid ${compact ? 'grid-cols-4 gap-2' : 'grid-cols-2 md:grid-cols-4 gap-3'} mb-4`}>
        <StatCard
          value={data.total_stories_24h}
          label="Stories (24h)"
          icon={<Activity className={compact ? 'w-3 h-3' : 'w-4 h-4'} />}
          color="text-osint-accent"
          compact={compact}
        />
        <StatCard
          value={data.total_events_24h}
          label="Events (24h)"
          icon={<TrendingUp className={compact ? 'w-3 h-3' : 'w-4 h-4'} />}
          color="text-blue-400"
          compact={compact}
        />
        <StatCard
          value={data.murders_24h}
          label="Murders (24h)"
          icon={<AlertTriangle className={compact ? 'w-3 h-3' : 'w-4 h-4'} />}
          color="text-red-400"
          compact={compact}
        />
        <StatCard
          value={data.violent_crimes_24h}
          label="Violent Crimes"
          icon={<TrendingDown className={compact ? 'w-3 h-3' : 'w-4 h-4'} />}
          color="text-orange-400"
          compact={compact}
        />
      </div>

      {/* Risk Districts */}
      {(data.high_risk_districts.length > 0 || data.critical_districts.length > 0) && (
        <div className="border-t border-osint-border pt-3">
          <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-osint-muted mb-2`}>Districts at Risk</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.critical_districts.map((d) => (
              <span
                key={d}
                className={`px-2 py-0.5 bg-red-500/20 text-red-400 rounded ${compact ? 'text-xs' : 'text-sm'} border border-red-500/30`}
              >
                {d}
              </span>
            ))}
            {data.high_risk_districts.map((d) => (
              <span
                key={d}
                className={`px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded ${compact ? 'text-xs' : 'text-sm'} border border-orange-500/30`}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
