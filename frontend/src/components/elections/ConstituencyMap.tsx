/**
 * ConstituencyMap - Interactive election map using district-level GeoJSON
 *
 * Matches district polygons to election results by district name.
 * Colors each district by the dominant party (most seats won).
 * Falls back gracefully when no data is available.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import { useElectionStore } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'
import { addDelayedTooltipBehavior, injectTooltipStyles } from '../map/tooltipUtils'
import { PROVINCE_COLORS } from '../../data/districts'

// Nepal bounds
const NEPAL_CENTER: [number, number] = [28.3, 84.1]
const NEPAL_ZOOM = 7
const NEPAL_BOUNDS: L.LatLngBoundsExpression = [[26.3, 80.0], [30.5, 88.2]]

// Province number to name mapping (for GeoJSON which uses ADM1_EN numbers)
const PROVINCE_NUMBER_TO_NAME: Record<string, string> = {
  '1': 'Koshi',
  '2': 'Madhesh',
  '3': 'Bagmati',
  '4': 'Gandaki',
  '5': 'Lumbini',
  '6': 'Karnali',
  '7': 'Sudurpashchim',
}

interface DistrictFeature extends Feature<Polygon | MultiPolygon> {
  properties: {
    name: string       // District name (e.g., "Kathmandu")
    province: string   // Province name (e.g., "Bagmati")
    code?: string      // Short code (e.g., "KTM")
    centroid?: { lat: number; lng: number }
    [key: string]: unknown
  }
}

interface DistrictCollection extends FeatureCollection<Polygon | MultiPolygon> {
  features: DistrictFeature[]
}

/** Aggregated district-level election data */
interface DistrictAggregate {
  district: string
  province: string
  constituencies: number
  declared: number
  counting: number
  dominant_party: string | null
  parties: Record<string, number>  // party -> seats won
  total_votes: number
  turnout_pct: number | null
}

export function ConstituencyMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const districtLayerRef = useRef<L.GeoJSON | null>(null)
  const provinceBorderLayerRef = useRef<L.GeoJSON | null>(null)
  const [geoData, setGeoData] = useState<DistrictCollection | null>(null)
  const [provinceData, setProvinceData] = useState<FeatureCollection | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const {
    constituencyResults,
    selectedConstituencyId,
    selectConstituency,
    isMapLoading,
    mapColorMode,
    setMapColorMode,
    antiIncumbencyData,
  } = useElectionStore()

  // Aggregate constituency results by district
  const districtAggregates = useMemo(() => {
    const aggregates = new Map<string, DistrictAggregate>()

    for (const [, result] of constituencyResults) {
      const district = result.district
      if (!district) continue

      const normalizedDistrict = normalizeDistrictName(district)

      if (!aggregates.has(normalizedDistrict)) {
        aggregates.set(normalizedDistrict, {
          district: normalizedDistrict,
          province: result.province,
          constituencies: 0,
          declared: 0,
          counting: 0,
          dominant_party: null,
          parties: {},
          total_votes: 0,
          turnout_pct: null,
        })
      }

      const agg = aggregates.get(normalizedDistrict)!
      agg.constituencies++
      agg.total_votes += result.total_votes || 0

      if (result.status === 'declared') {
        agg.declared++
        if (result.winner_party) {
          agg.parties[result.winner_party] = (agg.parties[result.winner_party] || 0) + 1
        }
      } else if (result.status === 'counting') {
        agg.counting++
      }

      if (result.turnout_pct) {
        agg.turnout_pct = agg.turnout_pct
          ? (agg.turnout_pct + result.turnout_pct) / 2
          : result.turnout_pct
      }
    }

    // Determine dominant party for each district
    for (const agg of aggregates.values()) {
      let maxSeats = 0
      for (const [party, seats] of Object.entries(agg.parties)) {
        if (seats > maxSeats) {
          maxSeats = seats
          agg.dominant_party = party
        }
      }
    }

    return aggregates
  }, [constituencyResults])

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    // Inject tooltip styles for consistent behavior
    injectTooltipStyles()

    const map = L.map(mapContainerRef.current, {
      center: NEPAL_CENTER,
      zoom: NEPAL_ZOOM,
      zoomControl: false,
      preferCanvas: true,
      attributionControl: false,
      maxBounds: NEPAL_BOUNDS,
      maxBoundsViscosity: 1.0,  // Solid bounds - can't drag outside
      minZoom: 7,  // Prevent zooming out beyond Nepal view
      maxZoom: 18,
    })

    // Dark tile layer (CartoDB Dark Matter) - LiveUAMap style
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© CartoDB',
      subdomains: 'abcd',
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    // Create custom panes for proper layer ordering
    map.createPane('districtPane')
    map.createPane('provinceBorderPane')
    const districtPane = map.getPane('districtPane')
    const provincePane = map.getPane('provinceBorderPane')
    if (districtPane) districtPane.style.zIndex = '400'
    if (provincePane) provincePane.style.zIndex = '450'

    mapRef.current = map
    setMapReady(true)

    return () => {
      setMapReady(false)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Load GeoJSON data
  useEffect(() => {
    let cancelled = false

    const loadGeoData = async () => {
      try {
        // Load districts
        const districtResponse = await fetch('/geo/nepal-districts.geojson')
        if (!districtResponse.ok) {
          throw new Error(`Failed to load districts: ${districtResponse.status}`)
        }
        const districtData = await districtResponse.json()
        if (!cancelled) setGeoData(districtData)

        // Load province borders
        const provinceResponse = await fetch('/geo/nepal-provinces.geojson')
        if (provinceResponse.ok) {
          const pData = await provinceResponse.json()
          if (!cancelled) setProvinceData(pData)
        }
      } catch (err) {
        console.error('[ConstituencyMap] GeoJSON load error:', err)
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load map data')
      }
    }

    loadGeoData()
    return () => { cancelled = true }
  }, [])

  // Aggregate anti-incumbency data per district
  const districtIncumbency = useMemo(() => {
    const result = new Map<string, { retained: number; lost: number; unknown: number }>()

    for (const [, cr] of constituencyResults) {
      const normalized = normalizeDistrictName(cr.district)
      if (!result.has(normalized)) {
        result.set(normalized, { retained: 0, lost: 0, unknown: 0 })
      }
      const entry = result.get(normalized)!
      const incumbencyEntry = antiIncumbencyData.get(cr.constituency_id)
      if (!incumbencyEntry || incumbencyEntry.retained === null) {
        entry.unknown++
      } else if (incumbencyEntry.retained) {
        entry.retained++
      } else {
        entry.lost++
      }
    }
    return result
  }, [constituencyResults, antiIncumbencyData])

  // Get fill color for a district
  const getDistrictColor = useCallback((districtName: string): string => {
    const normalized = normalizeDistrictName(districtName)

    if (mapColorMode === 'anti-incumbency') {
      const inc = districtIncumbency.get(normalized)
      if (!inc || (inc.retained === 0 && inc.lost === 0)) return '#4a5568' // No data - gray
      if (inc.retained > inc.lost) return '#22c55e' // Mostly retained - green
      if (inc.lost > inc.retained) return '#ef4444' // Mostly lost - red
      return '#eab308' // Even split - yellow
    }

    const agg = districtAggregates.get(normalized)

    if (!agg) return '#2d3748' // No data - very dark
    if (agg.declared === 0 && agg.counting === 0) return '#2d3748' // Pending
    if (agg.counting > 0 && agg.declared === 0) return '#4a5568' // Counting only

    if (agg.dominant_party) {
      return getPartyColor(agg.dominant_party)
    }
    return '#4a5568'
  }, [districtAggregates, mapColorMode, districtIncumbency])

  // Render district polygons
  useEffect(() => {
    const map = mapRef.current
    if (!map || !geoData || !mapReady) return

    // Remove previous layer
    if (districtLayerRef.current) {
      map.removeLayer(districtLayerRef.current)
      districtLayerRef.current = null
    }

    const layer = L.geoJSON(geoData as FeatureCollection, {
      pane: 'districtPane',
      style: (feature) => {
        if (!feature) return {}
        const f = feature as DistrictFeature
        const districtName = f.properties.name
        const province = f.properties.province
        const isSelected = selectedConstituencyId === districtName
        const provinceColor = PROVINCE_COLORS[province] || '#64748b'
        const fillColor = getDistrictColor(districtName)

        return {
          fillColor,
          fillOpacity: isSelected ? 0.85 : 0.55,
          color: isSelected ? '#ffffff' : provinceColor,
          weight: isSelected ? 4 : 2.5,
          opacity: 1,
        }
      },
      onEachFeature: (feature, featureLayer) => {
        const f = feature as DistrictFeature
        const districtName = f.properties.name
        const province = f.properties.province
        const agg = districtAggregates.get(normalizeDistrictName(districtName))

        // Build tooltip
        const tooltipHtml = buildTooltip(districtName, province, agg)
        featureLayer.bindTooltip(tooltipHtml, {
          permanent: false,
          sticky: false,
          interactive: false,
          className: 'constituency-tooltip',
          direction: 'top',
          offset: [0, -10],
        })

        // Add delayed tooltip behavior (250ms show delay, immediate hide)
        addDelayedTooltipBehavior(featureLayer, { showDelay: 250, hideDelay: 0 })

        // Click: select this district
        featureLayer.on('click', () => {
          selectConstituency(districtName)
        })

        // Hover effects - use province colors for borders
        const provinceColor = PROVINCE_COLORS[province] || '#64748b'

        featureLayer.on('mouseover', (e) => {
          const target = e.target as L.Path
          target.setStyle({
            fillOpacity: 0.8,
            weight: 3.5,
            color: provinceColor,
          })
        })

        featureLayer.on('mouseout', (e) => {
          const target = e.target as L.Path
          const isSelected = selectedConstituencyId === districtName
          target.setStyle({
            fillOpacity: isSelected ? 0.85 : 0.55,
            weight: isSelected ? 4 : 2.5,
            color: isSelected ? '#ffffff' : provinceColor,
          })
        })
      },
    })

    layer.addTo(map)
    districtLayerRef.current = layer

    return () => {
      if (districtLayerRef.current && map) {
        map.removeLayer(districtLayerRef.current)
        districtLayerRef.current = null
      }
    }
  }, [geoData, districtAggregates, selectedConstituencyId, getDistrictColor, selectConstituency, mapReady])

  // Province border overlay (on top) - uses custom pane for guaranteed z-index
  useEffect(() => {
    const map = mapRef.current
    if (!map || !provinceData || !mapReady) return

    if (provinceBorderLayerRef.current) {
      map.removeLayer(provinceBorderLayerRef.current)
      provinceBorderLayerRef.current = null
    }

    const layer = L.geoJSON(provinceData, {
      pane: 'provinceBorderPane',
      style: (feature) => {
        // Get province name from feature properties (handles both number and name formats)
        const props = feature?.properties || {}
        const provinceNum = props.ADM1_EN || props.PROVINCE || ''
        const provinceName = PROVINCE_NUMBER_TO_NAME[provinceNum] || props.name || props.PROVINCE || ''
        const color = PROVINCE_COLORS[provinceName] || '#ff00ff' // Magenta fallback for debugging
        console.log('[ProvinceBorder]', { provinceNum, provinceName, color, props })
        return {
          color,
          weight: 5,
          opacity: 1,
          fillOpacity: 0,
          fill: false,
        }
      },
      interactive: false, // Don't intercept clicks
    })

    layer.addTo(map)
    provinceBorderLayerRef.current = layer
    console.log('[ProvinceBorder] Layer added to map with', provinceData.features?.length, 'features')

    return () => {
      if (provinceBorderLayerRef.current && map) {
        map.removeLayer(provinceBorderLayerRef.current)
        provinceBorderLayerRef.current = null
      }
    }
  }, [provinceData, mapReady])

  // Error state
  if (loadError) {
    return (
      <div className="h-full w-full rounded-lg border border-osint-border bg-osint-card flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400 mb-1">Map Error</p>
          <p className="text-xs text-osint-muted">{loadError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full rounded-lg overflow-hidden border border-osint-border">
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Loading overlay */}
      {(isMapLoading || !geoData) && (
        <div className="absolute inset-0 bg-osint-bg/70 flex items-center justify-center z-[1000]">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-osint-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-osint-muted">Loading map...</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-[1000] bg-osint-card/95 border border-osint-border rounded-lg p-2 backdrop-blur-sm shadow-lg">
        {mapColorMode === 'party' ? (
          <>
            <div className="text-[9px] text-osint-muted uppercase tracking-wider mb-1.5 font-medium">Dominant Party</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {[
                { name: 'NC', label: 'Congress', color: '#DC2626' },
                { name: 'UML', label: 'CPN-UML', color: '#2563EB' },
                { name: 'Maoist', label: 'CPN-MC', color: '#8B0000' },
                { name: 'RSP', label: 'Swatantra', color: '#D97706' },
                { name: 'RPP', label: 'Prajatantra', color: '#7C3AED' },
                { name: 'JSP', label: 'Samajbadi', color: '#059669' },
              ].map(p => (
                <div key={p.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-[9px] text-osint-text-secondary">{p.name}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 pt-1 border-t border-osint-border/50 flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#4a5568]" />
                <span className="text-[8px] text-osint-muted">Counting</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#2d3748]" />
                <span className="text-[8px] text-osint-muted">Pending</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="text-[9px] text-osint-muted uppercase tracking-wider mb-1.5 font-medium">Anti-Incumbency</div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#22c55e]" />
                <span className="text-[9px] text-osint-text-secondary">Incumbent Retained</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#ef4444]" />
                <span className="text-[9px] text-osint-text-secondary">Incumbent Lost</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#4a5568]" />
                <span className="text-[9px] text-osint-text-secondary">No Data</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Map mode toggle */}
      <div className="absolute top-2 right-2 z-[1000]">
        <button
          onClick={() => setMapColorMode(mapColorMode === 'party' ? 'anti-incumbency' : 'party')}
          className={`bg-osint-card/90 border border-osint-border rounded px-2 py-1 backdrop-blur-sm text-[10px] transition-colors ${
            mapColorMode === 'anti-incumbency'
              ? 'text-osint-primary border-osint-primary/50'
              : 'text-osint-muted hover:text-osint-text'
          }`}
        >
          {mapColorMode === 'party' ? 'Anti-Incumbency' : 'Party View'}
        </button>
      </div>

      {/* District count badge */}
      {geoData && (
        <div className="absolute top-2 left-2 z-[1000] bg-osint-card/90 border border-osint-border rounded px-2 py-1 backdrop-blur-sm">
          <span className="text-[10px] text-osint-muted">
            {geoData.features.length} districts · 165 constituencies
          </span>
        </div>
      )}
    </div>
  )
}

/** Normalize district name for matching (handles casing, spelling variations) */
function normalizeDistrictName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Handle common variations
    .replace('kavrepalanchowk', 'kavrepalanchok')
    .replace('sindhupalchowk', 'sindhupalchok')
    .replace('kapilbastu', 'kapilvastu')
    .replace('nawalparasi (bardaghat susta east)', 'nawalparasi east')
    .replace('nawalparasi (bardaghat susta west)', 'nawalparasi west')
    .replace('rukum (east)', 'rukum east')
    .replace('rukum (west)', 'rukum west')
}

/** Build rich HTML tooltip for a district */
function buildTooltip(district: string, province: string, agg: DistrictAggregate | undefined): string {
  let html = `<div style="min-width: 140px; font-family: Inter, sans-serif;">`
  html += `<div style="font-weight: 600; font-size: 12px; color: #f3f4f6; margin-bottom: 2px;">${district}</div>`
  html += `<div style="font-size: 10px; color: #9ca3af; margin-bottom: 4px;">${province}</div>`

  if (agg && (agg.declared > 0 || agg.counting > 0)) {
    // Status
    html += `<div style="font-size: 10px; color: #d1d5db;">`
    if (agg.declared > 0) {
      html += `<span style="color: #34d399;">${agg.declared} declared</span>`
    }
    if (agg.counting > 0) {
      html += `${agg.declared > 0 ? ' · ' : ''}<span style="color: #fbbf24;">${agg.counting} counting</span>`
    }
    const pending = agg.constituencies - agg.declared - agg.counting
    if (pending > 0) {
      html += ` · ${pending} pending`
    }
    html += `</div>`

    // Dominant party
    if (agg.dominant_party) {
      const color = getPartyColor(agg.dominant_party)
      html += `<div style="margin-top: 3px; font-size: 10px;">`
      html += `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: ${color}; margin-right: 4px; vertical-align: middle;"></span>`
      html += `<span style="color: ${color}; font-weight: 500;">${agg.dominant_party}</span>`
      html += ` <span style="color: #9ca3af;">(${agg.parties[agg.dominant_party]} seats)</span>`
      html += `</div>`
    }

    // Total votes
    if (agg.total_votes > 0) {
      html += `<div style="font-size: 9px; color: #6b7280; margin-top: 2px;">`
      html += `${agg.total_votes.toLocaleString()} votes`
      if (agg.turnout_pct) html += ` · ${agg.turnout_pct.toFixed(1)}% turnout`
      html += `</div>`
    }
  } else {
    html += `<div style="font-size: 10px; color: #6b7280; font-style: italic;">No results yet</div>`
  }

  html += `<div style="font-size: 9px; color: #4b5563; margin-top: 3px;">Click for details</div>`
  html += `</div>`
  return html
}
