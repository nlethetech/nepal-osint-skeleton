import { useState } from 'react'
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface HourlyData {
  hour: string
  count: number
  label?: string
  category_breakdown?: Record<string, number>
}

interface ActivityTimelineProps {
  data: HourlyData[]
  onHourClick: (hour: string) => void
}

function formatHour(hourString: string, label?: string): string {
  if (label) return label

  try {
    const normalized = hourString.length === 13 ? hourString + ':00:00Z' : hourString
    const date = new Date(normalized)
    if (isNaN(date.getTime())) {
      const hourMatch = hourString.match(/T(\d{2})/)
      if (hourMatch) return hourMatch[1] + ':00'
      return '--:--'
    }
    return date.getHours().toString().padStart(2, '0') + ':00'
  } catch {
    return '--:--'
  }
}

function getActivityLevel(count: number, max: number): 'high' | 'medium' | 'low' | 'none' {
  if (count === 0) return 'none'
  const ratio = count / max
  if (ratio >= 0.7) return 'high'
  if (ratio >= 0.3) return 'medium'
  return 'low'
}

function getTrend(data: HourlyData[]): 'up' | 'down' | 'stable' {
  if (data.length < 4) return 'stable'
  const recent = data.slice(-3).reduce((sum, d) => sum + d.count, 0)
  const earlier = data.slice(-6, -3).reduce((sum, d) => sum + d.count, 0)
  if (recent > earlier * 1.2) return 'up'
  if (recent < earlier * 0.8) return 'down'
  return 'stable'
}

export function ActivityTimeline({ data, onHourClick }: ActivityTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const recentData = data.slice(-12)
  const maxCount = Math.max(...recentData.map((d) => d.count), 1)
  const totalCount = recentData.reduce((sum, d) => sum + d.count, 0)
  const trend = getTrend(recentData)

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-green-400' : 'text-[var(--pro-text-muted)]'

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={12} className="text-[var(--pro-text-muted)]" />
          <h2 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
            Activity (12h)
          </h2>
          <div className="ml-auto flex items-center gap-1.5">
            <TrendIcon size={10} className={trendColor} />
            <span className="text-[10px] font-mono text-[var(--pro-text-secondary)]">
              {totalCount}
            </span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="p-3">
        {recentData.length === 0 ? (
          <div className="text-center text-xs text-[var(--pro-text-muted)] py-4">
            No activity data
          </div>
        ) : (
          <div className="space-y-2">
            {/* Bar Chart */}
            <div className="flex items-end gap-[2px] h-16">
              {recentData.map((point, i) => {
                const heightPct = maxCount > 0 ? (point.count / maxCount) * 100 : 0
                const level = getActivityLevel(point.count, maxCount)
                const isHovered = hoveredIndex === i
                const hourLabel = formatHour(point.hour, point.label)

                // Determine bar color based on activity level and category
                let barClasses = 'bg-[var(--pro-accent)]'
                if (point.category_breakdown) {
                  const breakdown = point.category_breakdown
                  if ((breakdown.security || 0) > 0) barClasses = 'bg-red-500'
                  else if ((breakdown.disaster || 0) > 0) barClasses = 'bg-orange-500'
                  else if ((breakdown.political || 0) > 0) barClasses = 'bg-indigo-500'
                }

                const opacityClass = level === 'high' ? 'opacity-100'
                  : level === 'medium' ? 'opacity-70'
                  : level === 'low' ? 'opacity-40'
                  : 'opacity-10'

                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center relative group"
                    onMouseEnter={() => setHoveredIndex(i)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Tooltip */}
                    {isHovered && (
                      <div className="absolute bottom-full mb-2 px-2 py-1 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-default)] rounded shadow-lg z-10 whitespace-nowrap">
                        <div className="text-[10px] font-semibold text-[var(--pro-text-primary)]">
                          {point.count} events
                        </div>
                        <div className="text-[9px] text-[var(--pro-text-muted)]">{hourLabel}</div>
                      </div>
                    )}

                    {/* Bar container */}
                    <button
                      onClick={() => onHourClick(point.hour)}
                      className="w-full h-full flex items-end cursor-pointer"
                    >
                      <div
                        className={`
                          w-full rounded-sm transition-all duration-150
                          ${barClasses} ${opacityClass}
                          ${isHovered ? 'opacity-100 ring-1 ring-white/30' : ''}
                        `}
                        style={{ height: `${Math.max(heightPct, 4)}%` }}
                      />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Time Labels */}
            <div className="flex justify-between text-[8px] font-mono text-[var(--pro-text-disabled)]">
              {recentData.length > 0 && (
                <>
                  <span>{formatHour(recentData[0]?.hour, recentData[0]?.label)}</span>
                  {recentData.length > 6 && (
                    <span>{formatHour(recentData[6]?.hour, recentData[6]?.label)}</span>
                  )}
                  <span>{formatHour(recentData[recentData.length - 1]?.hour, recentData[recentData.length - 1]?.label)}</span>
                </>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-3 pt-1 text-[8px] text-[var(--pro-text-disabled)]">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-500" />
                <span>Security</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-orange-500" />
                <span>Disaster</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-indigo-500" />
                <span>Political</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
