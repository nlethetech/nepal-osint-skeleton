/**
 * AnnouncementMarkersLayer - Government announcement markers for the map
 * ======================================================================
 *
 * Displays government announcements (press releases, notices, circulars)
 * as megaphone icons at inferred issuing-office locations:
 * - DAO announcements are placed at their district centroid
 * - Central ministries/commissions default to Singha Durbar
 *
 * Features:
 * - Megaphone icon marker
 * - Clustered when multiple announcements
 * - Tooltip with announcement details
 * - Click to open announcement URL
 */

import { useEffect, useRef, memo } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { Map as LeafletMap, MarkerClusterGroup } from 'leaflet';
import type { MapAnnouncement } from '../../hooks/useMapAnnouncements';
import { formatBsToAd } from '../../lib/nepaliDate';
import { addDelayedTooltipBehavior, injectTooltipStyles } from './tooltipUtils';

// =============================================================================
// TYPES
// =============================================================================

export interface AnnouncementMarkersLayerProps {
  /** Leaflet map instance */
  map: LeafletMap | null;
  /** Array of announcements to display */
  announcements: MapAnnouncement[];
  /** Whether the layer is visible */
  visible?: boolean;
  /** Callback when an announcement is clicked */
  onAnnouncementClick?: (announcement: MapAnnouncement) => void;
}

// =============================================================================
// ICON CREATION
// =============================================================================

/** Category colors */
const CATEGORY_COLORS: Record<string, string> = {
  'press-release': '#5c7cba',
  'notice': '#b89830',
  'circular': '#408850',
  'press-release-ne': '#5c7cba',
  'notice-ne': '#b89830',
  'cabinet-decision': '#9333ea',
  'cabinet-committee-decision': '#7c3aed',
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#64748b';
}

/**
 * Create megaphone SVG icon for announcements
 */
function createAnnouncementIcon(isImportant: boolean = false, isUnread: boolean = false): L.DivIcon {
  const color = isImportant ? '#fbbf24' : '#5c7cba';
  // Simple markers - no outer rings or glow effects
  // Use thicker border for unread/important announcements
  const borderWidth = isUnread || isImportant ? 2.5 : 2;

  const svgContent = `
    <div class="announcement-marker" style="
      width: 32px;
      height: 32px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0c10;
      border-radius: 50%;
      border: ${borderWidth}px solid ${color};
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      cursor: pointer;
      transition: opacity 0.15s ease;
    ">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 11 18-5v12L3 14v-3z"/>
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
      </svg>
    </div>
  `;

  return L.divIcon({
    html: svgContent,
    className: 'announcement-marker-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

/**
 * Create cluster icon for multiple announcements
 */
function createAnnouncementClusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    html: `
      <div style="
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0a0c10;
        border-radius: 50%;
        border: 2px solid #5c7cba;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        cursor: pointer;
        transition: opacity 0.15s ease;
      ">
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          color: #5c7cba;
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m3 11 18-5v12L3 14v-3z"/>
            <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
          </svg>
          <span style="font-size: 10px; font-weight: 600; margin-top: -2px;">${count}</span>
        </div>
      </div>
    `,
    className: 'announcement-cluster-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/**
 * Create tooltip content for an announcement
 */
function formatAdDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function createAnnouncementTooltip(announcement: MapAnnouncement): string {
  const categoryColor = getCategoryColor(announcement.category);
  const categoryLabel = announcement.category.replace(/-ne$/, '').replace(/-/g, ' ');
  const dateDisplay = announcement.date_ad
    ? formatAdDate(announcement.date_ad)
    : announcement.date_bs
      ? formatBsToAd(announcement.date_bs)
      : '';

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; width: 260px;">
      <!-- Header -->
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        margin: -2px -2px 0;
        border-radius: 6px 6px 0 0;
        background: linear-gradient(135deg, #5c7cba, #4a6aa8);
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="m3 11 18-5v12L3 14v-3z"/>
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
        </svg>
        <span style="font-size: 12px; font-weight: 600; color: white; text-transform: uppercase;">
          Official Announcement
        </span>
      </div>

      <!-- Content -->
      <div style="padding: 10px;">
        <!-- Title -->
        <div style="
          font-size: 12px;
          font-weight: 600;
          color: #f1f5f9;
          line-height: 1.4;
          margin-bottom: 8px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        ">
          ${announcement.title}
        </div>

        <!-- Meta row -->
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
          <!-- Category badge -->
          <span style="
            padding: 2px 6px;
            border-radius: 3px;
            background: ${categoryColor}30;
            color: ${categoryColor};
            font-size: 10px;
            font-weight: 500;
            text-transform: capitalize;
          ">
            ${categoryLabel}
          </span>

          <!-- Source -->
          <span style="
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            color: #94a3b8;
          ">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 21h18"/>
              <path d="M5 21V7l8-4v18"/>
              <path d="M19 21V11l-6-4"/>
            </svg>
            ${announcement.source_name}
          </span>

          ${dateDisplay ? `
          <!-- Date -->
          <span style="
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            color: #94a3b8;
          ">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            ${dateDisplay}
          </span>
          ` : ''}
        </div>

        <!-- Attachment indicator -->
        ${announcement.has_attachments ? `
        <div style="
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: #5c7cba;
          margin-bottom: 8px;
        ">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          Has attachments
        </div>
        ` : ''}

        <!-- Click hint -->
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding-top: 6px;
          border-top: 1px solid rgba(71,85,105,0.3);
          font-size: 10px;
          color: #64748b;
        ">
          <span>Click to view</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// STYLES INJECTION
// =============================================================================

let stylesInjected = false;

function injectAnnouncementStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .announcement-marker-icon {
      background: transparent !important;
      border: none !important;
    }

    .announcement-marker:hover {
      opacity: 0.85;
    }

    .announcement-cluster-icon {
      background: transparent !important;
      border: none !important;
    }

    .announcement-cluster-icon > div:hover {
      opacity: 0.85;
    }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// COMPONENT
// =============================================================================

export const AnnouncementMarkersLayer = memo(function AnnouncementMarkersLayer({
  map,
  announcements,
  visible = true,
  onAnnouncementClick,
}: AnnouncementMarkersLayerProps) {
  const clusterGroupRef = useRef<MarkerClusterGroup | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());
  const initializedRef = useRef(false);

  // Inject styles on mount
  // Inject styles on mount
  useEffect(() => {
    injectAnnouncementStyles();
    injectTooltipStyles();
  }, []);

  // Initialize cluster group
  useEffect(() => {
    if (!map || initializedRef.current) return;

    const clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 15,
      animate: true,
      iconCreateFunction: (cluster) => {
        return createAnnouncementClusterIcon(cluster.getChildCount());
      },
    });

    clusterGroup.addTo(map);
    clusterGroupRef.current = clusterGroup;
    initializedRef.current = true;

    return () => {
      if (clusterGroupRef.current && map) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
        markersMapRef.current.clear();
        initializedRef.current = false;
      }
    };
  }, [map]);

  // Update markers when announcements change
  useEffect(() => {
    if (!clusterGroupRef.current || !map) return;

    const clusterGroup = clusterGroupRef.current;
    const currentMarkers = markersMapRef.current;
    const announcementIds = new Set(announcements.map(a => a.id));

    // Remove markers for announcements that no longer exist
    const markersToRemove: L.Marker[] = [];
    currentMarkers.forEach((marker, id) => {
      if (!announcementIds.has(id)) {
        markersToRemove.push(marker);
        currentMarkers.delete(id);
      }
    });

    if (markersToRemove.length > 0) {
      clusterGroup.removeLayers(markersToRemove);
    }

    // Add new markers
    const markersToAdd: L.Marker[] = [];

    for (const announcement of announcements) {
      if (currentMarkers.has(announcement.id)) continue;

      const [lng, lat] = announcement.coordinates;
      // Add small random offset to prevent exact overlap
      const offset = 0.001;
      const jitteredLat = lat + (Math.random() - 0.5) * offset;
      const jitteredLng = lng + (Math.random() - 0.5) * offset;

      const marker = L.marker([jitteredLat, jitteredLng], {
        icon: createAnnouncementIcon(announcement.is_important, !announcement.is_read),
        alt: `Government announcement: ${announcement.title}`,
      });

      // Bind tooltip with professional options to prevent clutter
      marker.bindTooltip(createAnnouncementTooltip(announcement), {
        permanent: false,
        sticky: false,
        interactive: false,
        direction: 'top',
        className: 'announcement-tooltip bg-osint-bg border border-osint-border rounded-lg shadow-md',
        offset: [0, -16],
        opacity: 1,
      });

      // Add delayed tooltip behavior (250ms show delay, immediate hide)
      addDelayedTooltipBehavior(marker, { showDelay: 250, hideDelay: 0 });

      // Click handler - open URL in new tab
      marker.on('click', () => {
        if (onAnnouncementClick) {
          onAnnouncementClick(announcement);
        }
        window.open(announcement.url, '_blank');
      });

      markersToAdd.push(marker);
      currentMarkers.set(announcement.id, marker);
    }

    if (markersToAdd.length > 0) {
      clusterGroup.addLayers(markersToAdd);
    }
  }, [announcements, map, onAnnouncementClick]);

  // Handle visibility changes
  useEffect(() => {
    if (!clusterGroupRef.current || !map) return;

    if (visible) {
      if (!map.hasLayer(clusterGroupRef.current)) {
        clusterGroupRef.current.addTo(map);
      }
    } else {
      if (map.hasLayer(clusterGroupRef.current)) {
        map.removeLayer(clusterGroupRef.current);
      }
    }
  }, [visible, map]);

  return null;
});

export default AnnouncementMarkersLayer;
