/**
 * ProvinceBorderLayer - Professional analyst-grade boundary visualization
 * =======================================================================
 *
 * Draws professional country and province boundary outlines:
 * - Always visible (not just when filtering)
 * - Country border: prominent white line
 * - Province borders: subtle gray lines
 * - Clean, minimal styling optimized for satellite imagery
 */

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson'

// Province names for labeling
const PROVINCE_NUMBER_TO_NAME: Record<string, string> = {
  '1': 'Koshi',
  '2': 'Madhesh',
  '3': 'Bagmati',
  '4': 'Gandaki',
  '5': 'Lumbini',
  '6': 'Karnali',
  '7': 'Sudurpashchim',
}

// Reverse mapping
const PROVINCE_NAME_TO_NUMBER: Record<string, string> = {
  'Koshi': '1',
  'Madhesh': '2',
  'Bagmati': '3',
  'Gandaki': '4',
  'Lumbini': '5',
  'Karnali': '6',
  'Sudurpashchim': '7',
}

interface ProvinceBorderLayerProps {
  map: LeafletMap | null
  selectedProvinces: string[]
  isFilterActive: boolean
  visible?: boolean
}

interface ProvinceFeature extends Feature<Polygon | MultiPolygon> {
  properties: {
    ADM1_EN: string
    ADM1_PCODE: string
    ADM0_EN: string
    [key: string]: unknown
  }
}

interface ProvinceCollection extends FeatureCollection<Polygon | MultiPolygon> {
  features: ProvinceFeature[]
}

export function ProvinceBorderLayer({
  map,
  selectedProvinces,
  isFilterActive,
  visible = true,
}: ProvinceBorderLayerProps) {
  const layerRef = useRef<L.LayerGroup | null>(null)
  const countryBorderRef = useRef<L.GeoJSON | null>(null)
  const [geoJSONData, setGeoJSONData] = useState<ProvinceCollection | null>(null)

  // Load province GeoJSON data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/geo/nepal-provinces.geojson')
        if (response.ok) {
          const data = await response.json()
          setGeoJSONData(data)
        }
      } catch (err) {
        console.error('Failed to load province GeoJSON:', err)
      }
    }
    fetchData()
  }, [])

  // Create and update the border layers
  useEffect(() => {
    if (!map || !geoJSONData) return

    // Remove existing layers
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }
    if (countryBorderRef.current) {
      map.removeLayer(countryBorderRef.current)
      countryBorderRef.current = null
    }

    if (!visible) return

    // Create layer group for province borders
    const layerGroup = L.layerGroup()

    // Get selected province numbers for highlighting
    const selectedNumbers = selectedProvinces
      .map(name => PROVINCE_NAME_TO_NUMBER[name])
      .filter(Boolean)

    // Draw all province internal borders - subtle gray for light map (Live UA Map style)
    for (const feature of geoJSONData.features) {
      const provinceNumber = feature.properties.ADM1_EN
      const isSelected = isFilterActive && selectedNumbers.includes(provinceNumber)

      // Province internal borders - subtle gray dashed lines
      const provinceBorder = L.geoJSON(feature, {
        style: {
          color: isSelected ? '#374151' : '#9ca3af',
          weight: isSelected ? 1.5 : 0.75,
          opacity: isSelected ? 0.8 : 0.4,
          fillOpacity: 0,
          fill: false,
          dashArray: isSelected ? undefined : '4, 4',
        },
      })

      provinceBorder.addTo(layerGroup)

      // Add province label at centroid for selected provinces
      if (isSelected) {
        const bounds = provinceBorder.getBounds()
        const center = bounds.getCenter()
        const provinceName = PROVINCE_NUMBER_TO_NAME[provinceNumber]

        const label = L.marker(center, {
          icon: L.divIcon({
            html: `<div class="province-label">${provinceName}</div>`,
            className: 'province-label-container',
            iconSize: [100, 20],
            iconAnchor: [50, 10],
          }),
          interactive: false,
        })

        label.addTo(layerGroup)
      }
    }

    // Create merged country border (outer boundary) - subtle dark gray
    const allProvinces = L.geoJSON(geoJSONData as any, {
      style: {
        color: '#374151',
        weight: 1.5,
        opacity: 0.6,
        fillOpacity: 0,
        fill: false,
      },
    })

    // No glow effect for light maps - clean professional look
    allProvinces.addTo(map)
    countryBorderRef.current = allProvinces

    layerGroup.addTo(map)
    layerRef.current = layerGroup

    // Inject province label styles
    injectProvinceLabelStyles()

    return () => {
      if (layerRef.current && map) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      if (countryBorderRef.current && map) {
        map.removeLayer(countryBorderRef.current)
        countryBorderRef.current = null
      }
    }
  }, [map, visible, geoJSONData, selectedProvinces, isFilterActive])

  return null
}

// Province label styles
let stylesInjected = false

function injectProvinceLabelStyles(): void {
  if (stylesInjected) return
  stylesInjected = true

  const style = document.createElement('style')
  style.textContent = `
    .province-label-container {
      background: transparent !important;
      border: none !important;
    }

    .province-label {
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
      pointer-events: none;
    }
  `
  document.head.appendChild(style)
}

export default ProvinceBorderLayer
