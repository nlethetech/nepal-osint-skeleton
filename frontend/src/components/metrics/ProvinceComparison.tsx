/**
 * Province Comparison Component
 * Shows province-level metrics with real-time updates and compact dashboard mode
 */
import { useEffect, useState, useCallback } from 'react'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { RefreshCw, Map, AlertTriangle } from 'lucide-react'
import { getProvinceMetrics, type ProvinceMetrics } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'

interface ProvinceComparisonProps {
  refreshKey?: number
  compact?: boolean
  autoRefresh?: boolean
  refreshInterval?: number
}

const PROVINCE_COLORS: Record<string, string> = {
  Bagmati: '#3b82f6',
  Koshi: '#22c55e',
  Gandaki: '#06b6d4',
  Lumbini: '#8b5cf6',
  Madhesh: '#f97316',
  Karnali: '#ef4444',
  Sudurpashchim: '#ec4899',
}

export function ProvinceComparison({
  refreshKey = 0,
  compact = false,
  autoRefresh = true,
  refreshInterval = 60000,
}: ProvinceComparisonProps) {
  const [data, setData] = useState<ProvinceMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null)

  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setIsRefreshing(true)
    try {
      const result = await getProvinceMetrics()
      setData(result)
      setError(null)
    } catch (err) {
      setError('Failed to load province data')
      console.error(err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData(true)
  }, [fetchData, refreshKey])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchData(false)
    }, refreshInterval)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshInterval, fetchData])

  if (loading && data.length === 0) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} flex items-center justify-center min-h-[200px]`}>
        <LoadingSpinner message="Loading province comparison..." />
      </div>
    )
  }

  if (error && data.length === 0) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} text-center text-osint-muted`}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-500" />
        {error}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} text-center text-osint-muted`}>
        No province data available
      </div>
    )
  }

  // Transform data for radar chart
  const radarData = [
    { metric: 'Stability', ...Object.fromEntries(data.map(d => [d.province, d.avg_stability])) },
    { metric: 'Economic', ...Object.fromEntries(data.map(d => [d.province, d.avg_economic_health])) },
    { metric: 'Low Crime', ...Object.fromEntries(data.map(d => [d.province, 100 - d.avg_violent_crime])) },
    { metric: 'Low Tension', ...Object.fromEntries(data.map(d => [d.province, 100 - d.avg_communal_tension])) },
  ]

  const provinces = data.map(d => d.province)
  const activeProvinces = selectedProvince ? [selectedProvince] : provinces

  const cardClass = compact
    ? "bg-osint-card rounded-lg border border-osint-border p-4"
    : "bg-osint-card rounded-xl border border-osint-border p-6"

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-osint-text flex items-center gap-2`}>
          <Map className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
          Province Comparison
        </h2>
        <button
          onClick={() => fetchData(false)}
          disabled={isRefreshing}
          className="p-1 rounded hover:bg-osint-border transition-colors"
          title="Refresh data"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-osint-muted ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Province selector */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setSelectedProvince(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            !selectedProvince
              ? 'bg-osint-accent text-white'
              : 'bg-osint-bg text-osint-muted hover:bg-osint-border'
          }`}
        >
          All
        </button>
        {provinces.map((province) => (
          <button
            key={province}
            onClick={() => setSelectedProvince(selectedProvince === province ? null : province)}
            className={`px-2 py-1 rounded text-xs transition-colors border ${
              selectedProvince === province
                ? 'text-white border-transparent'
                : 'bg-osint-bg text-osint-muted hover:bg-osint-border border-osint-border'
            }`}
            style={{
              backgroundColor: selectedProvince === province ? PROVINCE_COLORS[province] : undefined,
            }}
          >
            {province}
          </button>
        ))}
      </div>

      {/* Radar Chart */}
      <div className={compact ? 'h-48' : 'h-72'}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius={compact ? "65%" : "70%"} data={radarData}>
            <PolarGrid stroke="#2a2a3a" />
            <PolarAngleAxis
              dataKey="metric"
              tick={{ fill: '#a1a1aa', fontSize: compact ? 10 : 12 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fill: '#71717a', fontSize: compact ? 8 : 10 }}
            />
            {activeProvinces.map((province) => (
              <Radar
                key={province}
                name={province}
                dataKey={province}
                stroke={PROVINCE_COLORS[province]}
                fill={PROVINCE_COLORS[province]}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a1a24',
                border: '1px solid #2a2a3a',
                borderRadius: '8px',
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Province Stats Table */}
      <div className={`${compact ? 'mt-2 pt-2' : 'mt-4 pt-4'} border-t border-osint-border overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-osint-muted text-left">
              <th className="pb-2">Province</th>
              <th className="pb-2 text-right">Stability</th>
              <th className="pb-2 text-right">Crime</th>
              <th className="pb-2 text-right">Tension</th>
              {!compact && <th className="pb-2 text-right">Districts</th>}
              <th className="pb-2 text-right">At Risk</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr
                key={p.province}
                className={`border-t border-osint-border/50 hover:bg-osint-bg/50 cursor-pointer ${
                  selectedProvince === p.province ? 'bg-osint-bg/30' : ''
                }`}
                onClick={() => setSelectedProvince(selectedProvince === p.province ? null : p.province)}
              >
                <td className="py-1.5 font-medium text-osint-text">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PROVINCE_COLORS[p.province] }}
                    />
                    <span className={compact ? 'truncate max-w-[60px]' : ''}>{p.province}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right">
                  <span
                    className={
                      p.avg_stability >= 70
                        ? 'text-green-400'
                        : p.avg_stability >= 50
                        ? 'text-yellow-400'
                        : 'text-red-400'
                    }
                  >
                    {p.avg_stability.toFixed(1)}
                  </span>
                </td>
                <td className="py-1.5 text-right text-osint-muted">
                  {p.avg_violent_crime.toFixed(1)}
                </td>
                <td className="py-1.5 text-right text-osint-muted">
                  {p.avg_communal_tension.toFixed(1)}
                </td>
                {!compact && (
                  <td className="py-1.5 text-right text-osint-muted">{p.district_count}</td>
                )}
                <td className="py-1.5 text-right">
                  {p.high_risk_count > 0 ? (
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] border border-red-500/30">
                      {p.high_risk_count}
                    </span>
                  ) : (
                    <span className="text-osint-muted">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
