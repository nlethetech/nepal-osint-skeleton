/**
 * SatelliteImageryPanel - Google Earth Engine satellite layer controls
 * ====================================================================
 *
 * Production-grade satellite imagery panel with:
 * - Base imagery toggles (Sentinel-2 RGB, False Color)
 * - Environmental layers (NDVI, Temperature, Precipitation)
 * - Disaster analysis (Flood Extent, Landslide Detection)
 * - Change detection alerts
 * - Date picker for historical imagery
 * - Collapsible design for mobile
 */

import { useState, useCallback, memo, useMemo } from 'react'
import {
  Satellite,
  X,
  ChevronDown,
  ChevronUp,
  Leaf,
  Droplets,
  Thermometer,
  CloudRain,
  Mountain,
  AlertTriangle,
  Calendar,
  RefreshCw,
  Layers,
  Eye,
  EyeOff,
  Info,
  Bell,
  Loader2,
  CheckCircle2,
  Target,
  Crosshair,
  FileSearch,
  Building2,
  MapPin,
} from 'lucide-react'
import {
  type SatelliteLayerType,
  LAYER_INFO,
} from '../../api/earthEngine'
import { useGEEStatus, useChangeAlerts } from '../../hooks/useEarthEngine'
import { quickAnalyze, type QuickAnalyzeResult, listAssessments, type Assessment } from '../../api/damageAssessment'

// =============================================================================
// TYPES
// =============================================================================

export interface SatelliteImageryPanelProps {
  /** Currently active satellite layer */
  activeLayer: SatelliteLayerType | null
  /** Handler for layer toggle */
  onLayerToggle: (layer: SatelliteLayerType | null) => void
  /** Selected date for imagery */
  selectedDate: Date | null
  /** Handler for date change */
  onDateChange: (date: Date | null) => void
  /** Whether the panel is collapsed */
  collapsed?: boolean
  /** Collapse state change handler */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Whether to show as floating panel */
  floating?: boolean
  /** Position for floating panel */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Compact mode (fewer options visible) */
  compact?: boolean
  /** Handler for opening flood analysis modal */
  onFloodAnalysis?: () => void
  /** Handler for opening landslide analysis modal */
  onLandslideAnalysis?: () => void
  /** Handler for viewing change alerts */
  onViewAlerts?: () => void
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Layer icons mapping */
const LAYER_ICONS: Record<SatelliteLayerType, React.ElementType> = {
  'sentinel2-rgb': Satellite,
  'sentinel2-false-color': Layers,
  'ndvi': Leaf,
  'flood-extent': Droplets,
  'temperature': Thermometer,
  'precipitation': CloudRain,
}

/** Layer categories */
const LAYER_CATEGORIES = {
  base: {
    label: 'Base Imagery',
    layers: ['sentinel2-rgb', 'sentinel2-false-color'] as SatelliteLayerType[],
  },
  environmental: {
    label: 'Environmental',
    layers: ['ndvi', 'temperature', 'precipitation'] as SatelliteLayerType[],
  },
  disaster: {
    label: 'Disaster Detection',
    layers: ['flood-extent'] as SatelliteLayerType[],
  },
}

/** Severity colors for alerts */
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

// =============================================================================
// COMPONENT
// =============================================================================

export const SatelliteImageryPanel = memo(function SatelliteImageryPanel({
  activeLayer,
  onLayerToggle,
  selectedDate,
  onDateChange,
  collapsed = false,
  onCollapsedChange,
  floating = true,
  position = 'top-right',
  compact = false,
  onFloodAnalysis,
  onLandslideAnalysis,
  onViewAlerts,
}: SatelliteImageryPanelProps) {
  const [showBaseImagery, setShowBaseImagery] = useState(true)
  const [showEnvironmental, setShowEnvironmental] = useState(true)
  const [showDisaster, setShowDisaster] = useState(false)
  const [showPWTT, setShowPWTT] = useState(true)
  const [showAlerts, setShowAlerts] = useState(false)
  const [recentAssessments, setRecentAssessments] = useState<Assessment[]>([])
  const [loadingAssessments, setLoadingAssessments] = useState(false)

  // GEE status
  const { data: geeStatus, isLoading: statusLoading } = useGEEStatus()

  // Change alerts
  const { data: alertsData, isLoading: alertsLoading } = useChangeAlerts(
    { hours: 168 }, // 7 days
    { enabled: !collapsed }
  )

  // Position classes
  const positionClasses = floating
    ? {
        'top-left': 'top-4 left-4',
        'top-right': 'top-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'bottom-right': 'bottom-4 right-4',
      }[position]
    : ''

  // Format date for display
  const formatDate = useCallback((date: Date | null) => {
    if (!date) return 'Latest'
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }, [])

  // Format date for input
  const formatDateInput = useCallback((date: Date | null) => {
    if (!date) return ''
    return date.toISOString().split('T')[0]
  }, [])

  // Handle date input change
  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (!value) {
      onDateChange(null)
    } else {
      onDateChange(new Date(value))
    }
  }, [onDateChange])

  // Toggle layer
  const toggleLayer = useCallback((layer: SatelliteLayerType) => {
    if (activeLayer === layer) {
      onLayerToggle(null)
    } else {
      onLayerToggle(layer)
    }
  }, [activeLayer, onLayerToggle])

  // Reset to today
  const resetDate = useCallback(() => {
    onDateChange(null)
  }, [onDateChange])

  // Critical/High alert count
  const urgentAlertCount = useMemo(() => {
    if (!alertsData?.alerts) return 0
    return alertsData.alerts.filter(
      a => a.severity === 'critical' || a.severity === 'high'
    ).length
  }, [alertsData])

  // Load recent damage assessments
  const loadRecentAssessments = useCallback(async () => {
    setLoadingAssessments(true)
    try {
      const { items } = await listAssessments({ limit: 5 })
      setRecentAssessments(items)
    } catch (e) {
      console.error('Failed to load assessments:', e)
    } finally {
      setLoadingAssessments(false)
    }
  }, [])

  // Load assessments when PWTT section is expanded
  const handlePWTTToggle = useCallback(() => {
    const newState = !showPWTT
    setShowPWTT(newState)
    if (newState && recentAssessments.length === 0) {
      loadRecentAssessments()
    }
  }, [showPWTT, recentAssessments.length, loadRecentAssessments])

  // GEE not initialized
  const geeNotReady = !statusLoading && !geeStatus?.initialized

  // Collapsed view
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
          className="flex items-center gap-2 px-3 py-2 bg-osint-bg/95 backdrop-blur-sm
                     border border-osint-border rounded-lg shadow-lg
                     hover:bg-osint-card transition-colors"
          aria-label="Open satellite imagery panel"
        >
          <Satellite className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium">Satellite</span>
          {activeLayer && (
            <span className="px-1.5 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 rounded">
              Active
            </span>
          )}
          {urgentAlertCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
              {urgentAlertCount}
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
        w-64 max-h-[70vh] overflow-hidden
        bg-osint-bg/95 backdrop-blur-sm border border-osint-border
        rounded-lg shadow-lg
        flex flex-col
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-osint-border">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold">Satellite Imagery</span>
        </div>
        <div className="flex items-center gap-1">
          {geeNotReady && (
            <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded">
              Not configured
            </span>
          )}
          {onCollapsedChange && (
            <button
              onClick={() => onCollapsedChange(true)}
              className="p-1 text-osint-muted hover:text-osint-text transition-colors"
              title="Collapse"
              aria-label="Collapse satellite panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Status indicator */}
      {statusLoading ? (
        <div className="px-3 py-2 border-b border-osint-border/50 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
          <span className="text-xs text-osint-muted">Connecting to Earth Engine...</span>
        </div>
      ) : geeNotReady ? (
        <div className="px-3 py-2 border-b border-osint-border/50 bg-yellow-500/10">
          <div className="flex items-start gap-2">
            <Info className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
            <span className="text-[10px] text-yellow-400">
              Google Earth Engine not configured. Add GEE_SERVICE_ACCOUNT_JSON to enable satellite imagery.
            </span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-1.5 border-b border-osint-border/50 flex items-center gap-2">
          <CheckCircle2 className="w-3 h-3 text-green-400" />
          <span className="text-[10px] text-osint-muted">Earth Engine connected</span>
        </div>
      )}

      {/* Date selector */}
      <div className="px-3 py-2 border-b border-osint-border/50">
        <div className="flex items-center gap-2 mb-1.5">
          <Calendar className="w-3.5 h-3.5 text-osint-muted" />
          <span className="text-xs font-medium text-osint-muted uppercase">Imagery Date</span>
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={formatDateInput(selectedDate)}
            onChange={handleDateChange}
            max={new Date().toISOString().split('T')[0]}
            className="flex-1 px-2 py-1 text-xs bg-osint-card border border-osint-border rounded
                       text-osint-text focus:outline-none focus:border-cyan-500"
            disabled={geeNotReady}
          />
          <button
            onClick={resetDate}
            className="px-2 py-1 text-xs bg-osint-card border border-osint-border rounded
                       hover:bg-osint-border transition-colors disabled:opacity-50"
            title="Use latest available"
            disabled={geeNotReady}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="text-[10px] text-osint-muted mt-1">
          Showing: {formatDate(selectedDate)}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Base Imagery */}
        <div className="border-b border-osint-border/50">
          <button
            onClick={() => setShowBaseImagery(!showBaseImagery)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-osint-card/50 transition-colors"
            aria-expanded={showBaseImagery}
          >
            <span className="text-xs font-medium text-osint-muted uppercase">
              {LAYER_CATEGORIES.base.label}
            </span>
            {showBaseImagery ? (
              <ChevronUp className="w-4 h-4 text-osint-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-osint-muted" />
            )}
          </button>

          {showBaseImagery && (
            <div className="px-2 pb-2 space-y-1">
              {LAYER_CATEGORIES.base.layers.map(layer => {
                const info = LAYER_INFO[layer]
                const Icon = LAYER_ICONS[layer]
                const isActive = activeLayer === layer

                return (
                  <button
                    key={layer}
                    onClick={() => toggleLayer(layer)}
                    className={`
                      w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                      transition-colors group
                      ${isActive
                        ? 'bg-cyan-500/20 border border-cyan-500/30'
                        : 'hover:bg-osint-card/50'
                      }
                      ${geeNotReady ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                    disabled={geeNotReady}
                    aria-pressed={isActive}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`
                        w-5 h-5 rounded flex items-center justify-center
                        ${isActive ? 'bg-cyan-500/30' : 'bg-osint-card'}
                      `}>
                        <Icon className={`w-3 h-3 ${isActive ? 'text-cyan-400' : 'text-osint-muted'}`} />
                      </div>
                      <div className="text-left">
                        <div className={isActive ? 'text-cyan-400' : 'text-osint-text'}>
                          {info.name}
                        </div>
                        <div className="text-[10px] text-osint-muted">
                          {info.description}
                        </div>
                      </div>
                    </div>
                    {isActive ? (
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-osint-muted opacity-0 group-hover:opacity-100" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Environmental */}
        <div className="border-b border-osint-border/50">
          <button
            onClick={() => setShowEnvironmental(!showEnvironmental)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-osint-card/50 transition-colors"
            aria-expanded={showEnvironmental}
          >
            <span className="text-xs font-medium text-osint-muted uppercase">
              {LAYER_CATEGORIES.environmental.label}
            </span>
            {showEnvironmental ? (
              <ChevronUp className="w-4 h-4 text-osint-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-osint-muted" />
            )}
          </button>

          {showEnvironmental && (
            <div className="px-2 pb-2 space-y-1">
              {LAYER_CATEGORIES.environmental.layers.map(layer => {
                const info = LAYER_INFO[layer]
                const Icon = LAYER_ICONS[layer]
                const isActive = activeLayer === layer
                const colorClass = layer === 'ndvi' ? 'text-green-400' :
                                   layer === 'temperature' ? 'text-orange-400' :
                                   'text-blue-400'
                const bgClass = layer === 'ndvi' ? 'bg-green-500/20' :
                                layer === 'temperature' ? 'bg-orange-500/20' :
                                'bg-blue-500/20'

                return (
                  <button
                    key={layer}
                    onClick={() => toggleLayer(layer)}
                    className={`
                      w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                      transition-colors group
                      ${isActive
                        ? `${bgClass} border border-current/30`
                        : 'hover:bg-osint-card/50'
                      }
                      ${geeNotReady ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                    disabled={geeNotReady}
                    aria-pressed={isActive}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`
                        w-5 h-5 rounded flex items-center justify-center
                        ${isActive ? bgClass : 'bg-osint-card'}
                      `}>
                        <Icon className={`w-3 h-3 ${isActive ? colorClass : 'text-osint-muted'}`} />
                      </div>
                      <div className="text-left">
                        <div className={isActive ? colorClass : 'text-osint-text'}>
                          {info.name}
                        </div>
                        <div className="text-[10px] text-osint-muted">
                          {info.description}
                        </div>
                      </div>
                    </div>
                    {isActive ? (
                      <Eye className={`w-3.5 h-3.5 ${colorClass}`} />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-osint-muted opacity-0 group-hover:opacity-100" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Disaster Detection */}
        {!compact && (
          <div className="border-b border-osint-border/50">
            <button
              onClick={() => setShowDisaster(!showDisaster)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-osint-card/50 transition-colors"
              aria-expanded={showDisaster}
            >
              <span className="text-xs font-medium text-osint-muted uppercase">
                Disaster Analysis
              </span>
              {showDisaster ? (
                <ChevronUp className="w-4 h-4 text-osint-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-osint-muted" />
              )}
            </button>

            {showDisaster && (
              <div className="px-2 pb-2 space-y-1">
                {/* Flood Extent Layer */}
                <button
                  onClick={() => toggleLayer('flood-extent')}
                  className={`
                    w-full flex items-center justify-between px-2 py-1.5 rounded text-xs
                    transition-colors group
                    ${activeLayer === 'flood-extent'
                      ? 'bg-blue-500/20 border border-blue-500/30'
                      : 'hover:bg-osint-card/50'
                    }
                    ${geeNotReady ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                  disabled={geeNotReady}
                >
                  <div className="flex items-center gap-2">
                    <div className={`
                      w-5 h-5 rounded flex items-center justify-center
                      ${activeLayer === 'flood-extent' ? 'bg-blue-500/30' : 'bg-osint-card'}
                    `}>
                      <Droplets className={`w-3 h-3 ${activeLayer === 'flood-extent' ? 'text-blue-400' : 'text-osint-muted'}`} />
                    </div>
                    <div className="text-left">
                      <div className={activeLayer === 'flood-extent' ? 'text-blue-400' : 'text-osint-text'}>
                        Flood Detection
                      </div>
                      <div className="text-[10px] text-osint-muted">
                        SAR-based water detection
                      </div>
                    </div>
                  </div>
                </button>

                {/* Flood Analysis Button */}
                {onFloodAnalysis && (
                  <button
                    onClick={onFloodAnalysis}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs
                               bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors
                               disabled:opacity-50"
                    disabled={geeNotReady}
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>Run Flood Extent Analysis</span>
                  </button>
                )}

                {/* Landslide Analysis Button */}
                {onLandslideAnalysis && (
                  <button
                    onClick={onLandslideAnalysis}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs
                               bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition-colors
                               disabled:opacity-50"
                    disabled={geeNotReady}
                  >
                    <Mountain className="w-3.5 h-3.5" />
                    <span>Detect Landslides</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* PWTT Damage Analysis */}
        <div className="border-b border-osint-border/50">
          <button
            onClick={handlePWTTToggle}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-osint-card/50 transition-colors"
            aria-expanded={showPWTT}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-osint-muted uppercase">
                PWTT Damage Analysis
              </span>
              {recentAssessments.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                  {recentAssessments.length}
                </span>
              )}
            </div>
            {showPWTT ? (
              <ChevronUp className="w-4 h-4 text-osint-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-osint-muted" />
            )}
          </button>

          {showPWTT && (
            <div className="px-2 pb-2 space-y-2">
              {/* Info about PWTT */}
              <div className="px-2 py-1.5 bg-osint-card/30 rounded text-[10px] text-osint-muted">
                <div className="flex items-start gap-1.5">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-cyan-400" />
                  <span>PWTT (Pairwise T-Test) detects structural changes using before/after satellite imagery comparison.</span>
                </div>
              </div>

              {/* Quick Hotspot Check */}
              <a
                href="/damage-assessment"
                className="w-full flex items-center gap-2 px-2 py-2 rounded text-xs
                           bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors
                           border border-red-500/20"
              >
                <Target className="w-4 h-4" />
                <div className="text-left">
                  <div className="font-medium">Quick Hotspot Checker</div>
                  <div className="text-[10px] text-red-400/70">Click anywhere to analyze damage</div>
                </div>
              </a>

              {/* Create New Assessment */}
              <a
                href="/damage-assessment?new=true"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs
                           bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 transition-colors"
              >
                <FileSearch className="w-3.5 h-3.5" />
                <span>Create New Assessment</span>
              </a>

              {/* Recent Assessments */}
              <div className="pt-1">
                <div className="text-[10px] text-osint-muted uppercase px-2 mb-1">Recent Assessments</div>
                {loadingAssessments ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-osint-muted" />
                  </div>
                ) : recentAssessments.length > 0 ? (
                  <div className="space-y-1">
                    {recentAssessments.map(assessment => (
                      <a
                        key={assessment.id}
                        href={`/damage-assessment/${assessment.id}`}
                        className="flex items-start gap-2 px-2 py-1.5 rounded bg-osint-card/30
                                   hover:bg-osint-card text-xs transition-colors"
                      >
                        <Building2 className="w-3 h-3 mt-0.5 text-osint-muted flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-osint-text truncate">
                            {assessment.event_name}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-osint-muted">
                            {assessment.damage_percentage !== undefined && (
                              <span className={`${
                                assessment.damage_percentage > 50 ? 'text-red-400' :
                                assessment.damage_percentage > 20 ? 'text-orange-400' :
                                'text-yellow-400'
                              }`}>
                                {assessment.damage_percentage.toFixed(1)}% damage
                              </span>
                            )}
                            {assessment.districts && assessment.districts.length > 0 && (
                              <span className="flex items-center gap-0.5">
                                <MapPin className="w-2.5 h-2.5" />
                                {assessment.districts[0]}
                              </span>
                            )}
                          </div>
                        </div>
                      </a>
                    ))}
                    <a
                      href="/damage-assessment"
                      className="flex items-center justify-center gap-1 px-2 py-1.5 rounded
                                 text-[10px] text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                    >
                      View all assessments
                    </a>
                  </div>
                ) : (
                  <div className="text-center py-3 text-[10px] text-osint-muted">
                    No assessments yet
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Change Alerts */}
        {!compact && (
          <div>
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-osint-card/50 transition-colors"
              aria-expanded={showAlerts}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-osint-muted uppercase">
                  Change Alerts
                </span>
                {urgentAlertCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                    {urgentAlertCount}
                  </span>
                )}
              </div>
              {showAlerts ? (
                <ChevronUp className="w-4 h-4 text-osint-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-osint-muted" />
              )}
            </button>

            {showAlerts && (
              <div className="px-2 pb-2 space-y-1">
                {alertsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-osint-muted" />
                  </div>
                ) : alertsData?.alerts && alertsData.alerts.length > 0 ? (
                  <>
                    {alertsData.alerts.slice(0, 5).map(alert => (
                      <div
                        key={alert.id}
                        className="flex items-start gap-2 px-2 py-1.5 rounded bg-osint-card/50 text-xs"
                      >
                        <div className={`w-2 h-2 rounded-full mt-1 ${SEVERITY_COLORS[alert.severity]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-medium capitalize">{alert.detection_type}</span>
                            <span className="text-osint-muted">•</span>
                            <span className="text-osint-muted capitalize">{alert.severity}</span>
                          </div>
                          <div className="text-osint-muted truncate">
                            {alert.description}
                          </div>
                          <div className="text-[10px] text-osint-muted">
                            {new Date(alert.detected_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                    {onViewAlerts && alertsData.alerts.length > 5 && (
                      <button
                        onClick={onViewAlerts}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded
                                   text-xs text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                      >
                        <Bell className="w-3 h-3" />
                        <span>View all {alertsData.total_count} alerts</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4 text-xs text-osint-muted">
                    No recent change alerts
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {activeLayer && (
        <div className="px-3 py-2 border-t border-osint-border bg-osint-card/30">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Eye className="w-3 h-3 text-cyan-400" />
              <span className="text-osint-muted">
                {LAYER_INFO[activeLayer]?.name}
              </span>
            </div>
            <button
              onClick={() => onLayerToggle(null)}
              className="text-osint-accent hover:text-osint-accent/80 transition-colors"
            >
              Hide layer
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default SatelliteImageryPanel
