/**
 * MapFilterPanel - Professional Analyst Filter Controls
 * =====================================================
 *
 * Palantir-style professional filter panel with:
 * - Monospace text-only controls (no emojis)
 * - Compact, information-dense layout
 * - Category toggles with live counts
 * - Severity level filters
 * - Time range presets
 * - Data quality filters
 */

import { useState, useCallback, memo } from 'react'
import {
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  Shield,
  Landmark,
  TrendingUp,
  Building2,
  AlertTriangle,
  Heart,
  Users,
  Leaf,
  Circle,
  Clock,
  RotateCcw,
  CheckCircle2,
  Layers,
  Target,
} from 'lucide-react'
import {
  CATEGORY_CONFIG,
  type IntelligenceCategory,
  type EventSeverity,
} from './EventMarkerIcons'

// =============================================================================
// TYPES
// =============================================================================

export interface MapFilters {
  categories: IntelligenceCategory[]
  severities: EventSeverity[]
  hours: number
  // Advanced filters
  minConfidence?: number // 0-1, filter events below this confidence
  multiSourceOnly?: boolean // Only show events with 2+ sources
  verifiedOnly?: boolean // Only show consolidated/verified events
}

export interface CategoryCount {
  category: IntelligenceCategory
  count: number
}

export interface SeverityCount {
  severity: EventSeverity
  count: number
}

export interface MapFilterPanelProps {
  /** Current filter state */
  filters: MapFilters
  /** Category event counts */
  categoryCounts: Record<string, number>
  /** Severity event counts */
  severityCounts: Record<string, number>
  /** Total event count */
  totalCount: number
  /** Filter change handler */
  onFiltersChange: (filters: Partial<MapFilters>) => void
  /** Whether the panel is collapsed */
  collapsed?: boolean
  /** Collapse state change handler */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Whether to show as floating panel */
  floating?: boolean
  /** Position for floating panel */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Category icons mapping */
const CATEGORY_ICONS: Record<IntelligenceCategory, React.ElementType> = {
  SECURITY: Shield,
  POLITICAL: Landmark,
  ECONOMIC: TrendingUp,
  INFRASTRUCTURE: Building2,
  DISASTER: AlertTriangle,
  HEALTH: Heart,
  SOCIAL: Users,
  ENVIRONMENT: Leaf,
  GENERAL: Circle,
}

/** Severity configuration */
const SEVERITY_CONFIG: Record<EventSeverity, { label: string; color: string; bgColor: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-red-400', bgColor: 'bg-red-500/20' },
  HIGH: { label: 'High', color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  MEDIUM: { label: 'Medium', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  LOW: { label: 'Low', color: 'text-green-400', bgColor: 'bg-green-500/20' },
}

/** Time range presets */
const TIME_PRESETS = [
  { hours: 1, label: '1h' },
  { hours: 3, label: '3h' },
  { hours: 6, label: '6h' },
]

/** All categories */
const ALL_CATEGORIES: IntelligenceCategory[] = [
  'SECURITY',
  'POLITICAL',
  'ECONOMIC',
  'INFRASTRUCTURE',
  'DISASTER',
  'HEALTH',
  'SOCIAL',
  'ENVIRONMENT',
]

/** All severities */
const ALL_SEVERITIES: EventSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

// =============================================================================
// COMPONENT
// =============================================================================

export const MapFilterPanel = memo(function MapFilterPanel({
  filters,
  categoryCounts,
  severityCounts,
  totalCount,
  onFiltersChange,
  collapsed = false,
  onCollapsedChange,
  floating = true,
  position = 'top-left',
}: MapFilterPanelProps) {
  // Collapsed by default for cleaner initial view
  const [showCategories, setShowCategories] = useState(false)
  const [showSeverities, setShowSeverities] = useState(false)
  const [showDataQuality, setShowDataQuality] = useState(false)

  // Position classes
  const positionClasses = floating
    ? {
        'top-left': 'top-4 left-4',
        'top-right': 'top-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'bottom-right': 'bottom-4 right-4',
      }[position]
    : ''

  // Toggle category
  const toggleCategory = useCallback((category: IntelligenceCategory) => {
    const current = filters.categories
    const updated = current.includes(category)
      ? current.filter(c => c !== category)
      : [...current, category]
    onFiltersChange({ categories: updated })
  }, [filters.categories, onFiltersChange])

  // Toggle severity
  const toggleSeverity = useCallback((severity: EventSeverity) => {
    const current = filters.severities
    const updated = current.includes(severity)
      ? current.filter(s => s !== severity)
      : [...current, severity]
    onFiltersChange({ severities: updated })
  }, [filters.severities, onFiltersChange])

  // Set time range
  const setTimeRange = useCallback((hours: number) => {
    onFiltersChange({ hours })
  }, [onFiltersChange])

  // Reset filters (to defaults: 24h, all severities)
  const resetFilters = useCallback(() => {
    onFiltersChange({
      categories: [],
      severities: [],
      hours: 6,
      multiSourceOnly: false,
      verifiedOnly: false,
      minConfidence: undefined,
    })
  }, [onFiltersChange])

  // Show all events (remove all filters)
  const showAllEvents = useCallback(() => {
    onFiltersChange({
      categories: [],
      severities: [],
      hours: 6,
      multiSourceOnly: false,
      verifiedOnly: false,
      minConfidence: undefined,
    })
  }, [onFiltersChange])

  // Quick filter: Critical only
  const showCriticalOnly = useCallback(() => {
    onFiltersChange({
      severities: ['CRITICAL'],
    })
  }, [onFiltersChange])

  // Quick filter: High priority (Critical + High)
  const showHighPriority = useCallback(() => {
    onFiltersChange({
      severities: ['CRITICAL', 'HIGH'],
    })
  }, [onFiltersChange])

  // Quick filter: Disasters only
  const showDisastersOnly = useCallback(() => {
    onFiltersChange({
      categories: ['DISASTER'],
      severities: [],
    })
  }, [onFiltersChange])

  // Toggle multi-source only
  const toggleMultiSourceOnly = useCallback(() => {
    onFiltersChange({ multiSourceOnly: !filters.multiSourceOnly })
  }, [filters.multiSourceOnly, onFiltersChange])

  // Toggle verified only
  const toggleVerifiedOnly = useCallback(() => {
    onFiltersChange({ verifiedOnly: !filters.verifiedOnly })
  }, [filters.verifiedOnly, onFiltersChange])

  // Set confidence filter
  const setConfidenceFilter = useCallback((level: 'all' | 'low' | 'medium' | 'high') => {
    const minConfidence = level === 'high' ? 0.8 :
                          level === 'medium' ? 0.5 :
                          level === 'low' ? 0.3 : undefined
    onFiltersChange({ minConfidence })
  }, [onFiltersChange])

  // Select all categories
  const selectAllCategories = useCallback(() => {
    onFiltersChange({ categories: [] }) // Empty means all
  }, [onFiltersChange])

  // Check if filters differ from defaults (24h, all severities/categories)
  const isDefaultFilters = filters.severities.length === 0 &&
                           filters.categories.length === 0 &&
                           filters.hours === 6 &&
                           !filters.multiSourceOnly &&
                           !filters.verifiedOnly &&
                           !filters.minConfidence
  const hasActiveFilters = !isDefaultFilters
  const hasDataQualityFilters = filters.multiSourceOnly || filters.verifiedOnly || filters.minConfidence

  // Collapsed view - white button style
  if (collapsed) {
    return (
      <div
        className={`
          ${floating ? 'absolute z-[1000]' : ''}
          ${positionClasses}
        `}
      >
        <button
          onClick={() => onCollapsedChange?.(false)}
          className="flex items-center gap-2 px-3 py-2 bg-white
                     border border-gray-200 rounded-lg shadow-sm
                     hover:bg-gray-50 transition-colors"
          aria-label="Open filters"
        >
          <Filter className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
          {hasActiveFilters && (
            <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
              Active
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <div
      className={`
        ${floating ? 'absolute z-[1000]' : ''}
        ${positionClasses}
        w-56 max-h-[65vh] overflow-hidden
        bg-white border border-gray-200
        rounded-lg shadow-lg
        flex flex-col
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
          <span className="text-xs text-gray-500">{totalCount}</span>
        </div>
        <div className="flex items-center gap-1">
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title="Reset filters"
              aria-label="Reset all filters"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          {onCollapsedChange && (
            <button
              onClick={() => onCollapsedChange(true)}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title="Collapse"
              aria-label="Collapse filter panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Filters - Clean pill buttons */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={showCriticalOnly}
            className={`
              px-2.5 py-1 text-xs rounded-full transition-colors
              ${filters.severities.length === 1 && filters.severities[0] === 'CRITICAL'
                ? 'bg-red-100 text-red-700 border border-red-200'
                : 'bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-700'
              }
            `}
          >
            Critical
          </button>
          <button
            onClick={showHighPriority}
            className={`
              px-2.5 py-1 text-xs rounded-full transition-colors
              ${filters.severities.length === 2 && filters.severities.includes('CRITICAL') && filters.severities.includes('HIGH')
                ? 'bg-orange-100 text-orange-700 border border-orange-200'
                : 'bg-gray-100 hover:bg-orange-50 text-gray-600 hover:text-orange-700'
              }
            `}
          >
            High+
          </button>
          <button
            onClick={showDisastersOnly}
            className={`
              px-2.5 py-1 text-xs rounded-full transition-colors
              ${filters.categories.length === 1 && filters.categories[0] === 'DISASTER'
                ? 'bg-red-100 text-red-700 border border-red-200'
                : 'bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-700'
              }
            `}
          >
            Disaster
          </button>
          <button
            onClick={showAllEvents}
            className={`
              px-2.5 py-1 text-xs rounded-full transition-colors
              ${isDefaultFilters
                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                : 'bg-gray-100 hover:bg-blue-50 text-gray-600 hover:text-blue-700'
              }
            `}
          >
            All
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Time Range */}
        <div className="px-3 py-2.5 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Time Range</span>
          </div>
          <div className="flex gap-1">
            {TIME_PRESETS.map(preset => (
              <button
                key={preset.hours}
                onClick={() => setTimeRange(preset.hours)}
                className={`
                  flex-1 px-2 py-1.5 text-xs rounded transition-colors
                  ${filters.hours === preset.hours
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  }
                `}
                aria-pressed={filters.hours === preset.hours}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="border-b border-gray-100">
          <button
            onClick={() => setShowCategories(!showCategories)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
            aria-expanded={showCategories}
          >
            <span className="text-xs font-medium text-gray-600">Categories</span>
            <div className="flex items-center gap-2">
              {filters.categories.length > 0 && (
                <span className="text-xs text-blue-600">
                  {filters.categories.length} selected
                </span>
              )}
              {showCategories ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </div>
          </button>

          {showCategories && (
            <div className="px-2 pb-2 space-y-0.5">
              {/* Select All button */}
              <button
                onClick={selectAllCategories}
                className={`
                  w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors
                  ${filters.categories.length === 0
                    ? 'bg-blue-50 text-blue-700'
                    : 'hover:bg-gray-50 text-gray-600'
                  }
                `}
              >
                <div className="w-4 h-4 flex items-center justify-center">
                  {filters.categories.length === 0 && (
                    <div className="w-2 h-2 bg-blue-600 rounded-full" />
                  )}
                </div>
                <span>All Categories</span>
              </button>

              {/* Category toggles */}
              {ALL_CATEGORIES.map(category => {
                const config = CATEGORY_CONFIG[category]
                const Icon = CATEGORY_ICONS[category]
                const count = categoryCounts[category] || 0
                const isSelected = filters.categories.includes(category)

                return (
                  <button
                    key={category}
                    onClick={() => toggleCategory(category)}
                    className={`
                      w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                      transition-colors
                      ${isSelected
                        ? 'bg-gray-100 border border-gray-200'
                        : 'hover:bg-gray-50'
                      }
                    `}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center"
                        style={{ backgroundColor: `${config.color}15` }}
                      >
                        <Icon
                          className="w-3 h-3"
                          style={{ color: config.color }}
                        />
                      </div>
                      <span className={isSelected ? 'text-gray-900' : 'text-gray-600'}>
                        {config.label}
                      </span>
                    </div>
                    <span className={`
                      px-1.5 py-0.5 rounded text-xs
                      ${count > 0 ? 'bg-gray-100' : ''}
                      ${isSelected ? 'text-gray-700 font-medium' : 'text-gray-500'}
                    `}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Severities */}
        <div className="border-b border-gray-100">
          <button
            onClick={() => setShowSeverities(!showSeverities)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
            aria-expanded={showSeverities}
          >
            <span className="text-xs font-medium text-gray-600">Severity</span>
            <div className="flex items-center gap-2">
              {filters.severities.length > 0 && (
                <span className="text-xs text-blue-600">
                  {filters.severities.length} selected
                </span>
              )}
              {showSeverities ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </div>
          </button>

          {showSeverities && (
            <div className="px-2 pb-2 space-y-0.5">
              {ALL_SEVERITIES.map(severity => {
                const config = SEVERITY_CONFIG[severity]
                const count = severityCounts[severity] || 0
                const isSelected = filters.severities.includes(severity)

                return (
                  <button
                    key={severity}
                    onClick={() => toggleSeverity(severity)}
                    className={`
                      w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                      transition-colors
                      ${isSelected
                        ? 'bg-gray-100 border border-gray-200'
                        : 'hover:bg-gray-50'
                      }
                    `}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        severity === 'CRITICAL' ? 'bg-red-500' :
                        severity === 'HIGH' ? 'bg-orange-500' :
                        severity === 'MEDIUM' ? 'bg-yellow-500' :
                        'bg-gray-400'
                      }`} />
                      <span className={isSelected ? 'text-gray-900' : 'text-gray-600'}>
                        {config.label}
                      </span>
                    </div>
                    <span className={`
                      px-1.5 py-0.5 rounded text-xs
                      ${count > 0 ? 'bg-gray-100' : ''}
                      ${isSelected ? 'text-gray-700 font-medium' : 'text-gray-500'}
                    `}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Data Quality Filters */}
        <div>
          <button
            onClick={() => setShowDataQuality(!showDataQuality)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
            aria-expanded={showDataQuality}
          >
            <span className="text-xs font-medium text-gray-600">Data Quality</span>
            <div className="flex items-center gap-2">
              {hasDataQualityFilters && (
                <span className="text-xs text-blue-600">Active</span>
              )}
              {showDataQuality ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </div>
          </button>

          {showDataQuality && (
            <div className="px-2 pb-2 space-y-1.5">
              {/* Multi-source toggle */}
              <button
                onClick={toggleMultiSourceOnly}
                className={`
                  w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                  transition-colors
                  ${filters.multiSourceOnly
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50'
                  }
                `}
                aria-pressed={filters.multiSourceOnly}
              >
                <div className="flex items-center gap-2">
                  <Layers className={`w-3.5 h-3.5 ${filters.multiSourceOnly ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className={filters.multiSourceOnly ? 'text-blue-700' : 'text-gray-600'}>
                    Multi-source only
                  </span>
                </div>
                <div className={`
                  w-4 h-4 rounded flex items-center justify-center
                  ${filters.multiSourceOnly ? 'bg-blue-600' : 'bg-gray-100 border border-gray-200'}
                `}>
                  {filters.multiSourceOnly && (
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  )}
                </div>
              </button>

              {/* Verified only toggle */}
              <button
                onClick={toggleVerifiedOnly}
                className={`
                  w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                  transition-colors
                  ${filters.verifiedOnly
                    ? 'bg-green-50 border border-green-200'
                    : 'hover:bg-gray-50'
                  }
                `}
                aria-pressed={filters.verifiedOnly}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`w-3.5 h-3.5 ${filters.verifiedOnly ? 'text-green-600' : 'text-gray-400'}`} />
                  <span className={filters.verifiedOnly ? 'text-green-700' : 'text-gray-600'}>
                    Verified only
                  </span>
                </div>
                <div className={`
                  w-4 h-4 rounded flex items-center justify-center
                  ${filters.verifiedOnly ? 'bg-green-600' : 'bg-gray-100 border border-gray-200'}
                `}>
                  {filters.verifiedOnly && (
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  )}
                </div>
              </button>

              {/* Confidence level */}
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2 px-1 mb-1.5">
                  <Target className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-500">Confidence Level</span>
                </div>
                <div className="flex gap-1">
                  {(['all', 'low', 'medium', 'high'] as const).map(level => {
                    const isActive = level === 'all' ? !filters.minConfidence :
                                     level === 'high' ? filters.minConfidence === 0.8 :
                                     level === 'medium' ? filters.minConfidence === 0.5 :
                                     filters.minConfidence === 0.3
                    return (
                      <button
                        key={level}
                        onClick={() => setConfidenceFilter(level)}
                        className={`
                          flex-1 px-2 py-1.5 text-xs rounded transition-colors capitalize
                          ${isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                          }
                        `}
                      >
                        {level}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer with active filter summary */}
      {hasActiveFilters && (
        <div className="px-3 py-2 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">
              Showing {totalCount} events
            </span>
            <button
              onClick={resetFilters}
              className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default MapFilterPanel
