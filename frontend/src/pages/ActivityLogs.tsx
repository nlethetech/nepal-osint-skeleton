/**
 * Nepal OSINT Platform v2 - Activity Logs Page
 * Dev-only view of all user activity (Palantir-style audit trail)
 */
import { useState, useEffect } from 'react'
import {
  Activity,
  User,
  Clock,
  Globe,
  Filter,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Zap,
  DollarSign,
  AlertTriangle,
  Languages,
} from 'lucide-react'
import { useAuthStore } from '../store/slices/authSlice'

interface ActivityLog {
  id: string
  user_id: string
  user_email: string | null
  action: string
  resource_type: string
  resource_path: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
  details: {
    method?: string
    status_code?: number
    query_params?: Record<string, string>
  } | null
}

interface ActivityStats {
  total_actions: number
  unique_users: number
  actions_by_type: Record<string, number>
  actions_by_resource: Record<string, number>
  top_users: Array<{ user_id: string; email: string; count: number }>
}

interface LLMCosts {
  daily_cost_usd: number
  daily_limit_usd: number
  daily_remaining_usd: number
  daily_percent_used: number
  monthly_cost_usd: number
  monthly_limit_usd: number
  circuit_breaker_pct: number
  circuit_breaker_threshold_usd: number
  circuit_breaker_triggered: boolean
  haiku_calls_today: number
  sonnet_calls_today: number
  last_updated: string
}

interface TranslationStats {
  total_chars_translated: number
  total_cost_usd: number
  cache_hits: number
  cache_misses: number
  cache_hit_rate: number
  chars_saved_by_cache: number
  estimated_cache_savings_usd: number
  initialized: boolean
}

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-green-500/20 text-green-400',
  logout: 'bg-gray-500/20 text-gray-400',
  api_view: 'bg-blue-500/20 text-blue-400',
  api_mutation: 'bg-orange-500/20 text-orange-400',
  page_view: 'bg-purple-500/20 text-purple-400',
  search: 'bg-cyan-500/20 text-cyan-400',
}

export default function ActivityLogs() {
  const { token } = useAuthStore()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [llmCosts, setLlmCosts] = useState<LLMCosts | null>(null)
  const [translationStats, setTranslationStats] = useState<TranslationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filters, setFilters] = useState({
    action: '',
    user_email: '',
  })

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '25',
      })
      if (filters.action) params.append('action', filters.action)

      const response = await fetch(`/api/v1/activity/logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setLogs(data.items)
        setTotalPages(data.total_pages)
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error)
    }
    setLoading(false)
  }

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/v1/activity/stats?days=7', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const fetchLlmCosts = async () => {
    try {
      const response = await fetch('/api/v1/activity/llm-costs')
      if (response.ok) {
        const data = await response.json()
        setLlmCosts(data)
      }
    } catch (error) {
      console.error('Failed to fetch LLM costs:', error)
    }
  }

  const fetchTranslationStats = async () => {
    try {
      const response = await fetch('/api/v1/activity/translation-stats')
      if (response.ok) {
        const data = await response.json()
        setTranslationStats(data)
      }
    } catch (error) {
      console.error('Failed to fetch translation stats:', error)
    }
  }

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const response = await fetch(`/api/v1/activity/export?format=${format}&days=7`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `activity_logs.${format}`
        a.click()
        window.URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('Failed to export:', error)
    }
  }

  useEffect(() => {
    fetchLogs()
    fetchStats()
    fetchLlmCosts()
    fetchTranslationStats()
  }, [page, filters])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-osint-text flex items-center gap-2">
            <Activity className="w-6 h-6 text-osint-accent" />
            Activity Logs
          </h1>
          <p className="text-osint-muted text-sm mt-1">
            Monitor all user activity across the platform
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchLogs()}
            className="flex items-center gap-2 px-4 py-2 bg-osint-border rounded-lg hover:bg-osint-border/80 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-2 px-4 py-2 bg-osint-accent text-white rounded-lg hover:bg-osint-accent/80 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Cost Tracking Cards - LLM + Translation */}
      <div className="grid grid-cols-2 gap-4">
        {/* LLM Cost Card */}
        {llmCosts && (
          <div className={`bg-osint-card border rounded-lg p-4 ${
            llmCosts.circuit_breaker_triggered
              ? 'border-red-500 bg-red-500/10'
              : llmCosts.daily_percent_used > 70
              ? 'border-yellow-500 bg-yellow-500/10'
              : 'border-osint-border'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  llmCosts.circuit_breaker_triggered
                    ? 'bg-red-500/20'
                    : 'bg-osint-accent/20'
                }`}>
                  <DollarSign className={`w-5 h-5 ${
                    llmCosts.circuit_breaker_triggered
                      ? 'text-red-400'
                      : 'text-osint-accent'
                  }`} />
                </div>
                <div>
                  <div className="text-sm text-osint-muted">LLM Budget Today</div>
                  <div className="text-xl font-bold text-osint-text">
                    ${llmCosts.daily_cost_usd.toFixed(3)} / ${llmCosts.daily_limit_usd.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Progress bar */}
                <div className="w-32">
                  <div className="flex justify-between text-xs text-osint-muted mb-1">
                    <span>{llmCosts.daily_percent_used.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-osint-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        llmCosts.circuit_breaker_triggered
                          ? 'bg-red-500'
                          : llmCosts.daily_percent_used > 70
                          ? 'bg-yellow-500'
                          : 'bg-osint-accent'
                      }`}
                      style={{ width: `${Math.min(100, llmCosts.daily_percent_used)}%` }}
                    />
                  </div>
                </div>

                {/* Circuit breaker status */}
                <div className="text-center">
                  <div className="text-xs text-osint-muted">Circuit</div>
                  <div className={`flex items-center gap-1 text-sm font-medium ${
                    llmCosts.circuit_breaker_triggered ? 'text-red-400' : 'text-green-400'
                  }`}>
                    {llmCosts.circuit_breaker_triggered ? (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        ON
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        {llmCosts.circuit_breaker_pct}%
                      </>
                    )}
                  </div>
                </div>

                {/* Haiku Calls */}
                <div className="text-center">
                  <div className="text-xs text-osint-muted">Haiku</div>
                  <div className="text-lg font-bold text-osint-text">
                    {llmCosts.haiku_calls_today}
                  </div>
                </div>
              </div>
            </div>

            {llmCosts.circuit_breaker_triggered && (
              <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4" />
                Budget limit - routing to Qwen
              </div>
            )}
          </div>
        )}

        {/* Translation Stats Card */}
        {translationStats && (
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Languages className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="text-sm text-osint-muted">Google Translate (Nepali)</div>
                  <div className="text-xl font-bold text-osint-text">
                    ${translationStats.total_cost_usd.toFixed(4)}
                    <span className="text-sm text-osint-muted ml-2">
                      ({(translationStats.total_chars_translated / 1000).toFixed(1)}k chars)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Cache hit rate */}
                <div className="text-center">
                  <div className="text-xs text-osint-muted">Cache Hit</div>
                  <div className="text-lg font-bold text-green-400">
                    {translationStats.cache_hit_rate.toFixed(0)}%
                  </div>
                </div>

                {/* Cache savings */}
                <div className="text-center">
                  <div className="text-xs text-osint-muted">Saved</div>
                  <div className="text-sm font-medium text-osint-text">
                    ${translationStats.estimated_cache_savings_usd.toFixed(4)}
                  </div>
                </div>

                {/* Status */}
                <div className="text-center">
                  <div className="text-xs text-osint-muted">Status</div>
                  <div className={`text-sm font-medium ${
                    translationStats.initialized ? 'text-green-400' : 'text-yellow-400'
                  }`}>
                    {translationStats.initialized ? 'Active' : 'Not Init'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-osint-muted text-sm">Total Actions (7d)</div>
            <div className="text-2xl font-bold text-osint-text mt-1">
              {stats.total_actions.toLocaleString()}
            </div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-osint-muted text-sm">Active Users</div>
            <div className="text-2xl font-bold text-osint-text mt-1">
              {stats.unique_users}
            </div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-osint-muted text-sm">Most Active</div>
            <div className="text-lg font-medium text-osint-text mt-1 truncate">
              {stats.top_users[0]?.email || 'N/A'}
            </div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-osint-muted text-sm">Top Resource</div>
            <div className="text-lg font-medium text-osint-text mt-1">
              {Object.entries(stats.actions_by_resource).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 bg-osint-card border border-osint-border rounded-lg p-4">
        <Filter className="w-5 h-5 text-osint-muted" />
        <select
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          className="bg-osint-bg border border-osint-border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Actions</option>
          <option value="login">Login</option>
          <option value="logout">Logout</option>
          <option value="api_view">API View</option>
          <option value="api_mutation">API Mutation</option>
          <option value="page_view">Page View</option>
          <option value="search">Search</option>
        </select>
      </div>

      {/* Logs Table */}
      <div className="bg-osint-card border border-osint-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-osint-bg border-b border-osint-border">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">Time</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">User</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">Action</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">Resource</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">Path</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-osint-muted">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-osint-muted">
                  No activity logs found
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-osint-border hover:bg-osint-bg/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-osint-muted" />
                      <div>
                        <div className="text-sm text-osint-text">{formatRelativeTime(log.created_at)}</div>
                        <div className="text-xs text-osint-muted">{formatTime(log.created_at)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-osint-muted" />
                      <span className="text-sm text-osint-text">{log.user_email || 'Unknown'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-gray-500/20 text-gray-400'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-osint-text">
                    {log.resource_type}
                  </td>
                  <td className="px-4 py-3 text-sm text-osint-muted font-mono truncate max-w-[200px]">
                    {log.resource_path}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-osint-muted" />
                      <span className="text-sm text-osint-muted">{log.ip_address || 'N/A'}</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 bg-osint-bg border-t border-osint-border">
          <div className="text-sm text-osint-muted">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="p-2 rounded hover:bg-osint-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="p-2 rounded hover:bg-osint-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
