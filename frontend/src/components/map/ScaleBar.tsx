/**
 * ScaleBar - Map scale indicator
 * ===============================
 *
 * Shows distance scale that updates with zoom level:
 * - Metric units (km/m)
 * - Positioned in bottom-left corner
 * - Professional styling matching OSINT theme
 */

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'

// =============================================================================
// TYPES
// =============================================================================

export interface ScaleBarProps {
  /** Leaflet map instance */
  map: LeafletMap | null
  /** Whether the scale bar is visible */
  visible?: boolean
  /** Position on the map */
  position?: 'bottomleft' | 'bottomright' | 'topleft' | 'topright'
  /** Maximum width in pixels */
  maxWidth?: number
  /** Show imperial units alongside metric */
  showImperial?: boolean
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ScaleBar({
  map,
  visible = true,
  position = 'bottomleft',
  maxWidth = 100,
  showImperial = false,
}: ScaleBarProps) {
  const scaleControlRef = useRef<L.Control.Scale | null>(null)

  useEffect(() => {
    if (!map) return

    // Remove existing scale control if any
    if (scaleControlRef.current) {
      map.removeControl(scaleControlRef.current)
      scaleControlRef.current = null
    }

    if (!visible) return

    // Create scale control
    const scaleControl = L.control.scale({
      position,
      maxWidth,
      metric: true,
      imperial: showImperial,
      updateWhenIdle: false,
    })

    scaleControl.addTo(map)
    scaleControlRef.current = scaleControl

    // Inject custom styles
    injectScaleStyles()

    return () => {
      if (scaleControlRef.current && map) {
        map.removeControl(scaleControlRef.current)
        scaleControlRef.current = null
      }
    }
  }, [map, visible, position, maxWidth, showImperial])

  // No visual output - uses Leaflet's native control
  return null
}

// =============================================================================
// STYLES
// =============================================================================

let stylesInjected = false

function injectScaleStyles() {
  if (stylesInjected || typeof document === 'undefined') return

  const styles = `
    /* Custom scale bar styling - Light theme */
    .leaflet-control-scale {
      margin-left: 290px !important; /* Offset for legend panel */
      margin-bottom: 8px !important;
      z-index: 1000 !important;
    }

    .leaflet-control-scale-line {
      background: #ffffff !important;
      border: 1px solid #d1d5db !important;
      border-top: none !important;
      color: #374151 !important;
      font-size: 10px !important;
      font-weight: 500 !important;
      font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
      padding: 2px 6px !important;
      text-shadow: none !important;
      line-height: 1.4 !important;
    }

    .leaflet-control-scale-line:first-child {
      border-top: 1px solid #d1d5db !important;
      border-radius: 4px 4px 0 0;
    }

    .leaflet-control-scale-line:last-child {
      border-radius: 0 0 4px 4px;
    }

    .leaflet-control-scale-line:only-child {
      border-radius: 4px;
      border-top: 1px solid #d1d5db !important;
    }

    /* When legend is collapsed, adjust position */
    @media (max-width: 640px) {
      .leaflet-control-scale {
        margin-left: 60px !important;
      }
    }
  `

  const styleElement = document.createElement('style')
  styleElement.id = 'scale-bar-styles'
  styleElement.textContent = styles
  document.head.appendChild(styleElement)

  stylesInjected = true
}

export default ScaleBar
