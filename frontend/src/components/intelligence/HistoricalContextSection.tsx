/**
 * Historical Context Section - Palantir-grade historical intelligence display
 *
 * Displays:
 * - Similar past events with dates and outcomes
 * - District historical profile
 * - Seasonal context (monsoon, festival, election)
 * - Escalation indicators (+X% vs baseline)
 * - Entity timelines
 */
import { useState } from 'react'
import {
  History,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  MapPin,
  Calendar,
  Users,
  ChevronDown,
  ChevronRight,
  Flame,
  CloudRain,
  Vote,
  BarChart3,
} from 'lucide-react'

// Types matching backend schemas
interface HistoricalMatch {
  story_id: string
  headline: string
  occurred_at: string
  district: string
  story_type: string
  severity: string
  similarity_score: number
  match_reasons: string[]
  fatalities?: number
  injuries?: number
}

interface DistrictProfile {
  district: string
  total_events_1y: number
  total_events_2y: number
  fatalities_1y: number
  fatalities_2y: number
  injuries_1y: number
  events_by_type: Record<string, number>
  events_by_month: Record<string, number>
  peak_months: number[]
  notable_events: HistoricalMatch[]
  election_violence_history?: {
    year: number
    description: string
    fatalities?: number
  }
  is_high_risk_district: boolean
  risk_factors: string[]
}

interface SeasonalContext {
  current_season: string
  season_name: string
  historical_avg_events: number
  historical_max_events: number
  historical_max_year?: number
  historical_fatalities: number
  current_season_events: number
  comparison_to_baseline: string
  comparison_pct: number
  is_high_risk_season: boolean
  seasonal_risk_factors: string[]
}

interface EscalationContext {
  current_count_7d: number
  current_count_24h: number
  baseline_avg_7d: number
  baseline_avg_24h: number
  pct_change_7d: number
  pct_change_24h: number
  trend_direction: string
  trend_strength: string
  velocity: number
  days_since_last_similar?: number
  is_escalating: boolean
  escalation_level: string
}

interface EntityTimeline {
  entity_name: string
  entity_type: string
  total_mentions: number
  mentions_30d: number
  mentions_7d: number
  trend: string
  trend_pct_change: number
}

interface HistoricalPatterns {
  similar_events?: HistoricalMatch[]
  district_profile?: DistrictProfile
  seasonal_context?: SeasonalContext
  escalation_context?: EscalationContext
  entity_timelines?: EntityTimeline[]
  computed_at?: string
}

interface HistoricalContextSectionProps {
  historicalPatterns: HistoricalPatterns | null | undefined
  currentStoryType?: string
  currentDistrict?: string
}

// Severity colors for visual indicators
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low: 'text-green-400 bg-green-500/10 border-green-500/30',
}

// Season icons
const SEASON_ICONS: Record<string, typeof CloudRain> = {
  monsoon: CloudRain,
  festival: Flame,
  election: Vote,
  winter: CloudRain,
  pre_monsoon: CloudRain,
  normal: Calendar,
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
    return `${Math.floor(diffDays / 365)} years ago`
  } catch {
    return ''
  }
}

export function HistoricalContextSection({
  historicalPatterns,
  currentStoryType,
  currentDistrict,
}: HistoricalContextSectionProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    escalation: true,
    similarEvents: true,
    district: false,
    seasonal: false,
    entities: false,
  })

  if (!historicalPatterns) {
    return null
  }

  const {
    similar_events,
    district_profile,
    seasonal_context,
    escalation_context,
    entity_timelines,
  } = historicalPatterns

  // Check if we have any meaningful content to show
  const hasContent =
    (similar_events && similar_events.length > 0) ||
    district_profile ||
    seasonal_context ||
    escalation_context?.is_escalating ||
    (entity_timelines && entity_timelines.length > 0)

  if (!hasContent) {
    return null
  }

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  return (
    <div className="mb-4 p-4 bg-indigo-500/5 rounded-lg border border-indigo-500/20">
      <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <History className="w-4 h-4" />
        Historical Intelligence
      </h4>

      {/* Escalation Alert - Always show if escalating */}
      {escalation_context?.is_escalating && (
        <div
          className={`mb-3 p-3 rounded-lg border ${
            escalation_context.escalation_level === 'critical'
              ? 'bg-red-500/10 border-red-500/30'
              : escalation_context.escalation_level === 'high'
              ? 'bg-orange-500/10 border-orange-500/30'
              : 'bg-yellow-500/10 border-yellow-500/30'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-red-400" />
            <span className="text-xs font-semibold text-red-400 uppercase">
              Escalation Detected
            </span>
            <span
              className={`ml-auto text-sm font-bold ${
                escalation_context.pct_change_7d > 100 ? 'text-red-400' : 'text-orange-400'
              }`}
            >
              +{escalation_context.pct_change_7d.toFixed(0)}%
            </span>
          </div>
          <p className="text-[11px] text-osint-muted">
            {escalation_context.current_count_7d} events in past 7 days vs{' '}
            {escalation_context.baseline_avg_7d.toFixed(1)} average
          </p>
          {escalation_context.days_since_last_similar !== null &&
            escalation_context.days_since_last_similar !== undefined && (
              <p className="text-[11px] text-osint-text mt-1">
                Last similar event: {escalation_context.days_since_last_similar} days ago
              </p>
            )}
        </div>
      )}

      {/* Similar Past Events */}
      {similar_events && similar_events.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => toggleSection('similarEvents')}
            className="flex items-center gap-2 w-full text-left mb-2"
          >
            {expandedSections.similarEvents ? (
              <ChevronDown className="w-3 h-3 text-osint-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-osint-muted" />
            )}
            <span className="text-[10px] font-semibold text-osint-muted uppercase">
              Similar Past Events ({similar_events.length})
            </span>
          </button>

          {expandedSections.similarEvents && (
            <div className="space-y-2 pl-5">
              {similar_events.slice(0, 3).map((event, i) => (
                <div
                  key={event.story_id || i}
                  className="p-2 bg-osint-card rounded border border-osint-border"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-osint-text flex-1 line-clamp-2">
                      {event.headline}
                    </p>
                    <span
                      className={`px-1.5 py-0.5 text-[9px] rounded border shrink-0 ${
                        SEVERITY_COLORS[event.severity] || 'text-gray-400 bg-gray-500/10'
                      }`}
                    >
                      {event.severity}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-osint-muted">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(event.occurred_at)} ({formatTimeAgo(event.occurred_at)})
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {event.district}
                    </span>
                  </div>
                  {(event.fatalities || event.injuries) && (
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      {event.fatalities && (
                        <span className="text-red-400">{event.fatalities} deaths</span>
                      )}
                      {event.injuries && (
                        <span className="text-orange-400">{event.injuries} injured</span>
                      )}
                    </div>
                  )}
                  {event.match_reasons && event.match_reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {event.match_reasons.map((reason, j) => (
                        <span
                          key={j}
                          className="px-1.5 py-0.5 text-[9px] bg-indigo-500/10 text-indigo-400 rounded"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* District Historical Profile */}
      {district_profile && (
        <div className="mb-3">
          <button
            onClick={() => toggleSection('district')}
            className="flex items-center gap-2 w-full text-left mb-2"
          >
            {expandedSections.district ? (
              <ChevronDown className="w-3 h-3 text-osint-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-osint-muted" />
            )}
            <span className="text-[10px] font-semibold text-osint-muted uppercase">
              {district_profile.district} District Profile
            </span>
            {district_profile.is_high_risk_district && (
              <span className="ml-auto px-1.5 py-0.5 text-[9px] bg-red-500/20 text-red-400 rounded">
                HIGH RISK
              </span>
            )}
          </button>

          {expandedSections.district && (
            <div className="pl-5 space-y-2">
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-osint-card rounded border border-osint-border text-center">
                  <p className="text-lg font-bold text-osint-text">
                    {district_profile.total_events_1y}
                  </p>
                  <p className="text-[9px] text-osint-muted">Events (1Y)</p>
                </div>
                <div className="p-2 bg-osint-card rounded border border-osint-border text-center">
                  <p className="text-lg font-bold text-red-400">
                    {district_profile.fatalities_1y}
                  </p>
                  <p className="text-[9px] text-osint-muted">Fatalities (1Y)</p>
                </div>
                <div className="p-2 bg-osint-card rounded border border-osint-border text-center">
                  <p className="text-lg font-bold text-orange-400">
                    {district_profile.injuries_1y}
                  </p>
                  <p className="text-[9px] text-osint-muted">Injuries (1Y)</p>
                </div>
              </div>

              {/* Events by Type */}
              {Object.keys(district_profile.events_by_type).length > 0 && (
                <div className="p-2 bg-osint-card rounded border border-osint-border">
                  <p className="text-[9px] text-osint-muted uppercase mb-1.5">Events by Type</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(district_profile.events_by_type).map(([type, count]) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 text-[10px] bg-osint-bg rounded border border-osint-border"
                      >
                        {type}: <span className="font-semibold">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Peak Months */}
              {district_profile.peak_months && district_profile.peak_months.length > 0 && (
                <p className="text-[10px] text-osint-muted">
                  <span className="font-semibold">Peak months:</span>{' '}
                  {district_profile.peak_months
                    .map((m) => {
                      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                      return months[m - 1] || m
                    })
                    .join(', ')}
                </p>
              )}

              {/* Election Violence History */}
              {district_profile.election_violence_history && (
                <div className="p-2 bg-red-500/10 rounded border border-red-500/30">
                  <p className="text-[10px] font-semibold text-red-400 mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Election Violence History
                  </p>
                  <p className="text-[10px] text-osint-text">
                    {district_profile.election_violence_history.year}:{' '}
                    {district_profile.election_violence_history.description}
                    {district_profile.election_violence_history.fatalities && (
                      <span className="text-red-400">
                        {' '}
                        ({district_profile.election_violence_history.fatalities} deaths)
                      </span>
                    )}
                  </p>
                </div>
              )}

              {/* Risk Factors */}
              {district_profile.risk_factors && district_profile.risk_factors.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {district_profile.risk_factors.map((factor, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 text-[9px] bg-orange-500/10 text-orange-400 rounded border border-orange-500/30"
                    >
                      {factor}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Seasonal Context */}
      {seasonal_context && (
        <div className="mb-3">
          <button
            onClick={() => toggleSection('seasonal')}
            className="flex items-center gap-2 w-full text-left mb-2"
          >
            {expandedSections.seasonal ? (
              <ChevronDown className="w-3 h-3 text-osint-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-osint-muted" />
            )}
            <span className="text-[10px] font-semibold text-osint-muted uppercase">
              {seasonal_context.season_name}
            </span>
            {seasonal_context.is_high_risk_season && (
              <span className="ml-auto px-1.5 py-0.5 text-[9px] bg-orange-500/20 text-orange-400 rounded">
                HIGH RISK SEASON
              </span>
            )}
          </button>

          {expandedSections.seasonal && (
            <div className="pl-5 space-y-2">
              <div className="p-2 bg-osint-card rounded border border-osint-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-osint-muted">Current vs Historical</span>
                  <span
                    className={`text-xs font-semibold ${
                      seasonal_context.comparison_pct > 20
                        ? 'text-red-400'
                        : seasonal_context.comparison_pct < -20
                        ? 'text-green-400'
                        : 'text-yellow-400'
                    }`}
                  >
                    {seasonal_context.comparison_to_baseline}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <p className="text-osint-muted">This season</p>
                    <p className="font-semibold text-osint-text">
                      {seasonal_context.current_season_events} events
                    </p>
                  </div>
                  <div>
                    <p className="text-osint-muted">Historical avg</p>
                    <p className="font-semibold text-osint-text">
                      {seasonal_context.historical_avg_events.toFixed(1)} events
                    </p>
                  </div>
                </div>
                {seasonal_context.historical_max_year && (
                  <p className="text-[9px] text-osint-muted mt-2 pt-2 border-t border-osint-border/50">
                    Peak year: {seasonal_context.historical_max_year} with{' '}
                    {seasonal_context.historical_max_events} events (
                    {seasonal_context.historical_fatalities} fatalities)
                  </p>
                )}
              </div>

              {/* Seasonal Risk Factors */}
              {seasonal_context.seasonal_risk_factors &&
                seasonal_context.seasonal_risk_factors.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {seasonal_context.seasonal_risk_factors.map((factor, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 text-[9px] bg-blue-500/10 text-blue-400 rounded"
                      >
                        {factor}
                      </span>
                    ))}
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* Entity Timelines */}
      {entity_timelines && entity_timelines.length > 0 && (
        <div>
          <button
            onClick={() => toggleSection('entities')}
            className="flex items-center gap-2 w-full text-left mb-2"
          >
            {expandedSections.entities ? (
              <ChevronDown className="w-3 h-3 text-osint-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-osint-muted" />
            )}
            <span className="text-[10px] font-semibold text-osint-muted uppercase">
              Key Entity Trends ({entity_timelines.length})
            </span>
          </button>

          {expandedSections.entities && (
            <div className="pl-5 space-y-1.5">
              {entity_timelines.slice(0, 5).map((entity, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 bg-osint-card rounded border border-osint-border"
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-3 h-3 text-osint-muted" />
                    <span className="text-[11px] text-osint-text font-medium">
                      {entity.entity_name}
                    </span>
                    <span className="text-[9px] text-osint-muted">({entity.entity_type})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-osint-muted">
                      {entity.mentions_7d} this week
                    </span>
                    {entity.trend === 'escalating' ? (
                      <TrendingUp className="w-3 h-3 text-red-400" />
                    ) : entity.trend === 'declining' ? (
                      <TrendingDown className="w-3 h-3 text-green-400" />
                    ) : (
                      <BarChart3 className="w-3 h-3 text-yellow-400" />
                    )}
                    {entity.trend_pct_change !== 0 && (
                      <span
                        className={`text-[10px] font-semibold ${
                          entity.trend_pct_change > 0 ? 'text-red-400' : 'text-green-400'
                        }`}
                      >
                        {entity.trend_pct_change > 0 ? '+' : ''}
                        {entity.trend_pct_change.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Computed timestamp */}
      {historicalPatterns.computed_at && (
        <p className="text-[9px] text-osint-muted mt-3 pt-2 border-t border-osint-border/30 text-right">
          Historical data computed {formatTimeAgo(historicalPatterns.computed_at)}
        </p>
      )}
    </div>
  )
}
