/**
 * SatelliteLayer - Display Google Earth Engine tiles on Leaflet map
 * ==================================================================
 *
 * Renders satellite imagery layers from GEE:
 * - Sentinel-2 RGB/False Color
 * - NDVI vegetation index
 * - Flood extent detection
 * - Temperature and precipitation
 *
 * Uses the backend tile proxy for authentication.
 */

import { useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import {
  type SatelliteLayerType,
  getTileUrl,
} from '../../api/earthEngine'

// =============================================================================
// TYPES
// =============================================================================

export interface SatelliteLayerProps {
  /** Leaflet map instance */
  map: LeafletMap | null
  /** Type of satellite layer to display */
  layerType: SatelliteLayerType
  /** Date for imagery (YYYY-MM-DD), null for latest */
  date?: Date | null
  /** Bounding box for analysis layers (optional) */
  bbox?: string
  /** Layer opacity (0-1) */
  opacity?: number
  /** Z-index for layer ordering */
  zIndex?: number
  /** Whether the layer is visible */
  visible?: boolean
}

// =============================================================================
// LAYER CONFIGURATION
// =============================================================================

/** Attribution text */
const ATTRIBUTION = 'Imagery &copy; <a href="https://earthengine.google.com">Google Earth Engine</a>'

/** Default options by layer type */
const LAYER_OPTIONS: Record<SatelliteLayerType, Partial<L.TileLayerOptions>> = {
  'sentinel2-rgb': {
    maxZoom: 18,
    minZoom: 4,
    opacity: 1,
  },
  'sentinel2-false-color': {
    maxZoom: 18,
    minZoom: 4,
    opacity: 1,
  },
  'ndvi': {
    maxZoom: 16,
    minZoom: 4,
    opacity: 0.8,
  },
  'flood-extent': {
    maxZoom: 16,
    minZoom: 4,
    opacity: 0.7,
  },
  'temperature': {
    maxZoom: 14,
    minZoom: 4,
    opacity: 0.7,
  },
  'precipitation': {
    maxZoom: 14,
    minZoom: 4,
    opacity: 0.7,
  },
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SatelliteLayer({
  map,
  layerType,
  date,
  bbox,
  opacity,
  zIndex = 200,
  visible = true,
}: SatelliteLayerProps) {
  const layerRef = useRef<L.TileLayer | null>(null)

  // Format date for URL
  const dateString = useMemo(() => {
    if (!date) return undefined
    return date.toISOString().split('T')[0]
  }, [date])

  // Build tile URL
  const tileUrl = useMemo(() => {
    return getTileUrl(layerType, dateString, bbox)
  }, [layerType, dateString, bbox])

  // Get layer options
  const layerOptions = useMemo((): L.TileLayerOptions => {
    const defaults = LAYER_OPTIONS[layerType] || {}
    return {
      ...defaults,
      attribution: ATTRIBUTION,
      opacity: opacity ?? defaults.opacity ?? 1,
      zIndex,
      crossOrigin: 'anonymous' as const,
      errorTileUrl: '', // Don't show error tiles
    }
  }, [layerType, opacity, zIndex])

  useEffect(() => {
    if (!map) return

    // Remove existing layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    // Don't add layer if not visible
    if (!visible) return

    // Create new tile layer
    const layer = L.tileLayer(tileUrl, layerOptions)

    // Add error handling
    layer.on('tileerror', (e) => {
      console.warn(`Tile error for ${layerType}:`, e.coords)
    })

    // Add to map
    layer.addTo(map)
    layerRef.current = layer

    return () => {
      if (layerRef.current && map) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [map, tileUrl, layerOptions, visible, layerType])

  // Update opacity when it changes
  useEffect(() => {
    if (layerRef.current && opacity !== undefined) {
      layerRef.current.setOpacity(opacity)
    }
  }, [opacity])

  return null
}

// =============================================================================
// LEGEND COMPONENT
// =============================================================================

export interface SatelliteLegendProps {
  layerType: SatelliteLayerType
  className?: string
}

/** Legend color stops for different layers */
const LEGEND_COLORS: Record<string, { stops: { color: string; label: string }[]; unit?: string }> = {
  'ndvi': {
    stops: [
      { color: '#d73027', label: '-1.0' },
      { color: '#fc8d59', label: '-0.5' },
      { color: '#fee090', label: '0' },
      { color: '#d9ef8b', label: '0.5' },
      { color: '#1a9850', label: '1.0' },
    ],
    unit: 'NDVI',
  },
  'temperature': {
    stops: [
      { color: '#313695', label: '-10' },
      { color: '#4575b4', label: '0' },
      { color: '#fee090', label: '20' },
      { color: '#f46d43', label: '35' },
      { color: '#a50026', label: '50' },
    ],
    unit: '°C',
  },
  'precipitation': {
    stops: [
      { color: '#f7fbff', label: '0' },
      { color: '#9ecae1', label: '25' },
      { color: '#4292c6', label: '50' },
      { color: '#2171b5', label: '100' },
      { color: '#084594', label: '200+' },
    ],
    unit: 'mm',
  },
  'flood-extent': {
    stops: [
      { color: '#ffffff', label: 'Land' },
      { color: '#3b82f6', label: 'Water' },
    ],
  },
}

export function SatelliteLegend({ layerType, className = '' }: SatelliteLegendProps) {
  const legend = LEGEND_COLORS[layerType]
  if (!legend) return null

  return (
    <div className={`bg-osint-bg/90 backdrop-blur-sm border border-osint-border rounded-lg p-2 ${className}`}>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[10px] text-osint-muted uppercase font-medium">
          {layerType.replace(/-/g, ' ')}
        </span>
        {legend.unit && (
          <span className="text-[10px] text-osint-muted">({legend.unit})</span>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {legend.stops.map((stop, i) => (
          <div key={i} className="flex flex-col items-center">
            <div
              className="w-4 h-3 first:rounded-l last:rounded-r"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[8px] text-osint-muted mt-0.5">{stop.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// EXPORTS
// =============================================================================

export default SatelliteLayer
