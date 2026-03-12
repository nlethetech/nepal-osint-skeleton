/**
 * CapitalMarkersLayer - Shows capital city markers on the map
 * ============================================================
 *
 * Displays star markers for:
 * - National capital (Kathmandu) - Gold star
 * - Provincial capitals - Province-colored stars
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils'

// Province colors
const PROVINCE_COLORS: Record<string, string> = {
  'Koshi': '#3b82f6',
  'Madhesh': '#ef4444',
  'Bagmati': '#22c55e',
  'Gandaki': '#eab308',
  'Lumbini': '#f97316',
  'Karnali': '#8b5cf6',
  'Sudurpashchim': '#06b6d4',
}

// Capital cities data
interface CapitalCity {
  name: string
  nameNe?: string
  province: string
  lat: number
  lng: number
  isNationalCapital?: boolean
}

const CAPITAL_CITIES: CapitalCity[] = [
  // National Capital
  {
    name: 'Kathmandu',
    nameNe: 'काठमाडौं',
    province: 'Bagmati',
    lat: 27.7172,
    lng: 85.324,
    isNationalCapital: true,
  },
  // Provincial Capitals
  {
    name: 'Biratnagar',
    nameNe: 'विराटनगर',
    province: 'Koshi',
    lat: 26.4525,
    lng: 87.2718,
  },
  {
    name: 'Janakpur',
    nameNe: 'जनकपुर',
    province: 'Madhesh',
    lat: 26.7288,
    lng: 85.9263,
  },
  {
    name: 'Hetauda',
    nameNe: 'हेटौंडा',
    province: 'Bagmati',
    lat: 27.4287,
    lng: 85.0322,
  },
  {
    name: 'Pokhara',
    nameNe: 'पोखरा',
    province: 'Gandaki',
    lat: 28.2096,
    lng: 83.9856,
  },
  {
    name: 'Butwal',
    nameNe: 'बुटवल',
    province: 'Lumbini',
    lat: 27.7006,
    lng: 83.4483,
  },
  {
    name: 'Birendranagar',
    nameNe: 'वीरेन्द्रनगर',
    province: 'Karnali',
    lat: 28.6010,
    lng: 81.6350,
  },
  {
    name: 'Godawari',
    nameNe: 'गोदावरी',
    province: 'Sudurpashchim',
    lat: 28.8974,
    lng: 80.5828,
  },
]

// Create SVG star icon for national capital (larger, gold - professional static design)
function createNationalCapitalIcon(): L.DivIcon {
  const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="16,2 19.5,11 29,11 21.5,17.5 24,27 16,21.5 8,27 10.5,17.5 3,11 12.5,11"
        fill="#fbbf24"
        stroke="#92400e"
        stroke-width="1.5"
      />
      <circle cx="16" cy="15" r="3" fill="#92400e"/>
    </svg>
  `
  return L.divIcon({
    html: svg,
    className: 'capital-marker national-capital',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

// Create SVG star icon for provincial capital
function createProvincialCapitalIcon(color: string): L.DivIcon {
  const svg = `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="12,2 14.5,9 22,9 16,13.5 18,21 12,16.5 6,21 8,13.5 2,9 9.5,9"
        fill="${color}"
        stroke="#1f2937"
        stroke-width="1"
        opacity="0.9"
      />
    </svg>
  `
  return L.divIcon({
    html: svg,
    className: 'capital-marker provincial-capital',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

interface CapitalMarkersLayerProps {
  map: LeafletMap | null
  selectedProvinces: string[]
  isFilterActive: boolean
  visible?: boolean
  showLabels?: boolean
}

export function CapitalMarkersLayer({
  map,
  selectedProvinces,
  isFilterActive,
  visible = true,
  showLabels = true,
}: CapitalMarkersLayerProps) {
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!map) return

    // Inject tooltip styles
    injectTooltipStyles()

    // Remove existing layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!visible) return

    const layerGroup = L.layerGroup()

    // Determine which capitals to show
    const capitalsToShow = isFilterActive && selectedProvinces.length < 7
      ? CAPITAL_CITIES.filter(c =>
          c.isNationalCapital || selectedProvinces.includes(c.province)
        )
      : CAPITAL_CITIES

    for (const capital of capitalsToShow) {
      const color = PROVINCE_COLORS[capital.province] || '#6b7280'

      // Create appropriate icon
      const icon = capital.isNationalCapital
        ? createNationalCapitalIcon()
        : createProvincialCapitalIcon(color)

      // Create marker
      const marker = L.marker([capital.lat, capital.lng], {
        icon,
        zIndexOffset: capital.isNationalCapital ? 1000 : 500,
      })

      // Add tooltip
      const tooltipContent = `
        <div class="font-sans text-sm">
          <div class="font-bold ${capital.isNationalCapital ? 'text-amber-400' : 'text-white'}">
            ${capital.isNationalCapital ? '★ ' : '☆ '}${capital.name}
          </div>
          ${capital.nameNe ? `<div class="text-xs text-gray-400">${capital.nameNe}</div>` : ''}
          <div class="text-xs text-gray-400 mt-0.5">
            ${capital.isNationalCapital ? 'National Capital' : `${capital.province} Province Capital`}
          </div>
        </div>
      `

      marker.bindTooltip(tooltipContent, {
        permanent: false,
        sticky: false,
        interactive: false,
        direction: 'top',
        className: 'capital-tooltip bg-osint-bg border border-osint-border rounded-lg shadow-md px-2 py-1',
        offset: [0, -12],
        opacity: 1,
      })

      // Add delayed tooltip behavior (250ms show delay, immediate hide)
      addDelayedTooltipBehavior(marker, { showDelay: 250, hideDelay: 0 })

      // Add permanent label if enabled
      if (showLabels) {
        const labelClass = capital.isNationalCapital
          ? 'text-amber-400 font-bold'
          : 'text-white/80'

        const label = L.marker([capital.lat, capital.lng], {
          icon: L.divIcon({
            html: `<span class="${labelClass} text-[10px] whitespace-nowrap">${capital.name}</span>`,
            className: 'capital-label',
            iconSize: [100, 16],
            iconAnchor: [-14, 8],
          }),
          zIndexOffset: capital.isNationalCapital ? 999 : 499,
          interactive: false,
        })
        label.addTo(layerGroup)
      }

      marker.addTo(layerGroup)
    }

    layerGroup.addTo(map)
    layerRef.current = layerGroup

    return () => {
      if (layerRef.current && map) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [map, visible, isFilterActive, selectedProvinces, showLabels])

  return null
}

export default CapitalMarkersLayer
