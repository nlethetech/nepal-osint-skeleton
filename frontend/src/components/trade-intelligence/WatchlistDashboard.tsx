/**
 * Palantir-Grade Watchlist Dashboard
 *
 * Advanced visualization dashboard for custom watchlist baskets featuring:
 * - Stacked bar timeline (12-month view by category)
 * - Signal strength assessment (horizontal deviation bars)
 * - Year-over-year comparison charts
 * - Deviation heatmap (basket x month matrix)
 * - Basket management panel
 */
import { useState, useEffect, useMemo } from 'react'
import {
  Shield,
  Radio,
  Construction,
  Flame,
  HeartPulse,
  Target,
  AlertOctagon,
  Plus,
  Trash2,
  Settings,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Search,
  Filter,
  BarChart3,
  Activity,
  Grid3X3,
} from 'lucide-react'
import apiClient from '../../api/client'

// =============================================================================
// TYPES
// =============================================================================

interface WatchlistBasket {
  id: string
  name: string
  display_name: string
  description: string | null
  basket_type: string
  color: string
  icon: string | null
  intelligence_value: string | null
  event_correlation: string[]
  alert_threshold_low: number
  alert_threshold_medium: number
  alert_threshold_high: number
  is_active: boolean
  priority: number
  item_count: number
  items: BasketItem[] | null
}

interface BasketItem {
  id: string
  hs_code: string
  description: string | null
  custom_label: string | null
  weight: number
  notes: string | null
}

interface BasketAnalytics {
  fiscal_year: string
  month: number
  month_name: string
  total_import_value: number
  weighted_value: number
  yoy_change_pct: number | null
  deviation_from_baseline_pct: number | null
  signal_strength: string | null
  item_breakdown: Record<string, number>
}

interface TimelineData {
  timeline: Array<{
    period: string
    fiscal_year: string
    month: number
    month_name: string
    [key: string]: any
  }>
  baskets: Record<string, { id: string; display_name: string; color: string }>
}

interface SignalAssessment {
  period: { fiscal_year: string; month: number; month_name: string }
  signals: Array<{
    basket_id: string
    basket_name: string
    color: string
    deviation_pct: number
    signal_strength: string
    value: number
    baseline: number | null
  }>
  composite: {
    average_deviation: number
    high_signal_count: number
    total_baskets: number
    status: string
    pre_event_pattern: boolean
  }
}

interface HeatmapData {
  baskets: Record<string, { id: string; color: string }>
  data: Array<{
    basket: string
    period: string
    fiscal_year: string
    month: number
    deviation_pct: number
    signal_strength: string
    value: number
  }>
  fiscal_years: string[]
}

// =============================================================================
// HELPERS
// =============================================================================

const NEPALI_MONTHS = [
  'Baishakh', 'Jestha', 'Ashad', 'Shrawan',
  'Bhadra', 'Ashwin', 'Kartik', 'Mangsir',
  'Poush', 'Magh', 'Falgun', 'Chaitra',
]

function getBasketIcon(icon: string | null): any {
  const icons: Record<string, any> = {
    Shield: Shield,
    Radio: Radio,
    Construction: Construction,
    Flame: Flame,
    HeartPulse: HeartPulse,
    Target: Target,
    AlertOctagon: AlertOctagon,
  }
  return icons[icon || ''] || Shield
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'CRITICAL':
      return 'text-red-400 bg-red-500/20'
    case 'ELEVATED':
      return 'text-orange-400 bg-orange-500/20'
    case 'MODERATE':
      return 'text-yellow-400 bg-yellow-500/20'
    case 'BELOW_BASELINE':
      return 'text-blue-400 bg-blue-500/20'
    default:
      return 'text-green-400 bg-green-500/20'
  }
}

function getDeviationColor(deviation: number): string {
  if (deviation > 50) return '#EF4444' // Red
  if (deviation > 30) return '#F97316' // Orange
  if (deviation > 15) return '#F59E0B' // Amber
  if (deviation > 0) return '#22C55E' // Green
  return '#6B7280' // Gray for below baseline
}

function formatValue(value: number): string {
  if (value >= 10000000) return `${(value / 10000000).toFixed(1)} Cr`
  if (value >= 100000) return `${(value / 100000).toFixed(1)} L`
  if (value >= 1000) return `${(value / 1000).toFixed(1)} K`
  return value.toFixed(0)
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/**
 * Stacked Bar Timeline Chart
 * Shows 12-month timeline of watchlist category imports
 */
function StackedTimelineChart({
  data,
  baskets,
  highlightMonth,
  onMonthClick,
}: {
  data: TimelineData['timeline']
  baskets: TimelineData['baskets']
  highlightMonth?: string
  onMonthClick?: (period: string) => void
}) {
  const basketNames = Object.keys(baskets)
  const maxTotal = useMemo(() => {
    return Math.max(
      ...data.map((d) =>
        basketNames.reduce((sum, name) => sum + (d[name] || 0), 0)
      )
    )
  }, [data, basketNames])

  return (
    <div className="bg-osint-bg-secondary rounded-lg border border-osint-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-osint-text flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          WATCHLIST CATEGORY IMPORTS: 12-Month Timeline
        </h3>
        <div className="flex items-center gap-4 text-xs">
          {basketNames.map((name) => (
            <div key={name} className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: baskets[name]?.color || '#888' }}
              />
              <span className="text-osint-muted">{baskets[name]?.display_name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-1 h-64">
        {data.map((d, i) => {
          const total = basketNames.reduce((sum, name) => sum + (d[name] || 0), 0)
          const heightPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0
          const isHighlight = highlightMonth === d.period

          return (
            <div
              key={d.period}
              className={`flex-1 flex flex-col justify-end cursor-pointer transition-all ${
                isHighlight ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-osint-bg-secondary rounded' : ''
              }`}
              onClick={() => onMonthClick?.(d.period)}
            >
              <div
                className="flex flex-col-reverse rounded-t overflow-hidden"
                style={{ height: `${heightPct}%`, minHeight: total > 0 ? '4px' : '0' }}
              >
                {basketNames.map((name) => {
                  const value = d[name] || 0
                  const segmentPct = total > 0 ? (value / total) * 100 : 0
                  return (
                    <div
                      key={name}
                      style={{
                        height: `${segmentPct}%`,
                        backgroundColor: baskets[name]?.color || '#888',
                      }}
                      className="w-full transition-all hover:brightness-110"
                      title={`${baskets[name]?.display_name}: Rs. ${formatValue(value)}`}
                    />
                  )
                })}
              </div>
              <div className="text-[10px] text-osint-muted text-center mt-2 leading-tight">
                <div>{d.month_name}</div>
                <div>{d.fiscal_year.split('/')[0]}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Fiscal Year Divider */}
      <div className="flex items-center justify-center mt-2 text-xs text-osint-muted">
        <div className="border-t border-dashed border-osint-border w-full" />
      </div>
    </div>
  )
}

/**
 * Signal Strength Assessment Chart
 * Horizontal bar chart showing deviation from baseline for each category
 */
function SignalStrengthChart({
  assessment,
}: {
  assessment: SignalAssessment | null
}) {
  if (!assessment) return null

  const { signals, composite, period } = assessment

  return (
    <div className="bg-osint-bg-secondary rounded-lg border border-osint-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-osint-text">
          {period.month_name.toUpperCase()} {period.fiscal_year.split('/')[0]} SIGNAL STRENGTH
        </h3>
        <span className="text-xs text-osint-muted">by Category</span>
      </div>

      <div className="flex gap-6">
        {/* Signal Bars */}
        <div className="flex-1 space-y-3">
          {signals.map((signal) => (
            <div key={signal.basket_id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-osint-muted">{signal.basket_name}</span>
                <span
                  className={`font-mono ${
                    signal.deviation_pct > 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {signal.deviation_pct > 0 ? '+' : ''}{signal.deviation_pct.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center h-6 bg-osint-bg-tertiary rounded overflow-hidden">
                {/* Zero line in center */}
                <div className="relative w-full h-full">
                  {/* Negative bar (left side) */}
                  {signal.deviation_pct < 0 && (
                    <div
                      className="absolute right-1/2 h-full rounded-l"
                      style={{
                        width: `${Math.min(Math.abs(signal.deviation_pct), 60)}%`,
                        backgroundColor: '#6B7280',
                        transform: 'translateX(0)',
                      }}
                    />
                  )}
                  {/* Positive bar (right side) */}
                  {signal.deviation_pct > 0 && (
                    <div
                      className="absolute left-1/2 h-full rounded-r"
                      style={{
                        width: `${Math.min(signal.deviation_pct, 60)}%`,
                        backgroundColor: signal.color,
                      }}
                    />
                  )}
                  {/* Center line */}
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-osint-border" />
                  {/* Threshold lines */}
                  <div
                    className="absolute top-0 bottom-0 w-px border-l border-dashed border-yellow-500/50"
                    style={{ left: 'calc(50% + 15%)' }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-px border-l border-dashed border-red-500/50"
                    style={{ left: 'calc(50% + 30%)' }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Composite Assessment Panel */}
        <div className="w-56 p-3 border border-blue-500/30 rounded-lg bg-blue-500/5">
          <div className="text-xs text-blue-400 font-medium mb-2">COMPOSITE SIGNAL ASSESSMENT</div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-osint-muted">Average Deviation:</span>
              <span className="text-osint-text font-mono">
                {composite.average_deviation > 0 ? '+' : ''}{composite.average_deviation.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-osint-muted">High Signal Categories:</span>
              <span className="text-osint-text">{composite.high_signal_count}/{composite.total_baskets}</span>
            </div>
            <div className="w-full bg-osint-bg-tertiary rounded-full h-2 my-2">
              <div
                className="h-2 rounded-full bg-blue-500"
                style={{ width: `${(composite.high_signal_count / composite.total_baskets) * 100}%` }}
              />
            </div>
            <div className={`flex items-center justify-center py-2 rounded ${getStatusColor(composite.status)}`}>
              <span className="font-semibold">STATUS: {composite.status}</span>
            </div>
            {composite.pre_event_pattern && (
              <div className="text-amber-400 text-center mt-2">Pre-Event Pattern Detected</div>
            )}
          </div>

          {/* Threshold Legend */}
          <div className="mt-4 pt-3 border-t border-osint-border text-[10px] text-osint-muted space-y-1">
            <div className="font-medium">THRESHOLD LEGEND:</div>
            <div>&gt;30%: 🔴 HIGH SIGNAL</div>
            <div>15-30%: 🟡 MODERATE SIGNAL</div>
            <div>0-15%: 🟢 LOW SIGNAL</div>
            <div>&lt;0%: ⚪ BELOW BASELINE</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Year-over-Year Comparison Chart
 * Side-by-side bar comparison of two fiscal years
 */
function YoYComparisonChart({
  basketName,
  fy1,
  fy2,
  data,
  color,
}: {
  basketName: string
  fy1: string
  fy2: string
  data: Array<{
    month: number
    month_name: string
    fy1: { value: number }
    fy2: { value: number }
    yoy_change_pct: number
  }>
  color: string
}) {
  const maxValue = Math.max(
    ...data.flatMap((d) => [d.fy1?.value || 0, d.fy2?.value || 0])
  )

  return (
    <div className="bg-osint-bg-secondary rounded-lg border border-osint-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-osint-text">{basketName}</h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-blue-400" />
            <span className="text-osint-muted">FY {fy1}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
            <span className="text-osint-muted">FY {fy2}</span>
          </div>
        </div>
      </div>

      <div className="flex items-end gap-4 h-40">
        {data.slice(0, 5).map((d) => {
          const fy1Pct = maxValue > 0 ? ((d.fy1?.value || 0) / maxValue) * 100 : 0
          const fy2Pct = maxValue > 0 ? ((d.fy2?.value || 0) / maxValue) * 100 : 0
          const yoyChange = d.yoy_change_pct

          return (
            <div key={d.month} className="flex-1 flex flex-col items-center">
              {/* YoY label */}
              {yoyChange !== undefined && yoyChange !== 0 && (
                <div
                  className={`text-[10px] font-medium mb-1 ${
                    yoyChange > 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {yoyChange > 0 ? '+' : ''}{yoyChange.toFixed(0)}%
                </div>
              )}

              <div className="flex items-end gap-1 w-full">
                {/* FY1 bar */}
                <div
                  className="flex-1 rounded-t bg-blue-400/70"
                  style={{ height: `${fy1Pct}%`, minHeight: d.fy1?.value > 0 ? '4px' : '0' }}
                />
                {/* FY2 bar */}
                <div
                  className="flex-1 rounded-t"
                  style={{
                    height: `${fy2Pct}%`,
                    minHeight: d.fy2?.value > 0 ? '4px' : '0',
                    backgroundColor: color,
                  }}
                />
              </div>

              <div className="text-[10px] text-osint-muted mt-2">{d.month_name}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Deviation Heatmap
 * Matrix showing deviation % for each basket x month combination
 */
function DeviationHeatmap({
  data,
  baskets,
  highlightPeriod,
}: {
  data: HeatmapData['data']
  baskets: HeatmapData['baskets']
  highlightPeriod?: string
}) {
  // Group data by basket
  const basketNames = Object.keys(baskets)
  const periods = [...new Set(data.map((d) => d.period))].sort()

  // Create matrix
  const matrix: Record<string, Record<string, { deviation: number; signal: string }>> = {}
  for (const d of data) {
    if (!matrix[d.basket]) matrix[d.basket] = {}
    matrix[d.basket][d.period] = {
      deviation: d.deviation_pct,
      signal: d.signal_strength,
    }
  }

  return (
    <div className="bg-osint-bg-secondary rounded-lg border border-osint-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-osint-text flex items-center gap-2">
          <Grid3X3 className="w-4 h-4" />
          WATCHLIST CATEGORY DEVIATION HEATMAP
        </h3>
        <span className="text-xs text-osint-muted">% Above/Below Category Average</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-osint-muted py-2 pr-4 sticky left-0 bg-osint-bg-secondary"></th>
              {periods.map((period) => (
                <th
                  key={period}
                  className={`text-center text-osint-muted py-2 px-2 ${
                    highlightPeriod === period ? 'bg-red-500/20 rounded' : ''
                  }`}
                >
                  <div className="text-[10px] leading-tight">
                    {period.split(' ')[0]}
                    <br />
                    {period.split(' ')[1]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {basketNames.map((basketName) => (
              <tr key={basketName}>
                <td className="text-osint-muted py-2 pr-4 sticky left-0 bg-osint-bg-secondary whitespace-nowrap">
                  {baskets[basketName]?.id ? basketName : basketName}
                </td>
                {periods.map((period) => {
                  const cell = matrix[basketName]?.[period]
                  const deviation = cell?.deviation || 0
                  const bgColor = getDeviationColor(deviation)
                  const isHighlight = highlightPeriod === period

                  return (
                    <td
                      key={period}
                      className={`text-center py-2 px-2 ${isHighlight ? 'ring-1 ring-red-500' : ''}`}
                    >
                      <div
                        className="px-2 py-1 rounded text-white font-mono"
                        style={{
                          backgroundColor: bgColor,
                          opacity: Math.min(0.3 + Math.abs(deviation) / 100, 1),
                        }}
                      >
                        {deviation > 0 ? '+' : ''}{deviation.toFixed(0)}%
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Color scale legend */}
      <div className="flex items-center justify-end gap-4 mt-4 text-[10px] text-osint-muted">
        <span>% Deviation from Category Average</span>
        <div className="flex items-center">
          <div className="w-4 h-3 bg-gray-500 rounded-l" />
          <div className="w-4 h-3 bg-green-500" />
          <div className="w-4 h-3 bg-yellow-500" />
          <div className="w-4 h-3 bg-orange-500" />
          <div className="w-4 h-3 bg-red-500 rounded-r" />
        </div>
        <span>-60 → +60</span>
      </div>
    </div>
  )
}

/**
 * Basket Management Panel
 * Allows users to view and manage watchlist baskets
 */
function BasketManagementPanel({
  baskets,
  selectedBaskets,
  onToggleBasket,
  onAddBasket,
  onRemoveItem,
  onAddItem,
}: {
  baskets: WatchlistBasket[]
  selectedBaskets: Set<string>
  onToggleBasket: (id: string) => void
  onAddBasket: () => void
  onRemoveItem: (basketId: string, hsCode: string) => void
  onAddItem: (basketId: string, hsCode: string) => void
}) {
  const [expandedBasket, setExpandedBasket] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="bg-osint-bg-secondary rounded-lg border border-osint-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-osint-text flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Watchlist Baskets
        </h3>
        <button
          onClick={onAddBasket}
          className="px-3 py-1 text-xs bg-osint-accent/20 text-osint-accent rounded hover:bg-osint-accent/30 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Create Basket
        </button>
      </div>

      <div className="space-y-2">
        {baskets.map((basket) => {
          const Icon = getBasketIcon(basket.icon)
          const isExpanded = expandedBasket === basket.id
          const isSelected = selectedBaskets.has(basket.id)

          return (
            <div key={basket.id} className="border border-osint-border rounded-lg overflow-hidden">
              {/* Basket header */}
              <div
                className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-osint-bg-hover ${
                  isSelected ? 'bg-osint-bg-hover' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleBasket(basket.id)}
                  className="rounded border-osint-border"
                />
                <div
                  className="w-8 h-8 rounded flex items-center justify-center"
                  style={{ backgroundColor: basket.color + '30' }}
                >
                  <Icon className="w-4 h-4" style={{ color: basket.color }} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-osint-text">{basket.display_name}</div>
                  <div className="text-xs text-osint-muted">{basket.item_count} HS codes</div>
                </div>
                <span
                  className={`px-2 py-0.5 text-[10px] rounded ${
                    basket.basket_type === 'system'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-purple-500/20 text-purple-400'
                  }`}
                >
                  {basket.basket_type.toUpperCase()}
                </span>
                <button
                  onClick={() => setExpandedBasket(isExpanded ? null : basket.id)}
                  className="p-1 hover:bg-osint-bg-tertiary rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-osint-muted" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-osint-muted" />
                  )}
                </button>
              </div>

              {/* Expanded items */}
              {isExpanded && basket.items && (
                <div className="border-t border-osint-border bg-osint-bg-tertiary p-3">
                  <div className="text-xs text-osint-muted mb-2">
                    {basket.description}
                  </div>
                  <div className="space-y-1">
                    {basket.items.map((item) => (
                      <div
                        key={item.hs_code}
                        className="flex items-center justify-between text-xs p-2 bg-osint-bg-secondary rounded"
                      >
                        <div>
                          <span className="font-mono text-osint-text">{item.hs_code}</span>
                          <span className="text-osint-muted ml-2">{item.description || item.custom_label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-osint-muted">w: {item.weight}</span>
                          {basket.basket_type !== 'system' && (
                            <button
                              onClick={() => onRemoveItem(basket.id, item.hs_code)}
                              className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function WatchlistDashboard() {
  // State
  const [baskets, setBaskets] = useState<WatchlistBasket[]>([])
  const [selectedBaskets, setSelectedBaskets] = useState<Set<string>>(new Set())
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null)
  const [signalAssessment, setSignalAssessment] = useState<SignalAssessment | null>(null)
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedFY, setSelectedFY] = useState('2082/83')
  const [selectedMonth, setSelectedMonth] = useState(5) // Bhadra
  const [highlightPeriod, setHighlightPeriod] = useState<string | null>(null)

  // View mode
  const [viewMode, setViewMode] = useState<'timeline' | 'signals' | 'heatmap'>('timeline')

  // Fetch baskets on mount
  useEffect(() => {
    fetchBaskets()
  }, [])

  // Fetch visualization data when baskets are selected
  useEffect(() => {
    if (selectedBaskets.size > 0) {
      fetchVisualizationData()
    }
  }, [selectedBaskets, selectedFY, selectedMonth])

  async function fetchBaskets() {
    setLoading(true)
    try {
      // First seed the baskets if needed
      await apiClient.post('/trade-intelligence/baskets/seed')

      // Then fetch all baskets
      const response = await apiClient.get('/trade-intelligence/baskets')
      setBaskets(response.data)

      // Select all system baskets by default
      const systemBasketIds = response.data
        .filter((b: WatchlistBasket) => b.basket_type === 'system')
        .map((b: WatchlistBasket) => b.id)
      setSelectedBaskets(new Set(systemBasketIds))
    } catch (err: any) {
      setError(err.message || 'Failed to fetch baskets')
    } finally {
      setLoading(false)
    }
  }

  async function fetchVisualizationData() {
    if (selectedBaskets.size === 0) return

    const basketIds = Array.from(selectedBaskets)

    try {
      // Compute analytics for each basket first
      await Promise.all(
        basketIds.map((id) =>
          apiClient.post(`/trade-intelligence/baskets/${id}/compute-analytics`)
        )
      )

      // Fetch timeline data
      const timelineRes = await apiClient.get('/trade-intelligence/baskets/visualization/timeline', {
        params: {
          basket_ids: basketIds,
          start_fy: '2081/82',
          end_fy: '2082/83',
        },
        paramsSerializer: { indexes: null },
      })
      setTimelineData(timelineRes.data)

      // Fetch signal assessment
      const signalRes = await apiClient.get('/trade-intelligence/baskets/visualization/signal-assessment', {
        params: {
          basket_ids: basketIds,
          fiscal_year: selectedFY,
          month: selectedMonth,
        },
        paramsSerializer: { indexes: null },
      })
      setSignalAssessment(signalRes.data)

      // Fetch heatmap data
      const heatmapRes = await apiClient.get('/trade-intelligence/baskets/visualization/heatmap', {
        params: {
          basket_ids: basketIds,
          fiscal_years: ['2081/82', '2082/83'],
        },
        paramsSerializer: { indexes: null },
      })
      setHeatmapData(heatmapRes.data)
    } catch (err: any) {
      console.error('Failed to fetch visualization data:', err)
    }
  }

  function toggleBasket(id: string) {
    const newSelected = new Set(selectedBaskets)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedBaskets(newSelected)
  }

  // Render
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-osint-text flex items-center gap-2">
            <Activity className="w-5 h-5 text-osint-accent" />
            Watchlist Intelligence Dashboard
          </h2>
          <p className="text-sm text-osint-muted mt-1">
            Palantir-grade pre-event indicator monitoring by commodity category
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            className="px-3 py-1.5 bg-osint-bg-tertiary border border-osint-border rounded text-sm"
          >
            <option value="2082/83">FY 2082/83</option>
            <option value="2081/82">FY 2081/82</option>
          </select>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-osint-bg-tertiary border border-osint-border rounded text-sm"
          >
            {NEPALI_MONTHS.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <button
            onClick={fetchVisualizationData}
            className="p-2 bg-osint-bg-tertiary border border-osint-border rounded hover:bg-osint-bg-hover"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex items-center gap-2 border-b border-osint-border pb-2">
        {(['timeline', 'signals', 'heatmap'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-4 py-2 text-sm rounded-t ${
              viewMode === mode
                ? 'bg-osint-bg-secondary text-osint-text border border-osint-border border-b-0'
                : 'text-osint-muted hover:text-osint-text'
            }`}
          >
            {mode === 'timeline' && <BarChart3 className="w-4 h-4 inline mr-2" />}
            {mode === 'signals' && <Activity className="w-4 h-4 inline mr-2" />}
            {mode === 'heatmap' && <Grid3X3 className="w-4 h-4 inline mr-2" />}
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
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

      {/* Main Content */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Visualizations (3 cols) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Timeline View */}
            {viewMode === 'timeline' && timelineData && (
              <StackedTimelineChart
                data={timelineData.timeline}
                baskets={timelineData.baskets}
                highlightMonth={highlightPeriod || undefined}
                onMonthClick={(period) => setHighlightPeriod(period)}
              />
            )}

            {/* Signals View */}
            {viewMode === 'signals' && (
              <SignalStrengthChart assessment={signalAssessment} />
            )}

            {/* Heatmap View */}
            {viewMode === 'heatmap' && heatmapData && (
              <DeviationHeatmap
                data={heatmapData.data}
                baskets={heatmapData.baskets}
                highlightPeriod={highlightPeriod || undefined}
              />
            )}

            {/* Event Annotation */}
            {highlightPeriod && highlightPeriod.includes('Bhadra') && highlightPeriod.includes('2082') && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-semibold">PROTEST MONTH DETECTED</span>
                </div>
                <p className="text-sm text-osint-muted mt-2">
                  Bhadra 2082 (September 2025) - Gen-Z Protests in Nepal.
                  Multiple categories show elevated pre-event patterns.
                </p>
              </div>
            )}
          </div>

          {/* Basket Management Panel (1 col) */}
          <div className="space-y-4">
            <BasketManagementPanel
              baskets={baskets}
              selectedBaskets={selectedBaskets}
              onToggleBasket={toggleBasket}
              onAddBasket={() => {
                // TODO: Open create basket modal
                alert('Create basket modal - coming soon')
              }}
              onRemoveItem={(basketId, hsCode) => {
                // TODO: Remove item from basket
                console.log('Remove', hsCode, 'from', basketId)
              }}
              onAddItem={(basketId, hsCode) => {
                // TODO: Add item to basket
                console.log('Add', hsCode, 'to', basketId)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default WatchlistDashboard
