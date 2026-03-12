/**
 * Intelligence Insights Panel - Palantir-grade analytics display
 * Shows trends, anomalies, forecasts, and actionable observations
 */
import { useEffect, useState } from 'react'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, AlertCircle,
  Activity, Eye, Target, ChevronRight, Shield
} from 'lucide-react'
import { getIntelligenceInsights, type IntelligenceInsights, type TrendItem, type AnomalyItem } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'

interface IntelligenceInsightsPanelProps {
  hours?: number
}

const THREAT_LEVEL_COLORS = {
  critical: 'bg-red-500/20 border-red-500 text-red-400',
  elevated: 'bg-orange-500/20 border-orange-500 text-orange-400',
  guarded: 'bg-yellow-500/20 border-yellow-500 text-yellow-400',
  low: 'bg-green-500/20 border-green-500 text-green-400',
}

const SEVERITY_COLORS = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/50',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  low: 'bg-green-500/20 text-green-400 border-green-500/50',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
}

const DIRECTION_ICONS = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  stable: Minus,
  volatile: Activity,
}

const DIRECTION_COLORS = {
  increasing: 'text-red-400',
  decreasing: 'text-green-400',
  stable: 'text-gray-400',
  volatile: 'text-yellow-400',
}

function TrendCard({ trend }: { trend: TrendItem }) {
  const Icon = DIRECTION_ICONS[trend.direction] || Minus
  const color = DIRECTION_COLORS[trend.direction] || 'text-gray-400'

  // Format metric name for display
  const formatName = (name: string) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg p-3 hover:border-osint-accent/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-osint-text">{formatName(trend.metric_name)}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-bold ${color}`}>
          {trend.change_pct > 0 ? '+' : ''}{trend.change_pct.toFixed(1)}%
        </span>
        <span className="text-xs text-osint-muted">
          {trend.start_value.toFixed(1)} → {trend.end_value.toFixed(1)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-osint-muted">
        <span className={`px-1.5 py-0.5 rounded capitalize ${
          trend.strength === 'strong' ? 'bg-purple-500/20 text-purple-400' :
          trend.strength === 'moderate' ? 'bg-blue-500/20 text-blue-400' :
          'bg-gray-500/20 text-gray-400'
        }`}>
          {trend.strength}
        </span>
        <span>R²: {trend.r_squared.toFixed(2)}</span>
        <span>{trend.periods} periods</span>
      </div>
    </div>
  )
}

function AnomalyCard({ anomaly }: { anomaly: AnomalyItem }) {
  const severityClass = SEVERITY_COLORS[anomaly.severity] || SEVERITY_COLORS.medium

  return (
    <div className={`border rounded-lg p-3 ${severityClass}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium capitalize">{anomaly.anomaly_type.replace(/_/g, ' ')}</span>
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded border uppercase ${severityClass}`}>
          {anomaly.severity}
        </span>
      </div>

      <p className="text-sm text-osint-text mb-2">{anomaly.description}</p>

      {anomaly.affected_locations.length > 0 && (
        <div className="text-xs text-osint-muted mb-1">
          Locations: {anomaly.affected_locations.join(', ')}
        </div>
      )}

      {anomaly.recommended_actions.length > 0 && (
        <div className="mt-2 pt-2 border-t border-osint-border/50">
          <span className="text-xs text-osint-muted">Actions:</span>
          <ul className="mt-1 text-xs text-osint-text list-disc list-inside">
            {anomaly.recommended_actions.slice(0, 2).map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 text-xs text-osint-muted flex items-center justify-between">
        <span>Confidence: {(anomaly.confidence * 100).toFixed(0)}%</span>
        <span>{new Date(anomaly.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}

export function IntelligenceInsightsPanel({ hours = 168 }: IntelligenceInsightsPanelProps) {
  const [insights, setInsights] = useState<IntelligenceInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'trends' | 'anomalies'>('overview')

  useEffect(() => {
    const fetchInsights = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await getIntelligenceInsights(hours)
        setInsights(data)
      } catch (err) {
        console.error('Failed to fetch intelligence insights:', err)
        setError('Failed to load intelligence insights')
      } finally {
        setLoading(false)
      }
    }
    fetchInsights()
  }, [hours])

  if (loading) {
    return (
      <div className="bg-osint-card border border-osint-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4 text-osint-text flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Intelligence Insights
        </h2>
        <LoadingSpinner message="Analyzing intelligence..." />
      </div>
    )
  }

  if (error || !insights) {
    return (
      <div className="bg-osint-card border border-osint-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4 text-osint-text flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Intelligence Insights
        </h2>
        <p className="text-red-500 text-sm">{error || 'No data available'}</p>
      </div>
    )
  }

  const threatClass = THREAT_LEVEL_COLORS[insights.overall_threat_level] || THREAT_LEVEL_COLORS.low

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl p-6">
      {/* Header with Threat Level */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-osint-text flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Intelligence Insights
        </h2>
        <div className={`px-3 py-1.5 rounded-lg border ${threatClass} flex items-center gap-2`}>
          <Shield className="w-4 h-4" />
          <span className="text-sm font-medium uppercase">
            {insights.overall_threat_level} THREAT
          </span>
        </div>
      </div>

      {/* Assessment Summary */}
      <div className="bg-osint-bg rounded-lg p-3 mb-4 border border-osint-border">
        <p className="text-sm text-osint-text">{insights.assessment_summary}</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-4 border-b border-osint-border pb-2">
        {[
          { key: 'overview', label: 'Overview', icon: Target },
          { key: 'trends', label: `Trends (${insights.trends.length})`, icon: TrendingUp },
          { key: 'anomalies', label: `Anomalies (${insights.anomalies.length})`, icon: AlertCircle },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
              activeTab === tab.key
                ? 'bg-osint-accent text-white'
                : 'text-osint-muted hover:text-osint-text hover:bg-osint-bg'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Key Observations */}
          {insights.observations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-osint-text mb-2 flex items-center gap-1">
                <ChevronRight className="w-4 h-4" />
                Key Observations
              </h3>
              <ul className="space-y-1.5">
                {insights.observations.slice(0, 5).map((obs, i) => (
                  <li key={i} className="text-sm text-osint-muted flex items-start gap-2">
                    <span className="text-osint-accent mt-0.5">•</span>
                    <span>{obs}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-osint-bg rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-osint-text">{insights.trends.length}</div>
              <div className="text-xs text-osint-muted">Trends Detected</div>
            </div>
            <div className="bg-osint-bg rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-osint-text">{insights.anomalies.length}</div>
              <div className="text-xs text-osint-muted">Anomalies Found</div>
            </div>
            <div className="bg-osint-bg rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">
                {insights.anomaly_summary.by_severity.critical + insights.anomaly_summary.by_severity.high}
              </div>
              <div className="text-xs text-osint-muted">Critical/High</div>
            </div>
            <div className="bg-osint-bg rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-osint-text">{insights.data_window_hours}h</div>
              <div className="text-xs text-osint-muted">Analysis Window</div>
            </div>
          </div>

          {/* Top Trends Preview */}
          {insights.trends.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-osint-text mb-2">Strong Trends</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {insights.trends
                  .filter(t => t.strength === 'strong' || t.strength === 'moderate')
                  .slice(0, 4)
                  .map((trend, i) => (
                    <TrendCard key={i} trend={trend} />
                  ))}
              </div>
            </div>
          )}

          {/* Top Anomalies Preview */}
          {insights.anomalies.filter(a => a.severity === 'critical' || a.severity === 'high').length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-osint-text mb-2">Critical Anomalies</h3>
              <div className="space-y-2">
                {insights.anomalies
                  .filter(a => a.severity === 'critical' || a.severity === 'high')
                  .slice(0, 3)
                  .map(anomaly => (
                    <AnomalyCard key={anomaly.id} anomaly={anomaly} />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'trends' && (
        <div className="space-y-4">
          {insights.trends.length === 0 ? (
            <p className="text-osint-muted text-sm text-center py-4">
              No significant trends detected in this time window
            </p>
          ) : (
            <>
              {/* Trend Distribution */}
              <div className="flex gap-4 text-sm mb-4">
                {Object.entries(insights.trend_summary.direction_distribution || {}).map(([dir, count]) => (
                  <div key={dir} className="flex items-center gap-1.5">
                    {dir === 'increasing' && <TrendingUp className="w-3.5 h-3.5 text-red-400" />}
                    {dir === 'decreasing' && <TrendingDown className="w-3.5 h-3.5 text-green-400" />}
                    {dir === 'stable' && <Minus className="w-3.5 h-3.5 text-gray-400" />}
                    {dir === 'volatile' && <Activity className="w-3.5 h-3.5 text-yellow-400" />}
                    <span className="text-osint-muted capitalize">{dir}: {count}</span>
                  </div>
                ))}
              </div>

              {/* All Trends */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {insights.trends.map((trend, i) => (
                  <TrendCard key={i} trend={trend} />
                ))}
              </div>

              {/* Forecasts */}
              {Object.keys(insights.forecasts).length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-osint-text mb-2">7-Day Forecasts</h3>
                  <div className="space-y-2">
                    {Object.entries(insights.forecasts).map(([metric, forecast]) => (
                      <div key={metric} className="bg-osint-bg rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-osint-text capitalize">
                            {metric.replace(/_/g, ' ')}
                          </span>
                          <span className={`text-xs capitalize ${
                            forecast.direction === 'increasing' ? 'text-red-400' :
                            forecast.direction === 'decreasing' ? 'text-green-400' :
                            'text-gray-400'
                          }`}>
                            {forecast.direction}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {forecast.forecast_7d.map((point, i) => (
                            <div
                              key={i}
                              className="flex-1 bg-osint-accent/20 rounded text-center py-1"
                              title={new Date(point.date).toLocaleDateString()}
                            >
                              <span className="text-xs text-osint-text">{point.value.toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'anomalies' && (
        <div className="space-y-4">
          {insights.anomalies.length === 0 ? (
            <p className="text-osint-muted text-sm text-center py-4">
              No anomalies detected in this time window
            </p>
          ) : (
            <>
              {/* Anomaly Summary */}
              <div className="flex gap-4 text-sm mb-4">
                <span className="text-red-400">Critical: {insights.anomaly_summary.by_severity.critical}</span>
                <span className="text-orange-400">High: {insights.anomaly_summary.by_severity.high}</span>
                <span className="text-yellow-400">Medium: {insights.anomaly_summary.by_severity.medium}</span>
                <span className="text-green-400">Low: {insights.anomaly_summary.by_severity.low}</span>
              </div>

              {/* All Anomalies */}
              <div className="space-y-3">
                {insights.anomalies
                  .sort((a, b) => {
                    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
                    return (order[a.severity] || 4) - (order[b.severity] || 4)
                  })
                  .map(anomaly => (
                    <AnomalyCard key={anomaly.id} anomaly={anomaly} />
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-osint-border text-xs text-osint-muted flex items-center justify-between">
        <span>Analysis window: {insights.data_window_hours} hours</span>
        <span>Updated: {new Date(insights.analysis_timestamp).toLocaleString()}</span>
      </div>
    </div>
  )
}
