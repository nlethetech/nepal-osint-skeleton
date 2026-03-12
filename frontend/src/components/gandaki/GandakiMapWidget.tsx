/**
 * GandakiMapWidget Component
 *
 * Interactive province map showing Gandaki Province boundary
 * and all 11 district boundaries with GeoJSON.
 * Click a district to filter other widgets.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { PathOptions, Layer } from 'leaflet'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useGandakiDashboardStore } from '../../stores/gandakiDashboardStore'
import { GANDAKI_BOUNDS, GANDAKI_CENTER, type GandakiDistrict } from '../../data/gandaki'
import 'leaflet/dist/leaflet.css'
import './GandakiMapWidget.css'

// =============================================================================
// TYPES
// =============================================================================

interface DistrictProperties {
  name: string
  province: string
  code: string
  centroid: { lat: number; lng: number }
}

interface ProvinceProperties {
  ADM1_EN: string
  ADM1_PCODE: string
  ADM0_EN: string
}

interface GeoJSONFeature {
  type: 'Feature'
  properties: DistrictProperties | ProvinceProperties
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Map district names from GeoJSON to our display names
const DISTRICT_NAME_MAP: Record<string, GandakiDistrict> = {
  'Nawalpur': 'Nawalparasi East',
  'Tanahun': 'Tanahu',
}

const GANDAKI_PROVINCE_NUMBER = '4' // Gandaki is Province 4

// Dark theme styling
const PROVINCE_BORDER_STYLE: PathOptions = {
  weight: 3,
  opacity: 1,
  color: '#eab308', // Gandaki accent color (amber)
  fillColor: 'transparent',
  fillOpacity: 0,
  dashArray: '8, 4',
}

const DISTRICT_DEFAULT_STYLE: PathOptions = {
  weight: 1,
  opacity: 0.6,
  color: '#3f3f46',
  fillColor: '#27272a',
  fillOpacity: 0.3,
}

const DISTRICT_HOVER_STYLE: PathOptions = {
  weight: 2,
  opacity: 0.9,
  color: '#a1a1aa',
  fillColor: '#3f3f46',
  fillOpacity: 0.5,
}

const DISTRICT_SELECTED_STYLE: PathOptions = {
  weight: 2.5,
  opacity: 1,
  color: '#3b82f6',
  fillColor: '#3b82f6',
  fillOpacity: 0.25,
}

const DISTRICT_ACTIVITY_STYLE: PathOptions = {
  weight: 1.5,
  opacity: 0.8,
  color: '#f97316',
  fillColor: '#f97316',
  fillOpacity: 0.15,
}

// =============================================================================
// MAP CONTROLLER
// =============================================================================

function MapBoundsController({ expanded }: { expanded: boolean }) {
  const map = useMap()

  useEffect(() => {
    map.fitBounds(GANDAKI_BOUNDS, { padding: [20, 20] })
    setTimeout(() => map.invalidateSize(), 100)
  }, [map, expanded])

  return null
}

// =============================================================================
// TOOLTIP COMPONENT
// =============================================================================

interface TooltipState {
  visible: boolean
  x: number
  y: number
  district: DistrictProperties | null
  counts?: { news: number; events: number }
}

function DistrictTooltip({ state }: { state: TooltipState }) {
  if (!state.visible || !state.district) return null

  const { district, x, y, counts } = state
  const displayName = DISTRICT_NAME_MAP[district.name] || district.name

  // Smart positioning
  const tooltipWidth = 180
  const tooltipHeight = 100
  const padding = 12
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080

  let left = x + padding
  let top = y - tooltipHeight - padding

  if (left + tooltipWidth > viewportWidth - padding) {
    left = x - tooltipWidth - padding
  }
  if (top < padding) {
    top = y + padding
  }
  if (top + tooltipHeight > viewportHeight - padding) {
    top = viewportHeight - tooltipHeight - padding
  }
  if (left < padding) {
    left = padding
  }

  return (
    <div
      className="gandaki-map-tooltip"
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 100000,
        pointerEvents: 'none',
      }}
    >
      <div className="gandaki-map-tooltip-content">
        <div className="gandaki-map-tooltip-name">{displayName}</div>
        <div className="gandaki-map-tooltip-province">Gandaki Province</div>
        {counts && (
          <div className="gandaki-map-tooltip-stats">
            <div className="gandaki-map-tooltip-stat">
              <span className="label">News</span>
              <span className="value">{counts.news}</span>
            </div>
            <div className="gandaki-map-tooltip-stat">
              <span className="label">Events</span>
              <span className="value">{counts.events}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface GandakiMapWidgetProps {
  districtCounts?: Record<string, { news: number; events: number }>
}

export function GandakiMapWidget({ districtCounts = {} }: GandakiMapWidgetProps) {
  const { selectedDistrict, selectDistrict, isMapExpanded, toggleMapExpanded } = useGandakiDashboardStore()

  const [districtGeoData, setDistrictGeoData] = useState<GeoJSONFeatureCollection | null>(null)
  const [provinceGeoData, setProvinceGeoData] = useState<GeoJSONFeatureCollection | null>(null)
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    district: null,
  })

  const districtLayerRef = useRef<L.GeoJSON | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  // Load GeoJSON data
  useEffect(() => {
    const loadGeoData = async () => {
      try {
        // Load district boundaries
        const districtResponse = await fetch('/geo/nepal-districts.geojson')
        if (districtResponse.ok) {
          const data = await districtResponse.json()
          // Filter to only Gandaki districts
          const gandakiDistricts: GeoJSONFeatureCollection = {
            type: 'FeatureCollection',
            features: data.features.filter(
              (f: GeoJSONFeature) => (f.properties as DistrictProperties).province === 'Gandaki'
            ),
          }
          setDistrictGeoData(gandakiDistricts)
        }

        // Load province boundary
        const provinceResponse = await fetch('/geo/nepal-provinces.geojson')
        if (provinceResponse.ok) {
          const data = await provinceResponse.json()
          // Filter to only Gandaki province (Province 4)
          const gandakiProvince: GeoJSONFeatureCollection = {
            type: 'FeatureCollection',
            features: data.features.filter(
              (f: GeoJSONFeature) => (f.properties as ProvinceProperties).ADM1_EN === GANDAKI_PROVINCE_NUMBER
            ),
          }
          setProvinceGeoData(gandakiProvince)
        }
      } catch (error) {
        console.error('Failed to load GeoJSON:', error)
      }
    }

    loadGeoData()
  }, [])

  // Get normalized district name for matching
  const getNormalizedName = useCallback((name: string): string => {
    return DISTRICT_NAME_MAP[name] || name
  }, [])

  // Get district style
  const getDistrictStyle = useCallback((feature?: GeoJSON.Feature): PathOptions => {
    if (!feature?.properties) return DISTRICT_DEFAULT_STYLE

    const props = feature.properties as DistrictProperties
    const displayName = getNormalizedName(props.name)
    const isSelected = selectedDistrict === displayName
    const isHovered = hoveredDistrict === props.name
    const counts = districtCounts[displayName]
    const hasActivity = counts && (counts.news > 0 || counts.events > 0)

    if (isSelected) {
      return DISTRICT_SELECTED_STYLE
    }

    if (isHovered) {
      return DISTRICT_HOVER_STYLE
    }

    if (hasActivity) {
      return DISTRICT_ACTIVITY_STYLE
    }

    return DISTRICT_DEFAULT_STYLE
  }, [selectedDistrict, hoveredDistrict, districtCounts, getNormalizedName])

  // Handle district click
  const handleDistrictClick = useCallback((displayName: string) => {
    if (selectedDistrict === displayName) {
      selectDistrict(null)
    } else {
      selectDistrict(displayName as GandakiDistrict)
    }
  }, [selectedDistrict, selectDistrict])

  // Feature event handlers
  const onEachDistrictFeature = useCallback((feature: GeoJSON.Feature, layer: Layer) => {
    const props = feature.properties as DistrictProperties
    const displayName = getNormalizedName(props.name)

    layer.on({
      click: () => {
        handleDistrictClick(displayName)
      },
      mouseover: (e: L.LeafletMouseEvent) => {
        setHoveredDistrict(props.name)
        const counts = districtCounts[displayName]
        setTooltip({
          visible: true,
          x: e.originalEvent.clientX,
          y: e.originalEvent.clientY,
          district: props,
          counts,
        })
      },
      mousemove: (e: L.LeafletMouseEvent) => {
        setTooltip(prev => ({
          ...prev,
          x: e.originalEvent.clientX,
          y: e.originalEvent.clientY,
        }))
      },
      mouseout: () => {
        setHoveredDistrict(null)
        setTooltip(prev => ({ ...prev, visible: false }))
      },
    })
  }, [getNormalizedName, handleDistrictClick, districtCounts])

  // District labels
  const districtLabels = useMemo(() => {
    if (!districtGeoData) return null

    return districtGeoData.features.map((feature) => {
      const props = feature.properties as DistrictProperties
      const displayName = getNormalizedName(props.name)
      const isSelected = selectedDistrict === displayName

      return (
        <div
          key={props.name}
          className={`gandaki-district-label ${isSelected ? 'selected' : ''}`}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          {displayName.substring(0, 3).toUpperCase()}
        </div>
      )
    })
  }, [districtGeoData, selectedDistrict, getNormalizedName])

  // GeoJSON key to force re-render on style changes
  const geoJsonKey = useMemo(() =>
    `${selectedDistrict}-${hoveredDistrict}-${JSON.stringify(districtCounts)}`,
    [selectedDistrict, hoveredDistrict, districtCounts]
  )

  return (
    <div className={`gandaki-map-widget ${isMapExpanded ? 'expanded' : ''}`}>
      <div className="gandaki-map-header">
        <h3>Province Map</h3>
        <button
          className="gandaki-map-expand-btn"
          onClick={toggleMapExpanded}
          title={isMapExpanded ? 'Minimize' : 'Expand'}
        >
          {isMapExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      <div className="gandaki-map-container">
        <MapContainer
          center={[GANDAKI_CENTER.lat, GANDAKI_CENTER.lng]}
          zoom={GANDAKI_CENTER.zoom}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
          attributionControl={false}
          ref={mapRef}
        >
          {/* Dark tile layer */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />

          <MapBoundsController expanded={isMapExpanded} />

          {/* Province boundary (outer border) */}
          {provinceGeoData && (
            <GeoJSON
              key="province-boundary"
              data={provinceGeoData}
              style={PROVINCE_BORDER_STYLE}
            />
          )}

          {/* District boundaries */}
          {districtGeoData && (
            <GeoJSON
              key={geoJsonKey}
              data={districtGeoData}
              style={getDistrictStyle}
              onEachFeature={onEachDistrictFeature}
              ref={districtLayerRef}
            />
          )}
        </MapContainer>

        {/* Tooltip rendered outside map */}
        <DistrictTooltip state={tooltip} />
      </div>

      {/* Legend */}
      <div className="gandaki-map-legend">
        <div className="gandaki-map-legend-item">
          <span className="gandaki-map-legend-color" style={{ background: '#3b82f6' }} />
          <span>Selected</span>
        </div>
        <div className="gandaki-map-legend-item">
          <span className="gandaki-map-legend-color" style={{ background: '#f97316' }} />
          <span>Has Activity</span>
        </div>
        <div className="gandaki-map-legend-item">
          <span className="gandaki-map-legend-color province" style={{ borderColor: '#eab308' }} />
          <span>Province Border</span>
        </div>
      </div>

      {selectedDistrict && (
        <div className="gandaki-map-selection">
          <span>Selected: <strong>{selectedDistrict}</strong></span>
          <button onClick={() => selectDistrict(null)}>Clear</button>
        </div>
      )}
    </div>
  )
}
