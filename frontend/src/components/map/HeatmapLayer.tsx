/**
 * HeatmapLayer - Activity density visualization
 * =============================================
 *
 * Shows event density heatmap using Leaflet.heat:
 * - Intensity based on event count + severity weighting
 * - Critical events = 3x weight, High = 2x, Medium = 1x, Low = 0.5x
 * - Configurable radius and blur
 * - Toggle visibility via props
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.heat'
import type { Map as LeafletMap } from 'leaflet'
import type { MapEvent } from './EventMarkersLayer'
import type { EventSeverity } from './EventMarkerIcons'

// Extend Leaflet types to include heat layer
declare module 'leaflet' {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: HeatMapOptions
  ): HeatLayer

  interface HeatMapOptions {
    minOpacity?: number
    maxZoom?: number
    max?: number
    radius?: number
    blur?: number
    gradient?: { [key: number]: string }
  }

  interface HeatLayer extends Layer {
    setLatLngs(latlngs: Array<[number, number, number?]>): this
    addLatLng(latlng: [number, number, number?]): this
    setOptions(options: HeatMapOptions): this
    redraw(): this
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface HeatmapLayerProps {
  /** Leaflet map instance */
  map: LeafletMap | null
  /** Array of events to visualize */
  events: MapEvent[]
  /** Whether the layer is visible */
  visible?: boolean
  /** Heatmap radius (default: 25) */
  radius?: number
  /** Heatmap blur (default: 15) */
  blur?: number
  /** Maximum intensity value (default: auto-calculated) */
  maxIntensity?: number
  /** Minimum opacity (default: 0.3) */
  minOpacity?: number
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Severity weights for intensity calculation */
const SEVERITY_WEIGHTS: Record<EventSeverity, number> = {
  CRITICAL: 3.0,
  HIGH: 2.0,
  MEDIUM: 1.0,
  LOW: 0.5,
}

/** Default heatmap gradient (blue -> yellow -> red) */
const DEFAULT_GRADIENT: { [key: number]: string } = {
  0.0: '#0000ff00', // Transparent blue
  0.2: '#0066ff80', // Light blue
  0.4: '#00ff6680', // Green
  0.6: '#ffff00a0', // Yellow
  0.8: '#ff6600c0', // Orange
  1.0: '#ff0000e0', // Red
}

/** Professional OSINT gradient (dark theme optimized) */
const OSINT_GRADIENT: { [key: number]: string } = {
  0.0: 'rgba(59, 130, 246, 0)',     // Transparent
  0.2: 'rgba(59, 130, 246, 0.3)',   // Blue (cool/low)
  0.4: 'rgba(34, 197, 94, 0.4)',    // Green (medium-low)
  0.5: 'rgba(234, 179, 8, 0.5)',    // Yellow (medium)
  0.7: 'rgba(249, 115, 22, 0.6)',   // Orange (high)
  0.85: 'rgba(239, 68, 68, 0.7)',   // Red (critical)
  1.0: 'rgba(239, 68, 68, 0.85)',   // Bright red (max)
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Convert events to heatmap data points with weighted intensity
 */
function eventsToHeatData(events: MapEvent[]): Array<[number, number, number]> {
  return events.map(event => {
    const [lng, lat] = event.coordinates
    const weight = SEVERITY_WEIGHTS[event.severity] || 1.0
    return [lat, lng, weight]
  })
}

/**
 * Calculate max intensity for normalization
 */
function calculateMaxIntensity(events: MapEvent[]): number {
  if (events.length === 0) return 1

  // Use max possible intensity as reference
  const maxWeight = Math.max(...events.map(e => SEVERITY_WEIGHTS[e.severity] || 1))
  // Scale based on cluster density expectation
  return Math.max(maxWeight * 2, 5)
}

// =============================================================================
// COMPONENT
// =============================================================================

export function HeatmapLayer({
  map,
  events,
  visible = true,
  radius = 25,
  blur = 15,
  maxIntensity,
  minOpacity = 0.3,
}: HeatmapLayerProps) {
  const heatLayerRef = useRef<L.HeatLayer | null>(null)

  // Consolidated single useEffect for heatmap layer management
  // Fixes double-init issue from previously having two separate effects
  useEffect(() => {
    if (!map) return

    // Remove existing layer if any
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current)
      heatLayerRef.current = null
    }

    // Don't create layer if not visible or no events
    if (!visible || events.length === 0) return

    // Convert events to heat data
    const heatData = eventsToHeatData(events)
    const calculatedMax = maxIntensity ?? calculateMaxIntensity(events)

    // Create heat layer
    const heatLayer = L.heatLayer(heatData, {
      radius,
      blur,
      maxZoom: 15,
      max: calculatedMax,
      minOpacity,
      gradient: OSINT_GRADIENT,
    })

    heatLayer.addTo(map)
    heatLayerRef.current = heatLayer

    return () => {
      if (heatLayerRef.current && map) {
        map.removeLayer(heatLayerRef.current)
        heatLayerRef.current = null
      }
    }
  }, [map, events, visible, radius, blur, maxIntensity, minOpacity])

  // No visual output - this is a layer manager
  return null
}

export default HeatmapLayer
