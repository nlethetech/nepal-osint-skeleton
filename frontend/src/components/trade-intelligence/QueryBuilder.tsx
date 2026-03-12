/**
 * QueryBuilder - Self-Service Business Intelligence Interface
 *
 * Features:
 * - Visual query builder for business users
 * - Natural language query support
 * - Pre-built dashboard templates
 * - Export functionality
 */
import React, { useState, useCallback } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  Search,
  Play,
  Save,
  Download,
  BarChart2,
  LineChartIcon,
  PieChartIcon,
  Table as TableIcon,
  Sparkles,
  History,
  BookOpen,
  X,
  Plus,
  Filter,
  RefreshCw,
} from 'lucide-react'
import apiClient from '../../api/client'

// Types
interface QueryFilter {
  field: string
  operator: string
  value: any
  value2?: any
}

interface QuerySpec {
  metrics: string[]
  dimensions: string[]
  filters: QueryFilter[]
  aggregation: string
  sort_by: string | null
  sort_order: string
  limit: number
  offset: number
  include_totals: boolean
  include_percentages: boolean
}

interface QueryResult {
  query_id: string
  data: Record<string, any>[]
  total_rows: number
  totals?: Record<string, number>
  executed_at: string
}

interface NLQueryInterpretation {
  original_query: string
  interpreted_as: string
  confidence: number
  clarifications: string[]
  suggested_queries: string[]
}

type VisualizationType = 'table' | 'bar' | 'line' | 'pie'

// Available metrics and dimensions
const AVAILABLE_METRICS = [
  { id: 'import_value', name: 'Import Value', description: 'Total import value in NPR' },
  { id: 'export_value', name: 'Export Value', description: 'Total export value in NPR' },
  { id: 'trade_balance', name: 'Trade Balance', description: 'Export - Import' },
  { id: 'transaction_count', name: 'Transaction Count', description: 'Number of transactions' },
  { id: 'yoy_change', name: 'YoY Change %', description: 'Year-over-year percentage change' },
  { id: 'market_share', name: 'Market Share %', description: 'Percentage of total trade' },
]

const AVAILABLE_DIMENSIONS = [
  { id: 'country', name: 'Country', description: 'Group by trading partner country' },
  { id: 'commodity', name: 'Commodity', description: 'Group by HS code' },
  { id: 'hs_chapter', name: 'HS Chapter', description: 'Group by 2-digit HS chapter' },
  { id: 'fiscal_year', name: 'Fiscal Year', description: 'Group by Nepali fiscal year' },
  { id: 'month', name: 'Month', description: 'Group by month' },
  { id: 'quarter', name: 'Quarter', description: 'Group by quarter' },
]

const FILTER_OPERATORS = [
  { id: 'eq', name: '=', description: 'Equals' },
  { id: 'ne', name: '!=', description: 'Not equals' },
  { id: 'gt', name: '>', description: 'Greater than' },
  { id: 'lt', name: '<', description: 'Less than' },
  { id: 'gte', name: '>=', description: 'Greater or equal' },
  { id: 'lte', name: '<=', description: 'Less or equal' },
  { id: 'in', name: 'IN', description: 'In list' },
  { id: 'like', name: 'LIKE', description: 'Contains' },
]

// Chart colors
const CHART_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

// Format value for display
const formatValue = (value: number): string => {
  if (value >= 10000000) return `${(value / 10000000).toFixed(2)} Cr`
  if (value >= 100000) return `${(value / 100000).toFixed(2)} L`
  return value.toLocaleString()
}

// Natural Language Input
const NaturalLanguageInput: React.FC<{
  onSubmit: (query: string) => void
  loading: boolean
}> = ({ onSubmit, loading }) => {
  const [query, setQuery] = useState('')

  const suggestions = [
    'Show top 10 countries by import value',
    'Compare India and China trade for 2081-82',
    'What are the top commodities by export?',
    'Show petroleum import trend from India',
  ]

  return (
    <div className="bg-osint-surface border border-osint-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-severity-medium" />
        <h4 className="text-sm font-medium text-osint-text">Ask a Question</h4>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-osint-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && query && onSubmit(query)}
            placeholder="Ask in plain English..."
            className="w-full pl-10 pr-3 py-2 bg-osint-card border border-osint-border rounded-lg text-sm text-osint-text"
          />
        </div>
        <button
          onClick={() => query && onSubmit(query)}
          disabled={!query || loading}
          className="flex items-center gap-2 px-4 py-2 bg-severity-medium hover:bg-severity-medium/80 text-white rounded-lg text-sm disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          Ask
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => setQuery(s)}
            className="px-2 py-1 text-xs bg-osint-card hover:bg-osint-card/80 rounded text-osint-muted hover:text-osint-text"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// Visual Query Builder
const VisualQueryBuilder: React.FC<{
  querySpec: QuerySpec
  onChange: (spec: QuerySpec) => void
  onExecute: () => void
  loading: boolean
}> = ({ querySpec, onChange, onExecute, loading }) => {
  const toggleMetric = (id: string) => {
    if (querySpec.metrics.includes(id)) {
      onChange({ ...querySpec, metrics: querySpec.metrics.filter(m => m !== id) })
    } else {
      onChange({ ...querySpec, metrics: [...querySpec.metrics, id] })
    }
  }

  const toggleDimension = (id: string) => {
    if (querySpec.dimensions.includes(id)) {
      onChange({ ...querySpec, dimensions: querySpec.dimensions.filter(d => d !== id) })
    } else {
      onChange({ ...querySpec, dimensions: [...querySpec.dimensions, id] })
    }
  }

  const addFilter = () => {
    onChange({
      ...querySpec,
      filters: [...querySpec.filters, { field: 'fiscal_year', operator: 'eq', value: '' }]
    })
  }

  const removeFilter = (index: number) => {
    onChange({
      ...querySpec,
      filters: querySpec.filters.filter((_, i) => i !== index)
    })
  }

  const updateFilter = (index: number, updates: Partial<QueryFilter>) => {
    const newFilters = [...querySpec.filters]
    newFilters[index] = { ...newFilters[index], ...updates }
    onChange({ ...querySpec, filters: newFilters })
  }

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div>
        <h4 className="text-sm font-medium text-osint-text mb-2 flex items-center gap-2">
          <BarChart2 className="w-4 h-4" />
          Metrics (What to measure)
        </h4>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_METRICS.map(m => (
            <button
              key={m.id}
              onClick={() => toggleMetric(m.id)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                querySpec.metrics.includes(m.id)
                  ? 'bg-severity-medium text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
              title={m.description}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* Dimensions */}
      <div>
        <h4 className="text-sm font-medium text-osint-text mb-2 flex items-center gap-2">
          <TableIcon className="w-4 h-4" />
          Dimensions (How to group)
        </h4>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_DIMENSIONS.map(d => (
            <button
              key={d.id}
              onClick={() => toggleDimension(d.id)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                querySpec.dimensions.includes(d.id)
                  ? 'bg-severity-medium text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
              title={d.description}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-osint-text flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </h4>
          <button
            onClick={addFilter}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-osint-surface hover:bg-osint-surface/80 rounded text-osint-muted hover:text-osint-text"
          >
            <Plus className="w-3 h-3" />
            Add Filter
          </button>
        </div>
        <div className="space-y-2">
          {querySpec.filters.map((filter, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={filter.field}
                onChange={(e) => updateFilter(index, { field: e.target.value })}
                className="bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-sm text-osint-text"
              >
                {AVAILABLE_DIMENSIONS.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                value={filter.operator}
                onChange={(e) => updateFilter(index, { operator: e.target.value })}
                className="bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-sm text-osint-text"
              >
                {FILTER_OPERATORS.map(op => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={filter.value}
                onChange={(e) => updateFilter(index, { value: e.target.value })}
                placeholder="Value"
                className="flex-1 bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-sm text-osint-text"
              />
              <button
                onClick={() => removeFilter(index)}
                className="p-1.5 hover:bg-osint-surface rounded text-osint-muted hover:text-severity-critical"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {querySpec.filters.length === 0 && (
            <div className="text-sm text-osint-muted py-2">No filters applied</div>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <label className="text-sm text-osint-muted">Sort by:</label>
          <select
            value={querySpec.sort_by || ''}
            onChange={(e) => onChange({ ...querySpec, sort_by: e.target.value || null })}
            className="bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-sm text-osint-text"
          >
            <option value="">None</option>
            {querySpec.metrics.map(m => (
              <option key={m} value={m}>{m.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-osint-muted">Order:</label>
          <select
            value={querySpec.sort_order}
            onChange={(e) => onChange({ ...querySpec, sort_order: e.target.value })}
            className="bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-sm text-osint-text"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-osint-muted">Limit:</label>
          <input
            type="number"
            value={querySpec.limit}
            onChange={(e) => onChange({ ...querySpec, limit: parseInt(e.target.value) || 10 })}
            min={1}
            max={1000}
            className="w-20 bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-sm text-osint-text"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-osint-muted cursor-pointer">
          <input
            type="checkbox"
            checked={querySpec.include_totals}
            onChange={(e) => onChange({ ...querySpec, include_totals: e.target.checked })}
            className="rounded border-osint-border"
          />
          Include Totals
        </label>
        <label className="flex items-center gap-2 text-sm text-osint-muted cursor-pointer">
          <input
            type="checkbox"
            checked={querySpec.include_percentages}
            onChange={(e) => onChange({ ...querySpec, include_percentages: e.target.checked })}
            className="rounded border-osint-border"
          />
          Show %
        </label>
      </div>

      {/* Execute Button */}
      <button
        onClick={onExecute}
        disabled={querySpec.metrics.length === 0 || loading}
        className="flex items-center gap-2 px-4 py-2 bg-severity-medium hover:bg-severity-medium/80 text-white rounded-lg text-sm disabled:opacity-50"
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Run Query
      </button>
    </div>
  )
}

// Results Display
const ResultsDisplay: React.FC<{
  result: QueryResult | null
  visualization: VisualizationType
  onVisualizationChange: (v: VisualizationType) => void
  querySpec: QuerySpec
}> = ({ result, visualization, onVisualizationChange, querySpec }) => {
  if (!result) {
    return (
      <div className="h-64 flex items-center justify-center text-osint-muted">
        <div className="text-center">
          <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Run a query to see results</p>
        </div>
      </div>
    )
  }

  const { data, totals } = result

  // Get the main dimension and metric for charts
  const dimension = querySpec.dimensions[0] || 'country'
  const metric = querySpec.metrics[0] || 'import_value'

  // Prepare chart data
  const chartData = data.slice(0, 20).map(row => ({
    name: row[dimension] || row.commodity_code || row.country || 'Unknown',
    value: row[metric] || 0,
    ...row,
  }))

  return (
    <div>
      {/* Visualization Toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onVisualizationChange('table')}
            className={`p-2 rounded ${visualization === 'table' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
          >
            <TableIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onVisualizationChange('bar')}
            className={`p-2 rounded ${visualization === 'bar' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onVisualizationChange('line')}
            className={`p-2 rounded ${visualization === 'line' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
          >
            <LineChartIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onVisualizationChange('pie')}
            className={`p-2 rounded ${visualization === 'pie' ? 'bg-severity-medium/20 text-severity-medium' : 'hover:bg-osint-surface text-osint-muted'}`}
          >
            <PieChartIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="text-sm text-osint-muted">
          {result.total_rows} rows returned
        </div>
      </div>

      {/* Totals */}
      {totals && Object.keys(totals).length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          {Object.entries(totals).map(([key, value]) => (
            <div key={key} className="bg-osint-surface rounded-lg p-3">
              <div className="text-xs text-osint-muted capitalize">{key.replace('_', ' ')}</div>
              <div className="text-lg font-bold text-osint-text">{formatValue(value)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Visualization */}
      {visualization === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-osint-border">
                {querySpec.dimensions.map(d => (
                  <th key={d} className="px-3 py-2 text-left text-osint-muted font-normal capitalize">
                    {d.replace('_', ' ')}
                  </th>
                ))}
                {querySpec.metrics.map(m => (
                  <th key={m} className="px-3 py-2 text-right text-osint-muted font-normal capitalize">
                    {m.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-b border-osint-border/50 hover:bg-osint-surface/50">
                  {querySpec.dimensions.map(d => (
                    <td key={d} className="px-3 py-2 text-osint-text">
                      {row[d] || row.commodity_code || row.commodity_description || '-'}
                    </td>
                  ))}
                  {querySpec.metrics.map(m => (
                    <td key={m} className="px-3 py-2 text-right text-osint-text font-mono">
                      {formatValue(row[m] || 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : visualization === 'bar' ? (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
            <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} />
            <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={formatValue} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a24', border: '1px solid #2a2a3a' }}
              labelStyle={{ color: '#e4e4e7' }}
              formatter={(value: number) => formatValue(value)}
            />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      ) : visualization === 'line' ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
            <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} />
            <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={formatValue} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a24', border: '1px solid #2a2a3a' }}
              labelStyle={{ color: '#e4e4e7' }}
              formatter={(value: number) => formatValue(value)}
            />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={150}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => formatValue(value)} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// Main Component
const QueryBuilder: React.FC = () => {
  // State
  const [mode, setMode] = useState<'visual' | 'natural'>('visual')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [interpretation, setInterpretation] = useState<NLQueryInterpretation | null>(null)
  const [visualization, setVisualization] = useState<VisualizationType>('bar')

  const [querySpec, setQuerySpec] = useState<QuerySpec>({
    metrics: ['import_value'],
    dimensions: ['country'],
    filters: [],
    aggregation: 'sum',
    sort_by: 'import_value',
    sort_order: 'desc',
    limit: 10,
    offset: 0,
    include_totals: true,
    include_percentages: false,
  })

  // Execute visual query
  const executeQuery = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await apiClient.post('/trade-analytics/bi/query', querySpec)
      setResult(response.data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Query execution failed')
    } finally {
      setLoading(false)
    }
  }, [querySpec])

  // Execute natural language query
  const executeNLQuery = useCallback(async (query: string) => {
    setLoading(true)
    setError(null)

    try {
      const response = await apiClient.post('/trade-analytics/bi/natural-query', {
        query,
        execute: true,
      })

      setInterpretation(response.data.interpretation)
      if (response.data.result) {
        setResult(response.data.result)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Query execution failed')
    } finally {
      setLoading(false)
    }
  }, [])

  // Export to CSV
  const exportCSV = () => {
    if (!result?.data?.length) return

    const headers = Object.keys(result.data[0]).join(',')
    const rows = result.data.map(row =>
      Object.values(row).map(v => typeof v === 'string' ? `"${v}"` : v).join(',')
    )
    const csv = [headers, ...rows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query_results_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-osint-text flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-severity-medium" />
            Query Builder
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              disabled={!result?.data?.length}
              className="flex items-center gap-1 px-3 py-1.5 bg-osint-surface hover:bg-osint-surface/80 rounded-lg text-sm text-osint-muted disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('visual')}
            className={`px-4 py-2 text-sm rounded-lg ${
              mode === 'visual'
                ? 'bg-severity-medium text-white'
                : 'bg-osint-surface text-osint-muted hover:text-osint-text'
            }`}
          >
            Visual Builder
          </button>
          <button
            onClick={() => setMode('natural')}
            className={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 ${
              mode === 'natural'
                ? 'bg-severity-medium text-white'
                : 'bg-osint-surface text-osint-muted hover:text-osint-text'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Natural Language
          </button>
        </div>
      </div>

      {/* Query Input */}
      <div className="p-4 border-b border-osint-border">
        {mode === 'natural' ? (
          <NaturalLanguageInput onSubmit={executeNLQuery} loading={loading} />
        ) : (
          <VisualQueryBuilder
            querySpec={querySpec}
            onChange={setQuerySpec}
            onExecute={executeQuery}
            loading={loading}
          />
        )}

        {/* Interpretation */}
        {interpretation && (
          <div className="mt-4 p-3 bg-severity-medium/10 border border-severity-medium/30 rounded-lg">
            <div className="text-sm text-osint-text mb-1">
              <span className="text-osint-muted">Interpreted as: </span>
              {interpretation.interpreted_as}
            </div>
            <div className="text-xs text-osint-muted">
              Confidence: {(interpretation.confidence * 100).toFixed(0)}%
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-severity-critical/10 border border-severity-critical/30 rounded-lg text-severity-critical text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="p-4">
        <ResultsDisplay
          result={result}
          visualization={visualization}
          onVisualizationChange={setVisualization}
          querySpec={querySpec}
        />
      </div>
    </div>
  )
}

export default QueryBuilder
