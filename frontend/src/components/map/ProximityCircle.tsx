/**
 * ProximityCircle - Interactive radius selection tool for Leaflet map
 *
 * Features:
 * - Click map to set center point
 * - Adjustable radius
 * - Visual circle overlay
 * - Cursor change when in proximity mode
 */

import { useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils'

interface ProximityCircleProps {
  map: LeafletMap | null
  enabled: boolean
  center: [number, number] | null // [lat, lng]
  radiusKm: number
  onCenterChange: (center: [number, number]) => void
  onRadiusChange?: (radiusKm: number) => void
  eventCount?: number
}

export function ProximityCircle({
  map,
  enabled,
  center,
  radiusKm,
  onCenterChange,
  onRadiusChange,
  eventCount,
}: ProximityCircleProps) {
  const circleRef = useRef<L.Circle | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  // Handle map clicks
  const handleMapClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!enabled) return
      const { lat, lng } = e.latlng
      onCenterChange([lat, lng])
    },
    [enabled, onCenterChange]
  )

  // Setup/cleanup click handler and cursor
  useEffect(() => {
    if (!map) return

    if (enabled) {
      map.on('click', handleMapClick)
      map.getContainer().style.cursor = 'crosshair'
    } else {
      map.off('click', handleMapClick)
      map.getContainer().style.cursor = ''
    }

    return () => {
      map.off('click', handleMapClick)
      map.getContainer().style.cursor = ''
    }
  }, [map, enabled, handleMapClick])

  // Draw/update circle and center marker
  useEffect(() => {
    if (!map) return

    // Inject tooltip styles
    injectTooltipStyles()

    // Remove existing layers
    if (circleRef.current) {
      map.removeLayer(circleRef.current)
      circleRef.current = null
    }
    if (markerRef.current) {
      map.removeLayer(markerRef.current)
      markerRef.current = null
    }

    // Only draw if enabled and center is set
    if (!enabled || !center) return

    const [lat, lng] = center

    // Create circle
    circleRef.current = L.circle([lat, lng], {
      radius: radiusKm * 1000, // Leaflet uses meters
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      weight: 2,
      dashArray: '10, 6',
      className: 'proximity-circle',
    }).addTo(map)

    // Create center marker
    markerRef.current = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'proximity-center-icon',
        html: `
          <div style="
            position: relative;
            width: 24px;
            height: 24px;
          ">
            <div style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 12px;
              height: 12px;
              background: #3b82f6;
              border: 2px solid white;
              border-radius: 50%;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            "></div>
            <div style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 24px;
              height: 24px;
              border: 2px solid #3b82f6;
              border-radius: 50%;
              opacity: 0.5;
            "></div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      draggable: true,
    }).addTo(map)

    // Handle marker drag
    markerRef.current.on('dragend', (e) => {
      const newLatLng = e.target.getLatLng()
      onCenterChange([newLatLng.lat, newLatLng.lng])
    })

    // Add tooltip showing radius and event count
    const tooltipContent = eventCount !== undefined
      ? `<div style="text-align: center;">
          <div style="font-weight: bold;">${radiusKm} km radius</div>
          <div style="font-size: 11px; color: #94a3b8;">${eventCount} events found</div>
          <div style="font-size: 10px; color: #64748b;">Drag to move center</div>
        </div>`
      : `<div style="text-align: center;">
          <div style="font-weight: bold;">${radiusKm} km radius</div>
          <div style="font-size: 10px; color: #64748b;">Drag to move center</div>
        </div>`

    markerRef.current.bindTooltip(tooltipContent, {
      permanent: false,
      sticky: false,
      interactive: false,
      direction: 'top',
      offset: [0, -12],
      className: 'proximity-tooltip',
      opacity: 1,
    })

    // Add delayed tooltip behavior (250ms show delay, immediate hide)
    addDelayedTooltipBehavior(markerRef.current, { showDelay: 250, hideDelay: 0 })

    return () => {
      if (circleRef.current && map) {
        map.removeLayer(circleRef.current)
        circleRef.current = null
      }
      if (markerRef.current && map) {
        map.removeLayer(markerRef.current)
        markerRef.current = null
      }
    }
  }, [map, enabled, center, radiusKm, eventCount, onCenterChange])

  // Update circle radius when it changes
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(radiusKm * 1000)
    }
  }, [radiusKm])

  return null
}

export default ProximityCircle

// =============================================================================
// Radius Control Component (for use alongside ProximityCircle)
// =============================================================================

interface ProximityRadiusControlProps {
  radiusKm: number
  onRadiusChange: (radiusKm: number) => void
  eventCount?: number
  onClear: () => void
}

export function ProximityRadiusControl({
  radiusKm,
  onRadiusChange,
  eventCount,
  onClear,
}: ProximityRadiusControlProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '60px',
        left: '12px',
        zIndex: 1000,
        background: 'rgba(15, 16, 18, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '12px',
        minWidth: '180px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#e2e8f0' }}>
          Proximity Search
        </span>
        <button
          onClick={onClear}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '2px',
            fontSize: '10px',
          }}
        >
          Clear
        </button>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
          <span>Radius</span>
          <span style={{ color: '#3b82f6', fontWeight: 600 }}>{radiusKm} km</span>
        </div>
        <input
          type="range"
          min="5"
          max="200"
          step="5"
          value={radiusKm}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
          style={{
            width: '100%',
            height: '4px',
            background: '#1e293b',
            borderRadius: '2px',
            appearance: 'none',
            cursor: 'pointer',
          }}
        />
      </div>

      {eventCount !== undefined && (
        <div style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#3b82f6',
          textAlign: 'center',
          padding: '6px',
          background: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '4px',
        }}>
          {eventCount} event{eventCount !== 1 ? 's' : ''} found
        </div>
      )}
    </div>
  )
}
