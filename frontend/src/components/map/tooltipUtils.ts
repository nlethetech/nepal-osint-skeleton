/**
 * tooltipUtils - Utilities for professional tooltip behavior in Leaflet maps
 * ============================================================================
 *
 * Provides delayed tooltip show/hide behavior to prevent cluttered, glitchy tooltips.
 * - 250ms delay before showing tooltip
 * - Immediate hide on mouseout
 * - Only one tooltip visible at a time
 */

import L from 'leaflet'
import type { Layer, Marker, Path, Tooltip, TooltipOptions } from 'leaflet'

// =============================================================================
// TYPES
// =============================================================================

export interface TooltipDelayOptions {
  /** Delay in ms before showing tooltip (default: 250) */
  showDelay?: number
  /** Delay in ms before hiding tooltip (default: 0 for immediate) */
  hideDelay?: number
  /**
   * Called right before `openTooltip()` is executed (after the delay, if any).
   * Useful for dynamically adjusting tooltip options like direction/offset
   * based on viewport position.
   */
  beforeShow?: (layer: L.Layer) => void
}

// =============================================================================
// GLOBALS - Manage single tooltip visibility
// =============================================================================

let currentTooltipTimer: ReturnType<typeof setTimeout> | null = null
let currentOpenTooltip: L.Tooltip | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Clear any pending tooltip timers
 */
function clearTooltipTimers(): void {
  if (currentTooltipTimer) {
    clearTimeout(currentTooltipTimer)
    currentTooltipTimer = null
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/**
 * Close any currently open tooltip immediately
 */
function closeCurrentTooltip(): void {
  if (currentOpenTooltip && currentOpenTooltip.isOpen()) {
    const marker = (currentOpenTooltip as any)._source
    if (marker && typeof marker.closeTooltip === 'function') {
      marker.closeTooltip()
    }
  }
  currentOpenTooltip = null
}

// =============================================================================
// MAIN UTILITY
// =============================================================================

/**
 * Add delayed tooltip behavior to a Leaflet marker or layer.
 *
 * This replaces the default hover behavior with:
 * - Delayed show (250ms by default) to prevent tooltip spam
 * - Immediate hide on mouseout
 * - Single tooltip at a time (closes previous when hovering new marker)
 *
 * @param layer - The Leaflet marker/layer with a tooltip bound
 * @param options - Delay configuration options
 *
 * @example
 * ```ts
 * const marker = L.marker([lat, lng])
 * marker.bindTooltip(content, { permanent: false, sticky: false })
 * addDelayedTooltipBehavior(marker, { showDelay: 250 })
 * ```
 */
export function addDelayedTooltipBehavior(
  layer: L.Layer,
  options: TooltipDelayOptions = {}
): void {
  const { showDelay = 250, hideDelay = 0, beforeShow } = options

  // Remove default tooltip open on hover
  layer.off('mouseover')
  layer.off('mouseout')

  // Add delayed show behavior
  layer.on('mouseover', () => {
    clearTooltipTimers()

    // Close any other open tooltip immediately
    closeCurrentTooltip()

    // Schedule showing this tooltip after delay
    currentTooltipTimer = setTimeout(() => {
      if (layer instanceof L.Marker || layer instanceof L.Path) {
        beforeShow?.(layer)
        layer.openTooltip()
        const tooltip = layer.getTooltip()
        if (tooltip) {
          currentOpenTooltip = tooltip
        }
      }
      currentTooltipTimer = null
    }, showDelay)
  })

  // Add immediate hide behavior
  layer.on('mouseout', () => {
    clearTooltipTimers()

    if (hideDelay > 0) {
      hideTimer = setTimeout(() => {
        if (layer instanceof L.Marker || layer instanceof L.Path) {
          layer.closeTooltip()
        }
        if (currentOpenTooltip === layer.getTooltip?.()) {
          currentOpenTooltip = null
        }
        hideTimer = null
      }, hideDelay)
    } else {
      // Immediate hide
      if (layer instanceof L.Marker || layer instanceof L.Path) {
        layer.closeTooltip()
      }
      if (currentOpenTooltip === layer.getTooltip?.()) {
        currentOpenTooltip = null
      }
    }
  })
}

/**
 * Standard tooltip options for professional, non-cluttery behavior
 */
export const PROFESSIONAL_TOOLTIP_OPTIONS: L.TooltipOptions = {
  permanent: false,
  sticky: false,
  interactive: false,
  direction: 'top',
  opacity: 1,
}

/**
 * Create tooltip options merged with professional defaults
 */
export function createProfessionalTooltipOptions(
  customOptions: L.TooltipOptions = {}
): L.TooltipOptions {
  return {
    ...PROFESSIONAL_TOOLTIP_OPTIONS,
    ...customOptions,
  }
}

// =============================================================================
// CSS INJECTION
// =============================================================================

let tooltipStylesInjected = false

/**
 * Inject CSS for smooth tooltip transitions
 */
export function injectTooltipStyles(): void {
  if (tooltipStylesInjected) return
  tooltipStylesInjected = true

  const style = document.createElement('style')
  style.id = 'professional-tooltip-styles'
  style.textContent = `
    /* Professional tooltip behavior */
    .leaflet-tooltip {
      pointer-events: none !important;
      transition: opacity 0.12s ease-out !important;
    }

    /* Ensure tooltips appear above everything */
    .leaflet-tooltip-pane {
      z-index: 10000 !important;
    }

    /* Remove default tooltip arrow for cleaner look */
    .leaflet-tooltip-top::before,
    .leaflet-tooltip-bottom::before,
    .leaflet-tooltip-left::before,
    .leaflet-tooltip-right::before {
      display: none !important;
    }
  `
  document.head.appendChild(style)
}

export default {
  addDelayedTooltipBehavior,
  createProfessionalTooltipOptions,
  injectTooltipStyles,
  PROFESSIONAL_TOOLTIP_OPTIONS,
}
