/**
 * DistrictPolygonsLayer - GeoJSON district boundaries with React-controlled tooltip
 * ================================================================================
 *
 * Bloomberg-quality implementation:
 * - Single React-rendered tooltip (no Leaflet tooltip API)
 * - Portal-based rendering for proper z-index
 * - Mouse position tracking for tooltip placement
 * - Debounced show/hide for professional UX
 */

import { useEffect, useRef, useCallback, useState, memo } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import type { Map as LeafletMap, GeoJSON as GeoJSONLayer, Layer, PathOptions } from 'leaflet'
import apiClient from '../../api/client'

// =============================================================================
// TYPES
// =============================================================================

export interface DistrictCentroid {
  lat: number
  lng: number
}

export interface DistrictProperties {
  name: string
  province: string
  centroid: DistrictCentroid
  code: string
  event_count?: number
  critical_count?: number
  high_count?: number
  dominant_category?: string
  heat_value?: number
}

export interface GeoJSONFeature {
  type: 'Feature'
  properties: DistrictProperties
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  name: string
  features: GeoJSONFeature[]
}

export interface DistrictPolygonsLayerProps {
  map: LeafletMap | null
  geoJSONData?: GeoJSONFeatureCollection | null
  selectedDistrict?: string | null
  hoveredDistrict?: string | null
  showHeatMap?: boolean
  fillOpacity?: number
  visible?: boolean
  onDistrictClick?: (district: DistrictProperties) => void
  onDistrictHover?: (district: DistrictProperties | null) => void
  eventCounts?: Record<string, { total: number; critical: number; high: number }>
  selectedProvinces?: string[]
}

// =============================================================================
// CONSTANTS
// =============================================================================

const TOOLTIP_SHOW_DELAY = 350
const TOOLTIP_HIDE_DELAY = 100

// Province colors - subtle, muted for light backgrounds (Live UA Map style)
const PROVINCE_COLORS: Record<string, string> = {
  'Koshi': '#3b82f6',
  'Madhesh': '#dc2626',
  'Bagmati': '#059669',
  'Gandaki': '#d97706',
  'Lumbini': '#ea580c',
  'Karnali': '#7c3aed',
  'Sudurpashchim': '#0891b2',
}

// Heat colors for threat zones (subtle, transparent)
const HEAT_COLORS = ['#dcfce7', '#fef3c7', '#fed7aa', '#fecaca', '#fca5a5']

// Default: transparent with subtle gray borders (Live UA Map style)
const DEFAULT_STYLE: PathOptions = {
  weight: 0.5,
  opacity: 0.3,
  fillOpacity: 0,
  color: '#9ca3af',
  fillColor: 'transparent',
}

// Province filter active: subtle fill
const PROVINCE_BORDER_STYLE: PathOptions = {
  weight: 1.5,
  opacity: 0.8,
  fillOpacity: 0.08,
}

// Hover: light highlight
const HOVER_STYLE: PathOptions = {
  weight: 1,
  opacity: 0.5,
  fillOpacity: 0.1,
}

// Selected: blue border
const SELECTED_STYLE: PathOptions = {
  weight: 2,
  opacity: 1,
  fillOpacity: 0.12,
  color: '#2563eb',
}

// =============================================================================
// HELPERS
// =============================================================================

function getHeatColor(value: number): string {
  const index = Math.floor(Math.max(0, Math.min(1, value)) * (HEAT_COLORS.length - 1))
  return HEAT_COLORS[index]
}

function getDistrictStyle(
  properties: DistrictProperties,
  options: {
    isSelected: boolean
    isHovered: boolean
    showHeatMap: boolean
    fillOpacity: number
    eventCounts?: Record<string, { total: number; critical: number; high: number }>
    isInSelectedProvince: boolean
    isProvinceFilterActive: boolean
  }
): PathOptions {
  const { isSelected, isHovered, showHeatMap, eventCounts, isInSelectedProvince, isProvinceFilterActive } = options

  // Districts outside selected provinces: very subtle
  if (!isInSelectedProvince) {
    return { ...DEFAULT_STYLE, fillColor: '#f3f4f6', color: '#d1d5db', fillOpacity: 0.3, opacity: 0.3, weight: 0.5 }
  }

  // Default: transparent (Live UA Map style - clean map)
  let fillColor = 'transparent'
  let borderColor = '#9ca3af'

  // Heat map mode: show threat zones with subtle colors
  if (showHeatMap && eventCounts) {
    const counts = eventCounts[properties.name.toLowerCase()]
    if (counts && counts.total > 0) {
      const heatValue = Math.min(1, (counts.critical * 0.5 + counts.high * 0.3 + counts.total * 0.1) / 10)
      fillColor = getHeatColor(heatValue)
      borderColor = heatValue > 0.5 ? '#dc2626' : '#6b7280'
    }
  } else if (properties.heat_value !== undefined && properties.heat_value > 0) {
    fillColor = getHeatColor(properties.heat_value)
    borderColor = properties.heat_value > 0.5 ? '#dc2626' : '#6b7280'
  }

  if (isSelected) {
    return { ...DEFAULT_STYLE, ...SELECTED_STYLE, fillColor: fillColor || '#dbeafe', dashArray: '6, 4' }
  }

  if (isHovered) {
    const provinceColor = PROVINCE_COLORS[properties.province] || '#6b7280'
    return { ...DEFAULT_STYLE, ...HOVER_STYLE, fillColor: provinceColor, color: provinceColor }
  }

  if (isProvinceFilterActive) {
    const provinceColor = PROVINCE_COLORS[properties.province] || '#6b7280'
    return { ...DEFAULT_STYLE, ...PROVINCE_BORDER_STYLE, fillColor: provinceColor, color: provinceColor }
  }

  // Default: transparent with subtle borders
  return { ...DEFAULT_STYLE, fillColor: 'transparent', color: borderColor, fillOpacity: 0 }
}

// =============================================================================
// DISTRICT TOOLTIP COMPONENT (React-rendered)
// =============================================================================

interface TooltipState {
  visible: boolean
  x: number
  y: number
  district: DistrictProperties | null
}

function DistrictTooltip({ state }: { state: TooltipState }) {
  if (!state.district) return null

  const { district, x, y, visible } = state

  // Smart positioning to keep tooltip within viewport
  const tooltipWidth = 160
  const tooltipHeight = 80
  const padding = 12
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080

  // Calculate position - prefer top-right of cursor
  let left = x + padding
  let top = y - tooltipHeight - padding

  // If would go off right edge, flip to left of cursor
  if (left + tooltipWidth > viewportWidth - padding) {
    left = x - tooltipWidth - padding
  }

  // If would go off top edge, flip to below cursor
  if (top < padding) {
    top = y + padding
  }

  // If would go off bottom edge, move up
  if (top + tooltipHeight > viewportHeight - padding) {
    top = viewportHeight - tooltipHeight - padding
  }

  // If would go off left edge, move right
  if (left < padding) {
    left = padding
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 100000,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 150ms ease, transform 150ms ease',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '10px 14px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          minWidth: '120px',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827', marginBottom: '2px' }}>
          {district.name}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280' }}>
          {district.province} Province
        </div>
        {district.event_count !== undefined && (
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#6b7280' }}>Events</span>
              <span style={{ color: '#111827', fontWeight: 600 }}>{district.event_count}</span>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const DistrictPolygonsLayer = memo(function DistrictPolygonsLayer({
  map,
  geoJSONData,
  selectedDistrict,
  hoveredDistrict,
  showHeatMap = false,
  fillOpacity = 0.1,
  visible = true,
  onDistrictClick,
  onDistrictHover,
  eventCounts,
  selectedProvinces,
}: DistrictPolygonsLayerProps) {
  const geoJSONLayerRef = useRef<GeoJSONLayer | null>(null)
  const layersByDistrictRef = useRef<Map<string, Layer>>(new Map())

  // React-controlled tooltip state
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    district: null,
  })

  // Timers for debounced show/hide
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDistrictRef = useRef<string | null>(null)

  const [loadedData, setLoadedData] = useState<GeoJSONFeatureCollection | null>(null)
  const [_isLoading, setIsLoading] = useState(false)
  const [loadError, setError] = useState<string | null>(null)

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimers()
  }, [clearTimers])

  // Load GeoJSON
  useEffect(() => {
    if (geoJSONData) {
      setLoadedData(geoJSONData)
      return
    }

    const fetchGeoJSON = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch('/geo/nepal-districts.geojson')
        if (!response.ok) throw new Error(`Failed to load GeoJSON: ${response.status}`)
        setLoadedData(await response.json())
      } catch (err) {
        console.error('Failed to load district GeoJSON:', err)
        setError(err instanceof Error ? err.message : 'Failed to load map data')
      } finally {
        setIsLoading(false)
      }
    }
    fetchGeoJSON()
  }, [geoJSONData])

  // Style function
  const getStyle = useCallback((feature?: GeoJSON.Feature) => {
    if (!feature?.properties) return DEFAULT_STYLE

    const properties = feature.properties as DistrictProperties
    const name = properties.name?.toLowerCase() || ''
    const isSelected = selectedDistrict?.toLowerCase() === name
    const isHovered = hoveredDistrict?.toLowerCase() === name
    const isInSelectedProvince = !selectedProvinces || selectedProvinces.length === 0 || selectedProvinces.length === 7 || selectedProvinces.includes(properties.province)
    const isProvinceFilterActive = selectedProvinces && selectedProvinces.length > 0 && selectedProvinces.length < 7

    return getDistrictStyle(properties, {
      isSelected,
      isHovered,
      showHeatMap,
      fillOpacity,
      eventCounts,
      isInSelectedProvince,
      isProvinceFilterActive: !!isProvinceFilterActive,
    })
  }, [selectedDistrict, hoveredDistrict, showHeatMap, fillOpacity, eventCounts, selectedProvinces])

  // Click handler
  const handleClick = useCallback((e: L.LeafletMouseEvent) => {
    const properties = e.target.feature?.properties as DistrictProperties | undefined
    if (properties && onDistrictClick) onDistrictClick(properties)
  }, [onDistrictClick])

  // Mouse move - update tooltip position
  const handleMouseMove = useCallback((e: L.LeafletMouseEvent) => {
    const properties = e.target.feature?.properties as DistrictProperties | undefined
    if (!properties) return

    // Update position immediately (no delay for smooth tracking)
    setTooltip(prev => ({
      ...prev,
      x: e.originalEvent.clientX,
      y: e.originalEvent.clientY,
    }))
  }, [])

  // Mouse over - schedule tooltip show
  const handleMouseOver = useCallback((e: L.LeafletMouseEvent) => {
    const properties = e.target.feature?.properties as DistrictProperties | undefined
    if (!properties) return

    // Cancel any pending hide
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    // If already showing this district, just update position
    if (pendingDistrictRef.current === properties.name || tooltip.district?.name === properties.name) {
      setTooltip(prev => ({
        ...prev,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
      }))
      return
    }

    // Cancel any pending show for different district
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
    }

    // Track what we're about to show
    pendingDistrictRef.current = properties.name

    // Update position immediately, schedule visibility
    setTooltip(prev => ({
      ...prev,
      x: e.originalEvent.clientX,
      y: e.originalEvent.clientY,
      district: properties,
      visible: false, // Will become visible after delay
    }))

    // Schedule show
    showTimerRef.current = setTimeout(() => {
      // Only show if still hovering same district
      if (pendingDistrictRef.current === properties.name) {
        setTooltip(prev => ({ ...prev, visible: true }))
      }
      showTimerRef.current = null
    }, TOOLTIP_SHOW_DELAY)

    if (onDistrictHover) onDistrictHover(properties)
  }, [tooltip.district?.name, onDistrictHover])

  // Mouse out - schedule tooltip hide
  const handleMouseOut = useCallback(() => {
    // Cancel any pending show
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }

    pendingDistrictRef.current = null

    // Schedule hide with small delay (allows moving between adjacent districts smoothly)
    hideTimerRef.current = setTimeout(() => {
      setTooltip(prev => ({ ...prev, visible: false }))
      // Clear district after fade out
      setTimeout(() => {
        setTooltip(prev => {
          if (!prev.visible) return { ...prev, district: null }
          return prev
        })
      }, 150)
      hideTimerRef.current = null
    }, TOOLTIP_HIDE_DELAY)

    if (onDistrictHover) onDistrictHover(null)
  }, [onDistrictHover])

  // Create GeoJSON layer
  useEffect(() => {
    if (!map || !loadedData || !visible) {
      if (geoJSONLayerRef.current) {
        map?.removeLayer(geoJSONLayerRef.current)
        geoJSONLayerRef.current = null
        layersByDistrictRef.current.clear()
      }
      return
    }

    if (geoJSONLayerRef.current) {
      map.removeLayer(geoJSONLayerRef.current)
    }

    const geoJSONLayer = L.geoJSON(loadedData as GeoJSON.GeoJsonObject, {
      style: getStyle,
      onEachFeature: (feature, layer) => {
        const properties = feature.properties as DistrictProperties
        if (properties.name) {
          layersByDistrictRef.current.set(properties.name.toLowerCase(), layer)
        }
        layer.on({
          click: handleClick,
          mouseover: handleMouseOver,
          mouseout: handleMouseOut,
          mousemove: handleMouseMove,
        })
      },
    })

    geoJSONLayer.addTo(map)
    geoJSONLayer.bringToBack()
    geoJSONLayerRef.current = geoJSONLayer

    return () => {
      clearTimers()
      if (geoJSONLayerRef.current && map) {
        map.removeLayer(geoJSONLayerRef.current)
        geoJSONLayerRef.current = null
        layersByDistrictRef.current.clear()
      }
    }
  }, [map, loadedData, visible, getStyle, handleClick, handleMouseOver, handleMouseOut, handleMouseMove, clearTimers])

  // Update styles
  useEffect(() => {
    if (!geoJSONLayerRef.current) return
    geoJSONLayerRef.current.setStyle(getStyle)
    if (map?.hasLayer(geoJSONLayerRef.current)) {
      geoJSONLayerRef.current.bringToBack()
    }
  }, [selectedDistrict, hoveredDistrict, showHeatMap, fillOpacity, eventCounts, selectedProvinces, getStyle, map])

  // Visibility
  useEffect(() => {
    if (!geoJSONLayerRef.current || !map) return

    if (visible) {
      if (!map.hasLayer(geoJSONLayerRef.current)) {
        geoJSONLayerRef.current.addTo(map)
        geoJSONLayerRef.current.bringToBack()
      }
    } else {
      if (map.hasLayer(geoJSONLayerRef.current)) {
        map.removeLayer(geoJSONLayerRef.current)
      }
      setTooltip(prev => ({ ...prev, visible: false, district: null }))
    }
  }, [visible, map])

  if (loadError) console.warn('DistrictPolygonsLayer error:', loadError)

  // Render the React tooltip via portal
  return <DistrictTooltip state={tooltip} />
})

// =============================================================================
// HOOK
// =============================================================================

export function useDistrictGeoJSON() {
  const [data, setData] = useState<GeoJSONFeatureCollection | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        const apiResponse = await apiClient.get('/geo/districts', {
          params: { include_events: true },
          validateStatus: () => true,
        })
        if (apiResponse.status === 200 && apiResponse.data) {
          if (!cancelled) {
            setData(apiResponse.data)
            setIsLoading(false)
            return
          }
        }
      } catch { /* fall through */ }

      try {
        const response = await fetch('/geo/nepal-districts.geojson')
        if (!response.ok) throw new Error('Failed to load GeoJSON')
        if (!cancelled) setData(await response.json())
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [])

  return { data, isLoading, error }
}

export default DistrictPolygonsLayer
