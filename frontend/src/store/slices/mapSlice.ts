import { create } from 'zustand'
import { getYouthStress, getDistrictThreats, getDistrictMetrics } from '../../api/analytics'
import type { DistrictStress } from '../../types/api'
import { DISTRICTS, type DistrictInfo } from '../../data/districts'
import { getWebSocket, type WebSocketMessage } from '../../api/websocket'

export type MapMetric = 'youth_stress' | 'events' | 'alerts' | 'threat'

// LiveUAMap-style live event for real-time alerts
export interface LiveMapEvent {
  id: string
  type: 'breaking' | 'critical' | 'alert' | 'update'
  title: string
  district: string
  coordinates?: [number, number]
  severity: 'critical' | 'high' | 'medium' | 'low'
  timestamp: Date
  summary?: string
  source?: string
  isNew?: boolean // For animation
}

interface DistrictData extends DistrictInfo {
  value: number
  eventCount?: number
  alertCount?: number
  youthStress?: number
  // Enhanced threat data
  threatLevel?: 'critical' | 'high' | 'medium' | 'low'
  criticalEvents?: number
  highEvents?: number
  mediumEvents?: number
  lowEvents?: number
  topEventType?: string
  // Additional metrics
  riskLevel?: string
  stabilityScore?: number
  crimeScore?: number
  communalScore?: number
  // LiveUAMap: Real-time pulse
  hasCriticalEvent?: boolean
  lastEventTime?: Date
}

interface MapState {
  districts: DistrictData[]
  selectedDistrict: DistrictData | null
  hoveredDistrict: DistrictData | null
  metric: MapMetric
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  // LiveUAMap: Real-time events
  liveEvents: LiveMapEvent[]
  wsConnected: boolean
  latestAlert: LiveMapEvent | null

  // Actions
  setSelectedDistrict: (district: DistrictData | null) => void
  setHoveredDistrict: (district: DistrictData | null) => void
  setMetric: (metric: MapMetric) => void
  fetchDistrictData: (showLoading?: boolean) => Promise<void>
  // LiveUAMap: Real-time actions
  addLiveEvent: (event: LiveMapEvent) => void
  clearLatestAlert: () => void
  subscribeToRealtime: () => () => void
}

// Initialize districts with zero values so map renders immediately
const initialDistricts: DistrictData[] = DISTRICTS.map((district) => ({
  ...district,
  value: 0,
  youthStress: 0,
  eventCount: 0,
  alertCount: 0,
  threatLevel: 'low' as const,
  criticalEvents: 0,
  highEvents: 0,
  mediumEvents: 0,
  lowEvents: 0,
}))

// Max live events to keep in timeline
const MAX_LIVE_EVENTS = 50

export const useMapStore = create<MapState>((set, get) => ({
  districts: initialDistricts,
  selectedDistrict: null,
  hoveredDistrict: null,
  metric: 'youth_stress',
  loading: true, // Start as loading
  error: null,
  lastUpdated: null,
  // LiveUAMap state
  liveEvents: [],
  wsConnected: false,
  latestAlert: null,

  setSelectedDistrict: (district) => set({ selectedDistrict: district }),
  setHoveredDistrict: (district) => set({ hoveredDistrict: district }),
  setMetric: (metric) => set({ metric }),

  // LiveUAMap: Add real-time event
  addLiveEvent: (event) => {
    const { liveEvents, districts } = get()

    // Add to events list (newest first, cap at MAX)
    const updatedEvents = [event, ...liveEvents].slice(0, MAX_LIVE_EVENTS)

    // Update district to show pulse animation for critical events
    let updatedDistricts = districts
    if (event.severity === 'critical' || event.severity === 'high') {
      updatedDistricts = districts.map(d =>
        d.name.toLowerCase() === event.district.toLowerCase()
          ? { ...d, hasCriticalEvent: true, lastEventTime: event.timestamp }
          : d
      )
    }

    set({
      liveEvents: updatedEvents,
      districts: updatedDistricts,
      latestAlert: (event.severity === 'critical' || event.type === 'breaking') ? event : get().latestAlert,
    })

    // Auto-clear pulse after 30 seconds
    if (event.severity === 'critical' || event.severity === 'high') {
      setTimeout(() => {
        const { districts } = get()
        set({
          districts: districts.map(d =>
            d.name.toLowerCase() === event.district.toLowerCase()
              ? { ...d, hasCriticalEvent: false }
              : d
          )
        })
      }, 30000)
    }
  },

  clearLatestAlert: () => set({ latestAlert: null }),

  // Subscribe to WebSocket for real-time updates
  subscribeToRealtime: () => {
    const ws = getWebSocket()

    // Subscribe to districts channel
    ws.subscribe('districts')
    ws.subscribe('alerts')

    // Handle connection state
    const unsubConnection = ws.onConnectionChange((connected) => {
      set({ wsConnected: connected })
    })

    // Handle district updates
    const unsubDistricts = ws.onMessage('districts', (message: WebSocketMessage) => {
      handleDistrictMessage(message, get, set)
    })

    // Handle alert messages
    const unsubAlerts = ws.onMessage('alerts', (message: WebSocketMessage) => {
      handleAlertMessage(message, get, set)
    })

    // Return cleanup function
    return () => {
      unsubConnection()
      unsubDistricts()
      unsubAlerts()
      ws.unsubscribe('districts')
    }
  },

  fetchDistrictData: async (showLoading = true) => {
    // Only show loading spinner on initial load, not refreshes
    if (showLoading) {
      set({ loading: true, error: null })
    }

    // Helper to add timeout to promises
    const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
      const timeout = new Promise<T>((resolve) => {
        setTimeout(() => resolve(fallback), ms)
      })
      return Promise.race([promise, timeout])
    }

    try {
      // Fetch all data sources in parallel with 10s timeout each
      const [stressData, threatData, metricsData] = await Promise.all([
        withTimeout(getYouthStress().catch(() => []), 10000, []),
        withTimeout(getDistrictThreats(24).catch(() => []), 10000, []),
        withTimeout(getDistrictMetrics().catch(() => []), 10000, []),
      ])

      // Create lookup maps for efficient merging
      const stressMap = new Map<string, DistrictStress>()
      stressData.forEach((d) => {
        stressMap.set(d.district.toLowerCase(), d)
      })

      const threatMap = new Map<string, (typeof threatData)[0]>()
      threatData.forEach((d) => {
        threatMap.set(d.district.toLowerCase(), d)
      })

      const metricsMap = new Map<string, (typeof metricsData)[0]>()
      metricsData.forEach((d) => {
        metricsMap.set(d.district.toLowerCase(), d)
      })

      // Merge all data sources with district info - prioritize DistrictMetrics as primary source
      const districtsWithData: DistrictData[] = DISTRICTS.map((district) => {
        const nameKey = district.name.toLowerCase()
        const stress = stressMap.get(nameKey)
        const threat = threatMap.get(nameKey)
        const metrics = metricsMap.get(nameKey)

        // Priority: Use DistrictMetrics data first (seeded data), then Events data
        const riskLevel = metrics?.risk_level ?? threat?.threat_level ?? 'low'

        // Calculate alert count from real data:
        // - Use metrics events_7d if available
        // - Fall back to threat events
        // - Add bonus for high/critical risk levels
        const criticalEvents = threat?.critical_events ?? 0
        const highEvents = threat?.high_events ?? 0
        const riskBonus = riskLevel === 'critical' ? 3 : riskLevel === 'high' ? 2 : 0
        const calculatedAlerts = criticalEvents * 2 + highEvents + riskBonus +
          (metrics && metrics.risk_level === 'critical' ? 5 : metrics?.risk_level === 'high' ? 3 : 0)

        // Calculate youth stress - prioritize DistrictMetrics
        const youthStress = metrics
          ? calculateStressFromMetrics(metrics)
          : stress?.youth_stress ?? 0

        // Get event count from multiple sources
        const eventCount = metrics?.total_events_7d ??
          threat?.total_events ??
          stress?.event_count ??
          0

        return {
          ...district,
          // Primary value used for map coloring based on selected metric
          value: youthStress,
          youthStress,
          // Event counts - prefer metrics data
          eventCount,
          // Alert count calculated from real data
          alertCount: calculatedAlerts,
          // Threat level from metrics (seeded) or threat API
          threatLevel: mapRiskToThreat(riskLevel),
          criticalEvents,
          highEvents,
          mediumEvents: threat?.medium_events ?? 0,
          lowEvents: threat?.low_events ?? 0,
          topEventType: threat?.top_event_type,
          // Additional metrics for detail views
          riskLevel,
          stabilityScore: metrics?.overall_stability_score,
          crimeScore: metrics?.violent_crime_score,
          communalScore: metrics?.communal_tension_score,
        }
      })

      set({
        districts: districtsWithData,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      })
    } catch (err) {
      console.error('Failed to fetch district data:', err)

      // On error, show error state instead of mock data
      // Keep existing data if we have it (for refresh failures)
      const existingDistricts = get().districts

      if (existingDistricts.length > 0) {
        // Keep existing data on refresh failure, just update error state
        set({
          loading: false,
          error: 'Failed to refresh data. Showing last available data.',
        })
      } else {
        // No existing data - show districts with zero values
        const emptyDistricts: DistrictData[] = DISTRICTS.map((district) => ({
          ...district,
          value: 0,
          youthStress: 0,
          eventCount: 0,
          alertCount: 0,
          threatLevel: 'low' as const,
          criticalEvents: 0,
          highEvents: 0,
          mediumEvents: 0,
          lowEvents: 0,
        }))
        set({
          districts: emptyDistricts,
          loading: false,
          error: 'Failed to load district data. Please try again.',
        })
      }
    }
  },
}))

// Helper function to calculate stress from district metrics
function calculateStressFromMetrics(metrics: {
  violent_crime_score?: number
  communal_tension_score?: number
  economic_health_score?: number
  overall_stability_score?: number
}): number {
  // Stress is inverse of stability, weighted toward crime and communal tension
  const crimeWeight = 0.4
  const communalWeight = 0.3
  const economicWeight = 0.15
  const stabilityWeight = 0.15

  const crime = metrics.violent_crime_score ?? 0
  const communal = metrics.communal_tension_score ?? 0
  const economic = 100 - (metrics.economic_health_score ?? 50) // Invert: poor health = stress
  const stability = 100 - (metrics.overall_stability_score ?? 50) // Invert: low stability = stress

  return Math.min(100, Math.max(0,
    crime * crimeWeight +
    communal * communalWeight +
    economic * economicWeight +
    stability * stabilityWeight
  ))
}

// Helper to map risk level string to threat level
function mapRiskToThreat(riskLevel: string): 'critical' | 'high' | 'medium' | 'low' {
  const level = riskLevel?.toLowerCase()
  if (level === 'critical') return 'critical'
  if (level === 'high') return 'high'
  if (level === 'medium') return 'medium'
  return 'low'
}

// WebSocket message handlers for real-time updates
type StoreGet = () => MapState
type StoreSet = (partial: Partial<MapState>) => void

function handleDistrictMessage(message: WebSocketMessage, get: StoreGet, set: StoreSet) {
  const { data, event_type, priority } = message

  // Handle district event updates
  if (event_type === 'new_event' || event_type === 'district_update') {
    const districtName = data.district as string
    const eventTitle = data.title as string || 'New event detected'
    const severity = (priority || data.severity || 'medium') as LiveMapEvent['severity']

    // Create live event
    const liveEvent: LiveMapEvent = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: priority === 'critical' ? 'critical' : event_type === 'new_event' ? 'alert' : 'update',
      title: eventTitle,
      district: districtName,
      coordinates: data.coordinates as [number, number] | undefined,
      severity,
      timestamp: new Date(message.timestamp),
      summary: data.summary as string | undefined,
      source: data.source as string | undefined,
      isNew: true,
    }

    get().addLiveEvent(liveEvent)
  }

  // Handle district stat updates
  if (event_type === 'stats_update') {
    const districtName = (data.district as string)?.toLowerCase()
    const { districts } = get()

    set({
      districts: districts.map(d =>
        d.name.toLowerCase() === districtName
          ? {
              ...d,
              eventCount: (data.event_count as number) ?? d.eventCount,
              threatLevel: mapRiskToThreat((data.threat_level as string) ?? d.threatLevel ?? 'low'),
            }
          : d
      )
    })
  }
}

function handleAlertMessage(message: WebSocketMessage, get: StoreGet, set: StoreSet) {
  const { data, priority } = message

  // Convert alert to live event
  const liveEvent: LiveMapEvent = {
    id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: priority === 'critical' ? 'breaking' : 'alert',
    title: (data.title as string) || (data.headline as string) || 'Alert',
    district: (data.district as string) || (data.location as string) || 'Nepal',
    severity: (priority || 'high') as LiveMapEvent['severity'],
    timestamp: new Date(message.timestamp),
    summary: data.summary as string | undefined,
    source: data.source as string | undefined,
    isNew: true,
  }

  get().addLiveEvent(liveEvent)
}
