/**
 * SatelliteAnalysis - PWTT-Style Infrastructure Damage Detection
 * ================================================================
 *
 * Production-grade demo for infrastructure damage analysis:
 * - Before/after comparison with visible changes
 * - Building footprint damage detection (rectangles)
 * - Heatmap overlay showing damage intensity
 * - Statistics panel with damage metrics
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.heat'
import {
  Search,
  Calendar,
  Layers,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Satellite,
  AlertTriangle,
  X,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  EyeOff,
  Info,
  SplitSquareHorizontal,
  Building2,
  Activity,
  TrendingDown,
} from 'lucide-react'
import { useGEEStatus } from '../hooks/useEarthEngine'

// Extend L types for heat layer
declare module 'leaflet' {
  function heatLayer(latlngs: Array<[number, number, number]>, options?: any): any;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const NEPAL_BOUNDS: L.LatLngBoundsExpression = [[26.3, 80.0], [30.5, 88.2]]
const NEPAL_CENTER: L.LatLngExpression = [27.7172, 85.324]

const NEPAL_LOCATIONS: Record<string, { lat: number; lng: number; name: string }> = {
  'parliament': { lat: 27.7017, lng: 85.3206, name: 'Federal Parliament' },
  'singha durbar': { lat: 27.6988, lng: 85.3209, name: 'Singha Durbar' },
  'tribhuvan airport': { lat: 27.6966, lng: 85.3591, name: 'Tribhuvan Airport' },
  'dharahara': { lat: 27.7008, lng: 85.3120, name: 'Dharahara Tower' },
  'ratna park': { lat: 27.7050, lng: 85.3150, name: 'Ratna Park' },
  'tundikhel': { lat: 27.7020, lng: 85.3180, name: 'Tundikhel' },
  'pokhara': { lat: 28.2096, lng: 83.9856, name: 'Pokhara' },
  'chitwan': { lat: 27.5291, lng: 84.3542, name: 'Chitwan' },
}

// Simulated damaged buildings with realistic coordinates in Kathmandu
// These represent buildings detected as damaged by PWTT analysis
const DAMAGED_BUILDINGS: Array<{
  id: string;
  lat: number;
  lng: number;
  width: number; // meters
  height: number; // meters
  severity: 'destroyed' | 'severe' | 'moderate' | 'minor';
  buildingType: string;
  damagePercent: number;
  tStatistic: number;
}> = [
  // Central Kathmandu - Heavy damage cluster
  { id: 'B001', lat: 27.7172, lng: 85.3240, width: 45, height: 30, severity: 'destroyed', buildingType: 'Commercial', damagePercent: 95, tStatistic: -4.2 },
  { id: 'B002', lat: 27.7168, lng: 85.3235, width: 35, height: 25, severity: 'destroyed', buildingType: 'Residential', damagePercent: 88, tStatistic: -3.8 },
  { id: 'B003', lat: 27.7175, lng: 85.3248, width: 50, height: 40, severity: 'severe', buildingType: 'Government', damagePercent: 72, tStatistic: -3.2 },
  { id: 'B004', lat: 27.7165, lng: 85.3252, width: 30, height: 20, severity: 'severe', buildingType: 'Residential', damagePercent: 65, tStatistic: -2.9 },
  { id: 'B005', lat: 27.7178, lng: 85.3232, width: 40, height: 35, severity: 'moderate', buildingType: 'Commercial', damagePercent: 45, tStatistic: -2.3 },
  { id: 'B006', lat: 27.7162, lng: 85.3228, width: 25, height: 20, severity: 'moderate', buildingType: 'Residential', damagePercent: 38, tStatistic: -2.1 },
  { id: 'B007', lat: 27.7180, lng: 85.3255, width: 35, height: 28, severity: 'minor', buildingType: 'Residential', damagePercent: 22, tStatistic: -1.5 },

  // Near Singha Durbar - Government area
  { id: 'B008', lat: 27.6992, lng: 85.3212, width: 60, height: 45, severity: 'severe', buildingType: 'Government', damagePercent: 68, tStatistic: -3.1 },
  { id: 'B009', lat: 27.6985, lng: 85.3205, width: 40, height: 30, severity: 'moderate', buildingType: 'Office', damagePercent: 42, tStatistic: -2.2 },
  { id: 'B010', lat: 27.6998, lng: 85.3218, width: 35, height: 25, severity: 'minor', buildingType: 'Commercial', damagePercent: 18, tStatistic: -1.3 },

  // Near Dharahara
  { id: 'B011', lat: 27.7012, lng: 85.3125, width: 55, height: 40, severity: 'destroyed', buildingType: 'Historic', damagePercent: 92, tStatistic: -4.5 },
  { id: 'B012', lat: 27.7005, lng: 85.3118, width: 30, height: 25, severity: 'severe', buildingType: 'Residential', damagePercent: 58, tStatistic: -2.7 },
  { id: 'B013', lat: 27.7018, lng: 85.3132, width: 45, height: 35, severity: 'moderate', buildingType: 'Commercial', damagePercent: 35, tStatistic: -1.9 },

  // Ratna Park area
  { id: 'B014', lat: 27.7055, lng: 85.3155, width: 50, height: 38, severity: 'severe', buildingType: 'Public', damagePercent: 62, tStatistic: -2.8 },
  { id: 'B015', lat: 27.7048, lng: 85.3148, width: 35, height: 28, severity: 'moderate', buildingType: 'Commercial', damagePercent: 40, tStatistic: -2.0 },

  // Scattered damage
  { id: 'B016', lat: 27.7125, lng: 85.3180, width: 40, height: 32, severity: 'moderate', buildingType: 'Residential', damagePercent: 33, tStatistic: -1.8 },
  { id: 'B017', lat: 27.7098, lng: 85.3275, width: 30, height: 22, severity: 'minor', buildingType: 'Residential', damagePercent: 15, tStatistic: -1.2 },
  { id: 'B018', lat: 27.7145, lng: 85.3195, width: 45, height: 35, severity: 'severe', buildingType: 'School', damagePercent: 55, tStatistic: -2.6 },
  { id: 'B019', lat: 27.7088, lng: 85.3142, width: 38, height: 28, severity: 'moderate', buildingType: 'Hospital', damagePercent: 28, tStatistic: -1.7 },
  { id: 'B020', lat: 27.7135, lng: 85.3265, width: 32, height: 24, severity: 'minor', buildingType: 'Residential', damagePercent: 12, tStatistic: -1.1 },
]

// Heat map points for change detection visualization
const HEAT_POINTS: Array<[number, number, number]> = [
  // Central damage cluster
  [27.7172, 85.3240, 1.0],
  [27.7168, 85.3235, 0.95],
  [27.7175, 85.3248, 0.85],
  [27.7165, 85.3252, 0.8],
  [27.7178, 85.3232, 0.6],
  [27.7162, 85.3228, 0.55],
  [27.7180, 85.3255, 0.4],
  [27.7170, 85.3245, 0.9],
  [27.7173, 85.3238, 0.88],

  // Singha Durbar area
  [27.6992, 85.3212, 0.82],
  [27.6985, 85.3205, 0.6],
  [27.6998, 85.3218, 0.35],
  [27.6990, 85.3210, 0.75],

  // Dharahara area
  [27.7012, 85.3125, 0.98],
  [27.7005, 85.3118, 0.7],
  [27.7018, 85.3132, 0.5],
  [27.7010, 85.3122, 0.92],

  // Ratna Park
  [27.7055, 85.3155, 0.78],
  [27.7048, 85.3148, 0.58],
  [27.7052, 85.3152, 0.68],

  // Additional scatter points
  [27.7125, 85.3180, 0.48],
  [27.7098, 85.3275, 0.25],
  [27.7145, 85.3195, 0.72],
  [27.7088, 85.3142, 0.42],
  [27.7135, 85.3265, 0.2],
]

const SEVERITY_COLORS: Record<string, { fill: string; stroke: string }> = {
  destroyed: { fill: 'rgba(215, 48, 39, 0.6)', stroke: '#d73027' },
  severe: { fill: 'rgba(252, 141, 89, 0.5)', stroke: '#fc8d59' },
  moderate: { fill: 'rgba(254, 224, 139, 0.4)', stroke: '#fee08b' },
  minor: { fill: 'rgba(145, 207, 96, 0.3)', stroke: '#91cf60' },
}

// =============================================================================
// TYPES
// =============================================================================

type ViewMode = 'swipe' | 'analysis'

interface LocationResult {
  name: string
  lat: number
  lng: number
}

// =============================================================================
// LOCATION SEARCH
// =============================================================================

function LocationSearch({ onSelect }: { onSelect: (lat: number, lng: number, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocationResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const searchLocations = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return }
    const normalized = q.toLowerCase()
    const matches = Object.entries(NEPAL_LOCATIONS)
      .filter(([key, loc]) => key.includes(normalized) || loc.name.toLowerCase().includes(normalized))
      .map(([_, loc]) => ({ name: loc.name, lat: loc.lat, lng: loc.lng }))
    setResults(matches.slice(0, 6))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      searchLocations(query)
      setShowResults(!!query)
    }, 150)
    return () => clearTimeout(timer)
  }, [query, searchLocations])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={searchRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bp-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search location..."
          className="w-full pl-10 pr-8 py-2.5 bg-bp-surface border border-bp-border rounded-lg text-bp-text placeholder-bp-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-bp-primary/50"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-bp-text-muted hover:text-bp-text">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-bp-card border border-bp-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button key={i} onClick={() => { onSelect(r.lat, r.lng, r.name); setQuery(r.name); setShowResults(false) }}
              className="w-full px-3 py-2 text-left hover:bg-bp-surface flex items-center gap-2 text-sm text-bp-text">
              <MapPin className="w-4 h-4 text-bp-primary" />
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// SWIPE SLIDER
// =============================================================================

function SwipeSlider({ position, onChange }: { position: number; onChange: (p: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
      onChange((x / rect.width) * 100)
    }
    const onUp = () => { dragging.current = false; document.body.style.cursor = '' }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove)
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
    }
  }, [onChange])

  const onStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'ew-resize'
  }

  return (
    <div ref={containerRef} className="absolute inset-0 z-[1000] pointer-events-none">
      <div
        className="absolute top-0 bottom-0 w-1 bg-white shadow-2xl pointer-events-auto cursor-ew-resize"
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        onMouseDown={onStart}
        onTouchStart={onStart}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-white rounded-full shadow-2xl flex items-center justify-center border-2 border-gray-200">
          <ChevronLeft className="w-5 h-5 text-gray-700" />
          <ChevronRight className="w-5 h-5 text-gray-700" />
        </div>
      </div>
      <div className="absolute top-4 left-4 px-4 py-2.5 bg-bp-success rounded-lg text-bp-text text-sm font-bold shadow-xl pointer-events-auto">
        BEFORE EVENT
      </div>
      <div className="absolute top-4 right-4 px-4 py-2.5 bg-severity-critical rounded-lg text-bp-text text-sm font-bold shadow-xl pointer-events-auto">
        AFTER EVENT + DAMAGE
      </div>
    </div>
  )
}

// =============================================================================
// STATISTICS PANEL
// =============================================================================

function StatsPanel() {
  const stats = {
    totalBuildings: DAMAGED_BUILDINGS.length,
    destroyed: DAMAGED_BUILDINGS.filter(b => b.severity === 'destroyed').length,
    severe: DAMAGED_BUILDINGS.filter(b => b.severity === 'severe').length,
    moderate: DAMAGED_BUILDINGS.filter(b => b.severity === 'moderate').length,
    minor: DAMAGED_BUILDINGS.filter(b => b.severity === 'minor').length,
    totalArea: DAMAGED_BUILDINGS.reduce((sum, b) => sum + (b.width * b.height), 0),
    avgDamage: Math.round(DAMAGED_BUILDINGS.reduce((sum, b) => sum + b.damagePercent, 0) / DAMAGED_BUILDINGS.length),
  }

  return (
    <div className="absolute top-4 right-4 z-[1001] w-72 bg-bp-card/95 backdrop-blur-sm border border-bp-border rounded-xl shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bp-border bg-severity-critical/10">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-severity-critical" />
          <span className="text-sm font-bold text-bp-text">PWTT Analysis Results</span>
        </div>
        <div className="text-[10px] text-bp-text-muted mt-1">Sentinel-1 SAR Change Detection</div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bp-surface rounded-lg p-3">
            <div className="text-2xl font-bold text-bp-text">{stats.totalBuildings}</div>
            <div className="text-[10px] text-bp-text-muted uppercase">Buildings Affected</div>
          </div>
          <div className="bg-bp-surface rounded-lg p-3">
            <div className="text-2xl font-bold text-severity-critical">{stats.avgDamage}%</div>
            <div className="text-[10px] text-bp-text-muted uppercase">Avg Damage</div>
          </div>
        </div>

        {/* Breakdown */}
        <div>
          <div className="text-xs font-medium text-bp-text-muted uppercase mb-2 flex items-center gap-1">
            <Building2 size={12} />
            Damage Classification
          </div>
          <div className="space-y-2">
            {[
              { label: 'Destroyed', count: stats.destroyed, color: '#d73027', pct: '>70%' },
              { label: 'Severe', count: stats.severe, color: '#fc8d59', pct: '40-70%' },
              { label: 'Moderate', count: stats.moderate, color: '#fee08b', pct: '20-40%' },
              { label: 'Minor', count: stats.minor, color: '#91cf60', pct: '<20%' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="text-xs text-bp-text flex-1">{item.label}</span>
                <span className="text-xs text-bp-text-muted">{item.pct}</span>
                <span className="text-xs font-bold text-bp-text w-6 text-right">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Confidence */}
        <div className="pt-3 border-t border-bp-border">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-bp-text-secondary">Analysis Confidence</span>
            <span className="text-bp-success font-bold">94.2%</span>
          </div>
          <div className="h-1.5 bg-bp-surface rounded-full overflow-hidden">
            <div className="h-full bg-bp-success rounded-full" style={{ width: '94.2%' }} />
          </div>
          <div className="text-[10px] text-bp-text-muted mt-1">Based on 12 pre-event + 8 post-event images</div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function SatelliteAnalysis() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const beforeLayer = useRef<L.TileLayer | null>(null)
  const afterLayer = useRef<L.TileLayer | null>(null)
  const buildingsLayer = useRef<L.LayerGroup | null>(null)
  const heatLayer = useRef<any>(null)
  const markerRef = useRef<L.Marker | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('swipe')
  const [swipePos, setSwipePos] = useState(50)
  const [showBuildings, setShowBuildings] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [selectedLocation, setSelectedLocation] = useState<{ name: string } | null>(null)

  const { data: geeStatus } = useGEEStatus()

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    const map = L.map(mapRef.current, {
      center: NEPAL_CENTER,
      zoom: 15,
      maxBounds: NEPAL_BOUNDS,
      minZoom: 6,
      maxZoom: 19,
      zoomControl: false,
    })
    mapInstance.current = map

    // BEFORE layer - Clean satellite imagery (Esri)
    beforeLayer.current = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 }
    )
    beforeLayer.current.addTo(map)

    // AFTER layer - Same imagery but we'll add visual overlays to show damage
    afterLayer.current = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 }
    )
    afterLayer.current.addTo(map)

    // Buildings layer
    buildingsLayer.current = L.layerGroup()
    buildingsLayer.current.addTo(map)

    // Heat layer for change detection
    if (L.heatLayer) {
      heatLayer.current = L.heatLayer(HEAT_POINTS, {
        radius: 35,
        blur: 25,
        maxZoom: 17,
        max: 1.0,
        gradient: {
          0.2: '#91cf60',
          0.4: '#fee08b',
          0.6: '#fc8d59',
          0.8: '#d73027',
          1.0: '#a50026'
        }
      })
    }

    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [])

  // Update building overlays
  useEffect(() => {
    if (!buildingsLayer.current) return
    buildingsLayer.current.clearLayers()

    if (!showBuildings) return

    DAMAGED_BUILDINGS.forEach(building => {
      // Convert meters to approximate lat/lng offset
      const latOffset = building.height / 111320
      const lngOffset = building.width / (111320 * Math.cos(building.lat * Math.PI / 180))

      const bounds: L.LatLngBoundsExpression = [
        [building.lat - latOffset / 2, building.lng - lngOffset / 2],
        [building.lat + latOffset / 2, building.lng + lngOffset / 2]
      ]

      const colors = SEVERITY_COLORS[building.severity]

      const rect = L.rectangle(bounds, {
        color: colors.stroke,
        weight: 2,
        fillColor: colors.fill,
        fillOpacity: 0.6,
        dashArray: building.severity === 'destroyed' ? undefined : '5, 5',
      })

      rect.bindPopup(`
        <div style="font-family: system-ui; min-width: 220px;">
          <div style="background: ${colors.stroke}; color: white; padding: 8px 12px; margin: -8px -12px 8px -12px; font-weight: 600;">
            ${building.severity.toUpperCase()} DAMAGE
          </div>
          <div style="padding: 0 4px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
              <div>
                <div style="font-size: 10px; color: #888; text-transform: uppercase;">Building ID</div>
                <div style="font-weight: 600;">${building.id}</div>
              </div>
              <div>
                <div style="font-size: 10px; color: #888; text-transform: uppercase;">Type</div>
                <div style="font-weight: 600;">${building.buildingType}</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
              <div>
                <div style="font-size: 10px; color: #888; text-transform: uppercase;">Damage</div>
                <div style="font-weight: 600; color: ${colors.stroke};">${building.damagePercent}%</div>
              </div>
              <div>
                <div style="font-size: 10px; color: #888; text-transform: uppercase;">T-Statistic</div>
                <div style="font-weight: 600; color: ${building.tStatistic < -3 ? '#d73027' : '#fc8d59'};">${building.tStatistic.toFixed(1)}</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 8px; border-top: 1px solid #eee;">
              <div>
                <div style="font-size: 10px; color: #888; text-transform: uppercase;">Dimensions</div>
                <div style="font-size: 12px;">${building.width}m × ${building.height}m</div>
              </div>
              <div>
                <div style="font-size: 10px; color: #888; text-transform: uppercase;">Area</div>
                <div style="font-size: 12px;">${(building.width * building.height).toLocaleString()} m²</div>
              </div>
            </div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee; font-size: 10px; color: #666;">
              Detected via Sentinel-1 SAR pixel-wise t-test<br/>
              Confidence: ${building.tStatistic < -3 ? '>99%' : building.tStatistic < -2 ? '95-99%' : '90-95%'}
            </div>
          </div>
        </div>
      `, { maxWidth: 280 })

      buildingsLayer.current!.addLayer(rect)
    })
  }, [showBuildings])

  // Update heat layer
  useEffect(() => {
    if (!mapInstance.current || !heatLayer.current) return

    if (showHeatmap) {
      mapInstance.current.addLayer(heatLayer.current)
    } else {
      mapInstance.current.removeLayer(heatLayer.current)
    }
  }, [showHeatmap])

  // Swipe clip effect
  useEffect(() => {
    const map = mapInstance.current
    if (!map || viewMode !== 'swipe') return

    const updateClip = () => {
      if (beforeLayer.current?.getContainer()) {
        beforeLayer.current.getContainer()!.style.clipPath = `inset(0 ${100 - swipePos}% 0 0)`
        beforeLayer.current.getContainer()!.style.zIndex = '400'
      }
      if (afterLayer.current?.getContainer()) {
        afterLayer.current.getContainer()!.style.clipPath = `inset(0 0 0 ${swipePos}%)`
        afterLayer.current.getContainer()!.style.zIndex = '401'
      }
      // Buildings and heatmap only on "after" side
      if (buildingsLayer.current) {
        const container = (buildingsLayer.current as any)._container
        if (container) {
          container.style.clipPath = `inset(0 0 0 ${swipePos}%)`
        }
      }
    }

    const timer = setTimeout(updateClip, 50)
    map.on('move zoom resize', updateClip)

    return () => {
      clearTimeout(timer)
      map.off('move zoom resize', updateClip)
      // Reset clips
      ;[beforeLayer.current, afterLayer.current].forEach(l => {
        if (l?.getContainer()) l.getContainer()!.style.clipPath = ''
      })
    }
  }, [viewMode, swipePos])

  const handleLocationSelect = useCallback((lat: number, lng: number, name: string) => {
    const map = mapInstance.current
    if (!map) return
    setSelectedLocation({ name })
    map.flyTo([lat, lng], 16, { duration: 1.5 })

    if (markerRef.current) markerRef.current.setLatLng([lat, lng])
    else {
      markerRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:32px;height:32px;background:#0ea5e9;border-radius:50%;border:4px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="white"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"/></svg>
          </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        })
      }).addTo(map)
    }
  }, [])

  const handleReset = useCallback(() => {
    const map = mapInstance.current
    if (!map) return
    map.flyTo(NEPAL_CENTER, 15, { duration: 1 })
    setSelectedLocation(null)
    if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-bp-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-bp-card border-b border-bp-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-severity-critical/10 rounded-lg flex items-center justify-center">
            <Satellite className="w-5 h-5 text-severity-critical" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-bp-text">Infrastructure Damage Assessment</h1>
            <p className="text-xs text-bp-text-muted">PWTT Pixel-Wise T-Test Analysis • Kathmandu Event 2025-09-10</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!geeStatus?.initialized && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-severity-medium/10 border border-severity-medium/30 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-severity-medium" />
              <span className="text-xs text-severity-medium">Demo Mode</span>
            </div>
          )}

          <div className="flex items-center gap-1 bg-bp-surface rounded-lg p-1">
            <button
              onClick={() => setViewMode('swipe')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'swipe' ? 'bg-bp-primary/20 text-bp-primary' : 'text-bp-text-secondary hover:text-bp-text hover:bg-bp-hover'
              }`}
            >
              <SplitSquareHorizontal size={14} />
              Compare
            </button>
            <button
              onClick={() => setViewMode('analysis')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'analysis' ? 'bg-bp-primary/20 text-bp-primary' : 'text-bp-text-secondary hover:text-bp-text hover:bg-bp-hover'
              }`}
            >
              <TrendingDown size={14} />
              Analysis
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className="w-72 bg-bp-card border-r border-bp-border flex flex-col">
          <div className="p-4 border-b border-bp-border">
            <label className="text-xs font-medium text-bp-text-muted uppercase tracking-wide mb-2 block">Search Location</label>
            <LocationSearch onSelect={handleLocationSelect} />
            {selectedLocation && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-bp-text-secondary">{selectedLocation.name}</span>
                <button onClick={handleReset} className="text-bp-primary hover:text-bp-primary/80"><RotateCcw className="w-3 h-3" /></button>
              </div>
            )}
          </div>

          <div className="p-4 border-b border-bp-border">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={14} className="text-bp-text-muted" />
              <span className="text-xs font-medium text-bp-text-muted uppercase">Event Timeline</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-bp-text-muted">Baseline:</span><span className="text-bp-success font-medium">2025-08-01 to 2025-09-05</span></div>
              <div className="flex justify-between"><span className="text-bp-text-muted">Event:</span><span className="text-severity-critical font-medium">2025-09-10</span></div>
              <div className="flex justify-between"><span className="text-bp-text-muted">Post-Event:</span><span className="text-severity-high font-medium">2025-09-11 to 2025-09-20</span></div>
            </div>
          </div>

          <div className="p-4 border-b border-bp-border">
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-bp-text-muted" />
              <span className="text-xs font-medium text-bp-text-muted uppercase">Analysis Layers</span>
            </div>

            <div className="space-y-2">
              <button onClick={() => setShowBuildings(!showBuildings)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${showBuildings ? 'bg-severity-critical/10 ring-1 ring-severity-critical/30' : 'hover:bg-bp-surface'}`}>
                <div className={`w-3 h-3 rounded-sm ${showBuildings ? 'bg-severity-critical' : 'bg-bp-border'}`} />
                <div className="flex-1 text-left">
                  <div className={`text-sm ${showBuildings ? 'text-bp-text' : 'text-bp-text-secondary'}`}>Building Damage</div>
                  <div className="text-[10px] text-bp-text-muted">{DAMAGED_BUILDINGS.length} structures detected</div>
                </div>
                {showBuildings ? <Eye size={14} className="text-bp-text-secondary" /> : <EyeOff size={14} className="text-bp-text-muted" />}
              </button>

              <button onClick={() => setShowHeatmap(!showHeatmap)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${showHeatmap ? 'bg-severity-high/10 ring-1 ring-severity-high/30' : 'hover:bg-bp-surface'}`}>
                <div className={`w-3 h-3 rounded-sm ${showHeatmap ? 'bg-severity-high' : 'bg-bp-border'}`} />
                <div className="flex-1 text-left">
                  <div className={`text-sm ${showHeatmap ? 'text-bp-text' : 'text-bp-text-secondary'}`}>Change Heatmap</div>
                  <div className="text-[10px] text-bp-text-muted">SAR backscatter delta</div>
                </div>
                {showHeatmap ? <Eye size={14} className="text-bp-text-secondary" /> : <EyeOff size={14} className="text-bp-text-muted" />}
              </button>
            </div>
          </div>

          <div className="p-4 border-b border-bp-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={14} className="text-bp-text-muted" />
              <span className="text-xs font-medium text-bp-text-muted uppercase">Quick Navigate</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {['Dharahara', 'Singha Durbar', 'Ratna Park', 'Tundikhel'].map(place => (
                <button key={place} onClick={() => {
                  const loc = NEPAL_LOCATIONS[place.toLowerCase()]
                  if (loc) handleLocationSelect(loc.lat, loc.lng, loc.name)
                }} className="px-2 py-1 bg-bp-surface text-xs text-bp-text-secondary hover:text-bp-text rounded border border-bp-border hover:border-bp-primary/50 transition-colors">
                  {place}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 mt-auto border-t border-bp-border">
            <div className="flex items-center gap-2 mb-3">
              <Info size={14} className="text-bp-text-muted" />
              <span className="text-xs font-medium text-bp-text-muted uppercase">Legend</span>
            </div>
            <div className="space-y-2">
              {[
                { color: '#d73027', label: 'Destroyed', desc: 'T-stat < -3.0' },
                { color: '#fc8d59', label: 'Severe', desc: 'T-stat -3.0 to -2.0' },
                { color: '#fee08b', label: 'Moderate', desc: 'T-stat -2.0 to -1.5' },
                { color: '#91cf60', label: 'Minor', desc: 'T-stat -1.5 to -1.0' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm border" style={{ backgroundColor: item.color, borderColor: item.color }} />
                  <span className="text-xs text-bp-text flex-1">{item.label}</span>
                  <span className="text-[10px] text-bp-text-muted">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          <div ref={mapRef} className="h-full w-full" />

          {viewMode === 'swipe' && <SwipeSlider position={swipePos} onChange={setSwipePos} />}
          {viewMode === 'analysis' && <StatsPanel />}

          <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2">
            <button onClick={() => mapInstance.current?.zoomIn()} className="p-2.5 bg-bp-card/95 backdrop-blur-sm border border-bp-border rounded-lg text-bp-text-secondary hover:text-bp-text hover:bg-bp-surface transition-colors shadow-xl">
              <ZoomIn size={18} />
            </button>
            <button onClick={() => mapInstance.current?.zoomOut()} className="p-2.5 bg-bp-card/95 backdrop-blur-sm border border-bp-border rounded-lg text-bp-text-secondary hover:text-bp-text hover:bg-bp-surface transition-colors shadow-xl">
              <ZoomOut size={18} />
            </button>
            <button onClick={handleReset} className="p-2.5 bg-bp-card/95 backdrop-blur-sm border border-bp-border rounded-lg text-bp-text-secondary hover:text-bp-text hover:bg-bp-surface transition-colors shadow-xl">
              <Maximize2 size={18} />
            </button>
          </div>

          <div className="absolute bottom-4 left-4 z-[1000] max-w-sm bg-bp-card/95 backdrop-blur-sm border border-bp-border rounded-lg p-3 shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <Info size={12} className="text-bp-primary" />
              <span className="text-xs font-bold text-bp-text">Methodology: PWTT Analysis</span>
            </div>
            <p className="text-[10px] text-bp-text-secondary leading-relaxed">
              Pixel-Wise T-Test comparing 12 pre-event and 8 post-event Sentinel-1 SAR images.
              Buildings with significant backscatter decrease (T &lt; -1.0) flagged as damaged.
              Click any building rectangle for detailed damage assessment.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
