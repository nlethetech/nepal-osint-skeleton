/**
 * AnomalyDashboard - Palantir-Grade Ensemble Anomaly Detection UI
 *
 * Features:
 * - Real-time anomaly feed with filtering
 * - Confidence-based ranking
 * - Algorithm agreement visualization
 * - Interactive explanation panels
 * - Quick actions (acknowledge, investigate, dismiss)
 * - Bulk operations
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  Search,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Activity,
  BarChart2,
  TrendingUp,
  Clock,
  User,
  FileText,
  ArrowRight,
} from 'lucide-react'
import apiClient from '../../api/client'

// Types
interface AlgorithmResult {
  algorithm_name: string
  category: string
  is_anomaly: boolean
  score: number
  confidence: number
  details: Record<string, any>
}

interface EnsembleAnomaly {
  id: string
  entity_id: string
  entity_type: string
  fiscal_year: string
  month: number | null
  month_name: string | null
  observed_value: number
  baseline_value: number
  deviation_percentage: number
  is_anomaly: boolean
  ensemble_score: number
  confidence: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  algorithm_results: AlgorithmResult[]
  algorithms_triggered: number
  total_algorithms: number
  agreement_ratio: number
  weights_used: Record<string, number>
  explanation: string
  contributing_factors: Array<{
    factor: string
    contribution: number
    category: string
  }>
}

interface AnomalyExplanation {
  summary: string
  detailed_explanation: string
  contributing_factors: Array<{ factor: string; contribution_pct: number }>
  historical_context: {
    similar_occurrences: number
    last_occurrence: string | null
    pattern_description: string
  } | null
  comparable_events: Array<{
    date: string
    description: string
    similarity: number
  }>
  recommended_actions: string[]
  risk_assessment: string
  urgency: string
}

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'
type StatusFilter = 'all' | 'new' | 'acknowledged' | 'investigating' | 'confirmed' | 'dismissed'

interface AnomalyDashboardProps {
  fiscalYear?: string
  onAnomalySelect?: (anomaly: EnsembleAnomaly) => void
  onCreateCase?: (anomaly: EnsembleAnomaly) => void
}

// Severity colors
const SEVERITY_COLORS = {
  critical: {
    bg: 'bg-severity-critical/10',
    border: 'border-severity-critical/50',
    text: 'text-severity-critical',
    badge: 'bg-severity-critical',
  },
  high: {
    bg: 'bg-severity-high/10',
    border: 'border-severity-high/50',
    text: 'text-severity-high',
    badge: 'bg-severity-high',
  },
  medium: {
    bg: 'bg-severity-medium/10',
    border: 'border-severity-medium/50',
    text: 'text-severity-medium',
    badge: 'bg-severity-medium',
  },
  low: {
    bg: 'bg-severity-low/10',
    border: 'border-severity-low/50',
    text: 'text-severity-low',
    badge: 'bg-severity-low',
  },
}

// Algorithm category colors
const CATEGORY_COLORS: Record<string, string> = {
  statistical: '#3b82f6',
  time_series: '#8b5cf6',
  machine_learning: '#22c55e',
}

// Format large numbers
const formatValue = (value: number): string => {
  if (value >= 10000000) return `${(value / 10000000).toFixed(2)} Cr`
  if (value >= 100000) return `${(value / 100000).toFixed(2)} L`
  return value.toLocaleString()
}

// Algorithm Agreement Chart
const AlgorithmAgreementChart: React.FC<{ results: AlgorithmResult[] }> = ({ results }) => {
  const categories = ['statistical', 'time_series', 'machine_learning']
  const categoryResults = categories.map(cat => ({
    category: cat,
    algorithms: results.filter(r => r.category === cat),
    triggered: results.filter(r => r.category === cat && r.is_anomaly).length,
    total: results.filter(r => r.category === cat).length,
  }))

  return (
    <div className="space-y-2">
      {categoryResults.map(cat => (
        <div key={cat.category} className="flex items-center gap-2">
          <div className="w-24 text-xs text-osint-muted capitalize">
            {cat.category.replace('_', ' ')}
          </div>
          <div className="flex-1 h-4 bg-osint-surface rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${(cat.triggered / cat.total) * 100}%`,
                backgroundColor: CATEGORY_COLORS[cat.category],
              }}
            />
          </div>
          <div className="w-12 text-xs text-osint-muted text-right">
            {cat.triggered}/{cat.total}
          </div>
        </div>
      ))}
    </div>
  )
}

// Confidence Breakdown
const ConfidenceBreakdown: React.FC<{
  results: AlgorithmResult[]
  weights: Record<string, number>
}> = ({ results, weights }) => {
  const sorted = [...results]
    .filter(r => r.is_anomaly)
    .sort((a, b) => (b.score * (weights[b.algorithm_name] || 0.1)) - (a.score * (weights[a.algorithm_name] || 0.1)))

  return (
    <div className="space-y-2">
      {sorted.slice(0, 5).map(result => (
        <div key={result.algorithm_name} className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: CATEGORY_COLORS[result.category] }}
          />
          <div className="flex-1 text-xs text-osint-text">
            {result.algorithm_name.replace('_', ' ')}
          </div>
          <div className="w-16 h-2 bg-osint-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-severity-medium"
              style={{ width: `${result.score * 100}%` }}
            />
          </div>
          <div className="w-10 text-xs text-osint-muted text-right">
            {(result.score * 100).toFixed(0)}%
          </div>
        </div>
      ))}
    </div>
  )
}

// Anomaly Card
const AnomalyCard: React.FC<{
  anomaly: EnsembleAnomaly
  expanded: boolean
  onToggle: () => void
  onAcknowledge?: () => void
  onInvestigate?: () => void
  onDismiss?: () => void
  onCreateCase?: () => void
}> = ({
  anomaly,
  expanded,
  onToggle,
  onAcknowledge,
  onInvestigate,
  onDismiss,
  onCreateCase,
}) => {
  const colors = SEVERITY_COLORS[anomaly.severity]
  const direction = anomaly.deviation_percentage > 0 ? 'surge' : 'decline'
  const absDeviation = Math.abs(anomaly.deviation_percentage)

  return (
    <div className={`border rounded-lg overflow-hidden ${colors.bg} ${colors.border}`}>
      {/* Header */}
      <div
        className="p-4 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${colors.badge}/20`}>
              <AlertTriangle className={`w-5 h-5 ${colors.text}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors.badge} text-white uppercase`}>
                  {anomaly.severity}
                </span>
                <span className="text-sm text-osint-text font-medium">
                  {anomaly.entity_id}
                </span>
                <span className="text-xs text-osint-muted">
                  {anomaly.entity_type}
                </span>
              </div>
              <div className="mt-1 text-sm text-osint-muted">
                {anomaly.month_name} {anomaly.fiscal_year} • {absDeviation.toFixed(1)}% {direction}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-osint-muted">Confidence</div>
              <div className="text-lg font-bold text-osint-text">
                {(anomaly.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-osint-muted">Agreement</div>
              <div className="text-lg font-bold text-osint-text">
                {anomaly.algorithms_triggered}/{anomaly.total_algorithms}
              </div>
            </div>
            <button className="p-1">
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-osint-muted" />
              ) : (
                <ChevronDown className="w-5 h-5 text-osint-muted" />
              )}
            </button>
          </div>
        </div>

        {/* Quick Summary */}
        <div className="mt-3 text-sm text-osint-text/80">
          {anomaly.explanation}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-osint-border bg-osint-card">
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Algorithm Details */}
            <div>
              <h4 className="text-sm font-medium text-osint-text mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Algorithm Agreement
              </h4>
              <AlgorithmAgreementChart results={anomaly.algorithm_results} />

              <h4 className="text-sm font-medium text-osint-text mb-3 mt-4 flex items-center gap-2">
                <BarChart2 className="w-4 h-4" />
                Confidence Breakdown
              </h4>
              <ConfidenceBreakdown
                results={anomaly.algorithm_results}
                weights={anomaly.weights_used}
              />
            </div>

            {/* Right: Metrics & Factors */}
            <div>
              <h4 className="text-sm font-medium text-osint-text mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Value Comparison
              </h4>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-osint-surface rounded-lg p-3">
                  <div className="text-xs text-osint-muted">Observed</div>
                  <div className="text-lg font-bold text-osint-text">
                    {formatValue(anomaly.observed_value)}
                  </div>
                </div>
                <div className="bg-osint-surface rounded-lg p-3">
                  <div className="text-xs text-osint-muted">Baseline</div>
                  <div className="text-lg font-bold text-osint-text">
                    {formatValue(anomaly.baseline_value)}
                  </div>
                </div>
              </div>

              <h4 className="text-sm font-medium text-osint-text mb-3">Contributing Factors</h4>
              <div className="space-y-2">
                {anomaly.contributing_factors.slice(0, 4).map((factor, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex-1 text-xs text-osint-muted capitalize">
                      {factor.factor.replace('_', ' ')}
                    </div>
                    <div className="w-24 h-2 bg-osint-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-severity-medium"
                        style={{ width: `${factor.contribution * 100}%` }}
                      />
                    </div>
                    <div className="w-12 text-xs text-osint-muted text-right">
                      {(factor.contribution * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="px-4 py-3 border-t border-osint-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={onAcknowledge}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-osint-surface hover:bg-osint-surface/80 rounded-lg text-osint-text"
              >
                <CheckCircle className="w-4 h-4" />
                Acknowledge
              </button>
              <button
                onClick={onInvestigate}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-severity-medium/20 hover:bg-severity-medium/30 rounded-lg text-severity-medium"
              >
                <Eye className="w-4 h-4" />
                Investigate
              </button>
              <button
                onClick={onDismiss}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-osint-muted hover:text-osint-text"
              >
                <XCircle className="w-4 h-4" />
                Dismiss
              </button>
            </div>
            <button
              onClick={onCreateCase}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-severity-critical/20 hover:bg-severity-critical/30 rounded-lg text-severity-critical"
            >
              <FileText className="w-4 h-4" />
              Create Case
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Main Component
const AnomalyDashboard: React.FC<AnomalyDashboardProps> = ({
  fiscalYear = '2081-82',
  onAnomalySelect,
  onCreateCase,
}) => {
  // State
  const [anomalies, setAnomalies] = useState<EnsembleAnomaly[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filters
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [minConfidence, setMinConfidence] = useState(0.5)

  // Fetch anomalies (demo data for now)
  const fetchAnomalies = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // In production, this would fetch from API
      // For demo, we'll generate sample data
      const demoAnomalies: EnsembleAnomaly[] = [
        {
          id: '1',
          entity_id: '27101200',
          entity_type: 'commodity',
          fiscal_year: '2081-82',
          month: 7,
          month_name: 'Kartik',
          observed_value: 4500000000,
          baseline_value: 1800000000,
          deviation_percentage: 150,
          is_anomaly: true,
          ensemble_score: 0.92,
          confidence: 0.94,
          severity: 'critical',
          algorithm_results: [
            { algorithm_name: 'zscore', category: 'statistical', is_anomaly: true, score: 0.95, confidence: 0.9, details: {} },
            { algorithm_name: 'iqr', category: 'statistical', is_anomaly: true, score: 0.88, confidence: 0.85, details: {} },
            { algorithm_name: 'grubbs', category: 'statistical', is_anomaly: true, score: 0.82, confidence: 0.8, details: {} },
            { algorithm_name: 'pelt', category: 'time_series', is_anomaly: true, score: 0.9, confidence: 0.92, details: {} },
            { algorithm_name: 'cusum', category: 'time_series', is_anomaly: true, score: 0.85, confidence: 0.88, details: {} },
            { algorithm_name: 'stl', category: 'time_series', is_anomaly: false, score: 0.3, confidence: 0.7, details: {} },
            { algorithm_name: 'prophet', category: 'time_series', is_anomaly: true, score: 0.88, confidence: 0.9, details: {} },
            { algorithm_name: 'isolation_forest', category: 'machine_learning', is_anomaly: true, score: 0.78, confidence: 0.82, details: {} },
          ],
          algorithms_triggered: 7,
          total_algorithms: 8,
          agreement_ratio: 0.875,
          weights_used: { zscore: 0.15, pelt: 0.15, cusum: 0.15, prophet: 0.15 },
          explanation: 'Petroleum imports (HS 27101200) surged 150% above baseline in Kartik 2081. 7 out of 8 algorithms detected this anomaly with high confidence.',
          contributing_factors: [
            { factor: 'zscore', contribution: 0.25, category: 'statistical' },
            { factor: 'pelt', contribution: 0.22, category: 'time_series' },
            { factor: 'prophet', contribution: 0.20, category: 'time_series' },
            { factor: 'cusum', contribution: 0.18, category: 'time_series' },
          ],
        },
        {
          id: '2',
          entity_id: 'IN',
          entity_type: 'country',
          fiscal_year: '2081-82',
          month: 8,
          month_name: 'Mangsir',
          observed_value: 12000000000,
          baseline_value: 8500000000,
          deviation_percentage: 41.2,
          is_anomaly: true,
          ensemble_score: 0.72,
          confidence: 0.78,
          severity: 'high',
          algorithm_results: [
            { algorithm_name: 'zscore', category: 'statistical', is_anomaly: true, score: 0.72, confidence: 0.85, details: {} },
            { algorithm_name: 'iqr', category: 'statistical', is_anomaly: false, score: 0.35, confidence: 0.8, details: {} },
            { algorithm_name: 'grubbs', category: 'statistical', is_anomaly: false, score: 0.4, confidence: 0.75, details: {} },
            { algorithm_name: 'pelt', category: 'time_series', is_anomaly: true, score: 0.68, confidence: 0.82, details: {} },
            { algorithm_name: 'cusum', category: 'time_series', is_anomaly: true, score: 0.75, confidence: 0.85, details: {} },
            { algorithm_name: 'stl', category: 'time_series', is_anomaly: false, score: 0.28, confidence: 0.7, details: {} },
            { algorithm_name: 'prophet', category: 'time_series', is_anomaly: true, score: 0.7, confidence: 0.8, details: {} },
            { algorithm_name: 'isolation_forest', category: 'machine_learning', is_anomaly: true, score: 0.65, confidence: 0.75, details: {} },
          ],
          algorithms_triggered: 5,
          total_algorithms: 8,
          agreement_ratio: 0.625,
          weights_used: { zscore: 0.15, pelt: 0.15, cusum: 0.15, prophet: 0.15 },
          explanation: 'Trade with India increased 41.2% above baseline in Mangsir 2081. This may be related to festival season demand.',
          contributing_factors: [
            { factor: 'cusum', contribution: 0.28, category: 'time_series' },
            { factor: 'zscore', contribution: 0.24, category: 'statistical' },
            { factor: 'prophet', contribution: 0.22, category: 'time_series' },
          ],
        },
        {
          id: '3',
          entity_id: '72139100',
          entity_type: 'commodity',
          fiscal_year: '2081-82',
          month: 9,
          month_name: 'Poush',
          observed_value: 320000000,
          baseline_value: 680000000,
          deviation_percentage: -52.9,
          is_anomaly: true,
          ensemble_score: 0.65,
          confidence: 0.72,
          severity: 'medium',
          algorithm_results: [
            { algorithm_name: 'zscore', category: 'statistical', is_anomaly: true, score: 0.68, confidence: 0.8, details: {} },
            { algorithm_name: 'iqr', category: 'statistical', is_anomaly: true, score: 0.62, confidence: 0.75, details: {} },
            { algorithm_name: 'grubbs', category: 'statistical', is_anomaly: false, score: 0.38, confidence: 0.7, details: {} },
            { algorithm_name: 'pelt', category: 'time_series', is_anomaly: true, score: 0.55, confidence: 0.72, details: {} },
            { algorithm_name: 'cusum', category: 'time_series', is_anomaly: false, score: 0.42, confidence: 0.68, details: {} },
            { algorithm_name: 'stl', category: 'time_series', is_anomaly: false, score: 0.35, confidence: 0.65, details: {} },
            { algorithm_name: 'prophet', category: 'time_series', is_anomaly: false, score: 0.4, confidence: 0.7, details: {} },
            { algorithm_name: 'isolation_forest', category: 'machine_learning', is_anomaly: true, score: 0.58, confidence: 0.72, details: {} },
          ],
          algorithms_triggered: 4,
          total_algorithms: 8,
          agreement_ratio: 0.5,
          weights_used: { zscore: 0.15, pelt: 0.15, cusum: 0.15, prophet: 0.15 },
          explanation: 'Iron/Steel imports (HS 72139100) declined 52.9% in Poush 2081. May indicate construction slowdown or supply chain issues.',
          contributing_factors: [
            { factor: 'zscore', contribution: 0.32, category: 'statistical' },
            { factor: 'iqr', contribution: 0.28, category: 'statistical' },
            { factor: 'isolation_forest', contribution: 0.22, category: 'machine_learning' },
          ],
        },
      ]

      setAnomalies(demoAnomalies)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch anomalies')
    } finally {
      setLoading(false)
    }
  }, [fiscalYear])

  useEffect(() => {
    fetchAnomalies()
  }, [fetchAnomalies])

  // Filter anomalies
  const filteredAnomalies = anomalies.filter(a => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false
    if (entityTypeFilter !== 'all' && a.entity_type !== entityTypeFilter) return false
    if (a.confidence < minConfidence) return false
    if (searchQuery && !a.entity_id.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  // Stats
  const stats = {
    total: anomalies.length,
    critical: anomalies.filter(a => a.severity === 'critical').length,
    high: anomalies.filter(a => a.severity === 'high').length,
    medium: anomalies.filter(a => a.severity === 'medium').length,
    low: anomalies.filter(a => a.severity === 'low').length,
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-osint-text flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-severity-critical" />
            Anomaly Intelligence Center
          </h3>
          <button
            onClick={fetchAnomalies}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-osint-surface hover:bg-osint-surface/80 rounded-lg text-sm text-osint-text"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          <div className="bg-osint-surface rounded-lg p-3">
            <div className="text-2xl font-bold text-osint-text">{stats.total}</div>
            <div className="text-xs text-osint-muted">Total Anomalies</div>
          </div>
          <div className="bg-severity-critical/10 rounded-lg p-3">
            <div className="text-2xl font-bold text-severity-critical">{stats.critical}</div>
            <div className="text-xs text-severity-critical">Critical</div>
          </div>
          <div className="bg-severity-high/10 rounded-lg p-3">
            <div className="text-2xl font-bold text-severity-high">{stats.high}</div>
            <div className="text-xs text-severity-high">High</div>
          </div>
          <div className="bg-severity-medium/10 rounded-lg p-3">
            <div className="text-2xl font-bold text-severity-medium">{stats.medium}</div>
            <div className="text-xs text-severity-medium">Medium</div>
          </div>
          <div className="bg-severity-low/10 rounded-lg p-3">
            <div className="text-2xl font-bold text-severity-low">{stats.low}</div>
            <div className="text-xs text-severity-low">Low</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-osint-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by entity ID..."
              className="w-full pl-10 pr-3 py-2 bg-osint-surface border border-osint-border rounded-lg text-sm text-osint-text"
            />
          </div>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            className="bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text"
          >
            <option value="all">All Types</option>
            <option value="country">Country</option>
            <option value="commodity">Commodity</option>
          </select>

          <div className="flex items-center gap-2">
            <label className="text-sm text-osint-muted">Min Confidence:</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-osint-text w-12">{(minConfidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* Anomaly List */}
      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-osint-muted animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-severity-critical">{error}</div>
        ) : filteredAnomalies.length === 0 ? (
          <div className="text-center py-12 text-osint-muted">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No anomalies match your filters</p>
          </div>
        ) : (
          filteredAnomalies.map((anomaly) => (
            <AnomalyCard
              key={anomaly.id}
              anomaly={anomaly}
              expanded={expandedId === anomaly.id}
              onToggle={() => setExpandedId(expandedId === anomaly.id ? null : anomaly.id)}
              onAcknowledge={() => console.log('Acknowledge:', anomaly.id)}
              onInvestigate={() => onAnomalySelect?.(anomaly)}
              onDismiss={() => console.log('Dismiss:', anomaly.id)}
              onCreateCase={() => onCreateCase?.(anomaly)}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default AnomalyDashboard
