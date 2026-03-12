import { useMemo } from 'react'
import { AlertTriangle, TrendingUp, TrendingDown, Minus, RefreshCw, Zap } from 'lucide-react'
import type { ExecutiveSummary } from '../../stores/analystCenterStore'
import type { ConsolidatedStory } from '../../api/analytics'

interface InsightBannerProps {
  summary: ExecutiveSummary | null
  stories: ConsolidatedStory[]
  isLoading: boolean
  onRefresh: () => void
}

const STATUS_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white',
  ELEVATED: 'bg-orange-500 text-white',
  GUARDED: 'bg-yellow-500 text-black',
  LOW: 'bg-green-600 text-white',
}

const STATUS_BORDER: Record<string, string> = {
  CRITICAL: 'border-red-600',
  ELEVATED: 'border-orange-500',
  GUARDED: 'border-yellow-500',
  LOW: 'border-green-600',
}

function TrajectoryIcon({ trajectory }: { trajectory: string }) {
  switch (trajectory) {
    case 'ESCALATING':
    case 'RISING':
      return <TrendingUp size={14} className="text-red-400" />
    case 'DE-ESCALATING':
    case 'DECLINING':
      return <TrendingDown size={14} className="text-green-400" />
    default:
      return <Minus size={14} className="text-[var(--pro-text-muted)]" />
  }
}

export function InsightBanner({ summary, stories, isLoading, onRefresh }: InsightBannerProps) {
  // Compute fallback summary from stories if API returns null
  const computedSummary = useMemo(() => {
    if (summary) return null

    // Count severities
    const severities = { critical: 0, high: 0, medium: 0, low: 0 }
    const categories: Record<string, number> = {}
    const districts: Record<string, number> = {}

    stories.forEach((story) => {
      const sev = (story.severity || 'medium').toLowerCase() as keyof typeof severities
      if (sev in severities) severities[sev]++

      const cat = (story.story_type || 'social').toLowerCase()
      categories[cat] = (categories[cat] || 0) + 1

      story.districts_affected?.forEach((d) => {
        districts[d] = (districts[d] || 0) + 1
      })
    })

    // Determine threat level
    let threatLevel: 'CRITICAL' | 'ELEVATED' | 'GUARDED' | 'LOW' = 'LOW'
    if (severities.critical >= 3) threatLevel = 'CRITICAL'
    else if (severities.critical >= 1 || severities.high >= 5) threatLevel = 'ELEVATED'
    else if (severities.high >= 1 || severities.medium >= 10) threatLevel = 'GUARDED'

    // Get top category and district
    const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0]
    const topDistrict = Object.entries(districts).sort((a, b) => b[1] - a[1])[0]

    // Generate insight
    let insight = `Monitoring ${stories.length} stories.`
    if (severities.critical > 0) {
      insight = `${severities.critical} critical event${severities.critical > 1 ? 's' : ''} requiring attention.`
    } else if (severities.high > 0) {
      insight = `${severities.high} high-priority event${severities.high > 1 ? 's' : ''} in the last 24 hours.`
    }

    if (topCategory) {
      insight += ` Most activity in ${topCategory[0]} (${topCategory[1]} stories).`
    }
    if (topDistrict) {
      insight += ` Focus area: ${topDistrict[0]}.`
    }

    return {
      threatLevel,
      trajectory: 'STABLE' as const,
      storyCount: stories.length,
      insight,
    }
  }, [summary, stories])

  // Use API summary if available, otherwise use computed
  const displayData = summary
    ? {
        threatLevel: summary.threat_level,
        trajectory: summary.threat_trajectory,
        storyCount: summary.story_count,
        insight: summary.key_judgment,
        timeRange: summary.time_range_hours,
        generatedAt: summary.generated_at,
      }
    : computedSummary
      ? {
          threatLevel: computedSummary.threatLevel,
          trajectory: computedSummary.trajectory,
          storyCount: computedSummary.storyCount,
          insight: computedSummary.insight,
          timeRange: 24,
          generatedAt: null,
        }
      : null

  if (!displayData && !isLoading) {
    return (
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--pro-text-muted)]">
          <AlertTriangle size={16} />
          <span className="text-xs">No data available</span>
        </div>
        <button
          onClick={onRefresh}
          className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    )
  }

  const statusLevel = displayData?.threatLevel || 'LOW'
  const trajectory = displayData?.trajectory || 'STABLE'

  return (
    <div className={`px-4 py-3 border-l-4 ${STATUS_BORDER[statusLevel]}`}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: Status + Insight */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1.5">
            {/* Status Badge */}
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${STATUS_COLORS[statusLevel]}`}>
              {statusLevel}
            </span>

            {/* Trajectory */}
            <div className="flex items-center gap-1 text-xs text-[var(--pro-text-muted)]">
              <TrajectoryIcon trajectory={trajectory} />
              <span className="capitalize">{trajectory.toLowerCase().replace('_', ' ')}</span>
            </div>

            {/* Story Count */}
            {displayData && (
              <span className="text-xs text-[var(--pro-text-muted)]">
                {displayData.storyCount} stories in {displayData.timeRange}h
              </span>
            )}

            {/* Computed indicator */}
            {!summary && computedSummary && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--pro-text-disabled)]">
                <Zap size={10} />
                Auto-computed
              </span>
            )}
          </div>

          {/* Key Insight */}
          <p className="text-sm text-[var(--pro-text-primary)] leading-relaxed">
            {isLoading ? (
              <span className="text-[var(--pro-text-muted)]">Loading analysis...</span>
            ) : (
              displayData?.insight || 'No key insight available'
            )}
          </p>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {displayData?.generatedAt && (
            <span className="text-[10px] text-[var(--pro-text-disabled)] font-mono">
              {new Date(displayData.generatedAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors disabled:opacity-50"
            title="Refresh analysis"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    </div>
  )
}
