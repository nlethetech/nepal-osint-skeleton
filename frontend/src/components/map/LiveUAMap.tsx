/**
 * LiveUAMap - Main container component for the LiveUAMap-style map
 * ==================================================================
 *
 * Production-grade map view with:
 * - District polygon boundaries
 * - Clustered event markers
 * - Real-time WebSocket updates
 * - Category and severity filtering
 * - Timeline scrubbing with playback
 * - Event detail sidebar
 * - Responsive design
 * - Full keyboard navigation
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Map as MapIcon,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertTriangle,
  Flame,
  ShieldAlert,
  Layers,
  Crosshair,
} from 'lucide-react'

// Components
import { ProvinceBorderLayer } from './ProvinceBorderLayer'
import { EventMarkersLayer, type MapEvent } from './EventMarkersLayer'
import { MapFilterPanel, type MapFilters } from './MapFilterPanel'
import { TimelineSlider, type TimelineBucket } from './TimelineSlider'
import { EventDetailSidebar } from './EventDetailSidebar'
import { ClusterTimelineSidebar } from './ClusterTimelineSidebar'
import { LiveAlertBanner } from './LiveAlertBanner'
import { LiveEventTimeline } from './LiveEventTimeline'
import { MapLegend } from './MapLegend'
import { HeatmapLayer } from './HeatmapLayer'
import { ScaleBar } from './ScaleBar'
import { CurfewOverlay } from './CurfewOverlay'
import { injectMarkerStyles } from './EventMarkerIcons'

// Hooks
import { useMapEvents } from '../../hooks/useMapEvents'

// Store
import { useSettingsStore, PROVINCES } from '../../store/slices/settingsSlice'

// Data
import { DISTRICTS, NEPAL_BOUNDS, getProvinceBounds, normalizeDistrictName } from '../../data/districts'

// Types
import type { IntelligenceCategory, EventSeverity } from './EventMarkerIcons'

// =============================================================================
// TYPES
// =============================================================================

export interface LiveUAMapProps {
  /** Initial time range in hours */
  initialHours?: number
  /** Initial district filter (comma-separated query param support) */
  initialDistricts?: string[]
  /** Enable real-time updates */
  enableRealtime?: boolean
  /** Show filter panel */
  showFilters?: boolean
  /** Show timeline controls */
  showTimeline?: boolean
  /** Show live feed sidebar */
  showLiveFeed?: boolean
  /** External selected event ID */
  selectedEventId?: string
  /** Event selection callback */
  onEventSelect?: (event: MapEvent | null) => void
  /** Full screen mode */
  isFullScreen?: boolean
  /** Full screen toggle callback */
  onFullScreenToggle?: () => void
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_HOURS = 6  // Show last 6 hours
const REFRESH_INTERVAL = 60000 // 1 minute
const TIMELINE_BUCKET_MINUTES = 30

// Base layer options - Light map default (professional news style like Live UA Map)
type BaseLayerType = 'light' | 'minimal' | 'terrain' | 'satellite' | 'dark'

const BASE_LAYERS: Record<BaseLayerType, { name: string; url: string; overlayUrl?: string; attribution: string; maxZoom: number }> = {
  light: {
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
    maxZoom: 19,
  },
  minimal: {
    name: 'Minimal',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
    maxZoom: 19,
  },
  terrain: {
    name: 'Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 18,
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 18,
  },
  dark: {
    name: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© CartoDB © OpenStreetMap',
    maxZoom: 19,
  },
}

// =============================================================================
// COMPONENT
// =============================================================================

export function LiveUAMap({
  initialHours = DEFAULT_HOURS,
  initialDistricts,
  enableRealtime = true,
  showFilters = true,
  showTimeline = true,
  showLiveFeed = true,
  selectedEventId: externalSelectedId,
  onEventSelect,
  isFullScreen = false,
  onFullScreenToggle,
}: LiveUAMapProps) {
  // Refs
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<L.Map | null>(null)

  // State
  const [mapReady, setMapReady] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<MapEvent | null>(null)
  const [clusterEvents, setClusterEvents] = useState<MapEvent[] | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [clusterSidebarOpen, setClusterSidebarOpen] = useState(false)
  const [filtersCollapsed, setFiltersCollapsed] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showCurfews, setShowCurfews] = useState(true)
  const [activeBaseLayer, setActiveBaseLayer] = useState<BaseLayerType>('light')
  const [cursorPosition, setCursorPosition] = useState<{ lat: number; lng: number } | null>(null)
  const baseTileLayerRef = useRef<L.TileLayer | null>(null)
  const labelTileLayerRef = useRef<L.TileLayer | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [legendExpanded, setLegendExpanded] = useState(false)

  // Timeline state
  const [timelineTime, setTimelineTime] = useState(new Date())
  const [isPlaying, setIsPlaying] = useState(false)
  const [timelineBuckets, setTimelineBuckets] = useState<TimelineBucket[]>([])

  // Province filter from settings
  const { selectedProvinces, isProvinceFilterEnabled, getFilterLabel } = useSettingsStore()

  // Use map events hook
  const {
    events,
    filteredEvents,
    isLoading,
    error,
    isConnected,
    stats,
    newEventIds,
    filters,
    setFilters,
    setTimelineTime: updateTimelineTime,
    refresh,
    clearNewEvents,
    timeRange,
  } = useMapEvents({
    initialFilters: {
      hours: initialHours,
      ...(initialDistricts && initialDistricts.length > 0
        ? { districts: initialDistricts.map((d) => d.toLowerCase()) }
        : {}),
    },
    enableRealtime,
    refreshInterval: REFRESH_INTERVAL,
  })

  const initialDistrictKey = useMemo(() => (initialDistricts || []).join('|'), [initialDistricts])

  // Keep URL-driven district filter operational (works on search-param changes too)
  useEffect(() => {
    if (!initialDistricts || initialDistricts.length === 0) {
      setFilters({ districts: [] })
      return
    }
    setFilters({ districts: initialDistricts.map((d) => d.toLowerCase()) })
  }, [initialDistrictKey])

  // Optional: focus map on a single district (premium "jump-to" behavior)
  useEffect(() => {
    if (!mapReady || !leafletMapRef.current) return
    if (!initialDistricts || initialDistricts.length !== 1) return

    const target = initialDistricts[0]
    const info = DISTRICTS.find((d) => normalizeDistrictName(d.name) === normalizeDistrictName(target))
    if (!info) return

    leafletMapRef.current.setView([info.lat, info.lng], 9, { animate: true })
  }, [mapReady, initialDistrictKey])

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || leafletMapRef.current) return

    // Inject marker styles
    injectMarkerStyles()

    // Nepal bounds - restrict map to Nepal only
    const nepalLatLngBounds = L.latLngBounds(
      L.latLng(NEPAL_BOUNDS.bounds.south, NEPAL_BOUNDS.bounds.west),
      L.latLng(NEPAL_BOUNDS.bounds.north, NEPAL_BOUNDS.bounds.east)
    )

    // Create map
    const map = L.map(mapContainerRef.current, {
      center: [NEPAL_BOUNDS.center.lat, NEPAL_BOUNDS.center.lng],
      zoom: NEPAL_BOUNDS.zoom,
      minZoom: NEPAL_BOUNDS.minZoom,
      maxZoom: NEPAL_BOUNDS.maxZoom,
      maxBounds: nepalLatLngBounds,
      maxBoundsViscosity: 1.0,  // Solid bounds - can't drag outside
      zoomControl: false,
      attributionControl: false,
    })

    // Add zoom control
    L.control.zoom({ position: 'topright' }).addTo(map)

    // Add light tile layer (default - professional news style like Live UA Map)
    const baseLayer = BASE_LAYERS.light
    const tileLayer = L.tileLayer(baseLayer.url, {
      maxZoom: baseLayer.maxZoom,
    }).addTo(map)
    baseTileLayerRef.current = tileLayer

    // Label overlay ref (for potential future use)
    labelTileLayerRef.current = null

    // Track cursor position for coordinate display
    map.on('mousemove', (e) => {
      setCursorPosition({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    map.on('mouseout', () => {
      setCursorPosition(null)
    })

    // Add attribution
    L.control.attribution({
      position: 'bottomright',
      prefix: baseLayer.attribution,
    }).addTo(map)

    leafletMapRef.current = map
    setMapReady(true)

    // Cleanup
    return () => {
      map.remove()
      leafletMapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Auto-zoom to selected province(s) when filter changes
  useEffect(() => {
    if (!leafletMapRef.current || !mapReady) return

    if (isProvinceFilterEnabled && selectedProvinces.length < PROVINCES.length) {
      // Get bounds for selected provinces
      const bounds = getProvinceBounds(selectedProvinces)
      if (bounds) {
        leafletMapRef.current.fitBounds(bounds, {
          padding: [20, 20],
          maxZoom: 9,
          animate: true,
          duration: 0.5,
        })
      }
    } else {
      // Reset to Nepal-wide view when filter is disabled
      leafletMapRef.current.setView(
        [NEPAL_BOUNDS.center.lat, NEPAL_BOUNDS.center.lng],
        NEPAL_BOUNDS.zoom,
        { animate: true, duration: 0.5 }
      )
    }
  }, [mapReady, isProvinceFilterEnabled, selectedProvinces])

  // Switch base layer when selection changes
  useEffect(() => {
    if (!leafletMapRef.current || !baseTileLayerRef.current) return

    const map = leafletMapRef.current
    const config = BASE_LAYERS[activeBaseLayer]

    // Remove current base layer
    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current)
    }
    if (labelTileLayerRef.current) {
      map.removeLayer(labelTileLayerRef.current)
    }

    // Add new base layer
    const newBaseLayer = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
    }).addTo(map)
    baseTileLayerRef.current = newBaseLayer

    // Label overlay removed - using clean map styles
  }, [activeBaseLayer])

  // Handle external selected event
  useEffect(() => {
    if (externalSelectedId) {
      const event = events.find(e => e.id === externalSelectedId)
      if (event) {
        setSelectedEvent(event)
        setSidebarOpen(true)
      }
    }
  }, [externalSelectedId, events])

  // Calculate related events (from filtered events based on timeline)
  const relatedEvents = useMemo(() => {
    if (!selectedEvent?.district) return []
    return filteredEvents
      .filter(e => e.district === selectedEvent.district && e.id !== selectedEvent.id)
      .slice(0, 10)
  }, [selectedEvent, filteredEvents])

  // Use timeline range from hook (supports both hours and date range queries)
  const timelineRange = timeRange

  // Initialize timeline position to end of range when data loads
  useEffect(() => {
    if (events.length > 0 && timelineRange.end) {
      setTimelineTime(timelineRange.end)
      updateTimelineTime(timelineRange.end)
    }
  }, [timelineRange.end, events.length, updateTimelineTime])

  // Generate timeline buckets from ALL events (for histogram visualization)
  // Uses all events so the histogram always shows the full picture
  useEffect(() => {
    const duration = timelineRange.end.getTime() - timelineRange.start.getTime()
    const bucketDuration = TIMELINE_BUCKET_MINUTES * 60 * 1000
    const bucketCount = Math.ceil(duration / bucketDuration)

    const buckets: TimelineBucket[] = []
    const start = timelineRange.start.getTime()

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = start + i * bucketDuration
      const bucketEnd = bucketStart + bucketDuration

      // Use ALL events for histogram (not filtered)
      const bucketEvents = events.filter(e => {
        const eventTime = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp)
        const time = eventTime.getTime()
        return time >= bucketStart && time < bucketEnd
      })

      buckets.push({
        timestamp: new Date(bucketStart),
        count: bucketEvents.length,
        critical: bucketEvents.filter(e => e.severity === 'CRITICAL').length,
        high: bucketEvents.filter(e => e.severity === 'HIGH').length,
      })
    }

    setTimelineBuckets(buckets)
  }, [events, timelineRange])

  // Event handlers
  const handleEventClick = useCallback((event: MapEvent) => {
    setSelectedEvent(event)
    setSidebarOpen(true)
    onEventSelect?.(event)
    clearNewEvents()
  }, [onEventSelect, clearNewEvents])

  const handleEventHover = useCallback((_event: MapEvent | null) => {
    // Could add tooltip highlighting in the future
  }, [])

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
    setSelectedEvent(null)
    onEventSelect?.(null)
  }, [onEventSelect])

  const handleClusterClick = useCallback((events: MapEvent[]) => {
    setClusterEvents(events)
    setClusterSidebarOpen(true)
  }, [])

  const handleClusterSidebarClose = useCallback(() => {
    setClusterSidebarOpen(false)
    setClusterEvents(null)
  }, [])

  // Keyboard shortcuts for map controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key.toLowerCase()) {
        case 'h':
          // Toggle heatmap
          setShowHeatmap(prev => !prev)
          break
        case 'f':
          // Toggle filters panel
          setFiltersCollapsed(prev => !prev)
          break
        case 'escape':
          // Close sidebars
          if (sidebarOpen) {
            handleCloseSidebar()
          } else if (clusterSidebarOpen) {
            handleClusterSidebarClose()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarOpen, clusterSidebarOpen, handleCloseSidebar, handleClusterSidebarClose])

  const handleClusterEventClick = useCallback((event: MapEvent) => {
    // Close cluster sidebar and open event detail sidebar
    setClusterSidebarOpen(false)
    setClusterEvents(null)
    handleEventClick(event)
  }, [handleEventClick])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }, [refresh])

  const handleFilterChange = useCallback((newFilters: Partial<MapFilters>) => {
    setFilters({
      categories: newFilters.categories as IntelligenceCategory[] | undefined,
      severities: newFilters.severities as EventSeverity[] | undefined,
      hours: newFilters.hours,
    })
  }, [setFilters])

  const handleTimelineChange = useCallback((time: Date) => {
    setTimelineTime(time)
    // Update the hook's timeline filter to filter events
    updateTimelineTime(time)
  }, [updateTimelineTime])

  const handleViewFullStory = useCallback((eventId: string) => {
    // Navigate to story detail page
    window.open(`/stories/${eventId}`, '_blank')
  }, [])

  // Convert latest critical event to alert format (from filtered events)
  const latestAlert = useMemo(() => {
    const criticalEvent = filteredEvents.find(e =>
      e.severity === 'CRITICAL' && newEventIds.has(e.id)
    )
    if (!criticalEvent) return null

    return {
      id: criticalEvent.id,
      type: 'breaking' as const,
      title: criticalEvent.title,
      district: criticalEvent.district || 'Nepal',
      severity: criticalEvent.severity.toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
      timestamp: criticalEvent.timestamp instanceof Date
        ? criticalEvent.timestamp
        : new Date(criticalEvent.timestamp),
    }
  }, [filteredEvents, newEventIds])

  // Convert filtered events to live feed format (respects timeline position)
  const liveEvents = useMemo(() => {
    return filteredEvents.slice(0, 50).map(e => ({
      id: e.id,
      type: e.category, // Use category for colorful badges
      title: e.title,
      district: e.district || 'Nepal',
      severity: e.severity.toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
      timestamp: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp),
      source: e.story_type,
      source_url: e.source_url, // Include source URL for trustworthiness
      category: e.category, // Pass category
      isNew: newEventIds.has(e.id),
    }))
  }, [filteredEvents, newEventIds])

  return (
    <div className={`relative flex flex-col h-full ${isFullScreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header - Clean white bar like Live UA Map */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
        {/* Left: Brand + Province Tabs */}
        <div className="flex items-center gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">NARADA</span>
            <span className="text-xs text-gray-500 hidden sm:inline">Intelligence Map</span>
          </div>

          {/* Province tabs - Like Live UA Map region tabs */}
          <nav className="flex items-center gap-1">
            <button
              onClick={() => useSettingsStore.getState().selectAllProvinces()}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                !isProvinceFilterEnabled || selectedProvinces.length === PROVINCES.length
                  ? 'bg-red-500 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Nepal
            </button>
            {isProvinceFilterEnabled && selectedProvinces.length < PROVINCES.length && (
              <span className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded">
                {getFilterLabel()}
              </span>
            )}
          </nav>

          {/* Connection status - subtle dot */}
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>{filteredEvents.length} events</span>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-2">
          {/* Base layer dropdown */}
          <div className="relative group">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
              title="Base layer"
            >
              <Layers className="w-4 h-4" />
              <span className="hidden sm:inline">{BASE_LAYERS[activeBaseLayer].name}</span>
            </button>
            <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              {(Object.keys(BASE_LAYERS) as BaseLayerType[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveBaseLayer(key)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                    activeBaseLayer === key ? 'text-blue-600 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  {BASE_LAYERS[key].name}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-5 bg-gray-200" />

          {/* Overlay toggles */}
          <button
            onClick={() => setShowHeatmap(prev => !prev)}
            className={`p-2 rounded transition-colors ${
              showHeatmap ? 'bg-orange-100 text-orange-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Heatmap [H]"
          >
            <Flame className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowCurfews(prev => !prev)}
            className={`p-2 rounded transition-colors ${
              showCurfews ? 'bg-red-100 text-red-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Curfew Alerts"
          >
            <ShieldAlert className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-gray-200" />

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${(isLoading || isRefreshing) ? 'animate-spin' : ''}`} />
          </button>

          {/* Fullscreen */}
          {onFullScreenToggle && (
            <button
              onClick={onFullScreenToggle}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
              title={isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <span className="text-sm text-red-700">{error}</span>
          <button
            onClick={handleRefresh}
            className="ml-auto text-xs text-red-600 hover:text-red-800 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Map container - isolate creates stacking context to prevent z-index leaking to sidebar */}
      <div className="relative flex-1 isolate">
        {/* Leaflet map */}
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Province border highlighting for selected provinces */}
        {mapReady && (
          <ProvinceBorderLayer
            map={leafletMapRef.current}
            selectedProvinces={selectedProvinces}
            isFilterActive={isProvinceFilterEnabled && selectedProvinces.length < PROVINCES.length}
            visible={true}
          />
        )}

        {/* Event markers layer - uses filteredEvents for timeline playback */}
        {mapReady && (
          <EventMarkersLayer
            map={leafletMapRef.current}
            events={filteredEvents}
            selectedEventId={selectedEvent?.id}
            newEventIds={newEventIds}
            visible={true}
            onEventClick={handleEventClick}
            onEventHover={handleEventHover}
            onClusterClick={handleClusterClick}
          />
        )}

        {/* Heatmap layer - activity density visualization */}
        {mapReady && (
          <HeatmapLayer
            map={leafletMapRef.current}
            events={filteredEvents}
            visible={showHeatmap}
            radius={30}
            blur={20}
          />
        )}

        {/* Curfew alerts layer - red markers on districts with active curfews */}
        {mapReady && (
          <CurfewOverlay
            map={leafletMapRef.current}
            visible={showCurfews}
          />
        )}

        {/* Alert banner */}
        {latestAlert && (
          <LiveAlertBanner
            alert={latestAlert}
            onDismiss={() => clearNewEvents()}
            onViewDetails={(event) => {
              // Search in all events (not filtered) to allow clicking on any alert
              const mapEvent = events.find(e => e.id === event.id)
              if (mapEvent) handleEventClick(mapEvent)
            }}
          />
        )}

        {/* Filter panel */}
        {showFilters && (
          <MapFilterPanel
            filters={{
              categories: filters.categories,
              severities: filters.severities,
              hours: filters.hours,
            }}
            categoryCounts={stats.byCategory}
            severityCounts={stats.bySeverity}
            totalCount={stats.total}
            onFiltersChange={handleFilterChange}
            collapsed={filtersCollapsed}
            onCollapsedChange={setFiltersCollapsed}
            floating={true}
            position="top-left"
          />
        )}

        {/* Live feed */}
        {showLiveFeed && (
          <LiveEventTimeline
            events={liveEvents}
            onEventClick={(event) => {
              // Search in all events (not filtered) to allow clicking on any event
              const mapEvent = events.find(e => e.id === event.id)
              if (mapEvent) handleEventClick(mapEvent)
            }}
          />
        )}

        {/* Map legend */}
        <MapLegend
          isExpanded={legendExpanded}
          onExpandedChange={setLegendExpanded}
        />

        {/* Scale bar */}
        {mapReady && (
          <ScaleBar
            map={leafletMapRef.current}
            visible={true}
            position="bottomleft"
          />
        )}

        {/* Loading overlay */}
        {isLoading && !events.length && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-[500]">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
              <span className="text-sm text-gray-600">Loading events...</span>
            </div>
          </div>
        )}
      </div>

      {/* Timeline with enhanced controls */}
      {showTimeline && (
        <div className="px-4 py-2 bg-white/95 backdrop-blur-sm border-t border-gray-200">
          <TimelineSlider
            startTime={timelineRange.start}
            endTime={timelineRange.end}
            currentTime={timelineTime}
            buckets={timelineBuckets}
            onTimeChange={handleTimelineChange}
            onPlayingChange={setIsPlaying}
            isPlaying={isPlaying}
            compact={true}
          />
        </div>
      )}

      {/* Footer - Coordinates and Scale (minimal) */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-white border-t border-gray-200 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="font-medium text-gray-700">NARADA Intel</span>
          <span>Scale 1:{leafletMapRef.current ? Math.round(156543.03 * Math.cos(27.7 * Math.PI / 180) / Math.pow(2, leafletMapRef.current.getZoom())).toLocaleString() : '---'}</span>
        </div>
        <div className="flex items-center gap-4 font-mono">
          {cursorPosition ? (
            <>
              <span className="flex items-center gap-1">
                <Crosshair className="w-3 h-3" />
                {cursorPosition.lat.toFixed(5)}
              </span>
              <span>{cursorPosition.lng.toFixed(5)}</span>
            </>
          ) : (
            <span className="text-gray-400">Hover over map</span>
          )}
        </div>
      </div>

      {/* Event detail sidebar */}
      <EventDetailSidebar
        event={selectedEvent}
        relatedEvents={relatedEvents}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        onEventClick={handleEventClick}
        onViewFull={handleViewFullStory}
      />

      {/* Cluster timeline sidebar */}
      <ClusterTimelineSidebar
        events={clusterEvents || []}
        isOpen={clusterSidebarOpen}
        onClose={handleClusterSidebarClose}
        onEventClick={handleClusterEventClick}
      />
    </div>
  )
}

export default LiveUAMap
