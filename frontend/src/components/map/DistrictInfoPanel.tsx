import { useEffect, useState } from 'react'
import { X, MapPin, AlertTriangle, Calendar, TrendingUp, Activity, Sparkles, ExternalLink, Loader2, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { PROVINCE_COLORS } from '../../data/districts'
import { getDistrictBrief, type DistrictBrief, type SourceReference } from '../../api/analytics'

interface DistrictData {
  name: string
  nameNe?: string
  province: string
  lat: number
  lng: number
  value: number
  eventCount?: number
  alertCount?: number
  youthStress?: number
  threatLevel?: string
  riskLevel?: string
  stabilityScore?: number
  crimeScore?: number
  communalScore?: number
}

interface DistrictInfoPanelProps {
  district: DistrictData | null
  onClose: () => void
}

function getStressLevel(value: number): { label: string; color: string; bg: string } {
  if (value >= 70) return { label: 'Critical', color: 'text-severity-critical', bg: 'bg-severity-critical/20' }
  if (value >= 50) return { label: 'High', color: 'text-severity-high', bg: 'bg-severity-high/20' }
  if (value >= 30) return { label: 'Medium', color: 'text-severity-medium', bg: 'bg-severity-medium/20' }
  return { label: 'Low', color: 'text-severity-low', bg: 'bg-severity-low/20' }
}

function SourceLink({ source }: { source: SourceReference }) {
  const relevanceColors = {
    primary: 'border-l-severity-critical',
    supporting: 'border-l-osint-accent',
    context: 'border-l-osint-muted',
  }

  return (
    <a
      href={source.url || `/stories/${source.story_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-2 bg-osint-bg/50 border border-osint-border border-l-2 ${relevanceColors[source.relevance]} rounded hover:bg-osint-border/50 transition-colors group`}
    >
      <div className="flex items-start gap-2">
        <FileText className="w-3.5 h-3.5 text-osint-muted mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-osint-text line-clamp-2 group-hover:text-osint-accent transition-colors">
            {source.title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {source.source && (
              <span className="text-[10px] text-osint-muted">{source.source}</span>
            )}
            {source.published_at && (
              <span className="text-[10px] text-osint-muted">
                {new Date(source.published_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <ExternalLink className="w-3 h-3 text-osint-muted group-hover:text-osint-accent transition-colors flex-shrink-0" />
      </div>
    </a>
  )
}

export function DistrictInfoPanel({ district, onClose }: DistrictInfoPanelProps) {
  const [brief, setBrief] = useState<DistrictBrief | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAllSources, setShowAllSources] = useState(false)

  // Fetch district brief when district changes
  useEffect(() => {
    if (!district) {
      setBrief(null)
      return
    }

    const districtName = district.name
    let cancelled = false

    async function fetchBrief() {
      setLoading(true)
      setError(null)

      try {
        const result = await getDistrictBrief(districtName)
        if (!cancelled) {
          setBrief(result)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch district brief:', err)
          setError('Unable to generate intelligence brief')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchBrief()

    return () => {
      cancelled = true
    }
  }, [district])

  if (!district) return null

  const stressLevel = getStressLevel(district.youthStress ?? 0)
  const provinceColor = PROVINCE_COLORS[district.province] || '#71717a'

  const visibleSources = showAllSources ? brief?.sources : brief?.sources?.slice(0, 3)

  return (
    <div className="absolute inset-x-2 bottom-2 sm:inset-auto sm:top-4 sm:right-4 sm:w-80 lg:w-96 max-h-[60vh] sm:max-h-[calc(100vh-8rem)] bg-osint-bg/95 backdrop-blur-sm border border-osint-border rounded-xl shadow-2xl z-[40] overflow-hidden flex flex-col">
      {/* Header */}
      <div
        className="p-3 sm:p-4 border-b border-osint-border flex-shrink-0"
        style={{ background: `linear-gradient(135deg, ${provinceColor}20, transparent)` }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1">
              <MapPin className="w-3.5 sm:w-4 h-3.5 sm:h-4" style={{ color: provinceColor }} />
              <span className="text-[10px] sm:text-xs font-medium uppercase tracking-wide" style={{ color: provinceColor }}>
                {district.province} Province
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-osint-text">{district.name}</h3>
            {district.nameNe && (
              <p className="text-sm sm:text-base text-osint-muted mt-0.5">{district.nameNe}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 sm:p-1.5 hover:bg-osint-border rounded-lg transition-colors"
          >
            <X className="w-4 sm:w-5 h-4 sm:h-5" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Stress Index Hero */}
        <div className="p-3 sm:p-4 border-b border-osint-border">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-xs sm:text-sm text-osint-muted">Youth Stress Index</span>
            <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded ${stressLevel.bg} ${stressLevel.color}`}>
              {stressLevel.label}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span className={`text-3xl sm:text-4xl font-bold ${stressLevel.color}`}>
              {(district.youthStress ?? 0).toFixed(1)}
            </span>
            <span className="text-sm sm:text-base text-osint-muted mb-0.5 sm:mb-1">/ 100</span>
          </div>
          {/* Progress bar */}
          <div className="mt-2 sm:mt-3 h-1.5 sm:h-2 bg-osint-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                (district.youthStress ?? 0) >= 70 ? 'bg-severity-critical' :
                (district.youthStress ?? 0) >= 50 ? 'bg-severity-high' :
                (district.youthStress ?? 0) >= 30 ? 'bg-severity-medium' :
                'bg-severity-low'
              }`}
              style={{ width: `${Math.min(100, district.youthStress ?? 0)}%` }}
            />
          </div>
        </div>

        {/* AI Summary Section */}
        <div className="p-3 sm:p-4 border-b border-osint-border">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
            <Sparkles className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-accent" />
            <span className="text-xs sm:text-sm font-medium text-osint-text">Intelligence Brief</span>
            {brief?.llm_model && (
              <span className="text-[9px] sm:text-[10px] text-osint-muted bg-osint-card px-1 sm:px-1.5 py-0.5 rounded">
                AI
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-osint-muted py-3 sm:py-4">
              <Loader2 className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-spin" />
              <span className="text-xs sm:text-sm">Generating analysis...</span>
            </div>
          ) : error ? (
            <p className="text-xs sm:text-sm text-osint-muted italic">{error}</p>
          ) : brief ? (
            <>
              <p className="text-xs sm:text-sm text-osint-text leading-relaxed mb-2 sm:mb-3">
                {brief.summary}
              </p>

              {brief.key_factors.length > 0 && (
                <div className="space-y-1 sm:space-y-1.5">
                  <span className="text-[10px] sm:text-xs font-medium text-osint-muted uppercase tracking-wide">Key Factors</span>
                  <ul className="space-y-0.5 sm:space-y-1">
                    {brief.key_factors.map((factor, i) => (
                      <li key={i} className="flex items-start gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-osint-text">
                        <span className="text-osint-accent mt-0.5 sm:mt-1">•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs sm:text-sm text-osint-muted italic">
              Click refresh to generate an intelligence brief for this district.
            </p>
          )}
        </div>

        {/* Sources Section */}
        {brief && brief.sources.length > 0 && (
          <div className="p-3 sm:p-4 border-b border-osint-border">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <FileText className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
                <span className="text-xs sm:text-sm font-medium text-osint-text">Sources</span>
                <span className="text-[10px] sm:text-xs text-osint-muted">({brief.sources.length})</span>
              </div>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              {visibleSources?.map((source) => (
                <SourceLink key={source.story_id} source={source} />
              ))}
            </div>

            {brief.sources.length > 3 && (
              <button
                onClick={() => setShowAllSources(!showAllSources)}
                className="mt-1.5 sm:mt-2 w-full flex items-center justify-center gap-1 text-[10px] sm:text-xs text-osint-accent hover:text-osint-accent-hover transition-colors py-0.5 sm:py-1"
              >
                {showAllSources ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    Show {brief.sources.length - 3} more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Stats Grid */}
        <div className="p-3 sm:p-4 grid grid-cols-2 gap-2 sm:gap-3">
          <div className="bg-osint-card border border-osint-border rounded-lg p-2 sm:p-3">
            <div className="flex items-center gap-1.5 sm:gap-2 text-osint-muted mb-0.5 sm:mb-1">
              <Calendar className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
              <span className="text-[10px] sm:text-xs">Events</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-osint-text">
              {district.eventCount ?? 0}
            </p>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-2 sm:p-3">
            <div className="flex items-center gap-1.5 sm:gap-2 text-osint-muted mb-0.5 sm:mb-1">
              <AlertTriangle className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
              <span className="text-[10px] sm:text-xs">Alerts</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-osint-text">
              {district.alertCount ?? 0}
            </p>
          </div>
        </div>

        {/* Coordinates - Hidden on mobile */}
        <div className="hidden sm:block px-4 pb-4">
          <div className="bg-osint-card border border-osint-border rounded-lg p-3">
            <div className="flex items-center gap-2 text-osint-muted mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-xs">Coordinates</span>
            </div>
            <div className="font-mono text-sm">
              <span className="text-osint-muted">Lat:</span>{' '}
              <span className="text-osint-text">{district.lat.toFixed(4)}</span>
              <span className="text-osint-muted ml-3">Lng:</span>{' '}
              <span className="text-osint-text">{district.lng.toFixed(4)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 sm:p-4 border-t border-osint-border flex-shrink-0">
        <button className="w-full flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors font-medium text-sm sm:text-base">
          <TrendingUp className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          View Analytics
        </button>
      </div>
    </div>
  )
}
