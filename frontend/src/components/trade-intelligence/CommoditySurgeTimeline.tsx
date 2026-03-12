import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  TrendingUp,
  Shield,
  Radio,
  HeartPulse,
  Target,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
  Eye,
  CheckCircle,
  XCircle,
  Filter,
} from 'lucide-react'
import apiClient from '../../api/client'

// ============================================================================
// TYPES
// ============================================================================

interface TradeSurgeAlert {
  id: string
  hs_code: string
  hs_chapter: string | null
  commodity_description: string | null
  fiscal_year: string
  month: number | null
  month_name: string | null
  detection_method: string
  anomaly_score: number
  zscore: number | null
  pelt_detected: boolean
  cusum_detected: boolean
  baseline_value: number
  observed_value: number
  deviation_percentage: number
  absolute_change: number
  is_import: boolean
  primary_country: string | null
  pre_event_indicator: boolean
  pre_event_score: number | null
  correlated_events: any[] | null
  similar_historical_patterns: any[] | null
  status: string
  severity: string
  created_at: string
  acknowledged_at: string | null
}

interface SensitiveCategory {
  category_id: string
  display_name: string
  description: string
  intelligence_value: string
  priority: number
  hs_codes: Array<{
    hs_code: string
    description: string
    chapter: string
    heading: string
    specific_items: string[]
    notes: string | null
  }>
}

interface HistoricalPattern {
  event_name: string
  event_date: string
  nepali_date: string
  event_type: string
  pre_event_surges: any[]
  post_event_surges: any[]
  notes: string | null
}

interface SurgeStats {
  fiscal_year: string
  total_surges: number
  by_severity: Record<string, number>
  by_status: Record<string, number>
  pre_event_indicators: number
  top_surges: Array<{
    hs_code: string
    description: string | null
    deviation_percentage: number
    severity: string
  }>
  sensitive_categories_monitored: number
  total_hs_codes_monitored: number
}

// ============================================================================
// HELPERS
// ============================================================================

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-red-400 bg-red-500/20 border-red-500/30'
    case 'high':
      return 'text-orange-400 bg-orange-500/20 border-orange-500/30'
    case 'medium':
      return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30'
    case 'low':
      return 'text-blue-400 bg-blue-500/20 border-blue-500/30'
    default:
      return 'text-osint-muted bg-osint-bg-secondary border-osint-border'
  }
}

function getSeverityBadgeColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/30 text-red-300 border border-red-500/40'
    case 'high':
      return 'bg-orange-500/30 text-orange-300 border border-orange-500/40'
    case 'medium':
      return 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/40'
    case 'low':
      return 'bg-blue-500/30 text-blue-300 border border-blue-500/40'
    default:
      return 'bg-osint-bg-secondary text-osint-muted'
  }
}

function getCategoryIcon(categoryId: string): any {
  switch (categoryId) {
    case 'protective_gear':
      return Shield
    case 'communication_equipment':
      return Radio
    case 'medical_supplies':
      return HeartPulse
    case 'crowd_control':
      return Target
    default:
      return AlertTriangle
  }
}

function formatNepaliMonth(month: number | null, monthName: string | null): string {
  if (monthName) return monthName
  const months = [
    'Baishakh', 'Jestha', 'Ashad', 'Shrawan',
    'Bhadra', 'Ashwin', 'Kartik', 'Mangsir',
    'Poush', 'Magh', 'Falgun', 'Chaitra'
  ]
  return month ? months[month - 1] : ''
}

function formatDeviation(deviation: number): string {
  const sign = deviation >= 0 ? '+' : ''
  return `${sign}${deviation.toFixed(0)}%`
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CommoditySurgeTimeline() {
  // State
  const [surgeAlerts, setSurgeAlerts] = useState<TradeSurgeAlert[]>([])
  const [categories, setCategories] = useState<SensitiveCategory[]>([])
  const [historicalPatterns, setHistoricalPatterns] = useState<HistoricalPattern[]>([])
  const [stats, setStats] = useState<SurgeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedFY, setSelectedFY] = useState<string>('')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('')
  const [preEventOnly, setPreEventOnly] = useState(false)
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null)

  // Fetch data
  useEffect(() => {
    fetchData()
  }, [selectedFY, selectedSeverity, preEventOnly])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      // Fetch surge alerts
      const params = new URLSearchParams()
      if (selectedFY) params.append('fiscal_year', selectedFY)
      if (selectedSeverity) params.append('severity', selectedSeverity)
      if (preEventOnly) params.append('pre_event_only', 'true')
      params.append('limit', '50')

      const [alertsRes, categoriesRes, patternsRes, statsRes] = await Promise.all([
        apiClient.get(`/trade-intelligence/surges?${params.toString()}`),
        apiClient.get('/trade-intelligence/sensitive-commodities'),
        apiClient.get('/trade-intelligence/historical-patterns'),
        apiClient.get(`/trade-intelligence/summary${selectedFY ? `?fiscal_year=${selectedFY}` : ''}`),
      ])

      setSurgeAlerts(alertsRes.data)
      setCategories(categoriesRes.data)
      setHistoricalPatterns(patternsRes.data)
      setStats(statsRes.data)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  async function updateAlertStatus(alertId: string, status: string) {
    try {
      await apiClient.put(`/trade-intelligence/surges/${alertId}/status?status=${status}`)
      fetchData() // Refresh
    } catch (err: any) {
      console.error('Failed to update alert status:', err)
    }
  }

  async function runDetection() {
    try {
      const response = await apiClient.post('/trade-intelligence/surges/detect', {
        fiscal_year: selectedFY || '2082/83',
        sensitive_only: true,
      })
      alert(`Detection complete: ${response.data.surges_detected} surges found`)
      fetchData()
    } catch (err: any) {
      alert(`Detection failed: ${err.message}`)
    }
  }

  // Render
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-osint-text flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Commodity Surge Intelligence
          </h2>
          <p className="text-sm text-osint-muted mt-1">
            Pre-event indicator detection for sensitive commodities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runDetection}
            className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Run Detection
          </button>
          <button
            onClick={fetchData}
            className="p-1.5 rounded bg-osint-bg-secondary hover:bg-osint-bg-hover"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <div className="p-4 bg-osint-bg-secondary rounded-lg border border-osint-border">
            <div className="text-2xl font-bold text-osint-text">{stats.total_surges}</div>
            <div className="text-xs text-osint-muted">Total Surges</div>
          </div>
          <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30">
            <div className="text-2xl font-bold text-red-400">
              {(stats.by_severity?.critical || 0) + (stats.by_severity?.high || 0)}
            </div>
            <div className="text-xs text-red-300">Critical/High</div>
          </div>
          <div className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/30">
            <div className="text-2xl font-bold text-amber-400">{stats.pre_event_indicators}</div>
            <div className="text-xs text-amber-300">Pre-Event Indicators</div>
          </div>
          <div className="p-4 bg-osint-bg-secondary rounded-lg border border-osint-border">
            <div className="text-2xl font-bold text-osint-text">{stats.sensitive_categories_monitored}</div>
            <div className="text-xs text-osint-muted">Categories Monitored</div>
          </div>
          <div className="p-4 bg-osint-bg-secondary rounded-lg border border-osint-border">
            <div className="text-2xl font-bold text-osint-text">{stats.total_hs_codes_monitored}</div>
            <div className="text-xs text-osint-muted">HS Codes Tracked</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 bg-osint-bg-secondary rounded-lg border border-osint-border">
        <Filter className="w-4 h-4 text-osint-muted" />
        <select
          value={selectedFY}
          onChange={(e) => setSelectedFY(e.target.value)}
          className="px-3 py-1.5 bg-osint-bg-tertiary border border-osint-border rounded text-sm"
        >
          <option value="">All Fiscal Years</option>
          <option value="2082/83">2082/83 (Gen-Z Protests)</option>
          <option value="2081/82">2081/82</option>
          <option value="2080/81">2080/81</option>
          <option value="2079/80">2079/80</option>
          <option value="2078/79">2078/79</option>
          <option value="2077/78">2077/78 (COVID)</option>
        </select>
        <select
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          className="px-3 py-1.5 bg-osint-bg-tertiary border border-osint-border rounded text-sm"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-osint-muted">
          <input
            type="checkbox"
            checked={preEventOnly}
            onChange={(e) => setPreEventOnly(e.target.checked)}
            className="rounded border-osint-border"
          />
          Pre-Event Only
        </label>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-osint-muted" />
        </div>
      )}

      {/* Surge Alerts Timeline */}
      {!loading && surgeAlerts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-osint-muted uppercase tracking-wide">
            Detected Surges ({surgeAlerts.length})
          </h3>
          {surgeAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-4 rounded-lg border ${getSeverityColor(alert.severity)} transition-all`}
            >
              {/* Alert Header */}
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded ${getSeverityBadgeColor(alert.severity)}`}>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-medium text-osint-text flex items-center gap-2">
                      {alert.commodity_description || `HS ${alert.hs_code}`}
                      {alert.pre_event_indicator && (
                        <span className="px-2 py-0.5 text-xs bg-amber-500/30 text-amber-300 rounded">
                          PRE-EVENT
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-osint-muted flex items-center gap-2">
                      <span>HS {alert.hs_code}</span>
                      <span>|</span>
                      <span>{alert.fiscal_year}</span>
                      {alert.month && (
                        <>
                          <span>|</span>
                          <span>{formatNepaliMonth(alert.month, alert.month_name)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className={`text-lg font-bold ${
                      alert.deviation_percentage >= 200 ? 'text-red-400' :
                      alert.deviation_percentage >= 100 ? 'text-orange-400' : 'text-yellow-400'
                    }`}>
                      {formatDeviation(alert.deviation_percentage)}
                    </div>
                    <div className="text-xs text-osint-muted">vs baseline</div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded ${getSeverityBadgeColor(alert.severity)}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                  {expandedAlert === alert.id ? (
                    <ChevronUp className="w-4 h-4 text-osint-muted" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-osint-muted" />
                  )}
                </div>
              </div>

              {/* Expanded Details */}
              {expandedAlert === alert.id && (
                <div className="mt-4 pt-4 border-t border-osint-border/50 space-y-4">
                  {/* Detection Details */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <h4 className="text-xs text-osint-muted uppercase">Detection Method</h4>
                      <div className="flex items-center gap-2">
                        {alert.zscore && (
                          <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded">
                            Z-score: {alert.zscore.toFixed(1)}
                          </span>
                        )}
                        {alert.pelt_detected && (
                          <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded">
                            PELT
                          </span>
                        )}
                        {alert.cusum_detected && (
                          <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-300 rounded">
                            CUSUM
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs text-osint-muted uppercase">Values</h4>
                      <div className="text-sm">
                        <div>Baseline: NPR {(alert.baseline_value / 10000000).toFixed(2)} Cr</div>
                        <div>Observed: NPR {(alert.observed_value / 10000000).toFixed(2)} Cr</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs text-osint-muted uppercase">Pre-Event Score</h4>
                      <div className="flex items-center gap-2">
                        <div className="w-full bg-osint-bg-tertiary rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              (alert.pre_event_score || 0) >= 0.7 ? 'bg-amber-400' :
                              (alert.pre_event_score || 0) >= 0.4 ? 'bg-yellow-400' : 'bg-blue-400'
                            }`}
                            style={{ width: `${(alert.pre_event_score || 0) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm">{((alert.pre_event_score || 0) * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Similar Historical Patterns */}
                  {alert.similar_historical_patterns && alert.similar_historical_patterns.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs text-osint-muted uppercase">Similar Historical Patterns</h4>
                      <div className="flex flex-wrap gap-2">
                        {alert.similar_historical_patterns.map((pattern, idx) => (
                          <div
                            key={idx}
                            className="px-3 py-1.5 bg-osint-bg-tertiary rounded text-sm flex items-center gap-2"
                          >
                            <Clock className="w-3 h-3 text-osint-muted" />
                            <span>{pattern.event_name}</span>
                            <span className="text-osint-muted">({pattern.event_date})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    {alert.status === 'new' && (
                      <button
                        onClick={() => updateAlertStatus(alert.id, 'acknowledged')}
                        className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded text-sm flex items-center gap-1 hover:bg-blue-500/30"
                      >
                        <Eye className="w-3 h-3" />
                        Acknowledge
                      </button>
                    )}
                    <button
                      onClick={() => updateAlertStatus(alert.id, 'confirmed')}
                      className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded text-sm flex items-center gap-1 hover:bg-green-500/30"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Confirm
                    </button>
                    <button
                      onClick={() => updateAlertStatus(alert.id, 'false_positive')}
                      className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded text-sm flex items-center gap-1 hover:bg-red-500/30"
                    >
                      <XCircle className="w-3 h-3" />
                      False Positive
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* No Alerts */}
      {!loading && surgeAlerts.length === 0 && (
        <div className="p-8 text-center text-osint-muted bg-osint-bg-secondary rounded-lg border border-osint-border">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No surge alerts found for the selected filters.</p>
          <p className="text-sm mt-2">Try running detection or adjusting your filters.</p>
        </div>
      )}

      {/* Historical Patterns Reference */}
      {historicalPatterns.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-osint-muted uppercase tracking-wide mb-4">
            Historical Reference Patterns
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {historicalPatterns.map((pattern, idx) => (
              <div
                key={idx}
                className="p-4 bg-osint-bg-secondary rounded-lg border border-osint-border"
              >
                <div className="font-medium text-osint-text">{pattern.event_name}</div>
                <div className="text-sm text-osint-muted">{pattern.nepali_date}</div>
                <div className="text-xs mt-2">
                  <span className={`px-2 py-0.5 rounded ${
                    pattern.event_type === 'civil_unrest' ? 'bg-orange-500/20 text-orange-300' :
                    pattern.event_type === 'health_emergency' ? 'bg-blue-500/20 text-blue-300' :
                    'bg-gray-500/20 text-gray-300'
                  }`}>
                    {pattern.event_type.replace('_', ' ')}
                  </span>
                </div>
                {pattern.pre_event_surges.length > 0 && (
                  <div className="mt-3 text-xs text-osint-muted">
                    Pre-event surges: {pattern.pre_event_surges.map(s => s.hs_code).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sensitive Categories Overview */}
      {categories.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-osint-muted uppercase tracking-wide mb-4">
            Monitored Sensitive Categories
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {categories.slice(0, 6).map((cat) => {
              const Icon = getCategoryIcon(cat.category_id)
              return (
                <div
                  key={cat.category_id}
                  className="p-4 bg-osint-bg-secondary rounded-lg border border-osint-border"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-osint-bg-tertiary rounded">
                      <Icon className="w-4 h-4 text-osint-accent" />
                    </div>
                    <div>
                      <div className="font-medium text-osint-text">{cat.display_name}</div>
                      <div className="text-xs text-osint-muted">
                        Priority {cat.priority} | {cat.hs_codes.length} HS codes
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-osint-muted">{cat.intelligence_value}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default CommoditySurgeTimeline
