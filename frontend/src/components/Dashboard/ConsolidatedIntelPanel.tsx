/**
 * Intelligence Briefing Panel - Simplified News Intelligence Report
 * Provides executive summary, priority alerts, and categorized intelligence
 */
import { useEffect, useState, useMemo } from 'react'
import {
  FileText, AlertTriangle, TrendingUp, Users, Building2,
  CheckCircle, AlertCircle, MapPin, Clock, X, Filter, Link2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Sparkles, Star, Lightbulb, Newspaper, ChevronDown, ChevronUp, Shield, Target, Scale, Eye
} from 'lucide-react'
import { getConsolidatedStories, getExecutiveSummary, type ConsolidatedStory, type ExecutiveSummary } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { HistoricalContextSection } from '../intelligence/HistoricalContextSection'
import { useSettingsStore, getDistrictsForProvinces, type Province } from '../../store/slices/settingsSlice'

interface ConsolidatedIntelPanelProps {
  hours?: number
  limit?: number
  districts?: string[]
  compact?: boolean
  pageSize?: number
}

// Nepal-specific keywords for frontend filtering safety net
const NEPAL_KEYWORDS = [
  'nepal', 'nepali', 'nepalese', 'kathmandu', 'pokhara', 'lalitpur', 'bhaktapur',
  'everest', 'himalaya', 'terai', 'madhesh', 'karnali', 'gandaki', 'lumbini',
  'congress', 'uml', 'maoist', 'prachanda', 'oli', 'deuba', 'thapa',
  'नेपाल', 'काठमाडौं', 'सरकार', 'प्रधानमन्त्री', 'संसद', 'निर्वाचन',
  // Nepal districts
  'morang', 'jhapa', 'sunsari', 'chitwan', 'rupandehi', 'kaski', 'kailali',
  'banke', 'bara', 'parsa', 'makwanpur', 'dang', 'surkhet', 'bardiya'
]

// Foreign content markers to filter out
const FOREIGN_MARKERS = [
  // Countries
  'malaysia', 'malaysian', 'indonesia', 'indonesian', 'philippines', 'vietnam',
  'thailand', 'singapore', 'japan', 'japanese', 'korea', 'korean', 'taiwan',
  'australia', 'australian', 'new zealand', 'usa', 'american', 'canada', 'canadian',
  'uk', 'british', 'france', 'french', 'germany', 'german', 'italy', 'italian',
  'russia', 'russian', 'ukraine', 'ukrainian', 'israel', 'israeli', 'palestine',
  'saudi', 'uae', 'qatar', 'iran', 'iraq', 'syria', 'turkey', 'turkish',
  'africa', 'african', 'nigeria', 'kenya', 'egypt', 'south africa',
  'brazil', 'brazilian', 'argentina', 'mexico', 'mexican',
  // Politicians
  'trump', 'biden', 'putin', 'xi jinping', 'modi', 'zelensky',
  // Entertainment
  'grammy', 'oscar', 'emmy', 'golden globe', 'super bowl', 'nfl',
  'hollywood', 'bollywood', 'k-pop', 'netflix', 'disney', 'marvel',
  'box office', 'red carpet', 'celebrity', 'actress', 'actor',
  // Cricket (high priority filter)
  'cricket', 'ipl', 'bcci', 'test match', 'odi', 't20', 'world cup',
  'virat kohli', 'rohit sharma', 'dhoni', 'sachin', 'bumrah', 'kohli',
  'batsman', 'bowler', 'wicket', 'century', 'innings',
  // Football
  'premier league', 'champions league', 'la liga', 'bundesliga', 'serie a',
  'manchester', 'barcelona', 'real madrid', 'arsenal', 'chelsea', 'liverpool',
  'psg', 'bayern munich', 'juventus', 'ronaldo', 'messi',
  // Other sports
  'nba', 'basketball', 'lebron', 'lakers', 'celtics',
  'formula 1', 'f1', 'grand prix', 'hamilton', 'verstappen',
  'wimbledon', 'australian open', 'us open', 'tennis', 'federer', 'nadal',
  'olympics', 'asian games', 'commonwealth games', 'ufc', 'mma', 'boxing'
]

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/50',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  low: 'bg-green-500/20 text-green-400 border-green-500/50',
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  security: { label: 'Security', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: Shield },
  political: { label: 'Political', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: Building2 },
  disaster: { label: 'Disaster', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: AlertTriangle },
  economic: { label: 'Economic', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: TrendingUp },
  social: { label: 'Social', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: Users },
}

const ITEMS_PER_PAGE = 8

export function ConsolidatedIntelPanel({ hours = 72, limit = 500, districts, compact = false }: ConsolidatedIntelPanelProps) {
  const [stories, setStories] = useState<ConsolidatedStory[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)  // For background refresh without scroll reset
  const [error, setError] = useState<string | null>(null)
  const [selectedStory, setSelectedStory] = useState<ConsolidatedStory | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filterVerifiedOnly, setFilterVerifiedOnly] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  // Province filter from settings
  const { selectedProvinces, isProvinceFilterEnabled } = useSettingsStore()
  const selectedDistricts = useMemo(() => {
    if (!isProvinceFilterEnabled || selectedProvinces.length === 7) return null
    return getDistrictsForProvinces(selectedProvinces as Province[]).map(d => d.toLowerCase())
  }, [selectedProvinces, isProvinceFilterEnabled])

  useEffect(() => {
    const fetchStories = async () => {
      // Only show full loading spinner on initial load (when no stories yet)
      // For refreshes, show subtle indicator but keep existing content visible
      const isInitialLoad = stories.length === 0
      if (isInitialLoad) {
        setLoading(true)
      } else {
        setIsRefreshing(true)
      }
      setError(null)

      try {
        // Use districts prop (from Dashboard settings) for server-side filtering
        const apiDistricts = districts || (selectedDistricts ? selectedDistricts : undefined)
        const data = await getConsolidatedStories(hours, undefined, undefined, limit, apiDistricts || undefined)
        setStories(data)
      } catch (err) {
        console.error('Failed to fetch consolidated stories:', err)
        // Only show error on initial load - don't disrupt existing content
        if (isInitialLoad) {
          setError('Failed to load intelligence')
        }
      } finally {
        setLoading(false)
        setIsRefreshing(false)
      }
    }
    fetchStories()
  }, [hours, limit, districts, selectedDistricts])  // Re-fetch when districts change

  // Fetch AI-generated executive summary (6 hour window, cached for 6 hours)
  useEffect(() => {
    const fetchExecutiveSummary = async () => {
      setSummaryLoading(true)
      try {
        const apiDistricts = districts || (selectedDistricts ? selectedDistricts : undefined)
        const summary = await getExecutiveSummary(6, false, apiDistricts || undefined)
        setExecutiveSummary(summary)
      } catch (err) {
        console.error('Failed to fetch executive summary:', err)
        // Don't set error - just use fallback display
      } finally {
        setSummaryLoading(false)
      }
    }
    fetchExecutiveSummary()
  }, [districts, selectedDistricts])  // Re-fetch when districts change

  // Strict Nepal filtering on frontend as safety net
  const isNepalRelevant = (story: ConsolidatedStory): boolean => {
    const text = `${story.canonical_headline} ${story.summary || ''} ${story.canonical_headline_ne || ''}`.toLowerCase()

    // Check for foreign markers - reject if found and no Nepal keywords
    const hasForeignMarker = FOREIGN_MARKERS.some(marker => text.includes(marker))
    const hasNepalKeyword = NEPAL_KEYWORDS.some(kw => text.includes(kw))

    // If has foreign marker but no Nepal keyword, it's likely not relevant
    if (hasForeignMarker && !hasNepalKeyword) {
      return false
    }

    // Accept if it has Nepal keywords or districts
    if (hasNepalKeyword) return true

    // Accept if it has Nepali script (Devanagari)
    if (/[\u0900-\u097F]{5,}/.test(text)) return true

    // Accept if it has Nepal districts mentioned
    if (story.districts_affected && story.districts_affected.length > 0) return true

    // For stories without clear markers, reject by default
    return false
  }

  // Filter and process stories with content-based deduplication
  const processedStories = useMemo(() => {
    // First filter for Nepal relevance
    let filtered = stories.filter(isNepalRelevant)

    // Apply province filter if active
    if (selectedDistricts && selectedDistricts.length > 0) {
      filtered = filtered.filter(story => {
        // If story has no districts_affected, check headline for district mentions
        if (!story.districts_affected || story.districts_affected.length === 0) {
          const text = `${story.canonical_headline} ${story.summary || ''}`.toLowerCase()
          return selectedDistricts.some(d => text.includes(d))
        }
        // Check if any affected district is in selected provinces
        return story.districts_affected.some(d => selectedDistricts.includes(d.toLowerCase()))
      })
    }

    if (filterVerifiedOnly) {
      filtered = filtered.filter(s => s.is_verified || s.source_count >= 2)
    }

    // Deduplicate by canonical headline (same content = same story)
    // Keep the one with more sources or higher severity
    const seen = new Map<string, ConsolidatedStory>()
    for (const story of filtered) {
      const key = story.canonical_headline.toLowerCase().trim()
      const existing = seen.get(key)
      if (!existing) {
        seen.set(key, story)
      } else {
        // Keep story with more sources, or if equal, higher severity
        const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
        const existingSeverity = severityOrder[existing.severity || 'low'] || 0
        const storySeverity = severityOrder[story.severity || 'low'] || 0

        if (story.source_count > existing.source_count ||
            (story.source_count === existing.source_count && storySeverity > existingSeverity)) {
          seen.set(key, story)
        }
      }
    }

    return Array.from(seen.values())
  }, [stories, filterVerifiedOnly, selectedDistricts])

  // Categorize stories
  const categorizedStories = useMemo(() => {
    const priority: ConsolidatedStory[] = []
    const security: ConsolidatedStory[] = []
    const political: ConsolidatedStory[] = []
    const disaster: ConsolidatedStory[] = []
    const economic: ConsolidatedStory[] = []
    const social: ConsolidatedStory[] = []
    const general: ConsolidatedStory[] = []

    for (const story of processedStories) {
      // Priority: Critical/High severity OR multi-source verified
      if (
        story.severity === 'critical' ||
        story.severity === 'high' ||
        (story.is_verified && story.source_count >= 3)
      ) {
        priority.push(story)
      }

      // Categorize by type
      switch (story.story_type) {
        case 'security': security.push(story); break
        case 'political': political.push(story); break
        case 'disaster': disaster.push(story); break
        case 'economic': economic.push(story); break
        case 'social': social.push(story); break
        default: general.push(story)
      }
    }

    return { priority, security, political, disaster, economic, social, general }
  }, [processedStories])

  // Calculate stats for executive summary
  const stats = useMemo(() => {
    const verified = processedStories.filter(s => s.is_verified).length
    const critical = processedStories.filter(s => s.severity === 'critical' || s.severity === 'high').length
    const multiSource = processedStories.filter(s => s.source_count >= 2).length

    // Count by type
    const byType: Record<string, number> = {}
    for (const story of processedStories) {
      const type = story.story_type || 'general'
      byType[type] = (byType[type] || 0) + 1
    }

    // Get most active districts
    const districtCounts: Record<string, number> = {}
    for (const story of processedStories) {
      for (const d of story.districts_affected || []) {
        districtCounts[d] = (districtCounts[d] || 0) + 1
      }
    }
    const topDistricts = Object.entries(districtCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d]) => d)

    return { total: processedStories.length, verified, critical, multiSource, byType, topDistricts }
  }, [processedStories])

  // Get filtered stories based on selected category
  const filteredByCategory = useMemo(() => {
    if (selectedCategory === 'all') return processedStories
    if (selectedCategory === 'priority') return categorizedStories.priority
    return processedStories.filter(s => (s.story_type || 'general') === selectedCategory)
  }, [processedStories, categorizedStories, selectedCategory])

  // Pagination
  const totalPages = Math.ceil(filteredByCategory.length / ITEMS_PER_PAGE)
  const paginatedStories = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredByCategory.slice(start, start + ITEMS_PER_PAGE)
  }, [filteredByCategory, currentPage])

  // Reset page when category changes
  useEffect(() => {
    setCurrentPage(1)
  }, [selectedCategory, filterVerifiedOnly])

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    return `${Math.floor(diffHours / 24)}d ago`
  }

  const cardClass = compact
    ? "bg-osint-card border border-osint-border rounded-lg p-4"
    : "bg-osint-card border border-osint-border rounded-xl p-6"

  if (loading) {
    return (
      <div className={cardClass}>
        <h2 className="text-lg font-semibold mb-3 text-osint-text flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Intelligence Briefing
        </h2>
        <LoadingSpinner message="Compiling intelligence..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className={cardClass}>
        <h2 className="text-lg font-semibold mb-3 text-osint-text flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Intelligence Briefing
        </h2>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <AlertTriangle className="w-8 h-8 text-yellow-500 mb-2" />
          <p className="text-osint-muted text-sm mb-3">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 bg-osint-accent hover:bg-osint-accent-hover text-white text-sm rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Handle empty state
  if (stories.length === 0 || processedStories.length === 0) {
    return (
      <div className={cardClass}>
        <h2 className="text-lg font-semibold mb-3 text-osint-text flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Intelligence Briefing
        </h2>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Shield className="w-10 h-10 text-osint-muted mb-3 opacity-50" />
          <p className="text-osint-text font-medium mb-1">No Intelligence Available</p>
          <p className="text-osint-muted text-sm max-w-sm">
            No Nepal-relevant stories found in the last {hours} hours.
            Check back later or try expanding the time range.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={cardClass}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3 sm:mb-5 pb-2 sm:pb-3 border-b border-osint-border">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-lg font-bold text-osint-text flex items-center gap-1.5 sm:gap-2">
              <FileText className="w-4 sm:w-5 h-4 sm:h-5 text-osint-accent flex-shrink-0" />
              <span className="truncate">Intelligence Briefing</span>
              {isRefreshing && (
                <span className="ml-2 w-3 h-3 border-2 border-osint-accent border-t-transparent rounded-full animate-spin" />
              )}
            </h2>
            <p className="text-[10px] sm:text-xs text-osint-muted mt-0.5 sm:mt-1 truncate">
              Nepal OSINT • {hours}h • {new Date().toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-1.5 sm:p-2 rounded-lg border transition-all ${showFilters ? 'bg-osint-accent text-white border-osint-accent' : 'hover:bg-osint-border/50 text-osint-muted border-osint-border hover:border-osint-accent/50'}`}
              title="Toggle filters"
            >
              <Filter className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
            </button>
          </div>
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mb-4 p-3 bg-osint-bg rounded-lg border border-osint-border">
            <label className="flex items-center gap-2 text-sm text-osint-text cursor-pointer">
              <input
                type="checkbox"
                checked={filterVerifiedOnly}
                onChange={(e) => setFilterVerifiedOnly(e.target.checked)}
                className="rounded border-osint-border"
              />
              Show verified/multi-source only
            </label>
          </div>
        )}

        {/* Executive Summary */}
        <div className="mb-3 sm:mb-5 p-3 sm:p-4 bg-osint-bg/50 rounded-lg sm:rounded-xl border border-osint-border/50 shadow-sm">
          <div className="flex items-center justify-between mb-2 sm:mb-4 flex-wrap gap-1.5">
            <h3 className="text-[10px] sm:text-xs font-bold text-osint-accent uppercase tracking-wider sm:tracking-widest">
              Executive Summary
            </h3>
            {stats.critical > 0 && (
              <span className="px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-red-500/20 text-red-400 rounded-full border border-red-500/30 animate-pulse">
                {stats.critical} Priority{stats.critical !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* AI-Generated Key Judgment (from Executive Summary Service) */}
          <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-red-500/5 rounded-lg border border-red-500/20">
            <div className="flex items-center justify-between gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Target className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-red-400" />
                <span className="text-[10px] sm:text-xs font-bold text-red-400 uppercase tracking-wider">Key Judgment</span>
              </div>
              {executiveSummary && (
                <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${
                  executiveSummary.threat_level === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                  executiveSummary.threat_level === 'ELEVATED' ? 'bg-orange-500/20 text-orange-400' :
                  executiveSummary.threat_level === 'GUARDED' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-green-500/20 text-green-400'
                }`}>
                  {executiveSummary.threat_level}
                </span>
              )}
            </div>
            {summaryLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-osint-accent/30 border-t-osint-accent rounded-full animate-spin" />
                <span className="text-xs text-osint-muted">Generating AI summary...</span>
              </div>
            ) : (
              <>
                <p className="text-xs sm:text-sm text-osint-text leading-relaxed">
                  {executiveSummary?.key_judgment ||
                    `${stats.critical} priority ${stats.critical === 1 ? 'alert requires' : 'alerts require'} attention across ${stats.topDistricts.length > 0 ? stats.topDistricts.slice(0, 2).join(' and ') : 'Nepal'}.`}
                </p>
                {executiveSummary && (
                  <div className="flex items-center flex-wrap gap-3 mt-2 pt-2 border-t border-red-500/10">
                    <div className="flex items-center gap-1.5">
                      <Scale className="w-3 h-3 text-osint-muted" />
                      <span className="text-[10px] text-osint-muted">Trajectory:</span>
                      <span className={`text-[10px] font-medium ${
                        executiveSummary.threat_trajectory === 'ESCALATING' ? 'text-red-400' :
                        executiveSummary.threat_trajectory === 'DE-ESCALATING' ? 'text-green-400' :
                        'text-yellow-400'
                      }`}>
                        {executiveSummary.threat_trajectory}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3 h-3 text-osint-muted" />
                      <span className="text-[10px] text-osint-muted">
                        {executiveSummary.story_count} stories / {executiveSummary.time_range_hours}h
                      </span>
                    </div>
                    {executiveSummary.geographic_focus.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-osint-muted" />
                        <span className="text-[10px] text-osint-muted">
                          Focus: {executiveSummary.geographic_focus.slice(0, 2).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Watch Items (from AI summary) */}
          {executiveSummary && executiveSummary.watch_items.length > 0 && (
            <div className="mb-3 sm:mb-4 p-2 sm:p-2.5 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Eye className="w-3 h-3 text-yellow-400" />
                <span className="text-[10px] font-semibold text-yellow-400 uppercase">Watch Items</span>
              </div>
              <ul className="space-y-1">
                {executiveSummary.watch_items.slice(0, 3).map((item, i) => (
                  <li key={i} className="text-[10px] sm:text-xs text-osint-text flex items-start gap-1.5">
                    <span className="text-yellow-400/70">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Stats Grid - 2x2 on mobile, 4 cols on sm+ */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-3 sm:mb-4">
            <div className="text-center p-2 sm:p-3 bg-osint-card rounded-lg border border-osint-border">
              <div className="text-lg sm:text-2xl font-bold text-osint-text">{stats.total}</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wide text-osint-muted font-medium">Reports</div>
            </div>
            <div className="text-center p-2 sm:p-3 bg-osint-card rounded-lg border border-green-500/20">
              <div className="text-lg sm:text-2xl font-bold text-green-400">{stats.verified}</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wide text-osint-muted font-medium">Verified</div>
            </div>
            <div className="text-center p-2 sm:p-3 bg-osint-card rounded-lg border border-red-500/20">
              <div className="text-lg sm:text-2xl font-bold text-red-400">{stats.critical}</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wide text-osint-muted font-medium">Priority</div>
            </div>
            <div className="text-center p-2 sm:p-3 bg-osint-card rounded-lg border border-osint-accent/20">
              <div className="text-lg sm:text-2xl font-bold text-osint-accent">{stats.multiSource}</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wide text-osint-muted font-medium">Multi-Src</div>
            </div>
          </div>

          {/* Category Pills & Regions */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.byType).map(([type, count]) => {
                const config = TYPE_CONFIG[type]
                if (!config || count === 0) return null
                return (
                  <span key={type} className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${config.color}`}>
                    {config.label}: {count}
                  </span>
                )
              })}
            </div>
            {stats.topDistricts.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-osint-muted">
                <MapPin className="w-3 h-3 text-osint-accent" />
                <span className="font-medium">{stats.topDistricts.join(' • ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-2">
          <CategoryTab
            label="All"
            count={processedStories.length}
            active={selectedCategory === 'all'}
            onClick={() => setSelectedCategory('all')}
          />
          {categorizedStories.priority.length > 0 && (
            <CategoryTab
              label="Priority"
              count={categorizedStories.priority.length}
              active={selectedCategory === 'priority'}
              onClick={() => setSelectedCategory('priority')}
              color="text-red-400"
              bgColor="bg-red-500/10"
            />
          )}
          {categorizedStories.security.length > 0 && (
            <CategoryTab
              label="Security"
              count={categorizedStories.security.length}
              active={selectedCategory === 'security'}
              onClick={() => setSelectedCategory('security')}
              color="text-red-400"
              bgColor="bg-red-500/10"
            />
          )}
          {categorizedStories.political.length > 0 && (
            <CategoryTab
              label="Political"
              count={categorizedStories.political.length}
              active={selectedCategory === 'political'}
              onClick={() => setSelectedCategory('political')}
              color="text-purple-400"
              bgColor="bg-purple-500/10"
            />
          )}
          {categorizedStories.disaster.length > 0 && (
            <CategoryTab
              label="Disaster"
              count={categorizedStories.disaster.length}
              active={selectedCategory === 'disaster'}
              onClick={() => setSelectedCategory('disaster')}
              color="text-orange-400"
              bgColor="bg-orange-500/10"
            />
          )}
          {categorizedStories.economic.length > 0 && (
            <CategoryTab
              label="Economic"
              count={categorizedStories.economic.length}
              active={selectedCategory === 'economic'}
              onClick={() => setSelectedCategory('economic')}
              color="text-blue-400"
              bgColor="bg-blue-500/10"
            />
          )}
          {categorizedStories.social.length > 0 && (
            <CategoryTab
              label="Social"
              count={categorizedStories.social.length}
              active={selectedCategory === 'social'}
              onClick={() => setSelectedCategory('social')}
              color="text-green-400"
              bgColor="bg-green-500/10"
            />
          )}
        </div>

        {/* Story List - Fixed Height */}
        <div className="min-h-[400px]">
          {paginatedStories.length > 0 ? (
            <div className="space-y-2">
              {paginatedStories.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onClick={() => setSelectedStory(story)}
                  formatTime={formatTime}
                  compact={compact}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[400px] text-osint-muted">
              No reports found in this category
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-osint-border flex-wrap gap-2">
            <div className="text-[10px] sm:text-xs text-osint-muted">
              {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredByCategory.length)} of {filteredByCategory.length}
            </div>
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-1 sm:p-1.5 rounded border border-osint-border hover:bg-osint-border/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="First page"
              >
                <ChevronsLeft className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 sm:p-1.5 rounded border border-osint-border hover:bg-osint-border/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
              </button>
              <div className="px-2 sm:px-3 py-0.5 sm:py-1 text-xs sm:text-sm font-medium text-osint-text">
                {currentPage}/{totalPages}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 sm:p-1.5 rounded border border-osint-border hover:bg-osint-border/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1 sm:p-1.5 rounded border border-osint-border hover:bg-osint-border/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Last page"
              >
                <ChevronsRight className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedStory && (
        <StoryDetailModal
          story={selectedStory}
          onClose={() => setSelectedStory(null)}
        />
      )}
    </>
  )
}

// Category Tab Component
interface CategoryTabProps {
  label: string
  count: number
  active: boolean
  onClick: () => void
  color?: string
  bgColor?: string
}

function CategoryTab({ label, count, active, onClick, color = 'text-osint-text', bgColor = 'bg-osint-border/50' }: CategoryTabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
        active
          ? `${bgColor} ${color} ring-1 ring-current`
          : 'bg-osint-card border border-osint-border text-osint-muted hover:text-osint-text hover:border-osint-accent/50'
      }`}
    >
      {label}
      <span className={`px-1.5 py-0.5 rounded text-[10px] ${active ? 'bg-osint-card/50' : 'bg-osint-bg'}`}>
        {count}
      </span>
    </button>
  )
}

// Story Card Component
interface StoryCardProps {
  story: ConsolidatedStory
  onClick: () => void
  formatTime: (date?: string) => string
  compact: boolean
}

function StoryCard({ story, onClick, formatTime, compact }: StoryCardProps) {
  const typeConfig = TYPE_CONFIG[story.story_type || 'general']

  // Get priority tier color
  const getPriorityColor = (score: number | undefined) => {
    if (!score) return null
    if (score >= 90) return 'bg-red-500/20 text-red-400 border-red-500/50'
    if (score >= 70) return 'bg-orange-500/20 text-orange-400 border-orange-500/50'
    if (score >= 50) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
    return null // Don't show for low priority
  }

  const priorityColor = getPriorityColor(story.intel_priority_score)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 bg-osint-card rounded-lg border hover:border-osint-accent/50 hover:shadow-md transition-all group ${
        story.intel_is_critical ? 'border-red-500/50 ring-1 ring-red-500/20' : 'border-osint-border'
      }`}
    >
      {/* Top Row: Badges */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Critical Event Indicator */}
          {story.intel_is_critical && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500 text-white animate-pulse">
              CRITICAL
            </span>
          )}
          {/* Priority Score Badge */}
          {priorityColor && !story.intel_is_critical && (
            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${priorityColor}`}>
              P{Math.round(story.intel_priority_score || 0)}
            </span>
          )}
          {typeConfig && (
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${typeConfig.color}`}>
              {typeConfig.label}
            </span>
          )}
          {story.severity && (
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border capitalize ${SEVERITY_COLORS[story.severity] || ''}`}>
              {story.severity}
            </span>
          )}
          {story.is_verified ? (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <CheckCircle className="w-3 h-3" />
              <span className="font-medium">{story.source_provenance?.length || story.source_links?.length || story.source_count} sources</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-yellow-500">
              <AlertCircle className="w-3 h-3" />
            </span>
          )}
          {/* BLUF Processing Status Indicator */}
          {story.bluf ? (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium bg-emerald-500/20 text-emerald-400 rounded" title="Auto-generated briefing (verify independently)">
              <Sparkles className="w-2.5 h-2.5" />
              Auto
            </span>
          ) : (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium bg-slate-500/20 text-slate-400 rounded" title="Awaiting briefing generation">
              <Clock className="w-2.5 h-2.5" />
            </span>
          )}
        </div>
        {/* Trust indicator - simple star for reliability */}
        {story.admiralty_rating && (
          <div className="flex items-center gap-1" title={`Trust level: ${story.admiralty_rating}`}>
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
          </div>
        )}
      </div>

      {/* Headline */}
      <h4 className={`${compact ? 'text-sm' : 'text-[13px] font-medium leading-snug'} text-osint-text group-hover:text-osint-accent transition-colors line-clamp-2`}>
        {story.canonical_headline}
      </h4>

      {/* Summary */}
      {story.summary && !compact && (
        <p className="text-[11px] text-osint-muted mt-1.5 line-clamp-2 leading-relaxed">
          {story.summary}
        </p>
      )}

      {/* Footer: Location & Time */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-osint-border/50">
        <div className="flex items-center gap-2 text-[10px] text-osint-muted">
          {story.districts_affected?.length > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-osint-bg rounded">
              <MapPin className="w-2.5 h-2.5 text-osint-accent" />
              {story.districts_affected.slice(0, 2).join(', ')}
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 text-[10px] text-osint-muted">
          <Clock className="w-2.5 h-2.5" />
          {formatTime(story.first_reported_at)}
        </span>
      </div>
    </button>
  )
}

// =============================================================================
// CIVILIAN-FRIENDLY HELPERS
// =============================================================================

// Convert NATO reliability to star rating
function reliabilityToStars(grade: string): number {
  const map: Record<string, number> = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1, 'F': 1 }
  return map[grade?.toUpperCase()] || 3
}

// Convert confidence to plain English
function confidenceToPlainEnglish(level: string): string {
  const map: Record<string, string> = {
    'HIGH': 'Very confident',
    'MODERATE': 'Fairly confident',
    'LOW': 'Uncertain'
  }
  return map[level?.toUpperCase()] || level
}

// Convert corroboration to plain English
function corroborationToPlainEnglish(level: string): string {
  const map: Record<string, string> = {
    'CONFIRMED': 'Confirmed by multiple reliable sources',
    'CORROBORATED': 'Supported by other sources',
    'SINGLE_SOURCE': 'From one source only',
    'UNCORROBORATED': 'Not yet verified'
  }
  return map[level?.toUpperCase()] || level?.replace('_', ' ')
}

// Convert severity to user-friendly language
function severityToPlainEnglish(sev: string): { text: string; color: string } {
  const map: Record<string, { text: string; color: string }> = {
    'critical': { text: 'Very Important', color: 'text-red-400' },
    'high': { text: 'Important', color: 'text-orange-400' },
    'medium': { text: 'Moderate', color: 'text-yellow-400' },
    'low': { text: 'Minor', color: 'text-green-400' }
  }
  return map[sev?.toLowerCase()] || { text: sev, color: 'text-osint-muted' }
}

// StarRating component for civilian mode
function StarRating({ stars, max = 5 }: { stars: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i < stars ? 'text-yellow-400 fill-yellow-400' : 'text-osint-muted/30'}`}
        />
      ))}
    </div>
  )
}

// Story Detail Modal - Simplified Unified View
interface StoryDetailModalProps {
  story: ConsolidatedStory
  onClose: () => void
}

function StoryDetailModal({ story, onClose }: StoryDetailModalProps) {
  const typeConfig = TYPE_CONFIG[story.story_type || 'general']
  const [showHistory, setShowHistory] = useState(false)

  // Calculate overall reliability stars from source evaluation or admiralty rating
  const getOverallReliability = (): number => {
    if (story.source_evaluation?.reliability) {
      return reliabilityToStars(story.source_evaluation.reliability)
    }
    if (story.admiralty_rating) {
      // Extract reliability letter from admiralty rating (e.g., "B2" -> "B")
      const letter = story.admiralty_rating.charAt(0)
      return reliabilityToStars(letter)
    }
    // Default based on source count
    if (story.source_count >= 3) return 4
    if (story.source_count >= 2) return 3
    return 2
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-osint-card border-0 sm:border border-osint-border rounded-none sm:rounded-xl max-w-2xl w-full h-full sm:h-auto sm:max-h-[85vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-osint-border bg-gradient-to-r from-osint-bg to-osint-card">
          <div className="flex-1 pr-4">
            {/* Badges - Simplified */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {typeConfig && (
                <span className={`px-2 py-0.5 text-xs rounded border ${typeConfig.color}`}>
                  {typeConfig.label}
                </span>
              )}
              {story.severity && (
                <span className={`px-2 py-0.5 text-xs rounded border border-osint-border ${severityToPlainEnglish(story.severity).color}`}>
                  {severityToPlainEnglish(story.severity).text}
                </span>
              )}
              {story.is_verified ? (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {story.source_provenance?.length || story.source_links?.length || story.source_count} sources
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-yellow-500">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Not yet verified
                </span>
              )}
            </div>

            {/* Headline */}
            <h2 className="text-lg font-semibold text-osint-text">
              {story.canonical_headline}
            </h2>
            {story.canonical_headline_ne && (
              <h3 className="text-sm text-osint-muted mt-1">
                {story.canonical_headline_ne}
              </h3>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-osint-border transition-colors"
          >
            <X className="w-5 h-5 text-osint-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="p-3 sm:p-4 overflow-y-auto h-[calc(100vh-80px)] sm:h-auto sm:max-h-[calc(85vh-100px)]">

          {/* 1. Key Takeaway (BLUF) */}
          {story.bluf && (
            <div className="mb-4 p-4 rounded-lg border bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border-blue-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-blue-400" />
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                  Key Takeaway
                </h4>
              </div>
              <p className="text-sm text-osint-text leading-relaxed font-medium">
                {story.bluf}
              </p>
            </div>
          )}

          {/* 2. What Happened (Summary) */}
          {story.summary && (
            <div className="mb-4 p-4 bg-osint-bg rounded-lg border border-osint-border">
              <h4 className="text-xs font-semibold text-osint-accent uppercase tracking-wider mb-2 flex items-center gap-2">
                <Newspaper className="w-4 h-4" />
                What Happened
              </h4>
              <p className="text-sm text-osint-text leading-relaxed">
                {story.summary}
              </p>
              {story.summary_ne && (
                <p className="text-sm text-osint-muted mt-2 leading-relaxed">
                  {story.summary_ne}
                </p>
              )}
            </div>
          )}

          {/* 3. When & Where */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-osint-bg rounded-lg border border-osint-border">
              <h4 className="text-xs font-medium text-osint-muted uppercase mb-1">First Reported</h4>
              <p className="text-sm text-osint-text flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {story.first_reported_at
                  ? new Date(story.first_reported_at).toLocaleString()
                  : 'Unknown'
                }
              </p>
            </div>
            {story.districts_affected && story.districts_affected.length > 0 && (
              <div className="p-3 bg-osint-bg rounded-lg border border-osint-border">
                <h4 className="text-xs font-medium text-osint-muted uppercase mb-1">Location</h4>
                <p className="text-sm text-osint-text flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {story.districts_affected.join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* 4. People & Organizations */}
          {story.key_entities && story.key_entities.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-osint-muted uppercase tracking-wider mb-2">
                People & Organizations
              </h4>
              <div className="flex flex-wrap gap-2">
                {story.key_entities.map((entity, i) => (
                  <span
                    key={i}
                    className={`px-2.5 py-1 text-xs rounded ${
                      entity.type === 'PERSON' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30' :
                      entity.type === 'ORGANIZATION' ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30' :
                      entity.type === 'LOCATION' ? 'bg-green-500/15 text-green-400 border border-green-500/30' :
                      'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                    }`}
                  >
                    {entity.name}
                    {entity.name_ne && <span className="text-osint-muted ml-1">({entity.name_ne})</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 5. How Reliable */}
          <div className="mb-4 p-4 bg-osint-bg rounded-lg border border-osint-border">
            <h4 className="text-xs font-semibold text-osint-accent uppercase tracking-wider mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              How Reliable
            </h4>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-osint-muted">Trust Level:</span>
                <StarRating stars={getOverallReliability()} />
                <span className="text-xs text-osint-muted">({getOverallReliability()}/5)</span>
              </div>
              <span className="text-xs text-osint-muted">
                Based on {story.source_provenance?.length || story.source_links?.length || story.source_count} source{(story.source_provenance?.length || story.source_links?.length || story.source_count) !== 1 ? 's' : ''}
              </span>
            </div>
            {story.corroboration_level && (
              <p className="text-xs text-osint-muted mt-2 pt-2 border-t border-osint-border/50">
                {corroborationToPlainEnglish(story.corroboration_level)}
              </p>
            )}
          </div>

          {/* 6. Past Similar Events (Collapsible Historical Context) */}
          {story.nepal_context?.historical_patterns &&
           typeof story.nepal_context.historical_patterns === 'object' &&
           !Array.isArray(story.nepal_context.historical_patterns) && (
            <div className="mb-4">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between p-3 bg-osint-bg rounded-lg border border-osint-border hover:border-osint-accent/50 transition-colors"
              >
                <h4 className="text-xs font-semibold text-osint-muted uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Past Similar Events
                </h4>
                {showHistory ? (
                  <ChevronUp className="w-4 h-4 text-osint-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-osint-muted" />
                )}
              </button>
              {showHistory && (
                <div className="mt-2">
                  <HistoricalContextSection
                    historicalPatterns={story.nepal_context.historical_patterns}
                    currentStoryType={story.story_type}
                    currentDistrict={story.districts_affected?.[0]}
                  />
                </div>
              )}
            </div>
          )}

          {/* 7. Sources */}
          <div className="border-t border-osint-border pt-4">
            <h4 className="text-xs font-semibold text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-2">
              <Link2 className="w-4 h-4" />
              Sources ({story.source_provenance?.length || story.source_links?.length || 0})
            </h4>
            {(story.source_provenance && story.source_provenance.length > 0) ? (
              <div className="space-y-2">
                {story.source_provenance.map((source, i) => (
                  <a
                    key={i}
                    href={source.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg bg-osint-bg border border-osint-border hover:border-osint-accent/50 hover:bg-osint-border/30 transition-colors group"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <ExternalLink className="w-4 h-4 text-osint-accent flex-shrink-0 group-hover:scale-110 transition-transform" />
                      <StarRating stars={reliabilityToStars(source.reliability_grade)} max={5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-osint-text group-hover:text-osint-accent transition-colors truncate">
                          {source.title || source.source_id}
                        </p>
                        {source.is_first_report && (
                          <span className="px-1.5 py-0.5 text-[9px] bg-osint-accent/20 text-osint-accent rounded font-medium">
                            FIRST
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-osint-muted mt-0.5">
                        {source.source_id}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ) : story.source_links && story.source_links.length > 0 ? (
              <div className="space-y-2">
                {story.source_links.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg bg-osint-bg border border-osint-border hover:border-osint-accent/50 hover:bg-osint-border/30 transition-colors group"
                  >
                    <ExternalLink className="w-4 h-4 text-osint-accent flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-osint-text group-hover:text-osint-accent transition-colors truncate">
                        {link.title || link.source_id}
                      </p>
                      <p className="text-xs text-osint-muted mt-0.5">
                        {link.source_id}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-osint-muted text-center py-4">
                Source links not available
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
