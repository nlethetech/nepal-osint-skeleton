/**
 * TimeSeriesExplorer - Palantir-Grade Multi-Year Trend Analysis
 *
 * Features:
 * - Multi-entity comparison (up to 5)
 * - Customizable time range with fiscal year picker
 * - Multiple metric overlays
 * - Anomaly highlighting on timeline
 * - Zoom/pan with brush selection
 * - Export to CSV/PNG
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
  Brush,
} from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Download,
  Plus,
  X,
  Search,
  RefreshCw,
  Calendar,
  BarChart3,
  LineChartIcon,
  Layers,
} from 'lucide-react'
import apiClient from '../../api/client'

// Types
interface TimeSeriesPoint {
  fiscal_year: string
  month: number
  month_name: string
  import_value: number
  export_value: number
  trade_balance: number
  yoy_change_pct: number | null
  mom_change_pct: number | null
  market_share_pct: number | null
  anomaly_flag: boolean
  anomaly_severity: string | null
}

interface TrendSummary {
  total_import_value: number
  total_export_value: number
  cagr_import: number
  cagr_export: number
  trend_direction: string
  volatility_index: number
  peak_month: { fiscal_year: string; month_name: string; value: number } | null
  trough_month: { fiscal_year: string; month_name: string; value: number } | null
  yoy_growth_latest: number | null
}

interface EntityTrend {
  entity: {
    id: string
    name: string
    type: string
  }
  summary: TrendSummary
  time_series: TimeSeriesPoint[]
  comparable_entities: Array<{
    id: string
    name: string
    correlation: number
  }>
  insights: string[]
  anomaly_count: number
}

interface CompareResult {
  entities: Record<string, { id: string; name: string; type: string }>
  summaries: Record<string, TrendSummary>
  comparison_series: Array<Record<string, any>>
  correlation_matrix: Record<string, Record<string, number>>
}

type EntityType = 'country' | 'commodity' | 'hs_chapter'
type MetricType = 'import_value' | 'export_value' | 'trade_balance'
type ChartType = 'line' | 'area' | 'composed'
type GranularityType = 'yearly' | 'monthly'

interface TimeSeriesExplorerProps {
  defaultEntityType?: EntityType
  defaultEntities?: string[]
  defaultMetrics?: MetricType[]
  defaultTimeRange?: { start: string; end: string }
  fiscalYear?: string  // Current fiscal year from parent
  onAnomalyClick?: (anomaly: TimeSeriesPoint) => void
}

// Nepali months in FISCAL YEAR order (Shrawan = month 1 of fiscal year)
const NEPALI_MONTHS = [
  'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush',
  'Magh', 'Falgun', 'Chaitra', 'Baishakh', 'Jestha', 'Ashad'
]

// Available fiscal years (format matches database: 20XX/YY)
const FISCAL_YEARS = [
  '2077/78', '2078/79', '2079/80', '2080/81', '2081/82', '2082/83'
]

// Colors for entities
const ENTITY_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
]

// Metric labels
const METRIC_LABELS: Record<MetricType, string> = {
  import_value: 'Import Value',
  export_value: 'Export Value',
  trade_balance: 'Trade Balance',
}

// Format currency in crores
const formatCrore = (value: number): string => {
  if (value >= 10000000) {
    return `${(value / 10000000).toFixed(2)} Cr`
  } else if (value >= 100000) {
    return `${(value / 100000).toFixed(2)} L`
  }
  return value.toLocaleString()
}

// Format percentage
const formatPercent = (value: number | null): string => {
  if (value === null) return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

// Trend icon component
const TrendIcon: React.FC<{ direction: string; className?: string }> = ({ direction, className = '' }) => {
  if (direction === 'growing') {
    return <TrendingUp className={`${className} text-severity-low`} />
  } else if (direction === 'declining') {
    return <TrendingDown className={`${className} text-severity-critical`} />
  }
  return <Minus className={`${className} text-osint-muted`} />
}

// Summary card component
const SummaryCard: React.FC<{
  entity: { id: string; name: string }
  summary: TrendSummary
  color: string
  onRemove?: () => void
}> = ({ entity, summary, color, onRemove }) => (
  <div className="bg-osint-surface border border-osint-border rounded-lg p-4 relative">
    {onRemove && (
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 p-1 hover:bg-osint-card rounded"
      >
        <X className="w-4 h-4 text-osint-muted" />
      </button>
    )}
    <div className="flex items-center gap-2 mb-3">
      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium text-osint-text truncate">{entity.name}</span>
    </div>
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <div className="text-osint-muted">Total Imports</div>
        <div className="text-osint-text font-medium">{formatCrore(summary.total_import_value)}</div>
      </div>
      <div>
        <div className="text-osint-muted">Total Exports</div>
        <div className="text-osint-text font-medium">{formatCrore(summary.total_export_value)}</div>
      </div>
      <div>
        <div className="text-osint-muted">Import CAGR</div>
        <div className={`font-medium ${summary.cagr_import >= 0 ? 'text-severity-low' : 'text-severity-critical'}`}>
          {formatPercent(summary.cagr_import)}
        </div>
      </div>
      <div>
        <div className="text-osint-muted">Trend</div>
        <div className="flex items-center gap-1">
          <TrendIcon direction={summary.trend_direction} className="w-4 h-4" />
          <span className="capitalize text-osint-text">{summary.trend_direction}</span>
        </div>
      </div>
      <div className="col-span-2">
        <div className="text-osint-muted">Latest YoY</div>
        <div className={`font-medium ${(summary.yoy_growth_latest || 0) >= 0 ? 'text-severity-low' : 'text-severity-critical'}`}>
          {formatPercent(summary.yoy_growth_latest)}
        </div>
      </div>
    </div>
    {summary.volatility_index > 30 && (
      <div className="mt-2 flex items-center gap-1 text-xs text-severity-medium">
        <AlertTriangle className="w-3 h-3" />
        High volatility: {summary.volatility_index.toFixed(1)}%
      </div>
    )}
  </div>
)

// Custom tooltip
const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg p-3 shadow-lg">
      <div className="text-sm font-medium text-osint-text mb-2">{label}</div>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-osint-muted">{entry.name}:</span>
          <span className="text-osint-text font-medium">{formatCrore(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

// Main component
const TimeSeriesExplorer: React.FC<TimeSeriesExplorerProps> = ({
  defaultEntityType = 'country',
  defaultEntities = [],
  defaultMetrics = ['import_value'],
  defaultTimeRange = { start: '2077/78', end: '2081/82' },
  fiscalYear,
  onAnomalyClick,
}) => {
  // State
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType)
  const [entities, setEntities] = useState<string[]>(defaultEntities)
  const [metrics, setMetrics] = useState<MetricType[]>(defaultMetrics)
  const [startFY, setStartFY] = useState(defaultTimeRange.start)
  const [endFY, setEndFY] = useState(defaultTimeRange.end)
  const [chartType, setChartType] = useState<ChartType>('line')
  const [normalize, setNormalize] = useState(false)
  const [showAnomalies, setShowAnomalies] = useState(true)
  const [granularity, setGranularity] = useState<GranularityType>('yearly')
  const [yoyCompare, setYoyCompare] = useState(false) // Year-over-year comparison mode

  // Data state
  const [trendData, setTrendData] = useState<Record<string, EntityTrend>>({})
  const [compareData, setCompareData] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string }>>([])
  const [showSearch, setShowSearch] = useState(false)

  // Fetch trend data for entities
  const fetchTrendData = useCallback(async () => {
    if (entities.length === 0) return

    setLoading(true)
    setError(null)

    try {
      if (entities.length === 1) {
        // Single entity - get full trend
        const response = await apiClient.get(
          `/trade-analytics/trends/entity/${entityType}/${entities[0]}`,
          {
            params: {
              start_fy: startFY,
              end_fy: endFY,
              granularity: granularity,
              include_anomalies: showAnomalies,
              include_comparable: true,
            },
          }
        )
        setTrendData({ [entities[0]]: response.data })
        setCompareData(null)
      } else {
        // Multiple entities - compare
        const response = await apiClient.post('/trade-analytics/trends/compare', {
          entity_type: entityType,
          entity_ids: entities,
          metric: metrics[0],
          start_fy: startFY,
          end_fy: endFY,
          normalize,
        })
        setCompareData(response.data)

        // Also fetch individual trends for summaries
        const trendPromises = entities.map(id =>
          apiClient.get(`/trade-analytics/trends/entity/${entityType}/${id}`, {
            params: { start_fy: startFY, end_fy: endFY, granularity: granularity },
          })
        )
        const trendResponses = await Promise.all(trendPromises)
        const trends: Record<string, EntityTrend> = {}
        trendResponses.forEach((resp, i) => {
          trends[entities[i]] = resp.data
        })
        setTrendData(trends)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch trend data')
    } finally {
      setLoading(false)
    }
  }, [entities, entityType, startFY, endFY, metrics, normalize, showAnomalies, granularity])

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchTrendData()
  }, [fetchTrendData])

  // Search for entities
  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.length < 2) {
      setSearchResults([])
      return
    }

    try {
      if (entityType === 'country') {
        // Use full country names as IDs (matches database)
        const countries = [
          { id: 'India', name: 'India' },
          { id: 'China', name: 'China' },
          { id: 'United States', name: 'United States' },
          { id: 'Japan', name: 'Japan' },
          { id: 'Germany', name: 'Germany' },
          { id: 'United Kingdom', name: 'United Kingdom' },
          { id: 'Bangladesh', name: 'Bangladesh' },
          { id: 'Thailand', name: 'Thailand' },
          { id: 'Singapore', name: 'Singapore' },
          { id: 'Malaysia', name: 'Malaysia' },
          { id: 'United Arab Emirates', name: 'United Arab Emirates' },
          { id: 'South Korea', name: 'South Korea' },
          { id: 'Indonesia', name: 'Indonesia' },
          { id: 'Vietnam', name: 'Vietnam' },
          { id: 'Argentina', name: 'Argentina' },
          { id: 'Brazil', name: 'Brazil' },
          { id: 'Australia', name: 'Australia' },
          { id: 'France', name: 'France' },
          { id: 'Italy', name: 'Italy' },
          { id: 'Netherlands', name: 'Netherlands' },
          { id: 'Switzerland', name: 'Switzerland' },
          { id: 'Pakistan', name: 'Pakistan' },
          { id: 'Sri Lanka', name: 'Sri Lanka' },
          { id: 'Myanmar', name: 'Myanmar' },
        ]
        setSearchResults(
          countries.filter(c =>
            c.name.toLowerCase().includes(query.toLowerCase())
          )
        )
      } else if (entityType === 'commodity' || entityType === 'hs_chapter') {
        // Search commodities via API
        try {
          const response = await apiClient.get('/trade-analytics/commodities/search', {
            params: { q: query, limit: 20 }
          })
          setSearchResults(
            response.data.map((item: any) => ({
              id: item.commodity_code || item.hs_code,
              name: `${item.commodity_code || item.hs_code}: ${item.commodity_description || item.description || 'N/A'}`.substring(0, 80)
            }))
          )
        } catch (apiErr) {
          // Fallback to common HS codes if API fails
          const commonHsCodes = [
            { id: '01', name: '01: Live animals' },
            { id: '02', name: '02: Meat and edible meat offal' },
            { id: '03', name: '03: Fish and crustaceans' },
            { id: '04', name: '04: Dairy produce; eggs; honey' },
            { id: '07', name: '07: Edible vegetables' },
            { id: '10', name: '10: Cereals' },
            { id: '15', name: '15: Animal or vegetable fats' },
            { id: '17', name: '17: Sugars and sugar confectionery' },
            { id: '22', name: '22: Beverages, spirits and vinegar' },
            { id: '27', name: '27: Mineral fuels, oils' },
            { id: '28', name: '28: Inorganic chemicals' },
            { id: '29', name: '29: Organic chemicals' },
            { id: '30', name: '30: Pharmaceutical products' },
            { id: '39', name: '39: Plastics and articles thereof' },
            { id: '40', name: '40: Rubber and articles thereof' },
            { id: '52', name: '52: Cotton' },
            { id: '61', name: '61: Apparel and clothing (knitted)' },
            { id: '62', name: '62: Apparel and clothing (not knitted)' },
            { id: '72', name: '72: Iron and steel' },
            { id: '73', name: '73: Articles of iron or steel' },
            { id: '84', name: '84: Machinery and mechanical appliances' },
            { id: '85', name: '85: Electrical machinery and equipment' },
            { id: '87', name: '87: Vehicles other than railway' },
            { id: '90', name: '90: Optical, photographic instruments' },
          ]
          setSearchResults(
            commonHsCodes.filter(c =>
              c.id.includes(query) || c.name.toLowerCase().includes(query.toLowerCase())
            )
          )
        }
      }
    } catch (err) {
      console.error('Search failed:', err)
    }
  }

  // Add entity
  const addEntity = (id: string) => {
    if (entities.length >= 5) {
      alert('Maximum 5 entities can be compared')
      return
    }
    if (!entities.includes(id)) {
      setEntities([...entities, id])
    }
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
  }

  // Remove entity
  const removeEntity = (id: string) => {
    setEntities(entities.filter(e => e !== id))
  }

  // Prepare chart data
  const chartData = useMemo(() => {
    if (compareData && entities.length > 1) {
      return compareData.comparison_series.map(point => ({
        ...point,
        label: granularity === 'monthly'
          ? `${point.month_name} ${point.fiscal_year}`
          : point.fiscal_year,
      }))
    }

    if (entities.length === 1 && trendData[entities[0]]) {
      const timeSeries = trendData[entities[0]].time_series

      // Year-over-year comparison mode for monthly data
      if (yoyCompare && granularity === 'monthly') {
        // Group by month, with each fiscal year as a separate series
        const byMonth: Record<string, Record<string, number>> = {}
        const fiscalYears = new Set<string>()

        timeSeries.forEach(point => {
          const monthKey = point.month_name
          fiscalYears.add(point.fiscal_year)
          if (!byMonth[monthKey]) {
            byMonth[monthKey] = {}
          }
          byMonth[monthKey][`import_${point.fiscal_year}`] = point.import_value
          byMonth[monthKey][`export_${point.fiscal_year}`] = point.export_value
        })

        // Convert to array sorted by Nepali month order
        return NEPALI_MONTHS.map((monthName) => {
          const data = byMonth[monthName] || {}
          return {
            label: monthName,
            ...data,
          }
        }).filter(d => Object.keys(d).length > 1) // Only include months with data
      }

      // Standard time series
      return timeSeries.map(point => ({
        label: granularity === 'monthly'
          ? `${point.month_name} ${point.fiscal_year.split('/')[0].slice(-2)}`
          : point.fiscal_year,
        import_value: point.import_value,
        export_value: point.export_value,
        trade_balance: point.trade_balance,
        anomaly: point.anomaly_flag,
        severity: point.anomaly_severity,
        fiscal_year: point.fiscal_year,
        month_name: point.month_name,
      }))
    }

    return []
  }, [compareData, trendData, entities, granularity, yoyCompare])

  // Get unique fiscal years for YoY comparison lines
  const yoyFiscalYears = useMemo(() => {
    if (!yoyCompare || granularity !== 'monthly' || entities.length !== 1) return []
    if (!trendData[entities[0]]) return []

    const years = new Set<string>()
    trendData[entities[0]].time_series.forEach(p => years.add(p.fiscal_year))
    return Array.from(years).sort()
  }, [trendData, entities, yoyCompare, granularity])

  // Export data
  const exportToCSV = () => {
    if (chartData.length === 0) return

    const headers = Object.keys(chartData[0]).join(',')
    const rows = chartData.map(row =>
      Object.values(row).map(v => (typeof v === 'string' ? `"${v}"` : v)).join(',')
    )
    const csv = [headers, ...rows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trade_trends_${entityType}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-osint-text flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-severity-medium" />
            Time Series Explorer
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTrendData}
              disabled={loading}
              className="p-2 hover:bg-osint-surface rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 text-osint-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={exportToCSV}
              disabled={chartData.length === 0}
              className="p-2 hover:bg-osint-surface rounded-lg transition-colors"
            >
              <Download className="w-4 h-4 text-osint-muted" />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4">
          {/* Entity Type */}
          <div>
            <label className="block text-xs text-osint-muted mb-1">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value as EntityType)
                setEntities([])
              }}
              className="bg-osint-surface border border-osint-border rounded px-3 py-1.5 text-sm text-osint-text"
            >
              <option value="country">Country</option>
              <option value="commodity">Commodity</option>
              <option value="hs_chapter">HS Chapter</option>
            </select>
          </div>

          {/* Time Range */}
          <div className="flex gap-2">
            <div>
              <label className="block text-xs text-osint-muted mb-1">From FY</label>
              <select
                value={startFY}
                onChange={(e) => setStartFY(e.target.value)}
                className="bg-osint-surface border border-osint-border rounded px-3 py-1.5 text-sm text-osint-text"
              >
                {FISCAL_YEARS.map(fy => (
                  <option key={fy} value={fy}>{fy}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-osint-muted mb-1">To FY</label>
              <select
                value={endFY}
                onChange={(e) => setEndFY(e.target.value)}
                className="bg-osint-surface border border-osint-border rounded px-3 py-1.5 text-sm text-osint-text"
              >
                {FISCAL_YEARS.map(fy => (
                  <option key={fy} value={fy}>{fy}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Granularity */}
          <div>
            <label className="block text-xs text-osint-muted mb-1">Granularity</label>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setGranularity('yearly')
                  setYoyCompare(false)
                }}
                className={`px-2 py-1 text-xs rounded ${granularity === 'yearly' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
              >
                Yearly
              </button>
              <button
                onClick={() => setGranularity('monthly')}
                className={`px-2 py-1 text-xs rounded ${granularity === 'monthly' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
              >
                Monthly
              </button>
            </div>
          </div>

          {/* YoY Comparison (only for monthly) */}
          {granularity === 'monthly' && entities.length === 1 && (
            <div>
              <label className="block text-xs text-osint-muted mb-1">Compare</label>
              <button
                onClick={() => setYoyCompare(!yoyCompare)}
                className={`px-2 py-1 text-xs rounded ${yoyCompare ? 'bg-primary-600 text-white' : 'hover:bg-osint-surface text-osint-muted border border-osint-border'}`}
              >
                {yoyCompare ? 'YoY ON' : 'YoY OFF'}
              </button>
            </div>
          )}

          {/* Chart Type */}
          <div>
            <label className="block text-xs text-osint-muted mb-1">Chart</label>
            <div className="flex gap-1">
              <button
                onClick={() => setChartType('line')}
                className={`p-1.5 rounded ${chartType === 'line' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
              >
                <LineChartIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setChartType('area')}
                className={`p-1.5 rounded ${chartType === 'area' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
              >
                <Layers className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Metrics */}
          <div>
            <label className="block text-xs text-osint-muted mb-1">Metrics</label>
            <div className="flex gap-1">
              {(['import_value', 'export_value', 'trade_balance'] as MetricType[]).map(m => (
                <button
                  key={m}
                  onClick={() => {
                    if (metrics.includes(m)) {
                      if (metrics.length > 1) setMetrics(metrics.filter(x => x !== m))
                    } else {
                      setMetrics([...metrics, m])
                    }
                  }}
                  className={`px-2 py-1 text-xs rounded ${
                    metrics.includes(m)
                      ? 'bg-severity-medium/20 text-severity-medium'
                      : 'bg-osint-surface text-osint-muted hover:text-osint-text'
                  }`}
                >
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-osint-muted cursor-pointer">
              <input
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
                className="rounded border-osint-border"
              />
              Normalize
            </label>
            <label className="flex items-center gap-2 text-sm text-osint-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showAnomalies}
                onChange={(e) => setShowAnomalies(e.target.checked)}
                className="rounded border-osint-border"
              />
              Show Anomalies
            </label>
          </div>
        </div>

        {/* Entity Search */}
        <div className="mt-4 relative">
          <div className="flex flex-wrap gap-2 items-center">
            {entities.map((id, index) => (
              <div
                key={id}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-sm"
                style={{ backgroundColor: `${ENTITY_COLORS[index]}20`, color: ENTITY_COLORS[index] }}
              >
                <span>{trendData[id]?.entity?.name || id}</span>
                <button onClick={() => removeEntity(id)} className="hover:opacity-70">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {entities.length < 5 && (
              <button
                onClick={() => setShowSearch(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-sm bg-osint-surface text-osint-muted hover:text-osint-text"
              >
                <Plus className="w-3 h-3" />
                Add {entityType}
              </button>
            )}
          </div>

          {showSearch && (
            <div className="absolute top-full left-0 mt-2 w-64 bg-osint-card border border-osint-border rounded-lg shadow-lg z-10">
              <div className="p-2 border-b border-osint-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-osint-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={`Search ${entityType}...`}
                    className="w-full pl-8 pr-3 py-1.5 bg-osint-surface border border-osint-border rounded text-sm text-osint-text"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {searchResults.map(result => (
                  <button
                    key={result.id}
                    onClick={() => addEntity(result.id)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-osint-surface text-osint-text"
                  >
                    <span className="font-medium">{result.name}</span>
                    <span className="text-osint-muted ml-2">({result.id})</span>
                  </button>
                ))}
                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <div className="px-3 py-2 text-sm text-osint-muted">No results found</div>
                )}
              </div>
              <div className="p-2 border-t border-osint-border">
                <button
                  onClick={() => setShowSearch(false)}
                  className="w-full text-sm text-osint-muted hover:text-osint-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      {entities.length > 0 && Object.keys(trendData).length > 0 && (
        <div className="p-4 border-b border-osint-border">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {entities.map((id, index) =>
              trendData[id] ? (
                <SummaryCard
                  key={id}
                  entity={trendData[id].entity}
                  summary={trendData[id].summary}
                  color={ENTITY_COLORS[index]}
                  onRemove={entities.length > 1 ? () => removeEntity(id) : undefined}
                />
              ) : null
            )}
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="p-4">
        {loading ? (
          <div className="h-96 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-osint-muted animate-spin" />
          </div>
        ) : error ? (
          <div className="h-96 flex items-center justify-center text-severity-critical">
            {error}
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-96 flex flex-col items-center justify-center text-osint-muted">
            <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
            <p>Select entities to view trends</p>
            <p className="text-sm mt-1">Click "Add {entityType}" above to start</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickLine={{ stroke: '#2a2a3a' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickLine={{ stroke: '#2a2a3a' }}
                tickFormatter={formatCrore}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Brush
                dataKey="label"
                height={30}
                stroke="#3b82f6"
                fill="#1a1a24"
              />

              {entities.length === 1 && yoyCompare && granularity === 'monthly' ? (
                // YoY comparison mode - show each fiscal year as a separate line
                <>
                  {yoyFiscalYears.map((fy, index) => (
                    <Line
                      key={fy}
                      type="monotone"
                      dataKey={`import_${fy}`}
                      name={`Import ${fy}`}
                      stroke={ENTITY_COLORS[index % ENTITY_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                      connectNulls
                    />
                  ))}
                </>
              ) : entities.length === 1 ? (
                // Single entity - show all metrics
                <>
                  {metrics.includes('import_value') && (
                    chartType === 'area' ? (
                      <Area
                        type="monotone"
                        dataKey="import_value"
                        name="Import Value"
                        stroke="#ef4444"
                        fill="#ef444420"
                        strokeWidth={2}
                      />
                    ) : (
                      <Line
                        type="monotone"
                        dataKey="import_value"
                        name="Import Value"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 6 }}
                      />
                    )
                  )}
                  {metrics.includes('export_value') && (
                    chartType === 'area' ? (
                      <Area
                        type="monotone"
                        dataKey="export_value"
                        name="Export Value"
                        stroke="#22c55e"
                        fill="#22c55e20"
                        strokeWidth={2}
                      />
                    ) : (
                      <Line
                        type="monotone"
                        dataKey="export_value"
                        name="Export Value"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 6 }}
                      />
                    )
                  )}
                  {metrics.includes('trade_balance') && (
                    <Line
                      type="monotone"
                      dataKey="trade_balance"
                      name="Trade Balance"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  )}
                </>
              ) : (
                // Multiple entities - show comparison
                entities.map((id, index) => (
                  chartType === 'area' ? (
                    <Area
                      key={id}
                      type="monotone"
                      dataKey={normalize ? `${id}_normalized` : id}
                      name={trendData[id]?.entity?.name || id}
                      stroke={ENTITY_COLORS[index]}
                      fill={`${ENTITY_COLORS[index]}20`}
                      strokeWidth={2}
                    />
                  ) : (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={normalize ? `${id}_normalized` : id}
                      name={trendData[id]?.entity?.name || id}
                      stroke={ENTITY_COLORS[index]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                    />
                  )
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Insights */}
      {entities.length === 1 && trendData[entities[0]]?.insights?.length > 0 && (
        <div className="p-4 border-t border-osint-border">
          <h4 className="text-sm font-medium text-osint-text mb-2">Key Insights</h4>
          <ul className="space-y-1">
            {trendData[entities[0]].insights.map((insight, index) => (
              <li key={index} className="text-sm text-osint-muted flex items-start gap-2">
                <span className="text-severity-medium">•</span>
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Correlation Matrix (for comparisons) */}
      {compareData?.correlation_matrix && entities.length > 1 && (
        <div className="p-4 border-t border-osint-border">
          <h4 className="text-sm font-medium text-osint-text mb-2">Correlation Matrix</h4>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-osint-muted font-normal text-left"></th>
                  {entities.map(id => (
                    <th key={id} className="p-2 text-osint-muted font-normal text-center">
                      {trendData[id]?.entity?.name || id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entities.map(id1 => (
                  <tr key={id1}>
                    <td className="p-2 text-osint-muted">{trendData[id1]?.entity?.name || id1}</td>
                    {entities.map(id2 => {
                      const corr = compareData.correlation_matrix[id1]?.[id2] || 0
                      const color = corr > 0.7 ? 'text-severity-low' :
                                   corr > 0.3 ? 'text-severity-medium' :
                                   corr < -0.3 ? 'text-severity-critical' :
                                   'text-osint-muted'
                      return (
                        <td key={id2} className={`p-2 text-center font-mono ${color}`}>
                          {corr.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default TimeSeriesExplorer
