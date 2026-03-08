import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapMetric } from '../../store/slices/mapSlice'
import { NEPAL_BOUNDS, PROVINCE_COLORS } from '../../data/districts'
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils'

interface DistrictData {
  name: string
  nameNe?: string
  province: string
  lat: number
  lng: number
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
  // LiveUAMap: Real-time pulse
  hasCriticalEvent?: boolean
  lastEventTime?: Date
}

interface NepalDistrictMapProps {
  districts: DistrictData[]
  metric: MapMetric
  selectedDistrict: DistrictData | null
  onDistrictClick: (district: DistrictData) => void
  onDistrictHover: (district: DistrictData | null) => void
}

// Get color based on value (0-100 scale)
function getValueColor(value: number): string {
  if (value >= 70) return '#ef4444' // Red - Critical
  if (value >= 50) return '#f97316' // Orange - High
  if (value >= 30) return '#eab308' // Yellow - Medium
  return '#22c55e' // Green - Low
}

// Get color based on threat level
function getThreatColor(level?: string): string {
  switch (level) {
    case 'critical': return '#ef4444' // Red
    case 'high': return '#f97316' // Orange
    case 'medium': return '#eab308' // Yellow
    case 'low':
    default: return '#22c55e' // Green
  }
}

// Get marker size based on value
function getMarkerRadius(value: number): number {
  const base = 8
  const max = 20
  return base + (value / 100) * (max - base)
}

export function NepalDistrictMap({
  districts,
  metric,
  selectedDistrict,
  onDistrictClick,
  onDistrictHover,
}: NepalDistrictMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<L.Map | null>(null)
  const markersRef = useRef<L.CircleMarker[]>([])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return

    // Inject tooltip styles for consistent behavior
    injectTooltipStyles()

    // Nepal bounds - restrict map to Nepal only
    const nepalLatLngBounds = L.latLngBounds(
      L.latLng(NEPAL_BOUNDS.bounds.south, NEPAL_BOUNDS.bounds.west),
      L.latLng(NEPAL_BOUNDS.bounds.north, NEPAL_BOUNDS.bounds.east)
    )

    // Create map
    const map = L.map(mapRef.current, {
      center: [NEPAL_BOUNDS.center.lat, NEPAL_BOUNDS.center.lng],
      zoom: NEPAL_BOUNDS.zoom,
      minZoom: NEPAL_BOUNDS.minZoom,
      maxZoom: NEPAL_BOUNDS.maxZoom,
      maxBounds: nepalLatLngBounds,
      maxBoundsViscosity: 1.0,  // Solid bounds - can't drag outside
      zoomControl: false,
      attributionControl: false,
    })

    // Add zoom control to top-right
    L.control.zoom({ position: 'topright' }).addTo(map)

    // Satellite imagery layer (ESRI World Imagery)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '© Esri',
    }).addTo(map)

    // Add attribution
    L.control.attribution({
      position: 'bottomright',
      prefix: '© Esri World Imagery',
    }).addTo(map)

    leafletMap.current = map

    return () => {
      map.remove()
      leafletMap.current = null
    }
  }, [])

  // Update markers when data changes
  useEffect(() => {
    const map = leafletMap.current
    if (!map) return

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    // Get value based on metric
    const getValue = (district: DistrictData): number => {
      switch (metric) {
        case 'youth_stress':
          return district.youthStress ?? district.value
        case 'events':
          return district.eventCount ?? 0
        case 'alerts':
          return district.alertCount ?? 0
        case 'threat':
          // Map threat level to numeric value for sizing
          switch (district.threatLevel) {
            case 'critical': return 100
            case 'high': return 70
            case 'medium': return 40
            default: return 10
          }
        default:
          return district.value
      }
    }

    // Get color for a district based on metric
    const getColor = (district: DistrictData, value: number): string => {
      if (metric === 'threat') {
        return getThreatColor(district.threatLevel)
      }
      return getValueColor(metric === 'events' || metric === 'alerts'
        ? (value / 50) * 100
        : value
      )
    }

    // Create markers for each district
    districts.forEach((district) => {
      const value = getValue(district)
      const isSelected = selectedDistrict?.name === district.name
      const color = getColor(district, value)
      const radius = isSelected
        ? getMarkerRadius(value) * 1.3
        : getMarkerRadius(value)

      // Get province-specific border color
      const provinceColor = PROVINCE_COLORS[district.province] || '#64748b'

      const marker = L.circleMarker([district.lat, district.lng], {
        radius,
        fillColor: color,
        fillOpacity: isSelected ? 0.9 : 0.7,
        color: isSelected ? '#ffffff' : provinceColor,
        weight: isSelected ? 3.5 : 2.5,
        className: 'transition-all duration-200',
      }).addTo(map)

      // Build tooltip content based on metric
      let threatBreakdown = ''
      if (metric === 'threat' && (district.criticalEvents || district.highEvents || district.mediumEvents || district.lowEvents)) {
        threatBreakdown = `
          <div class="mt-2 pt-2 border-t border-gray-600">
            <div class="text-xs text-gray-400 mb-1">Event Severity:</div>
            ${district.criticalEvents ? `<div class="flex justify-between gap-2"><span class="text-red-400">Critical:</span><span class="text-white">${district.criticalEvents}</span></div>` : ''}
            ${district.highEvents ? `<div class="flex justify-between gap-2"><span class="text-orange-400">High:</span><span class="text-white">${district.highEvents}</span></div>` : ''}
            ${district.mediumEvents ? `<div class="flex justify-between gap-2"><span class="text-yellow-400">Medium:</span><span class="text-white">${district.mediumEvents}</span></div>` : ''}
            ${district.lowEvents ? `<div class="flex justify-between gap-2"><span class="text-green-400">Low:</span><span class="text-white">${district.lowEvents}</span></div>` : ''}
          </div>
        `
      }

      // Create tooltip
      const tooltipContent = `
        <div class="font-sans text-sm">
          <div class="font-bold text-white">${district.name}</div>
          ${district.nameNe ? `<div class="text-gray-300 text-xs">${district.nameNe}</div>` : ''}
          <div class="text-xs text-gray-400 mt-1">${district.province} Province</div>
          ${district.threatLevel ? `
            <div class="mt-2 px-2 py-1 rounded text-xs font-semibold uppercase ${
              district.threatLevel === 'critical' ? 'bg-red-500/30 text-red-400' :
              district.threatLevel === 'high' ? 'bg-orange-500/30 text-orange-400' :
              district.threatLevel === 'medium' ? 'bg-yellow-500/30 text-yellow-400' :
              'bg-green-500/30 text-green-400'
            }">
              ${district.threatLevel} Threat
            </div>
          ` : ''}
          <div class="mt-2 space-y-1">
            <div class="flex justify-between gap-4">
              <span class="text-gray-400">Stress Index:</span>
              <span class="text-white font-medium">${(district.youthStress ?? 0).toFixed(1)}</span>
            </div>
            <div class="flex justify-between gap-4">
              <span class="text-gray-400">Events:</span>
              <span class="text-white font-medium">${district.eventCount ?? 0}</span>
            </div>
            ${district.topEventType ? `
            <div class="flex justify-between gap-4">
              <span class="text-gray-400">Top Type:</span>
              <span class="text-white font-medium capitalize">${district.topEventType.replace('_', ' ')}</span>
            </div>
            ` : ''}
            <div class="flex justify-between gap-4">
              <span class="text-gray-400">Alerts:</span>
              <span class="text-white font-medium">${district.alertCount ?? 0}</span>
            </div>
          </div>
          ${threatBreakdown}
        </div>
      `

      marker.bindTooltip(tooltipContent, {
        permanent: false,
        sticky: false,
        interactive: false,
        direction: 'top',
        className: 'district-tooltip bg-osint-bg border border-osint-border rounded-lg shadow-xl px-3 py-2',
        offset: [0, -10],
      })

      // Add delayed tooltip behavior (250ms show delay, immediate hide)
      addDelayedTooltipBehavior(marker, { showDelay: 250, hideDelay: 0 })

      // Event handlers - thicker borders for satellite visibility
      marker.on('click', () => onDistrictClick(district))
      marker.on('mouseover', () => {
        onDistrictHover(district)
        marker.setStyle({
          weight: 3.5,
          color: '#ffffff',
          fillOpacity: 0.9,
        })
      })
      marker.on('mouseout', () => {
        if (selectedDistrict?.name !== district.name) {
          onDistrictHover(null)
          marker.setStyle({
            weight: 2.5,
            color: provinceColor,
            fillOpacity: 0.7,
          })
        }
      })

      markersRef.current.push(marker)

      // No outer ring indicators - simple markers only
    })

    // Add province labels (one per province)
    const provinceLabels = new Map<string, { lat: number; lng: number; count: number }>()
    districts.forEach((d) => {
      const existing = provinceLabels.get(d.province)
      if (!existing) {
        provinceLabels.set(d.province, { lat: d.lat, lng: d.lng, count: 1 })
      } else {
        existing.lat = (existing.lat * existing.count + d.lat) / (existing.count + 1)
        existing.lng = (existing.lng * existing.count + d.lng) / (existing.count + 1)
        existing.count++
      }
    })

  }, [districts, metric, selectedDistrict, onDistrictClick, onDistrictHover])

  // Pan to selected district
  useEffect(() => {
    const map = leafletMap.current
    if (!map || !selectedDistrict) return

    map.setView([selectedDistrict.lat, selectedDistrict.lng], 9, {
      animate: true,
      duration: 0.5,
    })
  }, [selectedDistrict])

  return (
    <div ref={mapRef} className="w-full h-full isolate" />
  )
}
