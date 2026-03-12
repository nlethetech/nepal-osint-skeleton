import { useEffect, useState, useMemo, Suspense, lazy, useCallback } from 'react'
import { FileText, Calendar, Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { getAnalyticsSummary } from '../api/analytics'
import type { AnalyticsSummary } from '../types/api'
import { KPICard } from '../components/Dashboard/KPICard'
import { TrendsChart } from '../components/Dashboard/TrendsChart'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { KeyActorsPanel } from '../components/Dashboard/KeyActorsPanel'
import { ThreatMatrix } from '../components/Dashboard/ThreatMatrix'
import { ConsolidatedIntelPanel } from '../components/Dashboard/ConsolidatedIntelPanel'
import { LiveFeed } from '../components/LiveFeed'
import { useRealtime } from '../hooks/useRealtime'
import { useRealtimeStore } from '../store/realtimeSlice'
import { useSettingsStore, getDistrictsForProvinces, type Province } from '../store/slices/settingsSlice'

const NationalOverview = lazy(() => import('../components/metrics/NationalOverview').then(m => ({ default: m.NationalOverview })))
const CrimeBreakdown = lazy(() => import('../components/metrics/CrimeBreakdown').then(m => ({ default: m.CrimeBreakdown })))
const ProvinceComparison = lazy(() => import('../components/metrics/ProvinceComparison').then(m => ({ default: m.ProvinceComparison })))

const TIME_OPTIONS = [
  { label: '24h', value: 24 },
  { label: '3d', value: 72 },
  { label: '7d', value: 168 },
  { label: '30d', value: 720 },
]

const AUTO_REFRESH_INTERVAL = 30000

type TabType = 'intel' | 'analytics' | 'live'

const TABS: { id: TabType; label: string; mobileOnly?: boolean }[] = [
  { id: 'intel', label: 'Intelligence' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'live', label: 'Feed', mobileOnly: true },
]

function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${isConnected ? 'text-severity-low' : 'text-osint-muted'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-severity-low' : 'bg-osint-muted'}`} />
      {isConnected ? 'Live' : 'Offline'}
    </span>
  )
}

function ComponentLoader() {
  return (
    <div className="card p-4 min-h-[120px] flex items-center justify-center">
      <LoadingSpinner />
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState(72)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('intel')

  const { isConnected } = useRealtime()
  const dataVersion = useRealtimeStore((state) => state.dataVersion)

  // Province/district filtering from settings store
  const { selectedProvinces, isProvinceFilterEnabled } = useSettingsStore()
  const selectedDistricts = useMemo(() => {
    if (!isProvinceFilterEnabled || selectedProvinces.length === 7) return undefined
    return getDistrictsForProvinces(selectedProvinces as Province[])
  }, [selectedProvinces, isProvinceFilterEnabled])

  const fetchStats = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const data = await getAnalyticsSummary(hours, selectedDistricts)
      setStats(data)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to fetch stats:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [hours, selectedDistricts])

  useEffect(() => {
    fetchStats(true)
  }, [hours, fetchStats])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => fetchStats(false), AUTO_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchStats])

  useEffect(() => {
    if (dataVersion > 0) setLastRefresh(new Date())
  }, [dataVersion])

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    )
  }

  if (error && !stats) {
    return (
      <div className="card p-6 text-center max-w-sm mx-auto mt-8">
        <AlertTriangle className="w-5 h-5 text-severity-critical mx-auto mb-3" />
        <p className="text-sm text-osint-text mb-4">{error}</p>
        <button onClick={() => fetchStats(true)} className="btn btn-primary btn-sm">
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 pb-3 flex-shrink-0 border-b border-osint-border mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-osint-text">Dashboard</h1>
          <ConnectionStatus isConnected={isConnected} />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-osint-muted hidden md:block tabular-nums">
            {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
          >
            {autoRefresh ? 'Auto' : 'Manual'}
          </button>
          <button
            onClick={() => fetchStats(false)}
            disabled={loading}
            className="btn btn-secondary btn-icon btn-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="select input-sm w-auto"
          >
            {TIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 flex flex-col xl:grid xl:grid-cols-12 gap-4 min-h-0 overflow-hidden">
        {/* Primary Content */}
        <div className="xl:col-span-9 flex flex-col gap-4 overflow-y-auto flex-1 xl:flex-none min-h-0 scroll-fade" style={{ '--scroll-fade-color': '#0c0c0e' } as React.CSSProperties}>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard title="Stories" value={stats?.stories || 0} icon={FileText} color="text-osint-primary" />
            <KPICard title="Events" value={stats?.events || 0} icon={Calendar} color="text-severity-high" />
            <KPICard title="Entities" value={stats?.entities || 0} icon={Users} color="text-severity-low" />
            <KPICard title="Alerts" value={stats?.active_alerts || 0} icon={AlertTriangle} color="text-severity-critical" />
          </div>

          {/* Threat Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ErrorBoundary>
              <ThreatMatrix hours={hours} districts={selectedDistricts} compact />
            </ErrorBoundary>
            <ErrorBoundary>
              <KeyActorsPanel hours={hours} limit={5} districts={selectedDistricts} compact />
            </ErrorBoundary>
          </div>

          {/* Tabs */}
          <div className="tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`tab ${tab.mobileOnly ? 'xl:hidden' : ''} ${activeTab === tab.id ? 'tab-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-[200px]">
            {activeTab === 'intel' && (
              <div className="space-y-3">
                <ErrorBoundary>
                  <ConsolidatedIntelPanel hours={hours} limit={500} pageSize={6} districts={selectedDistricts} compact />
                </ErrorBoundary>
                {stats?.top_event_types && stats.top_event_types.length > 0 && (
                  <div className="card p-3 hidden sm:block">
                    <h3 className="text-xs font-medium text-osint-muted uppercase mb-2">Event Types</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {stats.top_event_types.slice(0, 6).map((event) => (
                        <div key={event.event_type} className="flex items-center justify-between text-xs">
                          <span className="text-osint-text-secondary capitalize truncate">
                            {event.event_type.replace('_', ' ')}
                          </span>
                          <span className="text-osint-muted tabular-nums ml-2">{event.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'analytics' && (
              <div className="space-y-3">
                <ErrorBoundary>
                  <Suspense fallback={<ComponentLoader />}>
                    <NationalOverview />
                  </Suspense>
                </ErrorBoundary>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <ErrorBoundary>
                    <Suspense fallback={<ComponentLoader />}>
                      <CrimeBreakdown />
                    </Suspense>
                  </ErrorBoundary>
                  <ErrorBoundary>
                    <Suspense fallback={<ComponentLoader />}>
                      <ProvinceComparison />
                    </Suspense>
                  </ErrorBoundary>
                </div>
                <div className="card p-3">
                  <h3 className="text-xs font-medium text-osint-muted uppercase mb-2">Trends</h3>
                  <div className="h-40">
                    <ErrorBoundary>
                      <TrendsChart days={Math.floor(hours / 24)} />
                    </ErrorBoundary>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'live' && (
              <div className="xl:hidden h-[calc(100vh-400px)] min-h-[300px]">
                <ErrorBoundary>
                  <LiveFeed showAlerts={true} compact fillHeight hours={hours} />
                </ErrorBoundary>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="hidden xl:flex xl:col-span-3 flex-col min-h-0 overflow-hidden">
          <p className="text-xs font-medium text-osint-muted uppercase mb-2">Live Activity</p>
          <div className="flex-1 min-h-0">
            <ErrorBoundary>
              <LiveFeed showAlerts={true} compact fillHeight hours={hours} />
            </ErrorBoundary>
          </div>
        </aside>
      </div>
    </div>
  )
}
