/**
 * EventMarkersLayer - Clustered event markers for LiveUAMap
 * ===========================================================
 *
 * Production-grade marker layer with Leaflet.markercluster:
 * - Smart clustering with category breakdown
 * - Custom icons based on category and severity
 * - Real-time marker updates with animations
 * - Click handlers for event selection
 * - Optimized rendering with proper cleanup
 * - Accessibility support
 */

import { useEffect, useRef, useCallback, memo } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { Map as LeafletMap, MarkerClusterGroup } from 'leaflet'

import {
  createEventMarkerIcon,
  createClusterIcon,
  injectMarkerStyles,
  type IntelligenceCategory,
  type EventSeverity,
  type ClusterIconOptions,
} from './EventMarkerIcons'

// =============================================================================
// TYPES
// =============================================================================

/** Map event from API */
export interface MapEvent {
  id: string
  title: string
  category: IntelligenceCategory
  severity: EventSeverity
  timestamp: Date | string
  district?: string
  province?: string
  source_count: number
  summary?: string
  story_type?: string
  confidence: number
  is_consolidated: boolean
  // Coordinates (GeoJSON format: [lng, lat])
  coordinates: [number, number]
  // Original news source URL (for non-consolidated events)
  source_url?: string
  // Client-side flags
  isNew?: boolean
  isSelected?: boolean
}

export interface EventMarkersLayerProps {
  /** Leaflet map instance */
  map: LeafletMap | null
  /** Array of events to display */
  events: MapEvent[]
  /** Currently selected event ID */
  selectedEventId?: string | null
  /** Event IDs that are new (for animation) */
  newEventIds?: Set<string>
  /** Whether the layer is visible */
  visible?: boolean
  /** Callback when an event is clicked */
  onEventClick?: (event: MapEvent) => void
  /** Callback when an event is hovered */
  onEventHover?: (event: MapEvent | null) => void
  /** Callback when a cluster is clicked - receives all events in cluster */
  onClusterClick?: (events: MapEvent[]) => void
  /** Maximum zoom level to cluster at */
  maxClusterZoom?: number
  /** Whether to animate cluster changes */
  animateClusterChanges?: boolean
  /** Disable clustering entirely */
  disableClustering?: boolean
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Cluster options - clean, no spiderfy, smooth transitions */
const DEFAULT_CLUSTER_OPTIONS: L.MarkerClusterGroupOptions = {
  maxClusterRadius: 60,  // Larger radius = fewer markers = better performance
  spiderfyOnMaxZoom: false,
  spiderfyOnEveryZoom: false,
  spiderfyDistanceMultiplier: 0,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,  // We handle cluster clicks manually via sidebar
  disableClusteringAtZoom: 14,  // Higher = more clustering = better performance
  animate: false,  // Disable cluster animations to prevent glitchy transitions
  animateAddingMarkers: false,
  removeOutsideVisibleBounds: true,
  chunkedLoading: true,
  chunkInterval: 100,  // Slower chunking = smoother UI
  chunkDelay: 25,
  chunkProgress: undefined,  // Disable progress callback
  singleMarkerMode: false,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract cluster data from markers for custom icon
 */
function extractClusterData(markers: L.Marker[]): ClusterIconOptions {
  const categoryBreakdown: Partial<Record<IntelligenceCategory, number>> = {}
  let maxSeverity: EventSeverity = 'LOW'
  const severityOrder: EventSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

  for (const marker of markers) {
    const event = (marker as L.Marker & { eventData?: MapEvent }).eventData
    if (!event) continue

    // Count categories
    categoryBreakdown[event.category] = (categoryBreakdown[event.category] || 0) + 1

    // Track max severity
    const eventSeverityIndex = severityOrder.indexOf(event.severity)
    const maxSeverityIndex = severityOrder.indexOf(maxSeverity)
    if (eventSeverityIndex > maxSeverityIndex) {
      maxSeverity = event.severity
    }
  }

  return {
    count: markers.length,
    categoryBreakdown,
    maxSeverity,
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export const EventMarkersLayer = memo(function EventMarkersLayer({
  map,
  events,
  selectedEventId,
  newEventIds = new Set(),
  visible = true,
  onEventClick,
  onEventHover,
  onClusterClick,
  maxClusterZoom = 11,
  animateClusterChanges = true,
  disableClustering = false,
}: EventMarkersLayerProps) {
  // Refs
  const clusterGroupRef = useRef<MarkerClusterGroup | null>(null)
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map())
  const initializedRef = useRef(false)
  const onClusterClickRef = useRef(onClusterClick)
  onClusterClickRef.current = onClusterClick

  // Inject CSS styles on mount
  useEffect(() => {
    injectMarkerStyles()
  }, [])

  // Initialize cluster group
  useEffect(() => {
    if (!map || initializedRef.current) return

    // Create cluster group with custom icon function
    const clusterGroup = L.markerClusterGroup({
      ...DEFAULT_CLUSTER_OPTIONS,
      disableClusteringAtZoom: disableClustering ? 0 : maxClusterZoom,
      animate: animateClusterChanges,
      iconCreateFunction: (cluster) => {
        const markers = cluster.getAllChildMarkers()
        const clusterData = extractClusterData(markers)
        return createClusterIcon(clusterData)
      },
    })

    // Handle cluster click - open sidebar or zoom to bounds
    clusterGroup.on('clusterclick', (e: L.LeafletEvent) => {
      const cluster = (e as any).layer
      if (!cluster || typeof cluster.getAllChildMarkers !== 'function') return

      const childMarkers = cluster.getAllChildMarkers()
      const clusterEvents: MapEvent[] = childMarkers
        .map((marker: L.Marker) => (marker as L.Marker & { eventData?: MapEvent }).eventData)
        .filter((event: MapEvent | undefined): event is MapEvent => !!event)

      if (onClusterClickRef.current && clusterEvents.length > 0) {
        // Open sidebar with cluster events
        onClusterClickRef.current(clusterEvents)
      } else if (map) {
        // Fallback: zoom to cluster bounds
        const bounds = cluster.getBounds()
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
      }
    })

    clusterGroup.addTo(map)
    clusterGroupRef.current = clusterGroup
    initializedRef.current = true

    // Cleanup on unmount
    return () => {
      if (clusterGroupRef.current && map) {
        map.removeLayer(clusterGroupRef.current)
        clusterGroupRef.current = null
        markersMapRef.current.clear()
        initializedRef.current = false
      }
    }
  }, [map, disableClustering, maxClusterZoom, animateClusterChanges])

  // Create click handler
  const handleMarkerClick = useCallback((event: MapEvent) => {
    if (onEventClick) {
      onEventClick(event)
    }
  }, [onEventClick])


  // Update markers when events change
  useEffect(() => {
    if (!clusterGroupRef.current || !map) return

    const clusterGroup = clusterGroupRef.current
    const currentMarkers = markersMapRef.current
    const eventIds = new Set(events.map(e => e.id))

    // Remove markers for events that no longer exist
    const markersToRemove: L.Marker[] = []
    currentMarkers.forEach((marker, id) => {
      if (!eventIds.has(id)) {
        markersToRemove.push(marker)
        currentMarkers.delete(id)
      }
    })

    if (markersToRemove.length > 0) {
      clusterGroup.removeLayers(markersToRemove)
    }

    // Add or update markers
    const markersToAdd: L.Marker[] = []

    for (const event of events) {
      const existingMarker = currentMarkers.get(event.id)
      const isNew = newEventIds.has(event.id)
      const isSelected = selectedEventId === event.id

      // Check if event is fresh (less than 1 hour old)
      const eventTime = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp)
      const isFresh = (Date.now() - eventTime.getTime()) < 3600000 // 1 hour in ms

      if (existingMarker) {
        // Update existing marker if selection changed
        const markerEvent = (existingMarker as L.Marker & { eventData: MapEvent }).eventData
        if (markerEvent.isSelected !== isSelected || markerEvent.isNew !== isNew) {
          // Update icon
          const newIcon = createEventMarkerIcon({
            category: event.category,
            severity: event.severity,
            size: isSelected ? 'large' : 'medium',
            isNew,
            isSelected,
            sourceCount: event.source_count,
            confidence: event.confidence,
            isFresh,
          })
          existingMarker.setIcon(newIcon)

          // Update stored event data
          ;(existingMarker as L.Marker & { eventData: MapEvent }).eventData = {
            ...event,
            isNew,
            isSelected,
          }
        }
      } else {
        // Create new marker
        const [lng, lat] = event.coordinates
        const marker = L.marker([lat, lng], {
          icon: createEventMarkerIcon({
            category: event.category,
            severity: event.severity,
            size: isSelected ? 'large' : 'medium',
            isNew,
            isSelected,
            sourceCount: event.source_count,
            confidence: event.confidence,
            isFresh,
          }),
          alt: `${event.category} event: ${event.title}`,
        })

        // Store event data on marker
        ;(marker as L.Marker & { eventData: MapEvent }).eventData = {
          ...event,
          isNew,
          isSelected,
        }

        // Click to view details in sidebar (no hover tooltips - cleaner UX)
        marker.on('click', () => handleMarkerClick(event))

        markersToAdd.push(marker)
        currentMarkers.set(event.id, marker)
      }
    }

    // Add new markers in batch
    if (markersToAdd.length > 0) {
      clusterGroup.addLayers(markersToAdd)
    }
  }, [
    events,
    selectedEventId,
    newEventIds,
    map,
    handleMarkerClick,
  ])

  // Handle visibility changes
  useEffect(() => {
    if (!clusterGroupRef.current || !map) return

    if (visible) {
      if (!map.hasLayer(clusterGroupRef.current)) {
        clusterGroupRef.current.addTo(map)
      }
    } else {
      if (map.hasLayer(clusterGroupRef.current)) {
        map.removeLayer(clusterGroupRef.current)
      }
    }
  }, [visible, map])

  // Component renders nothing - markers are added directly to the map
  return null
})

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Weighted keyword scoring for category inference.
 * Each keyword has a weight (1-3): higher = stronger signal.
 * The category with the highest total score wins.
 */
interface CategoryKeywords {
  keywords: Array<{ word: string; weight: number }>
}

const CATEGORY_KEYWORDS: Record<Exclude<IntelligenceCategory, 'GENERAL'>, CategoryKeywords> = {
  SECURITY: {
    keywords: [
      // Strong signals (weight 3) - unambiguous security terms
      { word: 'murder', weight: 3 }, { word: 'robbery', weight: 3 },
      { word: 'homicide', weight: 3 }, { word: 'terrorism', weight: 3 },
      { word: 'terror', weight: 3 }, { word: 'kidnap', weight: 3 },
      { word: 'abduct', weight: 3 }, { word: 'gunfire', weight: 3 },
      { word: 'bombing', weight: 3 }, { word: 'explosive', weight: 3 },
      { word: 'stabbing', weight: 3 }, { word: 'shooting', weight: 3 },
      { word: 'ambush', weight: 3 }, { word: 'smuggling', weight: 3 },
      { word: 'trafficking', weight: 3 }, { word: 'armed', weight: 3 },
      // Medium signals (weight 2) - likely security
      { word: 'police', weight: 2 }, { word: 'arrest', weight: 2 },
      { word: 'crime', weight: 2 }, { word: 'criminal', weight: 2 },
      { word: 'violence', weight: 2 }, { word: 'attack', weight: 2 },
      { word: 'conflict', weight: 2 }, { word: 'military', weight: 2 },
      { word: 'army', weight: 2 }, { word: 'weapon', weight: 2 },
      { word: 'drug', weight: 2 }, { word: 'seized', weight: 2 },
      { word: 'custody', weight: 2 }, { word: 'detained', weight: 2 },
      { word: 'suspect', weight: 2 }, { word: 'investigation', weight: 2 },
      { word: 'raid', weight: 2 }, { word: 'security', weight: 2 },
      { word: 'theft', weight: 2 }, { word: 'rape', weight: 2 },
      { word: 'assault', weight: 2 }, { word: 'fugitive', weight: 2 },
      // Weak signals (weight 1) - could be security context
      { word: 'border', weight: 1 }, { word: 'patrol', weight: 1 },
      { word: 'jail', weight: 1 }, { word: 'prison', weight: 1 },
      { word: 'warrant', weight: 1 }, { word: 'accused', weight: 1 },
    ],
  },
  POLITICAL: {
    keywords: [
      // Strong signals (weight 3)
      { word: 'election', weight: 3 }, { word: 'parliament', weight: 3 },
      { word: 'constituency', weight: 3 }, { word: 'ballot', weight: 3 },
      { word: 'candidacy', weight: 3 }, { word: 'candidate', weight: 3 },
      { word: 'nomination', weight: 3 }, { word: 'legislature', weight: 3 },
      { word: 'coalition', weight: 3 }, { word: 'opposition', weight: 3 },
      { word: 'impeach', weight: 3 },
      // Medium signals (weight 2) - Nepal-specific political entities
      { word: 'minister', weight: 2 }, { word: 'government', weight: 2 },
      { word: 'congress', weight: 2 }, { word: 'communist', weight: 2 },
      { word: 'uml', weight: 2 }, { word: 'maoist', weight: 2 },
      { word: 'rsp', weight: 2 }, { word: 'political', weight: 2 },
      { word: 'deuba', weight: 2 }, { word: 'prachanda', weight: 2 },
      { word: 'oli', weight: 2 }, { word: 'lamichhane', weight: 2 },
      { word: 'prime minister', weight: 2 }, { word: 'cabinet', weight: 2 },
      { word: 'legislation', weight: 2 }, { word: 'bill passed', weight: 2 },
      { word: 'ordinance', weight: 2 }, { word: 'speaker', weight: 2 },
      // Weak signals (weight 1)
      { word: 'party', weight: 1 }, { word: 'vote', weight: 1 },
      { word: 'policy', weight: 1 }, { word: 'diplomatic', weight: 1 },
      { word: 'ambassador', weight: 1 }, { word: 'treaty', weight: 1 },
    ],
  },
  DISASTER: {
    keywords: [
      // Strong signals (weight 3) - unambiguous disasters
      { word: 'earthquake', weight: 3 }, { word: 'flood', weight: 3 },
      { word: 'landslide', weight: 3 }, { word: 'tsunami', weight: 3 },
      { word: 'avalanche', weight: 3 }, { word: 'cyclone', weight: 3 },
      { word: 'tornado', weight: 3 }, { word: 'volcanic', weight: 3 },
      { word: 'disaster', weight: 3 }, { word: 'seismic', weight: 3 },
      { word: 'devastat', weight: 3 }, { word: 'casualties', weight: 3 },
      // Medium signals (weight 2)
      { word: 'emergency', weight: 2 }, { word: 'rescue', weight: 2 },
      { word: 'evacuat', weight: 2 }, { word: 'relief', weight: 2 },
      { word: 'storm', weight: 2 }, { word: 'fire', weight: 2 },
      { word: 'blaze', weight: 2 }, { word: 'wildfire', weight: 2 },
      { word: 'accident', weight: 2 }, { word: 'crash', weight: 2 },
      { word: 'derail', weight: 2 }, { word: 'collapse', weight: 2 },
      { word: 'buried', weight: 2 }, { word: 'swept away', weight: 2 },
      { word: 'submerge', weight: 2 }, { word: 'displaced', weight: 2 },
      // Weak signals (weight 1)
      { word: 'damage', weight: 1 }, { word: 'destroy', weight: 1 },
      { word: 'victim', weight: 1 }, { word: 'death toll', weight: 1 },
    ],
  },
  ECONOMIC: {
    keywords: [
      // Strong signals (weight 3)
      { word: 'nepse', weight: 3 }, { word: 'stock market', weight: 3 },
      { word: 'gdp', weight: 3 }, { word: 'inflation', weight: 3 },
      { word: 'fiscal', weight: 3 }, { word: 'monetary', weight: 3 },
      { word: 'remittance', weight: 3 }, { word: 'export', weight: 3 },
      { word: 'import', weight: 3 }, { word: 'revenue', weight: 3 },
      // Medium signals (weight 2)
      { word: 'economic', weight: 2 }, { word: 'market', weight: 2 },
      { word: 'trade', weight: 2 }, { word: 'business', weight: 2 },
      { word: 'bank', weight: 2 }, { word: 'investment', weight: 2 },
      { word: 'budget', weight: 2 }, { word: 'tax', weight: 2 },
      { word: 'rupee', weight: 2 }, { word: 'stock', weight: 2 },
      { word: 'commerce', weight: 2 }, { word: 'industry', weight: 2 },
      { word: 'subsidy', weight: 2 }, { word: 'tariff', weight: 2 },
      { word: 'entrepreneur', weight: 2 },
      // Weak signals (weight 1)
      { word: 'price', weight: 1 }, { word: 'cost', weight: 1 },
      { word: 'profit', weight: 1 }, { word: 'loan', weight: 1 },
      { word: 'debt', weight: 1 },
    ],
  },
  SOCIAL: {
    keywords: [
      // Strong signals (weight 3)
      { word: 'protest', weight: 3 }, { word: 'demonstration', weight: 3 },
      { word: 'strike', weight: 3 }, { word: 'bandh', weight: 3 },
      { word: 'chakka jam', weight: 3 }, { word: 'hartal', weight: 3 },
      { word: 'rally', weight: 3 }, { word: 'march', weight: 3 },
      // Medium signals (weight 2)
      { word: 'rights', weight: 2 }, { word: 'movement', weight: 2 },
      { word: 'activist', weight: 2 }, { word: 'discrimination', weight: 2 },
      { word: 'inequality', weight: 2 }, { word: 'caste', weight: 2 },
      { word: 'dalit', weight: 2 }, { word: 'gender', weight: 2 },
      { word: 'feminism', weight: 2 }, { word: 'lgbtq', weight: 2 },
      { word: 'ethnic', weight: 2 }, { word: 'indigenous', weight: 2 },
      { word: 'janajati', weight: 2 }, { word: 'labor', weight: 2 },
      { word: 'labour', weight: 2 }, { word: 'union', weight: 2 },
      // Weak signals (weight 1)
      { word: 'social', weight: 1 }, { word: 'community', weight: 1 },
      { word: 'cultural', weight: 1 }, { word: 'festival', weight: 1 },
      { word: 'tradition', weight: 1 },
    ],
  },
  INFRASTRUCTURE: {
    keywords: [
      // Strong signals (weight 3)
      { word: 'highway', weight: 3 }, { word: 'airport', weight: 3 },
      { word: 'hydropower', weight: 3 }, { word: 'dam', weight: 3 },
      { word: 'tunnel', weight: 3 }, { word: 'railway', weight: 3 },
      { word: 'expressway', weight: 3 },
      // Medium signals (weight 2)
      { word: 'infrastructure', weight: 2 }, { word: 'road', weight: 2 },
      { word: 'bridge', weight: 2 }, { word: 'construction', weight: 2 },
      { word: 'electricity', weight: 2 }, { word: 'power grid', weight: 2 },
      { word: 'water supply', weight: 2 }, { word: 'sewage', weight: 2 },
      { word: 'irrigation', weight: 2 }, { word: 'telecom', weight: 2 },
      { word: 'broadband', weight: 2 }, { word: 'fiber optic', weight: 2 },
      // Weak signals (weight 1)
      { word: 'building', weight: 1 }, { word: 'project', weight: 1 },
      { word: 'development', weight: 1 }, { word: 'power', weight: 1 },
    ],
  },
  HEALTH: {
    keywords: [
      // Strong signals (weight 3)
      { word: 'epidemic', weight: 3 }, { word: 'pandemic', weight: 3 },
      { word: 'outbreak', weight: 3 }, { word: 'covid', weight: 3 },
      { word: 'dengue', weight: 3 }, { word: 'cholera', weight: 3 },
      { word: 'malaria', weight: 3 }, { word: 'tuberculosis', weight: 3 },
      { word: 'vaccination', weight: 3 }, { word: 'vaccine', weight: 3 },
      // Medium signals (weight 2)
      { word: 'hospital', weight: 2 }, { word: 'health', weight: 2 },
      { word: 'medical', weight: 2 }, { word: 'disease', weight: 2 },
      { word: 'doctor', weight: 2 }, { word: 'patient', weight: 2 },
      { word: 'clinic', weight: 2 }, { word: 'surgery', weight: 2 },
      { word: 'infection', weight: 2 }, { word: 'diagnosis', weight: 2 },
      { word: 'medicine', weight: 2 }, { word: 'pharmaceutical', weight: 2 },
      // Weak signals (weight 1)
      { word: 'treatment', weight: 1 }, { word: 'symptom', weight: 1 },
      { word: 'mental health', weight: 1 },
    ],
  },
  ENVIRONMENT: {
    keywords: [
      // Strong signals (weight 3)
      { word: 'deforestation', weight: 3 }, { word: 'climate change', weight: 3 },
      { word: 'global warming', weight: 3 }, { word: 'endangered species', weight: 3 },
      { word: 'poaching', weight: 3 }, { word: 'national park', weight: 3 },
      { word: 'conservation', weight: 3 },
      // Medium signals (weight 2)
      { word: 'environment', weight: 2 }, { word: 'climate', weight: 2 },
      { word: 'forest', weight: 2 }, { word: 'wildlife', weight: 2 },
      { word: 'pollution', weight: 2 }, { word: 'biodiversity', weight: 2 },
      { word: 'ecosystem', weight: 2 }, { word: 'glacier', weight: 2 },
      { word: 'carbon', weight: 2 }, { word: 'emission', weight: 2 },
      { word: 'renewable', weight: 2 }, { word: 'sustainability', weight: 2 },
      { word: 'air quality', weight: 2 }, { word: 'smog', weight: 2 },
      // Weak signals (weight 1)
      { word: 'nature', weight: 1 }, { word: 'green', weight: 1 },
      { word: 'tree', weight: 1 }, { word: 'river', weight: 1 },
    ],
  },
}

/** Minimum score threshold to classify (prevents weak single-keyword matches) */
const MIN_CLASSIFICATION_SCORE = 2

/**
 * Infer intelligence category using weighted keyword scoring.
 * Scores all categories simultaneously and picks the highest-scoring one.
 * This avoids order-dependent bias and reduces misclassification from generic keywords.
 */
function inferCategory(
  storyType?: string,
  title?: string,
  apiCategory?: string
): IntelligenceCategory {
  // If API already provides a valid non-GENERAL category, use it
  const validCategories: IntelligenceCategory[] = [
    'SECURITY', 'POLITICAL', 'ECONOMIC', 'INFRASTRUCTURE',
    'DISASTER', 'HEALTH', 'SOCIAL', 'ENVIRONMENT'
  ]
  if (apiCategory && validCategories.includes(apiCategory as IntelligenceCategory)) {
    return apiCategory as IntelligenceCategory
  }

  const text = `${storyType || ''} ${title || ''}`.toLowerCase()

  // Score each category
  let bestCategory: IntelligenceCategory = 'GENERAL'
  let bestScore = 0

  for (const [category, config] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0
    for (const { word, weight } of config.keywords) {
      if (text.includes(word)) {
        score += weight
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestCategory = category as IntelligenceCategory
    }
  }

  // Only classify if score meets minimum threshold
  if (bestScore < MIN_CLASSIFICATION_SCORE) {
    return 'GENERAL'
  }

  return bestCategory
}

/**
 * Transform API response to MapEvent array
 */
export function transformApiEvents(
  apiResponse: {
    features: Array<{
      properties: {
        id: string
        title: string
        category: string
        severity: string
        timestamp: string
        district?: string
        province?: string
        source_count: number
        summary?: string
        story_type?: string
        confidence: number
        is_consolidated: boolean
        source_url?: string
      }
      geometry: {
        coordinates: [number, number]
      }
    }>
  }
): MapEvent[] {
  return apiResponse.features.map(feature => ({
    id: feature.properties.id,
    title: feature.properties.title,
    category: inferCategory(
      feature.properties.story_type,
      feature.properties.title,
      feature.properties.category
    ),
    severity: feature.properties.severity as EventSeverity,
    timestamp: new Date(feature.properties.timestamp),
    district: feature.properties.district,
    province: feature.properties.province,
    source_count: feature.properties.source_count,
    summary: feature.properties.summary,
    story_type: feature.properties.story_type,
    confidence: feature.properties.confidence,
    is_consolidated: feature.properties.is_consolidated,
    coordinates: feature.geometry.coordinates,
    source_url: feature.properties.source_url,
  }))
}

export default EventMarkersLayer
