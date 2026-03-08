/**
 * ClusteredMapLayer - Professional marker clustering for intelligence maps
 *
 * Implements smart clustering with:
 * - Category-aware grouping with donut charts
 * - Severity-based visual priority
 * - Clean, minimal aesthetics
 * - Smooth animations
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils';

// =============================================================================
// TYPES
// =============================================================================

export interface ClusterableEvent {
  id: string;
  title: string;
  category: string;
  severity: string;
  timestamp: string;
  district?: string;
  coordinates: [number, number]; // [lng, lat]
  deaths?: number;
  injured?: number;
  source_url?: string;
}

interface ClusteredMapLayerProps {
  map: L.Map | null;
  events: ClusterableEvent[];
  onEventClick?: (event: ClusterableEvent) => void;
  onClusterClick?: (events: ClusterableEvent[]) => void;
}

// =============================================================================
// DESIGN TOKENS - Refined color palette
// =============================================================================

const COLORS = {
  bg: {
    dark: '#0a0a0c',
    surface: '#111214',
    overlay: 'rgba(10, 10, 12, 0.95)',
  },
  category: {
    DISASTER: '#ef4444',
    POLITICAL: '#6366f1',
    ECONOMIC: '#10b981',
    SECURITY: '#f59e0b',
    SOCIAL: '#8b5cf6',
    HEALTH: '#ec4899',
    INFRASTRUCTURE: '#f97316',
    ENVIRONMENT: '#14b8a6',
    GENERAL: '#64748b',
  } as Record<string, string>,
  severity: {
    CRITICAL: '#dc2626',
    HIGH: '#ea580c',
    MEDIUM: '#ca8a04',
    LOW: '#16a34a',
  } as Record<string, string>,
  text: {
    primary: '#f0f1f3',
    secondary: '#9ca3af',
    muted: '#6b7280',
  },
};

const CATEGORY_ICONS: Record<string, string> = {
  DISASTER: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  POLITICAL: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  ECONOMIC: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  SECURITY: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  SOCIAL: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  GENERAL: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

// =============================================================================
// MARKER ICON GENERATION
// =============================================================================

let iconIdCounter = 0;

function createEventMarkerIcon(event: ClusterableEvent): L.DivIcon {
  const color = COLORS.category[event.category] || COLORS.category.GENERAL;
  const iconPath = CATEGORY_ICONS[event.category] || CATEGORY_ICONS.GENERAL;
  const isCritical = event.severity === 'CRITICAL';
  const isHigh = event.severity === 'HIGH';
  const size = isCritical ? 32 : isHigh ? 28 : 24;
  const iconSize = isCritical ? 14 : isHigh ? 12 : 10;

  // Professional static marker - no glow, no gradients, no animations
  const html = `
    <div class="pro-marker">
      <div class="pro-marker-inner" style="
        width: ${size}px;
        height: ${size}px;
        background: #0a0c10;
        border: 1.5px solid ${color};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      ">
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="${iconPath}"/>
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    className: 'pro-marker-container',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const markers = cluster.getAllChildMarkers();
  const count = markers.length;

  // Analyze cluster contents
  const categoryBreakdown: Record<string, number> = {};
  let maxSeverity = 'LOW';
  const severityOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  markers.forEach((marker) => {
    const event = (marker as any).eventData as ClusterableEvent;
    if (event) {
      categoryBreakdown[event.category] = (categoryBreakdown[event.category] || 0) + 1;
      if (severityOrder.indexOf(event.severity) > severityOrder.indexOf(maxSeverity)) {
        maxSeverity = event.severity;
      }
    }
  });

  // Find dominant category
  let dominantCategory = 'GENERAL';
  let maxCount = 0;
  Object.entries(categoryBreakdown).forEach(([cat, num]) => {
    if (num > maxCount) {
      maxCount = num;
      dominantCategory = cat;
    }
  });

  const dominantColor = COLORS.category[dominantCategory] || COLORS.category.GENERAL;
  const isCritical = maxSeverity === 'CRITICAL';
  const isHigh = maxSeverity === 'HIGH';

  // Size based on count
  const baseSize = 36;
  const size = Math.min(56, baseSize + Math.log10(count + 1) * 10);
  const categories = Object.entries(categoryBreakdown).filter(([, n]) => n > 0);
  const totalEvents = categories.reduce((sum, [, n]) => sum + n, 0);

  // Generate pie chart segments if multiple categories
  let segments = '';
  if (categories.length > 1) {
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 2;
    const innerR = size / 4 + 2;
    let startAngle = -90;

    categories.sort(([, a], [, b]) => b - a);

    for (const [cat, n] of categories) {
      const catColor = COLORS.category[cat] || COLORS.category.GENERAL;
      const proportion = n / totalEvents;
      const sweepAngle = proportion * 360;
      if (sweepAngle < 2) continue;

      const endAngle = startAngle + sweepAngle;
      const largeArc = sweepAngle > 180 ? 1 : 0;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;

      const x1 = cx + outerR * Math.cos(startRad);
      const y1 = cy + outerR * Math.sin(startRad);
      const x2 = cx + outerR * Math.cos(endRad);
      const y2 = cy + outerR * Math.sin(endRad);
      const x3 = cx + innerR * Math.cos(endRad);
      const y3 = cy + innerR * Math.sin(endRad);
      const x4 = cx + innerR * Math.cos(startRad);
      const y4 = cy + innerR * Math.sin(startRad);

      segments += `<path d="M${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 ${largeArc} 0 ${x4},${y4} Z" fill="${catColor}" opacity="0.85"/>`;
      startAngle = endAngle;
    }
  }

  // Professional static cluster icons - no gradients, no animated shadows
  const html = categories.length > 1 ? `
    <div class="pro-cluster">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="#0f1012"/>
        ${segments}
        <circle cx="${size/2}" cy="${size/2}" r="${size/4 + 2}" fill="#0a0a0c"/>
        <text x="${size/2}" y="${size/2 + 4}" text-anchor="middle" fill="#f0f1f3" font-size="${count > 99 ? 10 : 12}" font-weight="600" font-family="IBM Plex Sans, sans-serif">${count > 999 ? '999+' : count}</text>
      </svg>
    </div>
  ` : `
    <div class="pro-cluster">
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: #0a0c10;
        border: 2px solid ${dominantColor};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      ">
        <span style="
          font-size: ${count > 99 ? 11 : 13}px;
          font-weight: 600;
          color: #f0f1f3;
          font-family: IBM Plex Sans, sans-serif;
        ">${count > 999 ? '999+' : count}</span>
      </div>
    </div>
  `;

  return L.divIcon({
    className: 'pro-cluster-container',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// =============================================================================
// TOOLTIP GENERATION
// =============================================================================

function createEventTooltip(event: ClusterableEvent): string {
  const color = COLORS.category[event.category] || COLORS.category.GENERAL;
  const severityColor = COLORS.severity[event.severity] || COLORS.severity.LOW;
  const iconPath = CATEGORY_ICONS[event.category] || CATEGORY_ICONS.GENERAL;
  const timeAgo = getTimeAgo(event.timestamp);
  const hasCasualties = event.deaths || event.injured;

  return `
    <div class="pro-tooltip">
      <div class="pro-tooltip-header">
        <div class="pro-tooltip-icon" style="background: ${color}15; border-color: ${color}50;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
            <path d="${iconPath}"/>
          </svg>
        </div>
        <div class="pro-tooltip-meta">
          <span class="pro-tooltip-category" style="color: ${color};">${event.category}</span>
          <span class="pro-tooltip-location">${event.district || 'Nepal'}</span>
        </div>
        <span class="pro-tooltip-severity" style="background: ${severityColor}20; color: ${severityColor};">${event.severity}</span>
      </div>
      <div class="pro-tooltip-title">${truncateText(event.title, 120)}</div>
      ${hasCasualties ? `
        <div class="pro-tooltip-casualties">
          ${event.deaths ? `<span style="color: ${COLORS.severity.CRITICAL};">${event.deaths} deaths</span>` : ''}
          ${event.injured ? `<span style="color: ${COLORS.severity.HIGH};">${event.injured} injured</span>` : ''}
        </div>
      ` : ''}
      <div class="pro-tooltip-footer">
        <span>${timeAgo} ago</span>
        ${event.source_url ? '<span class="pro-tooltip-source">View source →</span>' : ''}
      </div>
    </div>
  `;
}

// =============================================================================
// HELPERS
// =============================================================================

function getTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLength * 0.6 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

// =============================================================================
// STYLES INJECTION
// =============================================================================

function injectClusterStyles() {
  if (document.getElementById('pro-cluster-styles')) return;

  const styles = document.createElement('style');
  styles.id = 'pro-cluster-styles';
  styles.textContent = `
    /* Marker Base - Professional static styling */
    .pro-marker-container,
    .pro-cluster-container {
      background: transparent !important;
      border: none !important;
    }

    .pro-marker,
    .pro-cluster {
      position: relative;
      transition: opacity 0.1s ease;
    }

    /* Opacity-only hover - no scale bounce */
    .pro-marker:hover,
    .pro-cluster:hover {
      opacity: 0.85;
      z-index: 10000 !important;
    }

    .pro-marker-inner {
      position: relative;
      z-index: 1;
    }

    /* Tooltip Styles - Professional, no backdrop blur */
    .pro-tooltip {
      padding: 0;
      min-width: 260px;
      max-width: 340px;
    }

    .pro-tooltip-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .pro-tooltip-icon {
      width: 32px;
      height: 32px;
      border: 1px solid;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .pro-tooltip-meta {
      flex: 1;
      min-width: 0;
    }

    .pro-tooltip-category {
      display: block;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .pro-tooltip-location {
      display: block;
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
    }

    .pro-tooltip-severity {
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }

    .pro-tooltip-title {
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.5;
      color: #f0f1f3;
    }

    .pro-tooltip-casualties {
      padding: 8px 14px;
      display: flex;
      gap: 12px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(220, 38, 38, 0.08);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .pro-tooltip-footer {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      color: #6b7280;
    }

    .pro-tooltip-source {
      color: #6366f1;
      font-weight: 500;
    }

    /* Override leaflet tooltip styles - NO backdrop-filter */
    .leaflet-tooltip.pro-tooltip-container {
      background: rgba(15, 17, 21, 0.97) !important;
      border: 1px solid rgba(55, 65, 81, 0.7) !important;
      border-radius: 4px !important;
      padding: 0 !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
      color: #e8e8ea !important;
      font-size: 11px !important;
      font-family: 'JetBrains Mono', monospace !important;
    }

    .leaflet-tooltip.pro-tooltip-container::before {
      display: none !important;
    }

    /* Override default cluster styles */
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
  `;
  document.head.appendChild(styles);
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ClusteredMapLayer({
  map,
  events,
  onEventClick,
  onClusterClick,
}: ClusteredMapLayerProps) {
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  // Memoize cluster options
  const clusterOptions = useMemo(() => ({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: false,
    disableClusteringAtZoom: 12,
    animate: true,
    animateAddingMarkers: false,
    removeOutsideVisibleBounds: true,
    chunkedLoading: true,
    chunkInterval: 50,
    chunkDelay: 10,
    iconCreateFunction: createClusterIcon,
  }), []);

  // Initialize styles on mount
  useEffect(() => {
    injectClusterStyles();
    injectTooltipStyles();
  }, []);

  // Update markers when events change
  useEffect(() => {
    if (!map) return;

    // Remove existing cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
    }

    // Create new cluster group
    const clusterGroup = L.markerClusterGroup(clusterOptions);
    clusterGroupRef.current = clusterGroup;

    // Add markers
    events.forEach((event) => {
      const [lng, lat] = event.coordinates;
      const marker = L.marker([lat, lng], {
        icon: createEventMarkerIcon(event),
      });

      // Store event data on marker
      (marker as any).eventData = event;

      // Add tooltip with professional options to prevent clutter
      marker.bindTooltip(createEventTooltip(event), {
        direction: 'top',
        offset: [0, -16],
        className: 'pro-tooltip-container',
        permanent: false,
        sticky: false,
        interactive: false,
        opacity: 1,
      });

      // Add delayed tooltip behavior (250ms show delay, immediate hide)
      addDelayedTooltipBehavior(marker, { showDelay: 250, hideDelay: 0 });

      // Add click handler
      if (onEventClick) {
        marker.on('click', () => onEventClick(event));
      }

      clusterGroup.addLayer(marker);
    });

    // Handle cluster clicks
    if (onClusterClick) {
      clusterGroup.on('clusterclick', (e: L.LeafletEvent) => {
        const cluster = e.layer as L.MarkerCluster;
        const clusterEvents = cluster.getAllChildMarkers().map(
          (m) => (m as any).eventData as ClusterableEvent
        );
        onClusterClick(clusterEvents);
      });
    }

    map.addLayer(clusterGroup);

    return () => {
      if (clusterGroupRef.current) {
        map.removeLayer(clusterGroupRef.current);
      }
    };
  }, [map, events, clusterOptions, onEventClick, onClusterClick]);

  return null;
}

export default ClusteredMapLayer;
