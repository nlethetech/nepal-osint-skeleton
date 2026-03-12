/**
 * useMapEvents - React hook for map event data with real-time updates
 * =====================================================================
 *
 * Production-grade hook providing:
 * - Initial data fetching from REST API
 * - Real-time WebSocket updates
 * - Optimistic UI updates
 * - Automatic reconnection handling
 * - Viewport-based filtering
 * - Category/severity filtering
 * - Time range queries
 * - Loading, error, and connection states
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { LatLngBounds } from 'leaflet'
import { connectWebSocket, type WebSocketMessage } from '../api/websocket'
import { transformApiEvents, type MapEvent } from '../components/map/EventMarkersLayer'
import type { IntelligenceCategory, EventSeverity } from '../components/map/EventMarkerIcons'
import { useSettingsStore } from '../store/slices/settingsSlice'
import apiClient from '../api/client'

// =============================================================================
// TYPES
// =============================================================================

export interface MapEventsFilters {
  hours: number
  categories: IntelligenceCategory[]
  severities: EventSeverity[]
  districts: string[]
  bounds?: LatLngBounds
  // Timeline filtering - events up to this time will be shown
  timelineTime?: Date
  // Date range for historical queries (overrides hours)
  fromDate?: Date
  toDate?: Date
}

export interface MapEventsStats {
  total: number
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
  byDistrict: Record<string, number>
}

export interface UseMapEventsOptions {
  /** Initial filters */
  initialFilters?: Partial<MapEventsFilters>
  /** Enable WebSocket real-time updates */
  enableRealtime?: boolean
  /** Auto-refresh interval in ms (0 to disable) */
  refreshInterval?: number
  /** Maximum events to fetch */
  limit?: number
  /** Enable viewport-based filtering */
  enableViewportFiltering?: boolean
}

export interface UseMapEventsResult {
  /** All events in the time range */
  events: MapEvent[]
  /** Events filtered by timeline position (for playback) */
  filteredEvents: MapEvent[]
  /** Loading state */
  isLoading: boolean
  /** Error message if any */
  error: string | null
  /** WebSocket connection state */
  isConnected: boolean
  /** Aggregated statistics */
  stats: MapEventsStats
  /** IDs of new events (for animation) */
  newEventIds: Set<string>
  /** Current filters */
  filters: MapEventsFilters
  /** Update filters */
  setFilters: (filters: Partial<MapEventsFilters>) => void
  /** Update timeline position for filtering */
  setTimelineTime: (time: Date) => void
  /** Manual refresh */
  refresh: () => Promise<void>
  /** Clear new event flags */
  clearNewEvents: () => void
  /** Time range for the current query */
  timeRange: { start: Date; end: Date }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_FILTERS: MapEventsFilters = {
  hours: 6,  // Show last 6 hours by default
  categories: [],
  severities: [],  // Show all severity levels by default - let user filter if needed
  districts: [],
}

const API_BASE = '/map'
const NEW_EVENT_DURATION = 5000 // 5 seconds for "new" animation
const DEFAULT_LIMIT = 200 // Allow more events for better map coverage

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function buildQueryParams(filters: MapEventsFilters, limit: number): URLSearchParams {
  const params = new URLSearchParams()

  // Use from_date/to_date if provided, otherwise use hours
  if (filters.fromDate) {
    params.set('from_date', filters.fromDate.toISOString())
    if (filters.toDate) {
      params.set('to_date', filters.toDate.toISOString())
    }
  } else {
    params.set('hours', (filters.hours || 24).toString())
  }

  params.set('limit', limit.toString())

  // Defensive checks for arrays that might be undefined
  const categories = filters.categories || []
  const severities = filters.severities || []
  const districts = filters.districts || []

  if (categories.length > 0) {
    params.set('categories', categories.join(','))
  }

  if (severities.length > 0) {
    params.set('severities', severities.join(','))
  }

  if (districts.length > 0) {
    params.set('districts', districts.join(','))
  }

  if (filters.bounds) {
    const sw = filters.bounds.getSouthWest()
    const ne = filters.bounds.getNorthEast()
    params.set('bounds', `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`)
  }

  return params
}

function transformWebSocketEvent(message: WebSocketMessage): MapEvent | null {
  const { data, priority, timestamp } = message

  // Extract event data
  const id = (data.id as string) || `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const title = (data.title as string) || (data.headline as string) || 'New Event'
  const district = (data.district as string) || (data.location as string) || 'Unknown'

  // Map category
  let category: IntelligenceCategory = 'GENERAL'
  const eventType = (data.event_type as string) || (data.story_type as string) || ''
  if (eventType.toLowerCase().includes('security') || eventType.toLowerCase().includes('crime')) {
    category = 'SECURITY'
  } else if (eventType.toLowerCase().includes('political')) {
    category = 'POLITICAL'
  } else if (eventType.toLowerCase().includes('economic')) {
    category = 'ECONOMIC'
  } else if (eventType.toLowerCase().includes('disaster') || eventType.toLowerCase().includes('earthquake')) {
    category = 'DISASTER'
  }

  // Map severity
  let severity: EventSeverity = 'LOW'
  if (priority === 'critical') severity = 'CRITICAL'
  else if (priority === 'high') severity = 'HIGH'
  else if (priority === 'normal') severity = 'MEDIUM'

  // Get coordinates from data or use district centroid
  let coordinates: [number, number] | null = null
  if (data.coordinates && Array.isArray(data.coordinates)) {
    coordinates = data.coordinates as [number, number]
  } else if (data.lat && data.lng) {
    coordinates = [data.lng as number, data.lat as number]
  }

  // If no coordinates, return null (will be filtered out)
  if (!coordinates) {
    return null
  }

  return {
    id,
    title,
    category,
    severity,
    timestamp: new Date(timestamp),
    district,
    source_count: 1,
    summary: data.summary as string | undefined,
    story_type: eventType || undefined,
    confidence: 0.7,
    is_consolidated: false,
    coordinates,
    isNew: true,
  }
}

// =============================================================================
// HOOK
// =============================================================================

export function useMapEvents(options: UseMapEventsOptions = {}): UseMapEventsResult {
  const {
    initialFilters = {},
    enableRealtime = true,
    refreshInterval = 60000, // 1 minute
    limit = DEFAULT_LIMIT,  // Use reduced default of 100
    // enableViewportFiltering reserved for future use
  } = options

  // Get province filter from settings store
  const { getSelectedDistricts, isProvinceFilterEnabled, selectedProvinces } = useSettingsStore()

  // State
  const [events, setEvents] = useState<MapEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set())
  const [filters, setFiltersState] = useState<MapEventsFilters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  })
  // Timeline position for playback - defaults to end of range (now)
  const [timelineTime, setTimelineTimeState] = useState<Date>(new Date())

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const newEventTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // WebSocket debouncing - batch updates over 250ms window
  const pendingEventsRef = useRef<MapEvent[]>([])
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Calculate time range for current query
  const timeRange = useMemo(() => {
    if (filters.fromDate) {
      return {
        start: filters.fromDate,
        end: filters.toDate || new Date(),
      }
    }
    const end = new Date()
    const start = new Date(end.getTime() - (filters.hours || 24) * 60 * 60 * 1000)
    return { start, end }
  }, [filters.hours, filters.fromDate, filters.toDate])

  // Filter events based on timeline position (for playback)
  // Shows events from start of range up to current timeline position
  const filteredEvents = useMemo(() => {
    if (!timelineTime) return events

    return events.filter(event => {
      const eventTime = event.timestamp instanceof Date
        ? event.timestamp
        : new Date(event.timestamp)
      // Show events that occurred BEFORE or AT the current timeline position
      return eventTime.getTime() <= timelineTime.getTime()
    })
  }, [events, timelineTime])

  // Calculate stats from filtered events (not all events)
  const stats = useMemo<MapEventsStats>(() => {
    const byCategory: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    const byDistrict: Record<string, number> = {}

    for (const event of filteredEvents) {
      byCategory[event.category] = (byCategory[event.category] || 0) + 1
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1
      if (event.district) {
        byDistrict[event.district] = (byDistrict[event.district] || 0) + 1
      }
    }

    return {
      total: filteredEvents.length,
      byCategory,
      bySeverity,
      byDistrict,
    }
  }, [filteredEvents])

  // Fetch events from API
  const fetchEvents = useCallback(async (showLoading = true) => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    if (showLoading) {
      setIsLoading(true)
    }
    setError(null)

    try {
      // Merge province filter districts with explicit filter districts
      const provinceDistricts = getSelectedDistricts()
      const effectiveFilters = {
        ...filters,
        districts: provinceDistricts.length > 0
          ? provinceDistricts.map(d => d.toLowerCase())
          : filters.districts,
      }

      const params = buildQueryParams(effectiveFilters, limit)
      const response = await apiClient.get(`${API_BASE}/events?${params}`, {
        signal: controller.signal,
      })

      const data = response.data
      const transformedEvents = transformApiEvents(data)

      setEvents(transformedEvents)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Failed to fetch map events:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch events')
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [filters, limit, getSelectedDistricts])

  // Flush pending WebSocket events (debounced batch update)
  const flushPendingEvents = useCallback(() => {
    if (pendingEventsRef.current.length === 0) return

    const eventsToAdd = [...pendingEventsRef.current]
    pendingEventsRef.current = []

    setEvents(prev => {
      // Filter out duplicates
      const existingIds = new Set(prev.map(e => e.id))
      const uniqueNew = eventsToAdd.filter(e => !existingIds.has(e.id))

      if (uniqueNew.length === 0) return prev

      // Add to beginning, maintain limit
      return [...uniqueNew, ...prev].slice(0, limit)
    })

    // Mark all as new for animation
    eventsToAdd.forEach(newEvent => {
      setNewEventIds(prev => new Set(prev).add(newEvent.id))

      // Clear new flag after duration
      const timer = setTimeout(() => {
        setNewEventIds(prev => {
          const next = new Set(prev)
          next.delete(newEvent.id)
          return next
        })
      }, NEW_EVENT_DURATION)

      newEventTimersRef.current.set(newEvent.id, timer)
    })
  }, [limit])

  // Handle WebSocket message with 250ms debouncing
  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    // Story WS payloads do not include coordinates, so we refresh from /map/events
    // to let backend geolocation place them correctly on the map/feed.
    if (message.event_type === 'new_story' || message.event_type === 'new_item') {
      if (wsRefreshTimeoutRef.current) {
        clearTimeout(wsRefreshTimeoutRef.current)
      }
      wsRefreshTimeoutRef.current = setTimeout(() => {
        void fetchEvents(false)
      }, 500)
      return
    }

    // Only process relevant event types
    const relevantTypes = ['new_event', 'district_update', 'alert', 'story_created']
    if (!relevantTypes.includes(message.event_type)) {
      return
    }

    const newEvent = transformWebSocketEvent(message)
    if (!newEvent) return

    // Apply filters
    if (filters.categories.length > 0 && !filters.categories.includes(newEvent.category)) {
      return
    }
    if (filters.severities.length > 0 && !filters.severities.includes(newEvent.severity)) {
      return
    }

    // Apply province filter to real-time events
    const provinceDistricts = getSelectedDistricts()
    const effectiveDistricts = provinceDistricts.length > 0
      ? provinceDistricts.map(d => d.toLowerCase())
      : filters.districts

    if (effectiveDistricts.length > 0 && newEvent.district &&
        !effectiveDistricts.includes(newEvent.district.toLowerCase())) {
      return
    }

    // Queue event for batched update instead of immediate state change
    pendingEventsRef.current.push(newEvent)

    // Debounce flush with 250ms window
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
    }
    flushTimeoutRef.current = setTimeout(flushPendingEvents, 250)
  }, [filters, getSelectedDistricts, flushPendingEvents, fetchEvents])

  // Set up WebSocket connection
  useEffect(() => {
    if (!enableRealtime) return

    const ws = connectWebSocket()

    // Subscribe to relevant channels
    ws.subscribe('districts')
    ws.subscribe('alerts')
    ws.subscribe('feed')

    // Handle connection state
    const unsubConnection = ws.onConnectionChange((connected) => {
      setIsConnected(connected)
    })

    // Handle messages
    const unsubDistricts = ws.onMessage('districts', handleWebSocketMessage)
    const unsubAlerts = ws.onMessage('alerts', handleWebSocketMessage)
    const unsubFeed = ws.onMessage('feed', handleWebSocketMessage)

    // Set initial connection state
    setIsConnected(ws.isConnected())

    return () => {
      unsubConnection()
      unsubDistricts()
      unsubAlerts()
      unsubFeed()
    }
  }, [enableRealtime, handleWebSocketMessage])

  // Initial fetch and refresh interval
  useEffect(() => {
    fetchEvents(true)

    // Set up refresh interval
    if (refreshInterval > 0) {
      refreshTimerRef.current = setInterval(() => {
        fetchEvents(false) // Silent refresh
      }, refreshInterval)
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      // Clear WebSocket debounce timeout
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
      }
      if (wsRefreshTimeoutRef.current) {
        clearTimeout(wsRefreshTimeoutRef.current)
      }
      // Clear all new event timers
      newEventTimersRef.current.forEach(timer => clearTimeout(timer))
      newEventTimersRef.current.clear()
    }
  }, [fetchEvents, refreshInterval])

  // Refetch when province filter changes
  useEffect(() => {
    // Skip initial mount (handled by fetchEvents effect above)
    const timeoutId = setTimeout(() => {
      fetchEvents(true)
    }, 0)
    return () => clearTimeout(timeoutId)
    // Only re-run when province filter state changes
  }, [isProvinceFilterEnabled, selectedProvinces])

  // Update filters (with defensive checks to prevent undefined arrays)
  const setFilters = useCallback((newFilters: Partial<MapEventsFilters>) => {
    setFiltersState(prev => ({
      ...prev,
      ...newFilters,
      // Ensure arrays are never undefined
      categories: newFilters.categories ?? prev.categories ?? [],
      severities: newFilters.severities ?? prev.severities ?? [],
      districts: newFilters.districts ?? prev.districts ?? [],
      hours: newFilters.hours ?? prev.hours ?? 24,
    }))
  }, [])

  // Update timeline position for playback filtering
  const setTimelineTime = useCallback((time: Date) => {
    setTimelineTimeState(time)
  }, [])

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetchEvents(true)
  }, [fetchEvents])

  // Clear new events
  const clearNewEvents = useCallback(() => {
    setNewEventIds(new Set())
    newEventTimersRef.current.forEach(timer => clearTimeout(timer))
    newEventTimersRef.current.clear()
  }, [])

  return {
    events,
    filteredEvents,
    isLoading,
    error,
    isConnected,
    stats,
    newEventIds,
    filters,
    setFilters,
    setTimelineTime,
    refresh,
    clearNewEvents,
    timeRange,
  }
}

export default useMapEvents
