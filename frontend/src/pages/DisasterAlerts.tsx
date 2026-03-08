import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  RefreshCw,
  Clock,
  MapPin,
  CheckCircle2,
  Skull,
  Users,
  Home,
  TrendingUp,
  Filter,
  ChevronDown,
  ChevronRight,
  Flame,
  Droplets,
  Mountain,
  Zap,
  Wind,
  Snowflake,
  Bug,
} from 'lucide-react'
import {
  getActiveAlerts,
  getRecentIncidents,
  getAlertStats,
  syncBipadData,
  formatHazardType,
  type DisasterAlert,
  type DisasterIncident,
  type AlertStats,
} from '../api/disasterAlerts'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

const REFRESH_INTERVAL = 5 * 60 * 1000
const SYNC_INTERVAL = 5 * 60 * 1000  // Auto-sync from BIPAD every 5 minutes

// Hazard icons mapping
const hazardIcons: Record<string, typeof Flame> = {
  fire: Flame,
  forest_fire: Flame,
  flood: Droplets,
  landslide: Mountain,
  earthquake: TrendingUp,
  lightning: Zap,
  wind_storm: Wind,
  cold_wave: Snowflake,
  epidemic: Bug,
}

const getHazardIconComponent = (hazardType: string | null) => {
  return hazardIcons[hazardType || ''] || AlertTriangle
}

// Severity colors - more subtle
const severityConfig = {
  danger: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', dot: 'bg-red-500' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', dot: 'bg-amber-500' },
  watch: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', dot: 'bg-yellow-500' },
  normal: { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-400', dot: 'bg-slate-500' },
}

export default function DisasterAlertsPage() {
  const [activeTab, setActiveTab] = useState<'alerts' | 'incidents'>('alerts')
  const [alerts, setAlerts] = useState<DisasterAlert[]>([])
  const [incidents, setIncidents] = useState<DisasterIncident[]>([])
  const [stats, setStats] = useState<AlertStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const [severityFilter, setSeverityFilter] = useState<string>('')
  const [hazardFilter, setHazardFilter] = useState<string>('')
  const [daysFilter, setDaysFilter] = useState<number>(7)

  const loadData = useCallback(async () => {
    try {
      // Stats endpoint auto-syncs from BIPAD if data is stale (> 10 min)
      const [alertsData, incidentsData, statsData] = await Promise.all([
        getActiveAlerts(severityFilter || undefined, hazardFilter || undefined),
        getRecentIncidents(daysFilter, hazardFilter || undefined),
        getAlertStats(),
      ])
      setAlerts(alertsData)
      setIncidents(incidentsData)
      setStats(statsData)
      setLastUpdated(statsData.last_synced_at ? new Date(statsData.last_synced_at) : new Date())
      setSyncError(null)
    } catch (error) {
      console.error('Failed to load disaster data:', error)
      setSyncError('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [severityFilter, hazardFilter, daysFilter])

  // Initial load + trigger sync to ensure fresh data
  useEffect(() => {
    const initialLoad = async () => {
      // Trigger a BIPAD sync first, then load data
      try {
        await syncBipadData(true, true, 50)
      } catch {
        // Sync failed - will still show cached data
      }
      loadData()
    }
    initialLoad()
  }, [])

  // Auto-refresh: re-fetches from DB (stats endpoint auto-syncs if stale)
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(loadData, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [autoRefresh, loadData])

  // Periodic sync: explicitly trigger BIPAD sync every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return
    const syncInterval = setInterval(async () => {
      try {
        await syncBipadData(true, true, 50)
        loadData()
      } catch {
        // Silent fail - stats endpoint will auto-sync if needed
      }
    }, SYNC_INTERVAL)
    return () => clearInterval(syncInterval)
  }, [autoRefresh, loadData])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      await syncBipadData(true, true, 100)
      await loadData()
    } catch (error) {
      console.error('Sync failed:', error)
      setSyncError('Sync failed - check connection')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const dangerCount = stats?.by_severity?.danger || 0
  const warningCount = stats?.by_severity?.warning || 0

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-100">Disaster Monitoring</h1>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>BIPAD Portal</span>
                {lastUpdated && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </>
                )}
                {syncError && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="text-red-400">{syncError}</span>
                  </>
                )}
                {!syncError && autoRefresh && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="flex items-center gap-1 text-emerald-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Auto
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Stats Inline */}
            {dangerCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded text-xs">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 font-medium">{dangerCount} Danger</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-amber-400 font-medium">{warningCount} Warning</span>
              </div>
            )}

            <div className="w-px h-6 bg-zinc-700 mx-1" />

            <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-3 h-3 rounded bg-zinc-700 border-zinc-600 text-cyan-500 focus:ring-0 focus:ring-offset-0"
              />
              Auto
            </label>

            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700
                         disabled:opacity-50 text-xs text-zinc-300 rounded transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sync
            </button>
          </div>
        </div>
      </div>

      {/* Stats Row - Compact */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <StatItem label="Active Alerts" value={stats?.active_alerts || 0} />
          <StatItem label="24h Incidents" value={stats?.recent_incidents_24h || 0} />
          <StatItem label="7d Incidents" value={stats?.recent_incidents_7d || 0} />

          <div className="flex-1" />

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors
              ${showFilters ? 'bg-cyan-500/10 text-cyan-400' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Collapsible Filters */}
        {showFilters && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-800">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
            >
              <option value="">All Severities</option>
              <option value="danger">Danger</option>
              <option value="warning">Warning</option>
              <option value="watch">Watch</option>
            </select>
            <select
              value={hazardFilter}
              onChange={(e) => setHazardFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
            >
              <option value="">All Hazards</option>
              <option value="fire">Fire</option>
              <option value="flood">Flood</option>
              <option value="landslide">Landslide</option>
              <option value="earthquake">Earthquake</option>
              <option value="lightning">Lightning</option>
            </select>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
            >
              <option value={1}>24 hours</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 px-4 border-b border-zinc-800">
        <div className="flex gap-1">
          <TabButton
            active={activeTab === 'alerts'}
            onClick={() => setActiveTab('alerts')}
            count={alerts.length}
            label="Active Alerts"
            hasUrgent={dangerCount > 0}
          />
          <TabButton
            active={activeTab === 'incidents'}
            onClick={() => setActiveTab('incidents')}
            count={incidents.length}
            label="Recent Incidents"
          />
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'alerts' ? (
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <EmptyState message="No active alerts" />
            ) : (
              alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {incidents.length === 0 ? (
              <EmptyState message="No recent incidents" />
            ) : (
              incidents.map((incident) => <IncidentCard key={incident.id} incident={incident} />)
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-lg font-semibold text-zinc-100 tabular-nums">{value}</span>
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  count,
  label,
  hasUrgent
}: {
  active: boolean
  onClick: () => void
  count: number
  label: string
  hasUrgent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-cyan-500 text-cyan-400'
          : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      <span className="flex items-center gap-2">
        {hasUrgent && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
        {label}
        <span className={`text-xs ${active ? 'text-cyan-500/70' : 'text-zinc-600'}`}>
          {count}
        </span>
      </span>
    </button>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
      <CheckCircle2 className="w-8 h-8 mb-2 text-zinc-600" />
      <span className="text-sm">{message}</span>
    </div>
  )
}

function AlertCard({ alert }: { alert: DisasterAlert }) {
  const [expanded, setExpanded] = useState(false)
  const config = severityConfig[alert.severity as keyof typeof severityConfig] || severityConfig.normal
  const HazardIcon = getHazardIconComponent(alert.hazard_type)

  return (
    <div
      className={`${config.bg} border ${config.border} rounded-lg cursor-pointer
                  hover:bg-opacity-20 transition-all`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3 p-3">
        <div className={`p-1.5 rounded ${config.bg}`}>
          <HazardIcon className={`w-4 h-4 ${config.text}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
            <span className={`text-xs font-medium uppercase tracking-wide ${config.text}`}>
              {alert.severity}
            </span>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-xs text-zinc-500">{formatHazardType(alert.hazard_type)}</span>
            {alert.verified && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            )}
          </div>

          <h3 className="text-sm font-medium text-zinc-200 leading-tight">{alert.title}</h3>

          {alert.district && (
            <div className="flex items-center gap-1 mt-1 text-xs text-zinc-500">
              <MapPin className="w-3 h-3" />
              {alert.district}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-600">
          {alert.created_at && (
            <span>{new Date(alert.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          )}
          <ChevronRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && alert.description && (
        <div className="px-3 pb-3 pt-0">
          <div className="pl-9 pt-2 border-t border-zinc-800/50">
            <p className="text-xs text-zinc-400 leading-relaxed">{alert.description}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function IncidentCard({ incident }: { incident: DisasterIncident }) {
  const [expanded, setExpanded] = useState(false)
  const HazardIcon = getHazardIconComponent(incident.hazard_type)
  const hasCasualties = (incident.deaths || 0) > 0 || (incident.injured || 0) > 0

  return (
    <div
      className="bg-zinc-800/30 border border-zinc-800 rounded-lg cursor-pointer
                 hover:bg-zinc-800/50 transition-all"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="p-1.5 rounded bg-zinc-800">
          <HazardIcon className="w-4 h-4 text-zinc-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-zinc-500">{formatHazardType(incident.hazard_type)}</span>
            {incident.verified && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            )}
          </div>

          <h3 className="text-sm font-medium text-zinc-200 leading-tight">{incident.title}</h3>

          {incident.district && (
            <div className="flex items-center gap-1 mt-1 text-xs text-zinc-500">
              <MapPin className="w-3 h-3" />
              {incident.district}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {hasCasualties && (
            <div className="flex items-center gap-2 text-xs">
              {(incident.deaths || 0) > 0 && (
                <span className="flex items-center gap-0.5 text-red-400">
                  <Skull className="w-3 h-3" />
                  {incident.deaths}
                </span>
              )}
              {(incident.injured || 0) > 0 && (
                <span className="flex items-center gap-0.5 text-amber-400">
                  <Users className="w-3 h-3" />
                  {incident.injured}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            {incident.incident_date && (
              <span>{new Date(incident.incident_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            )}
            <ChevronRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0">
          <div className="pl-9 pt-2 border-t border-zinc-800/50">
            {incident.description && (
              <p className="text-xs text-zinc-400 leading-relaxed mb-2">{incident.description}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Skull className="w-3 h-3" />
                <span>{incident.deaths || 0} deaths</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Users className="w-3 h-3" />
                <span>{incident.injured || 0} injured</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Home className="w-3 h-3" />
                <span>{incident.houses_destroyed || 0} destroyed</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
