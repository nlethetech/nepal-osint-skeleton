import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getYouthStress } from '../../api/analytics'
import type { DistrictStress } from '../../types/api'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { injectTooltipStyles } from '../map/tooltipUtils'

// Nepal center coordinates and bounds
const NEPAL_CENTER: [number, number] = [28.3949, 84.1240]
const NEPAL_ZOOM = 7
const NEPAL_BOUNDS: [[number, number], [number, number]] = [[26.347, 80.058], [30.447, 88.201]]

const getColor = (level: string): string => {
  switch (level) {
    case 'high':
      return '#ef4444' // severity-critical
    case 'elevated':
      return '#eab308' // severity-medium
    case 'low':
      return '#22c55e' // severity-low
    default:
      return '#71717a' // osint-muted
  }
}

const getRadius = (eventCount: number): number => {
  // Scale radius based on event count (min 5, max 20)
  return Math.min(20, Math.max(5, 5 + Math.sqrt(eventCount) * 2))
}

// Component to inject tooltip styles when map is ready
function TooltipStylesInjector() {
  const map = useMap()
  useEffect(() => {
    if (map) {
      injectTooltipStyles()
    }
  }, [map])
  return null
}

export function YouthStressMap() {
  const [data, setData] = useState<DistrictStress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await getYouthStress()
        setData(result)
      } catch (err) {
        setError('Failed to load map data')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner message="Loading map data..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-osint-muted">
        {error}
      </div>
    )
  }

  return (
    <div className="h-full w-full rounded-lg overflow-hidden relative isolate">
      <MapContainer
        center={NEPAL_CENTER}
        zoom={NEPAL_ZOOM}
        minZoom={7}
        maxZoom={18}
        maxBounds={NEPAL_BOUNDS}
        maxBoundsViscosity={1.0}
        className="h-full w-full"
        style={{ background: '#0d0d12' }}
      >
        <TooltipStylesInjector />
        <TileLayer
          attribution='&copy; Esri'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        {data.map((district) => (
          <CircleMarker
            key={district.district}
            center={[district.lat, district.lng]}
            radius={getRadius(district.event_count)}
            pathOptions={{
              color: getColor(district.level),
              fillColor: getColor(district.level),
              fillOpacity: 0.6,
              weight: 2,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              opacity={1}
              permanent={false}
              sticky={false}
              interactive={false}
              className="district-tooltip"
            >
              <div className="text-sm">
                <div className="font-semibold">{district.district}</div>
                <div>Stress Index: {district.youth_stress.toFixed(1)}</div>
                <div>Events: {district.event_count}</div>
                <div className="capitalize">Level: {district.level}</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Legend - z-index below mobile sidebar (z-50) */}
      <div className="absolute bottom-4 right-4 bg-osint-card/90 border border-osint-border rounded-lg p-3 z-[40]">
        <div className="text-xs font-semibold mb-2">Youth Stress Level</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-severity-critical" />
            <span className="text-xs">High</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-severity-medium" />
            <span className="text-xs">Elevated</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-severity-low" />
            <span className="text-xs">Low</span>
          </div>
        </div>
      </div>
    </div>
  )
}
