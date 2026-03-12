/**
 * Threat Matrix - Shows threat levels by category
 */
import { useEffect, useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getThreatMatrix, type ThreatMatrix as ThreatMatrixData, type ThreatMatrixCell } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { useRealtimeStore, type ThreatMatrixCounts } from '../../store/realtimeSlice'

interface ThreatMatrixProps {
  hours?: number
  districts?: string[]
  compact?: boolean
}

const CATEGORIES: Record<string, string> = {
  political: 'Political',
  security: 'Security',
  disaster: 'Disaster',
  economic: 'Economic',
  social: 'Social',
}

const LEVEL_STYLES: Record<string, string> = {
  critical: 'text-severity-critical',
  elevated: 'text-severity-high',
  guarded: 'text-severity-medium',
  low: 'text-severity-low',
}

function formatRatePerHour(rate: number): string {
  if (!Number.isFinite(rate)) return '0'
  if (rate >= 10) return rate.toFixed(0)
  if (rate >= 1) return rate.toFixed(1)
  return rate.toFixed(2)
}

export function ThreatMatrix({ hours = 24, districts, compact = false }: ThreatMatrixProps) {
  const [data, setData] = useState<ThreatMatrixData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { threatMatrixDelta, resetThreatMatrixDelta } = useRealtimeStore()

  useEffect(() => {
    const fetchMatrix = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await getThreatMatrix(hours, districts)
        setData(result)
        resetThreatMatrixDelta()
      } catch (err) {
        console.error('Failed to fetch threat matrix:', err)
        setError('Failed to load')
      } finally {
        setLoading(false)
      }
    }
    fetchMatrix()
  }, [hours, districts, resetThreatMatrixDelta])

  const mergedMatrix = useMemo(() => {
    if (!data) return null

    const categoryMap: Record<string, keyof ThreatMatrixCounts> = {
      political: 'political',
      security: 'security',
      disaster: 'disaster',
      economic: 'economic',
      social: 'social',
    }

    const updatedMatrix = data.matrix.map((cell) => {
      const category = categoryMap[cell.category]
      if (!category) return cell

      const delta = threatMatrixDelta[category]
      const totalDelta = delta.critical + delta.high + delta.medium + delta.low

      if (totalDelta === 0) return cell

      return {
        ...cell,
        event_count: cell.event_count + totalDelta,
      }
    })

    return { ...data, matrix: updatedMatrix }
  }, [data, threatMatrixDelta])

  const getTrendIcon = (trend: string) => {
    if (trend === 'escalating') return <TrendingUp size={10} className="text-severity-critical" />
    if (trend === 'deescalating') return <TrendingDown size={10} className="text-severity-low" />
    return <Minus size={10} className="text-osint-muted" />
  }

  // Compact card styling matching KeyActorsPanel
  const cardClass = compact
    ? "bg-osint-card border border-osint-border rounded-lg p-3"
    : "bg-osint-card border border-osint-border rounded-xl p-5"

  if (loading) {
    return (
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-medium text-osint-muted uppercase">Threat Matrix</h3>
        </div>
        <div className="flex items-center justify-center h-20">
          <LoadingSpinner />
        </div>
      </div>
    )
  }

  if (error || !mergedMatrix) {
    return (
      <div className={cardClass}>
        <h3 className="text-xs font-medium text-osint-muted uppercase mb-1.5">Threat Matrix</h3>
        <p className="text-xs text-osint-muted">{error || 'No data'}</p>
      </div>
    )
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-osint-muted uppercase">Threat Matrix</h3>
          <span className="text-[10px] text-osint-muted tabular-nums">avg/hr</span>
        </div>
        <span
          className={`text-[10px] font-medium ${LEVEL_STYLES[mergedMatrix.overall_threat_level] || 'text-osint-muted'}`}
        >
          {mergedMatrix.overall_threat_level}
        </span>
      </div>

      {(() => {
        const hoursSafe = Math.max(1, hours)
        const totalEvents = mergedMatrix.matrix.reduce((sum, c) => sum + c.event_count, 0)
        const maxRatePerHour = Math.max(
          1,
          ...mergedMatrix.matrix.map(c => c.event_count / hoursSafe),
        )

        return (
      <div className="space-y-0.5">
        {mergedMatrix.matrix.map((cell) => (
          <div
            key={cell.category}
            className="flex items-center h-5"
            title={[
              `${(CATEGORIES[cell.category] || cell.category)}: ${cell.event_count.toLocaleString()} events`,
              `Avg/hr: ${formatRatePerHour(cell.event_count / hoursSafe)}`,
              totalEvents > 0 ? `Share: ${((cell.event_count / totalEvents) * 100).toFixed(1)}%` : undefined,
            ].filter(Boolean).join(' · ')}
          >
            <span className="text-[11px] text-osint-text-secondary w-14 flex-shrink-0">
              {CATEGORIES[cell.category] || cell.category}
            </span>
            <div className="flex-1 mx-2">
              <div className="h-1 bg-osint-surface rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    cell.level === 'critical' ? 'bg-severity-critical' :
                    cell.level === 'elevated' ? 'bg-severity-high' :
                    cell.level === 'guarded' ? 'bg-severity-medium' :
                    'bg-severity-low'
                  }`}
                  style={{ width: `${Math.min(100, (cell.event_count / hoursSafe) / maxRatePerHour * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-1 w-8 justify-end flex-shrink-0">
              <span className="text-[10px] text-osint-text tabular-nums">
                {formatRatePerHour(cell.event_count / hoursSafe)}
              </span>
              {getTrendIcon(cell.trend)}
            </div>
          </div>
        ))}
      </div>
        )
      })()}
    </div>
  )
}
