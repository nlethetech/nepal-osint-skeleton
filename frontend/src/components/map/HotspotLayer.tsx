/**
 * HotspotLayer - Visualize detected hotspot clusters on Leaflet map
 *
 * Features:
 * - Cluster bounding boxes as dashed rectangles
 * - Centroid markers with event count badges
 * - Color coding by dominant severity
 * - Click to see cluster details
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Map as LeafletMap } from 'leaflet'
import type { HotspotCluster } from '../../api/spatial'
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils'

interface HotspotLayerProps {
  map: LeafletMap | null
  clusters: HotspotCluster[]
  visible: boolean
  onClusterClick?: (cluster: HotspotCluster) => void
}

// Severity color mapping
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#d97706',
  LOW: '#16a34a',
}

// Get color based on dominant severity in cluster
function getClusterColor(cluster: HotspotCluster): string {
  const breakdown = cluster.severity_breakdown
  const maxSeverity = Object.entries(breakdown)
    .sort(([, a], [, b]) => (b || 0) - (a || 0))[0]?.[0]

  return SEVERITY_COLORS[maxSeverity] || SEVERITY_COLORS.MEDIUM
}

export function HotspotLayer({
  map,
  clusters,
  visible,
  onClusterClick,
}: HotspotLayerProps) {
  const layerGroupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!map) return

    // Inject tooltip styles
    injectTooltipStyles()

    // Clear existing layers
    if (layerGroupRef.current) {
      map.removeLayer(layerGroupRef.current)
      layerGroupRef.current = null
    }

    if (!visible || clusters.length === 0) return

    const layerGroup = L.layerGroup()

    clusters.forEach((cluster) => {
      const color = getClusterColor(cluster)
      const [minLng, minLat, maxLng, maxLat] = cluster.bounding_box

      // Create bounding box rectangle
      const bounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng])
      const rect = L.rectangle(bounds, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.1,
        dashArray: '8, 4',
        className: 'hotspot-boundary',
      })

      // Add tooltip to rectangle with professional options
      rect.bindTooltip(
        `<div style="text-align: center;">
          <strong>${cluster.member_count} events</strong><br/>
          <span style="font-size: 10px; color: #94a3b8;">
            ${cluster.districts.slice(0, 3).join(', ')}${cluster.districts.length > 3 ? '...' : ''}
          </span>
        </div>`,
        { className: 'hotspot-tooltip', direction: 'top', permanent: false, sticky: false, interactive: false, opacity: 1 }
      )

      // Add delayed tooltip behavior
      addDelayedTooltipBehavior(rect, { showDelay: 250, hideDelay: 0 })

      rect.on('click', () => onClusterClick?.(cluster))
      layerGroup.addLayer(rect)

      // Create centroid marker with count badge
      const [lng, lat] = cluster.centroid
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'hotspot-centroid-icon',
          html: `
            <div style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 32px;
              height: 32px;
              background: ${color};
              border: 2px solid rgba(255,255,255,0.8);
              border-radius: 50%;
              box-shadow: 0 2px 8px rgba(0,0,0,0.4);
              cursor: pointer;
            ">
              <span style="
                color: white;
                font-size: 11px;
                font-weight: bold;
                text-shadow: 0 1px 2px rgba(0,0,0,0.3);
              ">${cluster.member_count}</span>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
      })

      // Detailed tooltip for centroid
      const severityBreakdown = Object.entries(cluster.severity_breakdown)
        .filter(([, count]) => count > 0)
        .map(([sev, count]) => `<span style="color: ${SEVERITY_COLORS[sev]}">${sev}: ${count}</span>`)
        .join(' | ')

      marker.bindTooltip(
        `<div style="min-width: 150px;">
          <div style="font-weight: bold; margin-bottom: 4px; font-size: 12px;">
            Hotspot #${cluster.cluster_id + 1}
          </div>
          <div style="font-size: 11px; margin-bottom: 4px;">
            <strong>${cluster.member_count}</strong> events
          </div>
          <div style="font-size: 10px; margin-bottom: 4px;">
            ${severityBreakdown}
          </div>
          <div style="font-size: 10px; color: #94a3b8;">
            ${cluster.dominant_category} • ${cluster.districts.length} district${cluster.districts.length !== 1 ? 's' : ''}
          </div>
          ${cluster.time_range.earliest ? `
          <div style="font-size: 9px; color: #64748b; margin-top: 4px;">
            ${new Date(cluster.time_range.earliest).toLocaleDateString()} - ${new Date(cluster.time_range.latest).toLocaleDateString()}
          </div>
          ` : ''}
        </div>`,
        { className: 'hotspot-detail-tooltip', direction: 'top', offset: [0, -16], permanent: false, sticky: false, interactive: false, opacity: 1 }
      )

      // Add delayed tooltip behavior
      addDelayedTooltipBehavior(marker, { showDelay: 250, hideDelay: 0 })

      marker.on('click', () => onClusterClick?.(cluster))
      layerGroup.addLayer(marker)
    })

    layerGroup.addTo(map)
    layerGroupRef.current = layerGroup

    return () => {
      if (layerGroupRef.current && map) {
        map.removeLayer(layerGroupRef.current)
        layerGroupRef.current = null
      }
    }
  }, [map, clusters, visible, onClusterClick])

  return null
}

export default HotspotLayer
