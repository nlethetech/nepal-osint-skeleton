/**
 * CurfewOverlay - District highlighting for active curfews
 * =========================================================
 *
 * Overlays red highlighting on districts with active curfew orders.
 * Curfews are detected automatically from DAO and provincial government
 * announcements containing keywords like कर्फ्यु, निषेधाज्ञा, etc.
 *
 * Features:
 * - Red pulsing border on affected districts
 * - Curfew icon markers at district centroids
 * - Tooltip with curfew details and expiration
 * - Automatic refresh every 5 minutes
 */

import { useEffect, useRef, useCallback, memo } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap, GeoJSON as GeoJSONLayer, CircleMarker } from 'leaflet'

// Hooks
import { useCurfewDistricts } from '../../api/hooks/useCurfew'
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils'

// =============================================================================
// TYPES
// =============================================================================

export interface CurfewOverlayProps {
  /** Leaflet map instance */
  map: LeafletMap | null
  /** Whether overlay is visible */
  visible?: boolean
  /** Callback when curfew district is clicked */
  onCurfewClick?: (district: string, alert: CurfewAlertInfo) => void
}

interface CurfewAlertInfo {
  district: string
  severity: string
  hours_remaining: number
  title: string
}

interface DistrictCentroid {
  [district: string]: [number, number] // [lat, lng]
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** District centroids (approximate) for marker placement */
const DISTRICT_CENTROIDS: DistrictCentroid = {
  'Kathmandu': [27.7172, 85.3240],
  'Lalitpur': [27.6667, 85.3167],
  'Bhaktapur': [27.6710, 85.4298],
  'Kaski': [28.2096, 83.9856],
  'Morang': [26.6610, 87.4395],
  'Sunsari': [26.6500, 87.1667],
  'Jhapa': [26.5455, 87.8942],
  'Parsa': [27.1347, 84.8272],
  'Chitwan': [27.5291, 84.3542],
  'Rupandehi': [27.5000, 83.4500],
  'Banke': [28.0544, 81.6181],
  'Dang': [28.0500, 82.3000],
  'Kailali': [28.7833, 80.5500],
  'Kanchanpur': [29.0333, 80.2500],
  'Dhanusa': [26.8667, 86.0000],
  'Sarlahi': [26.8667, 85.5667],
  'Rautahat': [26.9833, 85.2833],
  'Bara': [27.0667, 85.0000],
  'Makwanpur': [27.4000, 85.0333],
  'Sindhuli': [27.2500, 85.9667],
  'Dolakha': [27.8333, 86.0833],
  'Sindhupalchok': [27.9500, 85.7000],
  'Gorkha': [28.0000, 84.6333],
  'Lamjung': [28.2500, 84.3500],
  'Tanahun': [27.9333, 84.2167],
  'Nawalpur': [27.6667, 84.1167],
  'Syangja': [28.0833, 83.8833],
  'Palpa': [27.8667, 83.5333],
  'Gulmi': [28.0833, 83.2833],
  'Arghakhanchi': [27.9500, 83.1333],
  'Kapilvastu': [27.5667, 83.0500],
  'Baglung': [28.2667, 83.5833],
  'Parbat': [28.2167, 83.7000],
  'Myagdi': [28.5167, 83.4833],
  'Mustang': [28.9833, 83.8500],
  'Manang': [28.6667, 84.0167],
  'Pyuthan': [28.0833, 82.8500],
  'Rolpa': [28.2833, 82.6500],
  'Rukum East': [28.5333, 82.6167],
  'Rukum West': [28.6000, 82.2000],
  'Salyan': [28.3667, 82.1500],
  'Surkhet': [28.6000, 81.6167],
  'Dailekh': [28.8333, 81.7000],
  'Jajarkot': [28.7500, 82.2000],
  'Dolpa': [29.0000, 82.8667],
  'Jumla': [29.2833, 82.1833],
  'Kalikot': [29.1333, 81.6333],
  'Mugu': [29.5000, 82.0833],
  'Humla': [29.9667, 81.9333],
  'Bardiya': [28.4333, 81.3500],
  'Achham': [29.0500, 81.2500],
  'Doti': [29.2500, 80.9500],
  'Bajhang': [29.5333, 81.1833],
  'Bajura': [29.4500, 81.4833],
  'Dadeldhura': [29.3000, 80.5833],
  'Baitadi': [29.5167, 80.4167],
  'Darchula': [29.8500, 80.5500],
}

/** Curfew polygon style - red pulsing border */
const CURFEW_STYLE: L.PathOptions = {
  fillColor: '#ef4444',
  fillOpacity: 0.2,
  color: '#dc2626',
  weight: 3,
  opacity: 0.9,
}

/** Curfew marker icon - simple circle with border, no outer rings */
const createCurfewIcon = (severity: string) => {
  const color = severity === 'critical' ? '#ef4444' : '#f97316'
  // Use thicker border for critical severity
  const borderWidth = severity === 'critical' ? 2.5 : 2

  return L.divIcon({
    className: 'curfew-marker',
    html: `
      <div class="relative" style="width: 24px; height: 24px;">
        <div class="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
             style="background-color: #0a0c10; border: ${borderWidth}px solid ${color}; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
          <span style="color: ${color};">⚠</span>
        </div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

// =============================================================================
// COMPONENT
// =============================================================================

export const CurfewOverlay = memo(function CurfewOverlay({
  map,
  visible = true,
  onCurfewClick,
}: CurfewOverlayProps) {
  // Refs
  const markersRef = useRef<L.Marker[]>([])
  const geoJsonLayerRef = useRef<GeoJSONLayer | null>(null)

  // Fetch curfew data
  const { districts, alerts, hasCurfews, isLoading } = useCurfewDistricts()

  // Create tooltip content
  const createTooltip = useCallback((alert: CurfewAlertInfo): string => {
    const hoursText = alert.hours_remaining < 1
      ? 'Expiring soon'
      : `${Math.round(alert.hours_remaining)}h remaining`

    return `
      <div class="p-2 min-w-[180px]">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-red-400 font-bold">⚠ CURFEW</span>
          <span class="px-1.5 py-0.5 text-xs rounded ${
            alert.severity === 'critical'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-orange-500/20 text-orange-400'
          }">${alert.severity.toUpperCase()}</span>
        </div>
        <div class="font-semibold text-white">${alert.district}</div>
        <div class="text-xs text-gray-400 mt-1 truncate">${alert.title}</div>
        <div class="text-xs text-osint-accent mt-1">${hoursText}</div>
      </div>
    `
  }, [])

  // Cleanup markers
  const cleanupMarkers = useCallback(() => {
    markersRef.current.forEach(marker => {
      if (map) marker.removeFrom(map)
    })
    markersRef.current = []
  }, [map])

  // Update markers when curfew data changes
  useEffect(() => {
    if (!map || !visible) {
      cleanupMarkers()
      return
    }

    // Inject tooltip styles
    injectTooltipStyles()

    // Cleanup previous markers
    cleanupMarkers()

    // Add markers for each curfew district
    alerts.forEach(alert => {
      const centroid = DISTRICT_CENTROIDS[alert.district]
      if (!centroid) return

      const marker = L.marker(centroid, {
        icon: createCurfewIcon(alert.severity),
        zIndexOffset: 1000, // Above other markers
      })

      // Bind tooltip with professional options to prevent clutter
      marker.bindTooltip(createTooltip(alert), {
        direction: 'top',
        permanent: false,
        sticky: false,
        interactive: false,
        className: 'curfew-tooltip bg-osint-bg border border-red-500/30 rounded-lg shadow-md',
        offset: [0, -10],
        opacity: 1,
      })

      // Add delayed tooltip behavior (250ms show delay, immediate hide)
      addDelayedTooltipBehavior(marker, { showDelay: 250, hideDelay: 0 })

      // Click handler
      if (onCurfewClick) {
        marker.on('click', () => {
          onCurfewClick(alert.district, alert)
        })
      }

      marker.addTo(map)
      markersRef.current.push(marker)
    })

    // Cleanup on unmount
    return () => cleanupMarkers()
  }, [map, visible, alerts, cleanupMarkers, createTooltip, onCurfewClick])

  // Inject CSS for pulsing animation
  useEffect(() => {
    const styleId = 'curfew-overlay-styles'
    if (document.getElementById(styleId)) return

    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .curfew-marker {
        background: transparent;
        border: none;
      }

      .curfew-tooltip {
        background: #0a0c10 !important;
        border: 1px solid rgba(239, 68, 68, 0.3) !important;
        color: white !important;
        padding: 0 !important;
      }

      .curfew-tooltip::before {
        border-top-color: rgba(239, 68, 68, 0.3) !important;
      }

      .curfew-district-highlight {
        stroke-dasharray: 5 3;
      }
    `
    document.head.appendChild(style)

    return () => {
      const existingStyle = document.getElementById(styleId)
      if (existingStyle) existingStyle.remove()
    }
  }, [])

  // No visual output - this is a marker manager
  return null
})

// =============================================================================
// HELPER HOOK
// =============================================================================

/**
 * Hook to get curfew districts for DistrictPolygonsLayer integration.
 *
 * Returns district names that should be highlighted with curfew styling.
 */
export function useCurfewHighlights() {
  const { districts, alerts, hasCurfews, isLoading, error } = useCurfewDistricts()

  return {
    curfewDistricts: districts,
    curfewAlerts: alerts,
    hasCurfews,
    isLoading,
    error,
  }
}

export default CurfewOverlay
