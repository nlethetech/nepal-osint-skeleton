import { useState, useEffect, useRef } from 'react'
import { Activity, TrendingUp, TrendingDown, AlertTriangle, Clock, Wifi, WifiOff } from 'lucide-react'

interface MetricUpdate {
  metric_id: string
  name: string
  value: number
  previous_value: number
  unit: string
  timestamp: string
  category: 'security' | 'economic' | 'political' | 'social'
}

interface RealTimeMetricsProps {
  wsUrl?: string
  refreshIntervalMs?: number
}

export function RealTimeMetrics({
  wsUrl = 'ws://localhost:8000/ws/metrics',
  refreshIntervalMs = 5000
}: RealTimeMetricsProps) {
  const [metrics, setMetrics] = useState<Map<string, MetricUpdate>>(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  // Mock data for demonstration
  const mockMetrics: MetricUpdate[] = [
    {
      metric_id: 'events_24h',
      name: 'Events (24h)',
      value: 127,
      previous_value: 115,
      unit: 'events',
      timestamp: new Date().toISOString(),
      category: 'security'
    },
    {
      metric_id: 'active_alerts',
      name: 'Active Alerts',
      value: 12,
      previous_value: 8,
      unit: 'alerts',
      timestamp: new Date().toISOString(),
      category: 'security'
    },
    {
      metric_id: 'trade_volume',
      name: 'Trade Volume',
      value: 2.4,
      previous_value: 2.1,
      unit: 'B NPR',
      timestamp: new Date().toISOString(),
      category: 'economic'
    },
    {
      metric_id: 'risk_index',
      name: 'Risk Index',
      value: 62,
      previous_value: 58,
      unit: '/100',
      timestamp: new Date().toISOString(),
      category: 'security'
    },
    {
      metric_id: 'entities_tracked',
      name: 'Entities Tracked',
      value: 1543,
      previous_value: 1521,
      unit: 'entities',
      timestamp: new Date().toISOString(),
      category: 'political'
    },
    {
      metric_id: 'economic_health',
      name: 'Economic Health',
      value: 52,
      previous_value: 54,
      unit: '/100',
      timestamp: new Date().toISOString(),
      category: 'economic'
    }
  ]

  useEffect(() => {
    // Initialize with mock data
    const initialMetrics = new Map<string, MetricUpdate>()
    mockMetrics.forEach(m => initialMetrics.set(m.metric_id, m))
    setMetrics(initialMetrics)
    setIsConnected(true)
    setLastUpdate(new Date())

    // Simulate WebSocket updates with random fluctuations
    const interval = setInterval(() => {
      setMetrics(prev => {
        const updated = new Map(prev)
        updated.forEach((metric, key) => {
          const change = (Math.random() - 0.5) * 10
          const newValue = Math.max(0, metric.value + change)
          updated.set(key, {
            ...metric,
            previous_value: metric.value,
            value: Math.round(newValue * 10) / 10,
            timestamp: new Date().toISOString()
          })
        })
        return updated
      })
      setLastUpdate(new Date())
    }, refreshIntervalMs)

    return () => {
      clearInterval(interval)
    }
  }, [refreshIntervalMs])

  const getChangePercent = (current: number, previous: number): number => {
    if (previous === 0) return 0
    return ((current - previous) / previous) * 100
  }

  const getCategoryColor = (category: string): string => {
    switch (category) {
      case 'security':
        return 'text-severity-critical'
      case 'economic':
        return 'text-entity-organization'
      case 'political':
        return 'text-entity-person'
      case 'social':
        return 'text-entity-event'
      default:
        return 'text-osint-text'
    }
  }

  const metricsArray = Array.from(metrics.values())

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="text-primary-400" size={20} />
          <h3 className="font-semibold text-osint-text">Real-Time Metrics</h3>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-1 text-severity-low text-xs">
              <Wifi size={14} />
              <span>Live</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-severity-critical text-xs">
              <WifiOff size={14} />
              <span>Disconnected</span>
            </div>
          )}
          {lastUpdate && (
            <div className="flex items-center gap-1 text-osint-muted text-xs">
              <Clock size={12} />
              <span>{lastUpdate.toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {metricsArray.map(metric => {
          const changePercent = getChangePercent(metric.value, metric.previous_value)
          const isPositive = changePercent >= 0
          const isRiskMetric = metric.name.toLowerCase().includes('risk') ||
                              metric.name.toLowerCase().includes('alert')

          return (
            <div
              key={metric.metric_id}
              className="bg-osint-bg border border-osint-border rounded-lg p-3 transition-all hover:border-primary-500"
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${getCategoryColor(metric.category)}`}>
                  {metric.category.toUpperCase()}
                </span>
                {changePercent !== 0 && (
                  <div className={`flex items-center gap-0.5 text-xs ${
                    isRiskMetric
                      ? (isPositive ? 'text-severity-critical' : 'text-severity-low')
                      : (isPositive ? 'text-severity-low' : 'text-severity-critical')
                  }`}>
                    {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span>{Math.abs(changePercent).toFixed(1)}%</span>
                  </div>
                )}
              </div>
              <p className="text-osint-muted text-xs mb-1">{metric.name}</p>
              <p className="text-osint-text text-xl font-bold">
                {metric.value.toLocaleString()}
                <span className="text-osint-muted text-xs font-normal ml-1">
                  {metric.unit}
                </span>
              </p>
            </div>
          )
        })}
      </div>

      {/* Alert Banner */}
      {metricsArray.some(m => m.name.includes('Alert') && m.value > 10) && (
        <div className="mt-3 flex items-center gap-2 bg-severity-high/10 text-severity-high text-xs p-2 rounded-lg">
          <AlertTriangle size={14} />
          <span>Elevated alert activity detected - review pending alerts</span>
        </div>
      )}
    </div>
  )
}
