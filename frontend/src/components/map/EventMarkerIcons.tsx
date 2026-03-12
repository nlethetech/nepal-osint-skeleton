/**
 * EventMarkerIcons - Live UA Map Style Professional Markers
 * =========================================================
 *
 * Clean, journalistic-quality markers with:
 * - Simple white circles with thin colored borders
 * - Muted category colors optimized for light map backgrounds
 * - No decorative animations or glows
 * - Newspaper/broadcast quality design
 * - Small, consistent icon centered in marker
 */

import L from 'leaflet'

// =============================================================================
// TYPES
// =============================================================================

export type IntelligenceCategory =
  | 'SECURITY'
  | 'POLITICAL'
  | 'ECONOMIC'
  | 'INFRASTRUCTURE'
  | 'DISASTER'
  | 'HEALTH'
  | 'SOCIAL'
  | 'ENVIRONMENT'
  | 'GENERAL'

export type EventSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type MarkerSize = 'small' | 'medium' | 'large'

export interface CategoryIconConfig {
  color: string
  bgColor: string
  icon: string
  label: string
}

export interface EventMarkerIconOptions {
  category: IntelligenceCategory
  severity: EventSeverity
  size?: MarkerSize
  isNew?: boolean
  isSelected?: boolean
  sourceCount?: number
  confidence?: number
  isFresh?: boolean // Event less than 1 hour old
}

export interface ClusterIconOptions {
  count: number
  categoryBreakdown: Partial<Record<IntelligenceCategory, number>>
  maxSeverity: EventSeverity
}

// =============================================================================
// CATEGORY CONFIG - Muted editorial colors for light map backgrounds (Live UA Map style)
// =============================================================================

export const CATEGORY_CONFIG: Record<IntelligenceCategory, CategoryIconConfig> = {
  SECURITY: {
    color: '#b91c1c',      // Muted red - visible on light backgrounds
    bgColor: '#ffffff',    // White background
    // Shield icon (simplified)
    icon: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Security',
  },
  POLITICAL: {
    color: '#1d4ed8',      // Muted blue
    bgColor: '#ffffff',
    // Ballot icon
    icon: `<rect x="5" y="4" width="14" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
           <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Political',
  },
  ECONOMIC: {
    color: '#047857',      // Muted green
    bgColor: '#ffffff',
    // Dollar icon
    icon: `<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Economic',
  },
  INFRASTRUCTURE: {
    color: '#b45309',      // Muted amber
    bgColor: '#ffffff',
    // Building icon
    icon: `<path d="M4 20h16M4 20V10l8-6 8 6v10M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Infrastructure',
  },
  DISASTER: {
    color: '#dc2626',      // Clear red for disasters
    bgColor: '#ffffff',
    // Alert triangle
    icon: `<path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Disaster',
  },
  HEALTH: {
    color: '#be185d',      // Muted pink
    bgColor: '#ffffff',
    // Medical cross
    icon: `<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Health',
  },
  SOCIAL: {
    color: '#6b21a8',      // Muted purple
    bgColor: '#ffffff',
    // Users icon
    icon: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="2"/>
           <circle cx="9" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Social',
  },
  ENVIRONMENT: {
    color: '#0f766e',      // Muted teal
    bgColor: '#ffffff',
    // Leaf icon
    icon: `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" fill="none" stroke="currentColor" stroke-width="2"/>`,
    label: 'Environment',
  },
  GENERAL: {
    color: '#4b5563',      // Gray
    bgColor: '#ffffff',
    // Info circle
    icon: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
           <path d="M12 8h.01M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    label: 'General',
  },
}

// Severity border colors - subtle, editorial style for light backgrounds
const SEVERITY_BORDER: Record<EventSeverity, string> = {
  CRITICAL: '#dc2626',   // Red border
  HIGH: '#ea580c',       // Orange border
  MEDIUM: '#6b7280',     // Gray border
  LOW: '#9ca3af',        // Light gray border
}

// Marker sizes - consistent like Live UA Map
const MARKER_SIZES: Record<MarkerSize, number> = {
  small: 24,
  medium: 28,
  large: 32,
}

// =============================================================================
// SVG GENERATION - Clean LiveUAMap-style
// =============================================================================

/** Counter for stable unique SVG IDs across renders */
let markerIdCounter = 0

function generateMarkerSVG(options: EventMarkerIconOptions): string {
  const config = CATEGORY_CONFIG[options.category] || CATEGORY_CONFIG.GENERAL
  const size = MARKER_SIZES[options.size || 'medium']

  // Use category color for border (Live UA Map style - simple colored borders)
  const borderColor = config.color
  const isCritical = options.severity === 'CRITICAL'
  const isHigh = options.severity === 'HIGH'

  // Border width based on severity
  const strokeWidth = options.isSelected ? 3 : (isCritical ? 2.5 : isHigh ? 2 : 1.5)

  // Scale icon to fit inside marker
  const iconScale = (size - 14) / 24
  const cx = size / 2
  const cy = size / 2
  const radius = (size / 2) - 2

  // Only show source badge for 3+ sources
  const showSourceBadge = (options.sourceCount ?? 1) >= 3
  const sourceCount = options.sourceCount ?? 1
  const sourceText = sourceCount > 9 ? '9+' : sourceCount.toString()

  // Simple white circle with colored border (Live UA Map style)
  // All markers are circles - no shape variance
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <!-- Drop shadow for visibility on light maps -->
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.2"/>
        </filter>
      </defs>

      <!-- White circle with colored border -->
      <circle
        cx="${cx}" cy="${cy}"
        r="${radius}"
        fill="#ffffff"
        stroke="${borderColor}"
        stroke-width="${strokeWidth}"
        filter="url(#shadow)"
      />

      <!-- Category icon in gray -->
      <g transform="translate(${(size - iconScale * 24) / 2}, ${(size - iconScale * 24) / 2}) scale(${iconScale})" style="color: #374151">
        ${config.icon}
      </g>

      ${showSourceBadge ? `
      <!-- Source count badge -->
      <circle cx="${size - 5}" cy="5" r="6" fill="${borderColor}" stroke="#ffffff" stroke-width="1"/>
      <text x="${size - 5}" y="7.5" font-size="7" font-weight="600" fill="#ffffff" text-anchor="middle" font-family="system-ui">${sourceText}</text>
      ` : ''}

      ${options.isSelected ? `
      <!-- Selection indicator - blue ring -->
      <circle cx="${cx}" cy="${cy}" r="${radius + 3}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="4,2"/>
      ` : ''}
    </svg>
  `
}

function generateClusterSVG(options: ClusterIconOptions): string {
  const { count, categoryBreakdown, maxSeverity } = options

  // Find dominant category
  let dominantCategory: IntelligenceCategory = 'GENERAL'
  let maxCount = 0
  for (const [cat, num] of Object.entries(categoryBreakdown)) {
    if (num && num > maxCount) {
      maxCount = num
      dominantCategory = cat as IntelligenceCategory
    }
  }

  const config = CATEGORY_CONFIG[dominantCategory]
  const isCritical = maxSeverity === 'CRITICAL'
  const isHigh = maxSeverity === 'HIGH'

  // Border color based on severity (red for critical/high, gray for others)
  const borderColor = isCritical ? '#dc2626' : isHigh ? '#ea580c' : config.color

  // Size based on count - compact scaling
  const baseSize = 32
  const size = Math.min(48, baseSize + Math.log10(count + 1) * 8)
  const cx = size / 2
  const cy = size / 2
  const radius = (size / 2) - 2

  // Simple white circle cluster (Live UA Map style)
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <!-- Drop shadow -->
      <defs>
        <filter id="clusterShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.25"/>
        </filter>
      </defs>

      <!-- White circle with colored border -->
      <circle
        cx="${cx}" cy="${cy}"
        r="${radius}"
        fill="#ffffff"
        stroke="${borderColor}"
        stroke-width="${isCritical ? 3 : isHigh ? 2.5 : 2}"
        filter="url(#clusterShadow)"
      />

      <!-- Count text -->
      <text
        x="${cx}" y="${cy + 4}"
        font-size="${count > 99 ? 11 : 13}"
        fill="${borderColor}"
        text-anchor="middle"
        font-weight="600"
        font-family="Inter, system-ui, sans-serif"
      >${count > 999 ? '1k+' : count}</text>
    </svg>
  `
}

// =============================================================================
// LEAFLET ICON FACTORIES
// =============================================================================

export function createEventMarkerIcon(options: EventMarkerIconOptions): L.DivIcon {
  const baseSize = MARKER_SIZES[options.size || 'medium']
  const totalSize = baseSize + 4
  const svg = generateMarkerSVG(options)
  const config = CATEGORY_CONFIG[options.category] || CATEGORY_CONFIG.GENERAL

  return L.divIcon({
    className: `event-marker event-marker-${options.category.toLowerCase()} ${options.isNew ? 'event-marker-new' : ''} ${options.isSelected ? 'event-marker-selected' : ''}`,
    html: `<div class="event-marker-inner" role="img" aria-label="${config.label} event">${svg}</div>`,
    iconSize: [totalSize, totalSize],
    iconAnchor: [totalSize / 2, totalSize / 2],
    popupAnchor: [0, -totalSize / 2],
  })
}

export function createClusterIcon(options: ClusterIconOptions): L.DivIcon {
  const baseSize = 32
  const size = Math.min(48, baseSize + Math.log10(options.count + 1) * 8)
  const svg = generateClusterSVG(options)

  return L.divIcon({
    className: `event-cluster event-cluster-${options.maxSeverity.toLowerCase()}`,
    html: `<div class="event-cluster-inner" role="img" aria-label="Cluster of ${options.count} events">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function createClusterIconFunction(
  getClusterData: (markers: L.Marker[]) => ClusterIconOptions
) {
  return (cluster: L.MarkerCluster) => {
    const markers = cluster.getAllChildMarkers()
    const options = getClusterData(markers)
    return createClusterIcon(options)
  }
}

// =============================================================================
// CSS STYLES
// =============================================================================

let stylesInjected = false

export function injectMarkerStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return

  const styles = `
    /* Live UA Map style marker styles - clean, professional */
    .leaflet-marker-pane,
    .leaflet-marker-icon {
      pointer-events: auto !important;
    }

    .event-marker {
      background: transparent !important;
      border: none !important;
      pointer-events: auto !important;
    }

    .event-marker-inner {
      transition: transform 0.1s ease-out, opacity 0.1s ease-out;
      cursor: pointer;
      pointer-events: auto !important;
    }

    .event-marker:hover .event-marker-inner {
      transform: scale(1.1);
    }

    .event-marker-selected .event-marker-inner {
      transform: scale(1.15);
    }

    /* Cluster styles - clean white circles */
    .event-cluster {
      background: transparent !important;
      border: none !important;
    }

    .event-cluster-inner {
      transition: transform 0.1s ease-out;
      cursor: pointer;
    }

    .event-cluster:hover .event-cluster-inner {
      transform: scale(1.05);
    }

    /* Tooltip styles - light theme */
    .leaflet-tooltip-pane {
      z-index: 1000 !important;
    }

    .leaflet-tooltip {
      background: #ffffff !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 8px !important;
      padding: 0 !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      color: #1f2937 !important;
      font-size: 12px !important;
      font-family: 'Inter', system-ui, sans-serif !important;
      max-width: 300px !important;
      white-space: normal !important;
      z-index: 10000 !important;
      pointer-events: auto !important;
    }

    .leaflet-tooltip::before {
      display: none !important;
    }

    .event-marker-tooltip {
      background: #ffffff !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 8px !important;
      padding: 0 !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
      z-index: 10000 !important;
      overflow: hidden !important;
    }

    /* Override Leaflet cluster defaults */
    .marker-cluster-small,
    .marker-cluster-medium,
    .marker-cluster-large {
      background: transparent !important;
    }
    .marker-cluster-small div,
    .marker-cluster-medium div,
    .marker-cluster-large div {
      background: transparent !important;
    }
  `

  const styleElement = document.createElement('style')
  styleElement.id = 'event-marker-styles'
  styleElement.textContent = styles
  document.head.appendChild(styleElement)

  stylesInjected = true
}

export { CATEGORY_CONFIG as CategoryConfig, SEVERITY_BORDER as SeverityConfig }
