/**
 * Trends Chart Component
 * Shows event trends over time with real-time updates
 */
import { useEffect, useState, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { getTrends } from '../../api/analytics'
import type { EventTrend } from '../../types/api'
import { LoadingSpinner } from '../common/LoadingSpinner'

interface TrendsChartProps {
  days?: number
  refreshKey?: number
  autoRefresh?: boolean
  refreshInterval?: number
  compact?: boolean
}

// Colors for different event types
const EVENT_COLORS: Record<string, string> = {
  protest: '#ef4444',
  election: '#3b82f6',
  flood: '#06b6d4',
  earthquake: '#f97316',
  corruption: '#a855f7',
  crime: '#ec4899',
  terrorism: '#dc2626',
  diplomacy: '#22c55e',
}

export function TrendsChart({
  days = 30,
  refreshKey = 0,
  autoRefresh = true,
  refreshInterval = 60000,
  compact = false,
}: TrendsChartProps) {
  const [trends, setTrends] = useState<EventTrend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTrends = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const result = await getTrends(days)
      setTrends(result)
      setError(null)
    } catch (err) {
      setError('Failed to load trend data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    fetchTrends(true)
  }, [fetchTrends, refreshKey])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchTrends(false)
    }, refreshInterval)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshInterval, fetchTrends])

  if (loading && trends.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner message="Loading trends..." />
      </div>
    )
  }

  if (error && trends.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-osint-muted text-sm">
        {error}
      </div>
    )
  }

  if (trends.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-osint-muted text-sm">
        No trend data available
      </div>
    )
  }

  // Transform data for Recharts - merge all trends into single data points by date
  const mergedData: Record<string, Record<string, number>> = {}

  trends.forEach((trend) => {
    trend.trend.forEach((point) => {
      if (!mergedData[point.date]) {
        mergedData[point.date] = {}
      }
      mergedData[point.date][trend.event_type] = point.count
    })
  })

  const chartData = Object.entries(mergedData)
    .map(([date, counts]) => ({
      date,
      ...counts,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const eventTypes = trends.map((t) => t.event_type)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: compact ? 10 : 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
        <XAxis
          dataKey="date"
          stroke="#71717a"
          tick={{ fill: '#71717a', fontSize: compact ? 10 : 12 }}
          tickFormatter={(value) => {
            const date = new Date(value)
            return `${date.getMonth() + 1}/${date.getDate()}`
          }}
        />
        <YAxis stroke="#71717a" tick={{ fill: '#71717a', fontSize: compact ? 10 : 12 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1a1a24',
            border: '1px solid #2a2a3a',
            borderRadius: '8px',
            fontSize: compact ? '12px' : '14px',
          }}
          labelStyle={{ color: '#e4e4e7' }}
        />
        {!compact && (
          <Legend
            wrapperStyle={{ paddingTop: '10px' }}
            formatter={(value) => (
              <span className="text-osint-text capitalize text-sm">{value.replace('_', ' ')}</span>
            )}
          />
        )}
        {eventTypes.map((eventType) => (
          <Line
            key={eventType}
            type="monotone"
            dataKey={eventType}
            stroke={EVENT_COLORS[eventType] || '#3b82f6'}
            strokeWidth={compact ? 1.5 : 2}
            dot={false}
            activeDot={{ r: compact ? 3 : 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
