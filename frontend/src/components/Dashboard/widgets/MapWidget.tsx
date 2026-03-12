import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapPin, RefreshCw, Filter, Clock, ChevronRight, ChevronLeft,
  Radio, AlertTriangle, Map, X, Layers, ZoomIn, ZoomOut,
  Crosshair, Activity, Eye, EyeOff, ChevronDown, ExternalLink,
  Vote, Users, TrendingUp, ShieldCheck, CheckCircle, Rss
} from 'lucide-react';
import { Widget } from '../Widget';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import apiClient from '../../../api/client';
import { useMapAnnouncements } from '../../../hooks/useMapAnnouncements';
import { addDelayedTooltipBehavior, injectTooltipStyles } from '../../map/tooltipUtils';
import {
  PROVINCES,
  PROVINCE_COLORS,
  PROVINCE_BOUNDS,
  getDistrictsForProvince,
  normalizeDistrictName,
  getProvinceForDistrict,
  type Province,
} from '../../../data/districts';
import { useDashboardStore } from '../../../stores/dashboardStore';
import { useElectionStore, type MapColorMode } from '../../../stores/electionStore';
import { useDistrictMapData, useNationalSummary, useLatestBrief, useRequestFactCheck } from '../../../api/hooks';
import type { DistrictElectionData } from '../../../api/elections';
import { loadElectionData, type ElectionData, type RawConstituencyResult, type RawCandidate } from '../../elections/electionDataLoader';
import { ElectionMapContent } from './ElectionMapWidget';
// =============================================================================
// TYPES
// =============================================================================

interface MapEvent {
  id: string;
  title: string;
  category: string;
  severity: string;
  timestamp: string;
  timeLabel?: string;
  district?: string;
  coordinates: [number, number];
  story_type?: string;
  deaths?: number;
  injured?: number;
  magnitude?: number;
  summary?: string;
  source_url?: string;
  cluster_id?: string;
  source_name?: string;
  source_count?: number;
  is_consolidated?: boolean;
  tactical_type?: string;
  tactical_context?: string;
  municipality?: string;
}

interface MapApiResponse {
  features: Array<{
    properties: {
      id: string;
      title: string;
      category: string;
      severity: string;
      timestamp: string;
      district?: string;
      story_type?: string;
      deaths?: number;
      injured?: number;
      magnitude?: number;
      summary?: string;
      source_url?: string;
      cluster_id?: string;
      source_name?: string;
      source_count?: number;
      is_consolidated?: boolean;
      tactical_type?: string;
      tactical_context?: string;
      municipality?: string;
    };
    geometry: { coordinates: [number, number] };
  }>;
  total: number;
}

function getMapEventLimit(hours: number): number {
  if (hours >= 24 * 7) return 1500;
  if (hours >= 72) return 1200;
  return 1000;
}

interface DistrictFeature {
  type: 'Feature';
  properties: { name: string; province?: string; DISTRICT?: string; PROVINCE?: string; };
  geometry: GeoJSON.Geometry;
}

interface DistrictGeoJSON {
  type: 'FeatureCollection';
  features: DistrictFeature[];
}

// =============================================================================
// LIGHT THEME DESIGN SYSTEM (LiveUAMap Style)
// =============================================================================

const PALANTIR_COLORS = {
  bg: {
    base: '#0a0e14',
    surface: '#111720',
    elevated: '#1a2230',
    overlay: 'rgba(10, 14, 20, 0.95)',
  },
  border: {
    subtle: '#1e2936',
    default: '#2a3544',
    active: 'rgba(59, 130, 246, 0.5)',
  },
  text: {
    primary: '#e5e7eb',
    secondary: '#9ca3af',
    muted: '#6b7280',
  },
  severity: {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e',
  },
  accent: '#3b82f6',
};

// Prefer the global dashboard theme variables when available (fallbacks keep MapWidget usable in isolation)
const PRO_THEME = {
  bg: {
    base: 'var(--pro-bg-base, #08090a)',
    surface: 'var(--pro-bg-surface, #0c0d0f)',
    elevated: 'var(--pro-bg-elevated, #111214)',
    overlay: 'var(--pro-bg-overlay, #161719)',
    hover: 'var(--pro-bg-hover, #1a1b1e)',
    active: 'var(--pro-bg-active, #1f2024)',
  },
  border: {
    subtle: 'var(--pro-border-subtle, rgba(255, 255, 255, 0.04))',
    default: 'var(--pro-border-default, rgba(255, 255, 255, 0.07))',
    emphasis: 'var(--pro-border-emphasis, rgba(255, 255, 255, 0.12))',
    focus: 'var(--pro-border-focus, rgba(99, 102, 241, 0.4))',
  },
  text: {
    primary: 'var(--pro-text-primary, #f0f1f3)',
    secondary: 'var(--pro-text-secondary, #9ca3af)',
    muted: 'var(--pro-text-muted, #6b7280)',
    disabled: 'var(--pro-text-disabled, #4b5563)',
  },
  accent: 'var(--pro-accent, #6366f1)',
  accentMuted: 'var(--pro-accent-muted, rgba(99, 102, 241, 0.15))',
} as const;

const TIME_FILTERS = [
  { label: '1H', value: 1, desc: 'Last hour' },
  { label: '6H', value: 6, desc: 'Last 6 hours' },
  { label: '24H', value: 24, desc: 'Last 24 hours' },
  { label: '48H', value: 48, desc: 'Last 2 days' },
  { label: '7D', value: 168, desc: 'Last 7 days' },
];

const CATEGORY_CONFIG: Record<string, {
  color: string;
  label: string;
  icon: string;
}> = {
  DISASTER: { color: '#ef4444', label: 'Disaster', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  POLITICAL: { color: '#3b82f6', label: 'Political', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  ECONOMIC: { color: '#10b981', label: 'Economic', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  SECURITY: { color: '#f59e0b', label: 'Security', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  SOCIAL: { color: '#8b5cf6', label: 'Social', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  GOVERNMENT: { color: '#5c7cba', label: 'Govt', icon: 'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6' },
  GENERAL: { color: '#64748b', label: 'General', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
};

// =============================================================================
// NEPAL POLITICAL PARTY COLORS
// =============================================================================

const PARTY_COLORS: Record<string, { color: string; label: string; shortLabel: string }> = {
  // Major Parties
  'Nepali Congress': { color: '#dc2626', label: 'Nepali Congress', shortLabel: 'NC' },
  'CPN (UML)': { color: '#2563eb', label: 'CPN (UML)', shortLabel: 'UML' },
  'CPN (Maoist Centre)': { color: '#7f1d1d', label: 'CPN (Maoist Centre)', shortLabel: 'MC' },
  'Rastriya Swatantra Party': { color: '#f97316', label: 'Rastriya Swatantra Party', shortLabel: 'RSP' },
  'CPN (Unified Socialist)': { color: '#b91c1c', label: 'CPN (Unified Socialist)', shortLabel: 'US' },
  'Rastriya Prajatantra Party': { color: '#eab308', label: 'Rastriya Prajatantra Party', shortLabel: 'RPP' },
  'Janata Samajbadi Party': { color: '#16a34a', label: 'Janata Samajbadi Party', shortLabel: 'JSP' },
  'Loktantrik Samajwadi Party': { color: '#059669', label: 'Loktantrik Samajwadi Party', shortLabel: 'LSP' },
  'Janamat Party': { color: '#8b5cf6', label: 'Janamat Party', shortLabel: 'JP' },
  'Nagarik Unmukti Party': { color: '#06b6d4', label: 'Nagarik Unmukti Party', shortLabel: 'NUP' },
  'Nepal Workers Peasants Party': { color: '#991b1b', label: 'Nepal Workers Peasants Party', shortLabel: 'NWPP' },
  // Aliases for common variations
  'NC': { color: '#dc2626', label: 'Nepali Congress', shortLabel: 'NC' },
  'UML': { color: '#2563eb', label: 'CPN (UML)', shortLabel: 'UML' },
  'Maoist': { color: '#7f1d1d', label: 'CPN (Maoist Centre)', shortLabel: 'MC' },
  'RSP': { color: '#f97316', label: 'Rastriya Swatantra Party', shortLabel: 'RSP' },
  'Independent': { color: '#64748b', label: 'Independent', shortLabel: 'IND' },
  // Default
  'Other': { color: '#475569', label: 'Other', shortLabel: 'OTH' },
};

function getPartyColor(partyName: string | undefined): string {
  if (!partyName) return PARTY_COLORS.Other.color;
  // Try exact match first
  if (PARTY_COLORS[partyName]) return PARTY_COLORS[partyName].color;
  // Try partial match
  const lower = partyName.toLowerCase();
  if (lower.includes('congress')) return PARTY_COLORS['Nepali Congress'].color;
  if (lower.includes('uml')) return PARTY_COLORS['CPN (UML)'].color;
  if (lower.includes('maoist')) return PARTY_COLORS['CPN (Maoist Centre)'].color;
  if (lower.includes('swatantra') || lower.includes('rsp')) return PARTY_COLORS['Rastriya Swatantra Party'].color;
  if (lower.includes('prajatantra') || lower.includes('rpp')) return PARTY_COLORS['Rastriya Prajatantra Party'].color;
  if (lower.includes('samajbadi') || lower.includes('jsp')) return PARTY_COLORS['Janata Samajbadi Party'].color;
  if (lower.includes('janamat')) return PARTY_COLORS['Janamat Party'].color;
  if (lower.includes('independent')) return PARTY_COLORS['Independent'].color;
  return PARTY_COLORS.Other.color;
}

function getPartyShortLabel(partyName: string | undefined): string {
  if (!partyName) return 'OTH';
  if (PARTY_COLORS[partyName]) return PARTY_COLORS[partyName].shortLabel;
  const lower = partyName.toLowerCase();
  if (lower.includes('congress')) return 'NC';
  if (lower.includes('uml')) return 'UML';
  if (lower.includes('maoist')) return 'MC';
  if (lower.includes('swatantra') || lower.includes('rsp')) return 'RSP';
  if (lower.includes('prajatantra') || lower.includes('rpp')) return 'RPP';
  if (lower.includes('samajbadi') || lower.includes('jsp')) return 'JSP';
  if (lower.includes('janamat')) return 'JP';
  if (lower.includes('independent')) return 'IND';
  return 'OTH';
}

// =============================================================================
// HELPERS
// =============================================================================

function getTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

function getEventTimeLabel(event: Pick<MapEvent, 'timestamp' | 'timeLabel'>): string {
  return event.timeLabel || getTimeAgo(event.timestamp);
}

function getEventDetailTimeLabel(event: Pick<MapEvent, 'timestamp' | 'timeLabel'>): string {
  if (event.timeLabel) {
    return event.timeLabel;
  }

  const date = new Date(event.timestamp);
  return Number.isNaN(date.getTime()) ? event.timestamp : date.toLocaleString();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLength * 0.6 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

function createPalantirMarker(category: string, severity: string): L.DivIcon {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.GENERAL;
  const size = severity === 'CRITICAL' ? 20 : severity === 'HIGH' ? 16 : 12;
  // Simple white markers with colored borders - LiveUAMap style
  const borderWidth = severity === 'CRITICAL' ? 2.5 : severity === 'HIGH' ? 2 : 1.5;

  return L.divIcon({
    className: 'palantir-marker',
    html: `
      <div class="palantir-marker-container" style="
        width: ${size * 2}px;
        height: ${size * 2}px;
        position: relative;
      ">
        <div class="palantir-marker-inner" style="
          width: ${size * 2}px;
          height: ${size * 2}px;
          background: #ffffff;
          border: ${borderWidth}px solid ${config.color};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        ">
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="${config.icon}"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [size * 2, size * 2],
    iconAnchor: [size, size],
  });
}


function injectPalantirStyles() {
  if (document.getElementById('palantir-map-styles')) return;

  const style = document.createElement('style');
  style.id = 'palantir-map-styles';
  style.textContent = `
    .palantir-marker { background: transparent !important; border: none !important; }
    .palantir-marker-container { transition: opacity 0.15s ease; cursor: pointer; }
    .palantir-marker-container:hover { opacity: 0.9; z-index: 10000 !important; }

    .leaflet-container { background: #e5e7eb !important; }

    .palantir-tooltip {
      background: ${PRO_THEME.bg.elevated} !important;
      border: 1px solid ${PRO_THEME.border.default} !important;
      border-radius: 8px !important;
      padding: 0 !important;
      color: ${PRO_THEME.text.primary} !important;
      font-size: 12px !important;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45) !important;
      max-width: 380px !important;
      min-width: 280px !important;
      overflow: hidden !important;
    }
    .palantir-tooltip:before { display: none !important; }

    .district-tooltip {
      background: ${PRO_THEME.bg.elevated} !important;
      border: 1px solid ${PRO_THEME.border.default} !important;
      border-radius: 6px !important;
      padding: 10px 14px !important;
      font-size: 12px !important;
      color: ${PRO_THEME.text.primary} !important;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45) !important;
    }
    .district-tooltip:before { display: none !important; }

    .leaflet-control-zoom { border: none !important; box-shadow: 0 10px 30px rgba(0,0,0,0.35) !important; }
    .leaflet-control-zoom a {
      background: ${PRO_THEME.bg.elevated} !important;
      border: 1px solid ${PRO_THEME.border.default} !important;
      color: ${PRO_THEME.text.secondary} !important;
      width: 32px !important;
      height: 32px !important;
      line-height: 32px !important;
      font-size: 16px !important;
    }
    .leaflet-control-zoom a:hover { background: ${PRO_THEME.bg.surface} !important; color: ${PRO_THEME.text.primary} !important; }
    .leaflet-control-zoom-in { border-radius: 6px 6px 0 0 !important; }
    .leaflet-control-zoom-out { border-radius: 0 0 6px 6px !important; border-top: none !important; }

    /* Cluster marker styles - professional static design */
    .marker-cluster-custom { background: transparent !important; border: none !important; }
    .cluster-marker { transition: opacity 0.15s ease; cursor: pointer; }
    .cluster-marker:hover { opacity: 0.9; z-index: 10000 !important; }

    /* Override default leaflet.markercluster styles */
    .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
      background: transparent !important;
    }
    .marker-cluster-small div, .marker-cluster-medium div, .marker-cluster-large div {
      background: transparent !important;
    }

`;
  document.head.appendChild(style);
}

// =============================================================================
// COMPONENT
// =============================================================================

function SituationMapWidget() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const districtLayerRef = useRef<L.GeoJSON | null>(null);
  const openEventTooltipMarkerRef = useRef<L.Marker | null>(null);

  // Get widget size and active preset for mode detection
  const { widgetSizes, activePreset: currentPreset } = useDashboardStore();
  const widgetSize = widgetSizes['map'] || 'medium';
  const isCompactMode = ['small', 'medium', 'third', 'quarter', 'mini', 'compact', 'slim'].includes(widgetSize);
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(6);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set(['DISASTER', 'POLITICAL', 'ECONOMIC', 'SECURITY', 'SOCIAL', 'GOVERNMENT'])
  );
  const [showFilters, setShowFilters] = useState(true);
  // Collapse sidebar by default in compact mode
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isCompactMode);
  const [selectedProvinces, setSelectedProvinces] = useState<Set<Province>>(new Set(PROVINCES));
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [districtGeoData, setDistrictGeoData] = useState<DistrictGeoJSON | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<MapEvent | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [factCheckConfirm, setFactCheckConfirm] = useState<string | null>(null);
  const [factCheckRequested, setFactCheckRequested] = useState<Set<string>>(new Set());
  const factCheckMutation = useRequestFactCheck();

  // Analyst brief data for province threat-level choropleth
  const { data: latestBrief } = useLatestBrief();
  const provinceThreatColors = useMemo(() => {
    const map: Record<string, string> = {};
    if (latestBrief?.province_sitreps) {
      const colors: Record<string, string> = {
        critical: '#CD4246',
        elevated: '#C87619',
        guarded: '#D1980B',
        low: '#238551',
      };
      for (const s of latestBrief.province_sitreps) {
        if (s.province_name && s.threat_level) {
          map[s.province_name] = colors[s.threat_level] || '#64748b';
        }
      }
    }
    return map;
  }, [latestBrief]);

  // Cluster panel state
  const [clusterEvents, setClusterEvents] = useState<MapEvent[]>([]);
  const [clusterLocation, setClusterLocation] = useState<string | null>(null);
  const [showClusterPanel, setShowClusterPanel] = useState(false);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  // Group cluster events by cluster_id for deduplication display
  const groupedClusterEvents = useMemo(() => {
    const groups = new globalThis.Map<string, { title: string; events: MapEvent[]; category: string; severity: string; timestamp: string }>();

    clusterEvents.forEach(event => {
      // Group by cluster_id, standalone events stay separate
      const groupKey = event.cluster_id || `standalone_${event.id}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          title: event.title,
          events: [event],
          category: event.category,
          severity: event.severity,
          timestamp: event.timestamp,
        });
      } else {
        const group = groups.get(groupKey)!;
        group.events.push(event);
        // Use the most recent timestamp and highest severity
        if (new Date(event.timestamp) > new Date(group.timestamp)) {
          group.timestamp = event.timestamp;
        }
        if (event.severity === 'CRITICAL' || (event.severity === 'HIGH' && group.severity !== 'CRITICAL')) {
          group.severity = event.severity;
        }
      }
    });

    // Convert to array and sort by timestamp (most recent first)
    return Array.from(groups.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [clusterEvents]);

  // =============================================================================
  // ELECTION MODE DETECTION
  // =============================================================================
  const isElectionMode = currentPreset === 'elections';
  // Election store & hooks
  const { electionYear, mapColorMode, setMapColorMode, availableYears } = useElectionStore();
  const latestElectionYear = useMemo(() => Math.max(...(availableYears?.length ? availableYears : [electionYear])), [availableYears, electionYear]);
  const isLiveElectionYear = electionYear === latestElectionYear;

  // Anti-incumbency data state
  const [antiIncumbencyMap, setAntiIncumbencyMap] = useState<globalThis.Map<string, 'retained' | 'lost' | null>>(new globalThis.Map());
  const [loadedElectionData, setLoadedElectionData] = useState<ElectionData | null>(null);
  const [localNationalSummary, setLocalNationalSummary] = useState<{
    declared: number;
    counting: number;
    pending: number;
    total: number;
    turnout: number;
    leadingParty: string;
    leadingSeats: number;
    totalVotes: number;
  } | null>(null);

  // Load election data from static JSON files (more reliable than database API)
  useEffect(() => {
    if (!isElectionMode) return;

    const loadData = async () => {
      try {
        const data = await loadElectionData(electionYear);
        if (data) {
          setLoadedElectionData(data);
          // Compute local national summary
          const ns = data.national_summary;
          setLocalNationalSummary({
            declared: ns.declared,
            counting: ns.counting,
            pending: ns.pending,
            total: ns.total_constituencies,
            turnout: ns.turnout_pct,
            leadingParty: ns.leading_party,
            leadingSeats: ns.leading_party_seats,
            totalVotes: ns.total_votes_cast,
          });
        }
      } catch (err) {
        console.error('[MapWidget] Failed to load election data:', err);
      }
    };

    loadData();
  }, [isElectionMode, electionYear]);

  // Fallback to database API hooks (keep for compatibility)
  const { data: districtMapData, isLoading: isLoadingDistrictMap } = useDistrictMapData(isElectionMode ? electionYear : 0);
  const { data: nationalSummary, isLoading: isLoadingNational } = useNationalSummary(isElectionMode ? electionYear : 0);

  // Create district election data map - PRIORITIZE local JSON data over database API
  const districtElectionMap = useMemo((): globalThis.Map<string, DistrictElectionData> => {
    const dataMap: globalThis.Map<string, DistrictElectionData> = new globalThis.Map();

    // First try: Compute from loaded static JSON data (more reliable)
    if (loadedElectionData && loadedElectionData.constituencies.length > 0) {
      // Aggregate constituencies by district
      const districtAggregates: Record<string, {
        constituencies: number;
        declared: number;
        counting: number;
        pending: number;
        parties: Record<string, number>;
        totalVotes: number;
        province: string;
        province_id: number;
      }> = {};

      for (const c of loadedElectionData.constituencies) {
        const dist = normalizeDistrictName(c.district);
        if (!districtAggregates[dist]) {
          districtAggregates[dist] = {
            constituencies: 0,
            declared: 0,
            counting: 0,
            pending: 0,
            parties: {},
            totalVotes: 0,
            province: c.province,
            province_id: c.province_id,
          };
        }

        const agg = districtAggregates[dist];
        agg.constituencies++;
        agg.totalVotes += c.total_votes || 0;

        if (c.status === 'declared') {
          agg.declared++;
          if (c.winner_party) {
            agg.parties[c.winner_party] = (agg.parties[c.winner_party] || 0) + 1;
          }
        } else if (c.status === 'counting') {
          agg.counting++;
        } else {
          agg.pending++;
        }
      }

      // Convert aggregates to DistrictElectionData format
      for (const [dist, agg] of Object.entries(districtAggregates)) {
        // Find dominant party (most seats won)
        let dominantParty: string | undefined = undefined;
        let maxSeats = 0;
        for (const [party, seats] of Object.entries(agg.parties)) {
          if (seats > maxSeats) {
            maxSeats = seats;
            dominantParty = party;
          }
        }

        dataMap.set(dist, {
          district: dist,
          province: agg.province,
          province_id: agg.province_id,
          constituencies: agg.constituencies,
          declared: agg.declared,
          counting: agg.counting,
          pending: agg.pending,
          dominant_party: dominantParty,
          parties: agg.parties,
          total_votes: agg.totalVotes,
        });
      }

      return dataMap;
    }

    // Fallback: Use database API data if local data not available
    if (districtMapData?.districts) {
      for (const d of districtMapData.districts) {
        dataMap.set(normalizeDistrictName(d.district), d);
      }
    }
    return dataMap;
  }, [loadedElectionData, districtMapData]);

  // Compute anti-incumbency data for map coloring
  useEffect(() => {
    if (!isElectionMode || mapColorMode !== 'anti-incumbency') return;

    const computeAntiIncumbency = async () => {
      try {
        const currentData = await loadElectionData(electionYear);
        const prevYear = electionYear === 2082 ? 2079 : electionYear === 2079 ? 2074 : null;
        if (!prevYear || !currentData) return;

        const prevData = await loadElectionData(prevYear);
        if (!prevData) return;

        // Build map of previous winners by district
        const prevWinnersByDistrict = new globalThis.Map<string, string>();
        for (const c of prevData.constituencies) {
          const winner = c.candidates.find((x: RawCandidate) => x.is_winner);
          if (winner) {
            const dist = normalizeDistrictName(c.district);
            // Track dominant party per district
            const existing = prevWinnersByDistrict.get(dist);
            if (!existing) prevWinnersByDistrict.set(dist, winner.party);
          }
        }

        // Compare current winners to previous
        const districtIncumbency = new globalThis.Map<string, 'retained' | 'lost' | null>();
        const districtRetained = new globalThis.Map<string, number>();
        const districtLost = new globalThis.Map<string, number>();

        for (const c of currentData.constituencies) {
          if (c.status !== 'declared') continue;
          const dist = normalizeDistrictName(c.district);
          const currentWinner = c.candidates.find((x: RawCandidate) => x.is_winner);
          if (!currentWinner) continue;

          const prevC = prevData.constituencies.find((pc: RawConstituencyResult) => pc.constituency_id === c.constituency_id);
          if (!prevC) continue;
          const prevWinner = prevC.candidates.find((x: RawCandidate) => x.is_winner);
          if (!prevWinner) continue;

          if (currentWinner.party === prevWinner.party) {
            districtRetained.set(dist, (districtRetained.get(dist) || 0) + 1);
          } else {
            districtLost.set(dist, (districtLost.get(dist) || 0) + 1);
          }
        }

        // Determine overall district status
        for (const dist of new Set([...districtRetained.keys(), ...districtLost.keys()])) {
          const retained = districtRetained.get(dist) || 0;
          const lost = districtLost.get(dist) || 0;
          if (retained > lost) {
            districtIncumbency.set(dist, 'retained');
          } else if (lost > retained) {
            districtIncumbency.set(dist, 'lost');
          } else {
            districtIncumbency.set(dist, null);
          }
        }

        setAntiIncumbencyMap(districtIncumbency);
      } catch (err) {
        console.error('Failed to compute anti-incumbency:', err);
      }
    };

    computeAntiIncumbency();
  }, [isElectionMode, mapColorMode, electionYear]);

  // Fetch government announcements (follows map time filter)
  const { announcements: mapAnnouncements } = useMapAnnouncements(hours);

  // Get selected districts based on selected provinces
  const selectedDistrictNames = useMemo(() => {
    if (selectedProvinces.size === PROVINCES.length) return null;
    const districts = new Set<string>();
    selectedProvinces.forEach(province => {
      getDistrictsForProvince(province).forEach(d => districts.add(normalizeDistrictName(d)));
    });
    return districts;
  }, [selectedProvinces]);

  // Convert announcements to MapEvent format
  const announcementEvents = useMemo((): MapEvent[] => {
    return mapAnnouncements.map(a => ({
      id: `govt-${a.id}`,
      title: a.title,
      category: 'GOVERNMENT',
      severity: a.is_important ? 'HIGH' : 'MEDIUM',
      timestamp: a.timestamp,
      timeLabel: a.time_label,
      district: a.district,
      coordinates: a.coordinates,
      story_type: a.category.replace(/-/g, ' '),
      source_url: a.url,
      summary: `Source: ${a.source_name}`,
    }));
  }, [mapAnnouncements]);

  // Filter events (including government announcements)
  // Clustering handles visual density, so show all severity levels
  const filteredEvents = useMemo(() => {
    // Combine regular events with announcement events
    const allEvents = [...events, ...announcementEvents];

    const filtered = allEvents.filter(e => {
      if (!activeCategories.has(e.category)) return false;
      if (selectedDistrictNames && e.district) {
        if (!selectedDistrictNames.has(normalizeDistrictName(e.district))) return false;
      }
      if (selectedDistrict && e.district) {
        if (normalizeDistrictName(e.district) !== normalizeDistrictName(selectedDistrict)) return false;
      }
      return true;
    });

    return filtered;
  }, [events, announcementEvents, activeCategories, selectedDistrictNames, selectedDistrict]);

  // Statistics
  const stats = useMemo(() => {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const byProvince: Record<string, number> = {};

    filteredEvents.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
      if (e.district) {
        const prov = getProvinceForDistrict(e.district);
        if (prov) byProvince[prov] = (byProvince[prov] || 0) + 1;
      }
    });

    return { total: filteredEvents.length, byCategory, bySeverity, byProvince };
  }, [filteredEvents]);

  // Fetch events
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const preferredLimit = getMapEventLimit(hours);
      const limitCandidates = Array.from(new Set([preferredLimit, 1500, 1000, 500]));
      let response: { data: MapApiResponse } | null = null;
      let lastError: unknown = null;

      for (const limitCandidate of limitCandidates) {
        try {
          response = await apiClient.get<MapApiResponse>('/map/events', {
            params: { hours, limit: limitCandidate, include_rivers: false },
          });
          break;
        } catch (err) {
          lastError = err;
          const status = (err as { response?: { status?: number } })?.response?.status;
          // Older backend instances may reject higher limits with 422 (validation).
          // Retry with progressively smaller limits instead of failing hard.
          if (status === 422) {
            continue;
          }
          throw err;
        }
      }

      if (!response) {
        throw lastError ?? new Error('Failed to load map events');
      }

      setEvents(response.data.features.map(f => ({
        id: f.properties.id,
        title: f.properties.title,
        category: f.properties.category,
        severity: f.properties.severity,
        timestamp: f.properties.timestamp,
        district: f.properties.district,
        story_type: f.properties.story_type,
        deaths: f.properties.deaths,
        injured: f.properties.injured,
        magnitude: f.properties.magnitude,
        summary: f.properties.summary,
        source_url: f.properties.source_url,
        cluster_id: f.properties.cluster_id,
        source_name: f.properties.source_name,
        source_count: f.properties.source_count,
        is_consolidated: f.properties.is_consolidated,
        tactical_type: f.properties.tactical_type,
        tactical_context: f.properties.tactical_context,
        municipality: f.properties.municipality,
        coordinates: f.geometry.coordinates,
      })));
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch map events:', err);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  // Initialize map
  useEffect(() => {
    injectPalantirStyles();
    injectTooltipStyles();
    if (mapRef.current && !mapInstance.current) {
      // Nepal bounds — include Terai/Madhesh (south to 25.8°)
      const nepalBounds = L.latLngBounds(
        L.latLng(25.8, 79.5),   // Southwest corner (wider for Madhesh visibility)
        L.latLng(30.5, 88.5)    // Northeast corner
      );

      mapInstance.current = L.map(mapRef.current, {
        center: [28.0, 84.1240],
        zoom: 7,
        minZoom: 6,
        maxZoom: 18,
        maxBounds: nepalBounds,
        maxBoundsViscosity: 0.8,
        zoomControl: false,
        attributionControl: false,
      });

      // Light tile layer (CartoDB Voyager — bright, readable)
      tileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap © CARTO',
        subdomains: 'abcd',
      }).addTo(mapInstance.current);

      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);

      // Close any open event tooltip when clicking empty map (professional single-focus behavior)
      const handleMapClick = () => {
        const openMarker = openEventTooltipMarkerRef.current;
        if (openMarker && openMarker.isTooltipOpen()) openMarker.closeTooltip();
        openEventTooltipMarkerRef.current = null;
      };
      mapInstance.current.on('click', handleMapClick);
      (mapInstance.current as any).__handleMapClick = handleMapClick;
    }
    return () => {
      if (mapInstance.current) {
        const handleMapClick = (mapInstance.current as any).__handleMapClick;
        if (handleMapClick) {
          mapInstance.current.off('click', handleMapClick);
          delete (mapInstance.current as any).__handleMapClick;
        }
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Always satellite tiles — user preference

  // Load GeoJSON
  useEffect(() => {
    fetch('/geo/nepal-districts.geojson')
      .then(res => res.json())
      .then((data: DistrictGeoJSON) => setDistrictGeoData(data))
      .catch(err => console.error('Failed to load district boundaries:', err));
  }, []);

  // Update district boundaries
  useEffect(() => {
    const shouldShowBoundaries = isElectionMode || showBoundaries;
    if (!mapInstance.current || !districtGeoData || !shouldShowBoundaries) {
      if (districtLayerRef.current) {
        districtLayerRef.current.remove();
        districtLayerRef.current = null;
      }
      return;
    }

    if (districtLayerRef.current) districtLayerRef.current.remove();

    const getStyle = (feature: DistrictFeature): L.PathOptions => {
      const districtName = feature.properties.name || feature.properties.DISTRICT || '';
      const province = feature.properties.province || feature.properties.PROVINCE || getProvinceForDistrict(districtName) || 'Bagmati';
      const normalized = normalizeDistrictName(districtName);

      const isProvinceSelected = selectedProvinces.size === PROVINCES.length ||
        Array.from(selectedProvinces).some(p => getProvinceForDistrict(districtName) === p);
      const isSelected = selectedDistrict && normalizeDistrictName(selectedDistrict) === normalized;
      const isHovered = hoveredDistrict && normalizeDistrictName(hoveredDistrict) === normalized;

      // ELECTION MODE: Color by dominant party OR anti-incumbency
      if (isElectionMode) {
        const electionData = districtElectionMap.get(normalized);
        const hasData = electionData && electionData.declared > 0;

        // Anti-incumbency mode: green = retained, red = lost
        if (mapColorMode === 'anti-incumbency') {
          const incumbencyStatus = antiIncumbencyMap.get(normalized);
          let fillColor = '#374151'; // No data
          if (incumbencyStatus === 'retained') fillColor = '#22c55e';
          else if (incumbencyStatus === 'lost') fillColor = '#dc2626';

          if (isSelected) return { fillColor, fillOpacity: 0.6, color: '#fff', weight: 4, opacity: 1 };
          if (isHovered) return { fillColor, fillOpacity: 0.5, color: fillColor, weight: 3.5, opacity: 1 };
          if (!incumbencyStatus) return { fillColor: '#1f2937', fillOpacity: 0.15, color: '#4b5563', weight: 1.5, opacity: 0.4 };
          return { fillColor, fillOpacity: 0.4, color: fillColor, weight: 2.5, opacity: 0.9 };
        }

        // Party mode (default) - use party colors for borders
        const partyColor = electionData?.dominant_party
          ? getPartyColor(electionData.dominant_party)
          : '#374151'; // Pending/no data color

        if (isSelected) return { fillColor: partyColor, fillOpacity: 0.5, color: '#fff', weight: 4, opacity: 1 };
        if (isHovered) return { fillColor: partyColor, fillOpacity: 0.4, color: partyColor, weight: 3.5, opacity: 1 };
        if (!hasData) return { fillColor: '#1f2937', fillOpacity: 0.15, color: '#4b5563', weight: 1.5, opacity: 0.4 };
        return { fillColor: partyColor, fillOpacity: 0.3, color: partyColor, weight: 2.5, opacity: 0.9 };
      }

      // NORMAL MODE: Use threat-level choropleth from analyst brief when available,
      // otherwise fall back to province colors.
      const threatColor = provinceThreatColors[province];
      const color = threatColor || PROVINCE_COLORS[province] || '#64748b';
      const fillOpBase = threatColor ? 0.18 : 0.1; // Slightly more visible when threat-colored
      if (isSelected) return { fillColor: color, fillOpacity: 0.4, color: '#ffffff', weight: 4, opacity: 1 };
      if (isHovered) return { fillColor: color, fillOpacity: 0.25, color, weight: 3.5, opacity: 1 };
      if (!isProvinceSelected) return { fillColor: '#1f2937', fillOpacity: 0.02, color: '#4b5563', weight: 1.5, opacity: 0.3 };
      return { fillColor: color, fillOpacity: fillOpBase, color, weight: 2.5, opacity: 0.85 };
    };

    districtLayerRef.current = L.geoJSON(districtGeoData as GeoJSON.FeatureCollection, {
      style: (feature) => getStyle(feature as DistrictFeature),
      onEachFeature: (feature, layer) => {
        const f = feature as DistrictFeature;
        const name = f.properties.name || f.properties.DISTRICT || 'Unknown';
        const prov = f.properties.province || f.properties.PROVINCE || getProvinceForDistrict(name) || '';
        const eventCount = filteredEvents.filter(e => e.district && normalizeDistrictName(e.district) === normalizeDistrictName(name)).length;

        // Election mode tooltip
        if (isElectionMode) {
          const electionData = districtElectionMap.get(normalizeDistrictName(name));
          const partyColor = electionData?.dominant_party ? getPartyColor(electionData.dominant_party) : '#64748b';
          const partyLabel = electionData?.dominant_party ? getPartyShortLabel(electionData.dominant_party) : 'N/A';
          const seatsText = electionData
            ? `${electionData.declared}/${electionData.constituencies} declared`
            : 'No data';
          const topParties = electionData?.parties
            ? (Object.entries(electionData.parties) as [string, number][])
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([party, seats]) => `<span style="color: ${getPartyColor(party)}">${getPartyShortLabel(party)}: ${seats}</span>`)
                .join(' • ')
            : '';

          layer.bindTooltip(`
            <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px;">${name}</div>
            <div style="font-size: 10px; color: #64748b; margin-bottom: 6px;">${prov}</div>
            ${electionData?.dominant_party ? `
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                <div style="width: 10px; height: 10px; border-radius: 2px; background: ${partyColor}"></div>
                <span style="font-size: 11px; font-weight: 600; color: ${partyColor}">${electionData.dominant_party}</span>
              </div>
            ` : ''}
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">${seatsText}</div>
            ${topParties ? `<div style="font-size: 10px;">${topParties}</div>` : ''}
          `, { sticky: false, permanent: false, direction: 'top', className: 'district-tooltip', interactive: false });
          // Add delayed tooltip behavior for election mode district tooltips
          addDelayedTooltipBehavior(layer, { showDelay: 250, hideDelay: 0 });
        } else {
          // Normal mode tooltip
          layer.bindTooltip(`
            <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">${name}</div>
            <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
              <span>${prov}</span>
              ${eventCount > 0 ? `<span style="color: #3b82f6;">• ${eventCount} events</span>` : ''}
            </div>
          `, { sticky: false, permanent: false, direction: 'top', className: 'district-tooltip', interactive: false });
          // Add delayed tooltip behavior for normal mode district tooltips
          addDelayedTooltipBehavior(layer, { showDelay: 250, hideDelay: 0 });
        }

        layer.on('click', () => {
          const norm = normalizeDistrictName(name);
          setSelectedDistrict(prev => prev && normalizeDistrictName(prev) === norm ? null : name);
        });
        layer.on('mouseover', () => setHoveredDistrict(name));
        layer.on('mouseout', () => setHoveredDistrict(null));
      },
    });

    districtLayerRef.current.addTo(mapInstance.current);
    districtLayerRef.current.bringToBack();
  }, [districtGeoData, showBoundaries, selectedProvinces, selectedDistrict, hoveredDistrict, filteredEvents, isElectionMode, districtElectionMap, mapColorMode, antiIncumbencyMap]);

  // Zoom to province
  useEffect(() => {
    if (!mapInstance.current || selectedProvinces.size === 0 || selectedProvinces.size === PROVINCES.length) return;
    let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
    selectedProvinces.forEach(p => {
      const bounds = PROVINCE_BOUNDS[p];
      if (bounds) {
        minLat = Math.min(minLat, bounds[0][0]);
        minLng = Math.min(minLng, bounds[0][1]);
        maxLat = Math.max(maxLat, bounds[1][0]);
        maxLng = Math.max(maxLng, bounds[1][1]);
      }
    });
    if (minLat < 90) mapInstance.current.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [30, 30], animate: true, duration: 0.5 });
  }, [selectedProvinces]);

  // Fetch and auto-refresh
  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => {
    const interval = setInterval(fetchEvents, 60000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Create cluster icon function
  const createClusterIcon = useCallback((cluster: L.MarkerCluster): L.DivIcon => {
    const markers = cluster.getAllChildMarkers();
    const count = markers.length;

    // Analyze cluster contents by category
    const typeBreakdown: Record<string, number> = {};
    let maxSeverity = 'LOW';
    const severityOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    markers.forEach((marker) => {
      const event = (marker as any).eventData as MapEvent;
      if (event) {
        typeBreakdown[event.category] = (typeBreakdown[event.category] || 0) + 1;
        if (severityOrder.indexOf(event.severity) > severityOrder.indexOf(maxSeverity)) {
          maxSeverity = event.severity;
        }
      }
    });

    // Find dominant type
    let dominantType = 'GENERAL';
    let maxCount = 0;
    Object.entries(typeBreakdown).forEach(([t, num]) => {
      if (num > maxCount) { maxCount = num; dominantType = t; }
    });

    const config = CATEGORY_CONFIG[dominantType] || CATEGORY_CONFIG.GENERAL;
    const isCritical = maxSeverity === 'CRITICAL';
    const isHigh = maxSeverity === 'HIGH';

    // Size based on count
    const baseSize = 36;
    const size = Math.min(56, baseSize + Math.log10(count + 1) * 10);
    const typeEntries = Object.entries(typeBreakdown).filter(([, n]) => n > 0);
    const totalEvents = typeEntries.reduce((sum, [, n]) => sum + n, 0);

    // Generate pie segments if multiple types
    let segments = '';
    if (typeEntries.length > 1) {
      const cx = size / 2, cy = size / 2;
      const outerR = size / 2 - 2, innerR = size / 4 + 2;
      let startAngle = -90;
      typeEntries.sort(([, a], [, b]) => b - a);

      for (const [t, n] of typeEntries) {
        const catConfig = CATEGORY_CONFIG[t] || CATEGORY_CONFIG.GENERAL;
        const proportion = n / totalEvents;
        const sweepAngle = proportion * 360;
        if (sweepAngle < 2) continue;

        const endAngle = startAngle + sweepAngle;
        const largeArc = sweepAngle > 180 ? 1 : 0;
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + outerR * Math.cos(startRad), y1 = cy + outerR * Math.sin(startRad);
        const x2 = cx + outerR * Math.cos(endRad), y2 = cy + outerR * Math.sin(endRad);
        const x3 = cx + innerR * Math.cos(endRad), y3 = cy + innerR * Math.sin(endRad);
        const x4 = cx + innerR * Math.cos(startRad), y4 = cy + innerR * Math.sin(startRad);

        segments += `<path d="M${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 ${largeArc} 0 ${x4},${y4} Z" fill="${catConfig.color}" opacity="0.85"/>`;
        startAngle = endAngle;
      }
    }

    // Simple cluster markers - no outer rings or glow effects
    const borderWidth = isCritical ? 3 : isHigh ? 2.5 : 2;

    const html = typeEntries.length > 1 ? `
      <div class="cluster-marker" style="position: relative;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="#ffffff" stroke="#e5e7eb" stroke-width="1"/>
          ${segments}
          <circle cx="${size/2}" cy="${size/2}" r="${size/4 + 2}" fill="#ffffff"/>
          <text x="${size/2}" y="${size/2 + 4}" text-anchor="middle" fill="#111827" font-size="${count > 99 ? 10 : 12}" font-weight="600" font-family="system-ui">${count > 999 ? '999+' : count}</text>
        </svg>
      </div>
    ` : `
      <div class="cluster-marker" style="
        width: ${size}px; height: ${size}px;
        position: relative;
      ">
        <div style="
          width: 100%; height: 100%;
          background: #ffffff;
          border: ${borderWidth}px solid ${config.color};
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        ">
          <span style="font-size: ${count > 99 ? 11 : 13}px; font-weight: 600; color: #111827;">${count > 999 ? '999+' : count}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      className: 'marker-cluster-custom',
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;

    // Remove existing layers
    if (clusterGroupRef.current) { map.removeLayer(clusterGroupRef.current); clusterGroupRef.current = null; }

    // Don't show markers in election mode
    if (isElectionMode) return;

    const positionEventTooltip = (marker: L.Marker) => {
      const tooltip = marker.getTooltip();
      if (!tooltip) return;
      const size = map.getSize();
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const edgePadding = 180;
      const nearTop = point.y < edgePadding;
      const nearBottom = point.y > size.y - edgePadding;
      const nearLeft = point.x < edgePadding;
      const nearRight = point.x > size.x - edgePadding;
      let direction: 'top' | 'bottom' | 'left' | 'right' = 'top';
      if (nearTop && !nearBottom) direction = 'bottom';
      else if (nearBottom && !nearTop) direction = 'top';
      else if (nearLeft && !nearRight) direction = 'right';
      else if (nearRight && !nearLeft) direction = 'left';
      const offset: [number, number] =
        direction === 'bottom' ? [0, 14] : direction === 'top' ? [0, -14] :
        direction === 'right' ? [14, 0] : [-14, 0];
      (tooltip.options as any).direction = direction;
      (tooltip.options as any).offset = offset;
    };

    const bindMarkerClick = (marker: L.Marker, event: MapEvent) => {
      marker.off('mouseover');
      marker.off('mouseout');
      marker.on('click', (e: any) => {
        if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        setShowClusterPanel(false);
        setExpandedClusterId(null);
        const openMarker = openEventTooltipMarkerRef.current;
        const isSameMarker = openMarker === marker;
        if (openMarker && openMarker.isTooltipOpen() && !isSameMarker) openMarker.closeTooltip();
        if (isSameMarker && marker.isTooltipOpen()) {
          marker.closeTooltip(); openEventTooltipMarkerRef.current = null; return;
        }
        positionEventTooltip(marker);
        marker.openTooltip();
        openEventTooltipMarkerRef.current = marker;
        setSelectedEvent(event);
      });
    };

    const clusterGroup = L.markerClusterGroup({
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
      zoomToBoundsOnClick: false,
    });
    clusterGroupRef.current = clusterGroup;

    // Handle cluster click - show panel instead of zooming
    clusterGroup.on('clusterclick', (e: L.LeafletEvent) => {
      const openMarker = openEventTooltipMarkerRef.current;
      if (openMarker && openMarker.isTooltipOpen()) openMarker.closeTooltip();
      openEventTooltipMarkerRef.current = null;
      const cluster = e.layer as L.MarkerCluster;
      const markers = cluster.getAllChildMarkers();
      const clusterEventsData = markers
        .map((m) => (m as any).eventData as MapEvent)
        .filter(Boolean)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const districtCounts: Record<string, number> = {};
      clusterEventsData.forEach(ev => { if (ev.district) districtCounts[ev.district] = (districtCounts[ev.district] || 0) + 1; });
      const topDistrict = Object.entries(districtCounts).sort(([,a], [,b]) => b - a)[0]?.[0] || 'Multiple Locations';
      setClusterEvents(clusterEventsData);
      setClusterLocation(topDistrict);
      setSelectedEvent(null);
      setExpandedClusterId(null);
      setShowClusterPanel(true);
    });

    filteredEvents.forEach(event => {
      const [lng, lat] = event.coordinates;

      const icon = createPalantirMarker(event.category, event.severity);
      const marker = L.marker([lat, lng], { icon });
      (marker as any).eventData = event;

      const config = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.GENERAL;
        const severityColor = PALANTIR_COLORS.severity[event.severity.toLowerCase() as keyof typeof PALANTIR_COLORS.severity] || '#64748b';
        const hasCasualties = event.deaths || event.injured;
        const isMultiSource = (event.source_count || 1) > 1;
        const sourceCount = event.source_count || 1;

        marker.bindTooltip(`
          <div style="padding: 0;">
            <div style="padding: 14px 16px; border-bottom: 1px solid var(--pro-border-default, rgba(255, 255, 255, 0.07));">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div style="
                  width: 36px; height: 36px;
                  background: ${config.color}15;
                  border: 1px solid ${config.color}50;
                  border-radius: 8px;
                  display: flex; align-items: center; justify-content: center;
                ">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${config.color}" stroke-width="2">
                    <path d="${config.icon}"/>
                  </svg>
                </div>
                <div style="flex: 1;">
                  <div style="font-size: 10px; font-weight: 600; text-transform: uppercase; color: ${config.color}; letter-spacing: 0.5px;">
                    ${config.label}
                  </div>
                  <div style="font-size: 11px; color: var(--pro-text-muted, #9ca3af); margin-top: 2px;">
                    ${event.municipality || event.district || 'Nepal'}${event.story_type ? ` • ${event.story_type}` : ''}
                  </div>
                </div>
                <div style="
                  padding: 4px 10px; border-radius: 4px; font-size: 9px; font-weight: 700;
                  background: ${severityColor}15; color: ${severityColor};
                  text-transform: uppercase; letter-spacing: 0.3px;
                ">${event.severity}</div>
              </div>
              <div style="font-weight: 500; font-size: 13px; line-height: 1.5; color: var(--pro-text-primary, #f0f1f3);">
                ${truncateText(event.title, 120)}
              </div>
              ${isMultiSource ? `
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
                  <div style="
                    display: inline-flex; align-items: center; gap: 5px;
                    padding: 3px 9px; border-radius: 4px;
                    background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25);
                  ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span style="font-size: 10px; font-weight: 600; color: #10b981;">VERIFIED</span>
                  </div>
                  <div style="
                    display: inline-flex; align-items: center; gap: 5px;
                    padding: 3px 9px; border-radius: 4px;
                    background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.25);
                  ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <span style="font-size: 10px; font-weight: 600; color: #3b82f6;">${sourceCount} SOURCES</span>
                  </div>
                  ${event.source_name ? `
                    <span style="font-size: 10px; color: var(--pro-text-muted, #6b7280);">via ${event.source_name}</span>
                  ` : ''}
                </div>
              ` : event.source_name ? `
                <div style="margin-top: 8px;">
                  <span style="font-size: 10px; color: var(--pro-text-muted, #6b7280);">Source: ${event.source_name}</span>
                </div>
              ` : ''}
            </div>
            ${hasCasualties ? `
              <div style="padding: 10px 16px; background: rgba(220, 38, 38, 0.06); border-bottom: 1px solid var(--pro-border-default, rgba(255, 255, 255, 0.07));">
                <div style="display: flex; gap: 16px; font-size: 11px;">
                  ${event.deaths ? `<span style="color: #dc2626; font-weight: 600;"><strong>${event.deaths}</strong> deaths</span>` : ''}
                  ${event.injured ? `<span style="color: #ea580c; font-weight: 600;"><strong>${event.injured}</strong> injured</span>` : ''}
                  ${event.magnitude ? `<span style="color: #d97706; font-weight: 600;">M<strong>${event.magnitude}</strong></span>` : ''}
                </div>
              </div>
            ` : ''}
            ${event.summary ? `
              <div style="padding: 12px 16px; border-bottom: 1px solid var(--pro-border-default, rgba(255, 255, 255, 0.07));">
                <div style="font-size: 11px; color: var(--pro-text-secondary, #9ca3af); line-height: 1.6;">
                  ${truncateText(event.summary, 200)}
                </div>
              </div>
            ` : ''}
            <div style="padding: 10px 16px; display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 10px; color: var(--pro-text-muted, #6b7280);">${getEventTimeLabel(event)}</span>
              ${event.source_url ? `<span style="font-size: 10px; color: var(--pro-accent, #6366f1);">View source →</span>` : ''}
            </div>
          </div>
        `, { direction: 'top', offset: [0, -12], className: 'palantir-tooltip', permanent: false, sticky: false, interactive: false, opacity: 1 });

      bindMarkerClick(marker, event);
      clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    return () => {
      if (clusterGroupRef.current && mapInstance.current) {
        mapInstance.current.removeLayer(clusterGroupRef.current);
      }
    };
  }, [filteredEvents, createClusterIcon, isElectionMode]);

  const toggleCategory = (cat: string) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const toggleProvince = (province: Province) => {
    setSelectedProvinces(prev => {
      const next = new Set(prev);
      next.has(province) ? next.delete(province) : next.add(province);
      return next;
    });
    setSelectedDistrict(null);
  };

  const resetView = () => {
    setSelectedProvinces(new Set(PROVINCES));
    setSelectedDistrict(null);
    mapInstance.current?.flyTo([28.3949, 84.1240], 7, { duration: 0.5 });
  };

  // Filter dropdown state
  const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);

  // In election mode, keep the map "independent" from situation-monitor state:
  // - boundaries always on
  // - no lingering story selections/panels
  // - close filter dropdown
  useEffect(() => {
    if (!isElectionMode) return;
    setShowFiltersDropdown(false);
    setSelectedEvent(null);
    setShowClusterPanel(false);
    setExpandedClusterId(null);
  }, [isElectionMode]);

  const [feedLimit, setFeedLimit] = useState(50);
  const recentEvents = useMemo(() => {
    // Deduplicate by title (keep most recent) in addition to cluster_id dedup
    const seenTitles = new globalThis.Map<string, MapEvent>();
    const sorted = [...filteredEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const deduped: MapEvent[] = [];
    for (const e of sorted) {
      const key = e.title.trim().toLowerCase();
      if (!seenTitles.has(key)) {
        seenTitles.set(key, e);
        deduped.push(e);
      }
    }
    return deduped.slice(0, feedLimit);
  }, [filteredEvents, feedLimit]);
  const hasMoreEvents = filteredEvents.length > feedLimit;

  // Cluster size lookup — how many stories share each cluster_id
  const clusterSizeLookup = useMemo(() => {
    const counts = new globalThis.Map<string, number>();
    for (const e of events) {
      if (e.cluster_id) {
        counts.set(e.cluster_id, (counts.get(e.cluster_id) || 0) + 1);
      }
    }
    return counts;
  }, [events]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeCategories.size < 6) count += 1;
    if (selectedProvinces.size < PROVINCES.length) count += 1;
    if (selectedDistrict) count += 1;
    return count;
  }, [activeCategories, selectedProvinces, selectedDistrict]);

  return (
    <Widget id="map" title={isElectionMode ? 'Election Map' : undefined} icon={isElectionMode ? <Vote size={14} /> : <MapPin size={14} />} actions={
      <div className="flex items-center gap-2">
        {isElectionMode ? (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30">
            <Vote size={10} className="text-blue-400" />
            <span className="text-[9px] font-semibold tracking-wide text-blue-400">{electionYear} BS</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">
            <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span className="text-[9px] font-semibold tracking-wide text-emerald-400">LIVE</span>
          </span>
        )}
        <button className="widget-action" onClick={fetchEvents} disabled={loading || isElectionMode}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    }>
      <div style={{ display: 'flex', height: '100%', background: PRO_THEME.bg.base, position: 'relative', overflow: 'hidden' }}>
        {/* Main Map Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Compact Control Bar - Reduced height in compact mode */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: isCompactMode ? '4px 8px' : '8px 12px',
            background: PRO_THEME.bg.surface,
            borderBottom: `1px solid ${PRO_THEME.border.subtle}`,
            gap: isCompactMode ? '6px' : '10px',
            height: isCompactMode ? '32px' : '44px',
          }}>
            {isElectionMode ? (
              /* Election Mode Controls */
              <>
                {/* Election Status Badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  background: '#3b82f615',
                  borderRadius: '4px',
                  border: '1px solid #3b82f630',
                }}>
                  <Vote size={12} style={{ color: '#3b82f6' }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#3b82f6' }}>
                    Election {electionYear}
                  </span>
                  {(localNationalSummary || nationalSummary) && (
                    <span style={{
                      marginLeft: '4px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      background: '#22c55e25',
                      color: '#22c55e',
                    }}>
                      {localNationalSummary?.declared ?? nationalSummary?.declared ?? 0}/{localNationalSummary?.total ?? nationalSummary?.total_constituencies ?? 165}
                    </span>
                  )}
                </div>

                {/* Map Color Mode Toggle */}
                <button
                  onClick={() => setMapColorMode(mapColorMode === 'party' ? 'anti-incumbency' : 'party')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    fontSize: '10px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: mapColorMode === 'anti-incumbency' ? '#8b5cf620' : 'rgba(255,255,255,0.06)',
                    color: mapColorMode === 'anti-incumbency' ? '#8b5cf6' : '#94a3b8',
                    transition: 'all 0.15s',
                  }}
                >
                  {mapColorMode === 'anti-incumbency' ? (
                    <>
                      <TrendingUp size={10} />
                      Incumbency
                    </>
                  ) : (
                    <>
                      <Users size={10} />
                      Party
                    </>
                  )}
                </button>

                {/* Leading Party Badge */}
                {(localNationalSummary?.leadingParty || nationalSummary?.leading_party) && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    background: getPartyColor(localNationalSummary?.leadingParty || nationalSummary?.leading_party) + '15',
                    borderRadius: '4px',
                    border: `1px solid ${getPartyColor(localNationalSummary?.leadingParty || nationalSummary?.leading_party)}30`,
                  }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: getPartyColor(localNationalSummary?.leadingParty || nationalSummary?.leading_party) }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: getPartyColor(localNationalSummary?.leadingParty || nationalSummary?.leading_party) }}>
                      {getPartyShortLabel(localNationalSummary?.leadingParty || nationalSummary?.leading_party)} Leading
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#e2e8f0', fontFamily: 'var(--font-mono, monospace)' }}>
                      {localNationalSummary?.leadingSeats ?? nationalSummary?.leading_party_seats}
                    </span>
                  </div>
                )}
              </>
            ) : (
              /* Normal Mode Controls */
              <>
                {/* Compact Mode Indicator */}
                {isCompactMode && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    background: PALANTIR_COLORS.severity.critical + '15',
                    borderRadius: '3px',
                    border: `1px solid ${PALANTIR_COLORS.severity.critical}30`,
                  }}>
                    <AlertTriangle size={10} style={{ color: PALANTIR_COLORS.severity.critical }} />
                    <span style={{ fontSize: '9px', fontWeight: 600, color: PALANTIR_COLORS.severity.critical, textTransform: 'uppercase' }}>
                      High Priority
                    </span>
                  </div>
                )}

                {/* Event Count Badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: isCompactMode ? '4px' : '6px',
                  padding: isCompactMode ? '2px 6px' : '4px 10px',
                  background: PRO_THEME.accentMuted,
                  borderRadius: '4px',
                  border: `1px solid ${PRO_THEME.border.focus}`,
                }}>
                  <span style={{ fontSize: isCompactMode ? '11px' : '14px', fontWeight: 700, color: PRO_THEME.text.primary, fontFamily: 'var(--font-mono, monospace)' }}>
                    {stats.total}
                  </span>
                  <span style={{ fontSize: isCompactMode ? '8px' : '10px', color: PRO_THEME.text.muted, textTransform: 'uppercase' }}>
                    events
                  </span>
                  {stats.bySeverity.CRITICAL > 0 && (
                    <span style={{
                      marginLeft: '4px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      background: PALANTIR_COLORS.severity.critical + '25',
                      color: PALANTIR_COLORS.severity.critical,
                    }}>
                      {stats.bySeverity.CRITICAL} CRIT
                    </span>
                  )}
                </div>

                {/* Time Dropdown - Compact in compact mode */}
                <select
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                  style={{
                    padding: isCompactMode ? '2px 20px 2px 6px' : '5px 28px 5px 10px',
                    fontSize: isCompactMode ? '9px' : '11px',
                    fontWeight: 600,
                    background: PRO_THEME.bg.elevated,
                    border: `1px solid ${PRO_THEME.border.subtle}`,
                    borderRadius: '4px',
                    color: PRO_THEME.text.primary,
                    cursor: 'pointer',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 8px center',
                  }}
                >
                  {TIME_FILTERS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>

                {/* Filters Button - Hidden in compact mode (auto-filtered to HIGH/CRITICAL) */}
                {!isCompactMode && (
                  <button
                    onClick={() => setShowFiltersDropdown(!showFiltersDropdown)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 10px',
                      fontSize: '11px',
                      fontWeight: 500,
                      borderRadius: '4px',
                      border: `1px solid ${showFiltersDropdown || activeFilterCount > 0 ? PRO_THEME.border.focus : PRO_THEME.border.subtle}`,
                      cursor: 'pointer',
                      background: showFiltersDropdown || activeFilterCount > 0 ? PRO_THEME.accentMuted : 'transparent',
                      color: showFiltersDropdown || activeFilterCount > 0 ? PRO_THEME.accent : PRO_THEME.text.secondary,
                      transition: 'all 0.15s',
                    }}
                  >
                    <Filter size={12} />
                    Filters
                    {activeFilterCount > 0 && (
                      <span style={{
                        padding: '1px 5px',
                        borderRadius: '8px',
                        fontSize: '9px',
                        fontWeight: 700,
                        background: PRO_THEME.accent,
                        color: '#fff',
                      }}>
                        {activeFilterCount}
                      </span>
                    )}
                    <ChevronDown size={12} style={{ marginLeft: '2px', transform: showFiltersDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                )}
              </>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Map Controls */}
            {!isElectionMode && (
              <button
                onClick={() => setShowBoundaries(!showBoundaries)}
                title="Toggle boundaries"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '5px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${showBoundaries ? '#22c55e40' : PRO_THEME.border.subtle}`,
                  cursor: 'pointer',
                  background: showBoundaries ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                  color: showBoundaries ? '#22c55e' : PRO_THEME.text.muted,
                  transition: 'all 0.15s',
                }}
              >
                <Layers size={14} />
              </button>
            )}
            <button
              onClick={resetView}
              title="Reset view"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '5px 8px',
                borderRadius: '4px',
                border: `1px solid ${PRO_THEME.border.subtle}`,
                cursor: 'pointer',
                background: 'transparent',
                color: PRO_THEME.text.muted,
                transition: 'all 0.15s',
              }}
            >
              <Crosshair size={14} />
            </button>
          </div>

          {/* Filters Dropdown Panel - Only in normal mode */}
          {!isElectionMode && showFiltersDropdown && (
            <div style={{
              position: 'absolute',
              top: '52px',
              left: '12px',
              width: '320px',
              maxHeight: '400px',
              overflowY: 'auto',
              background: PRO_THEME.bg.elevated,
              border: `1px solid ${PRO_THEME.border.default}`,
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              zIndex: 1100,
              padding: '12px',
            }}>
              {/* Categories Section */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '9px', color: PRO_THEME.text.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  Categories
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {Object.entries(CATEGORY_CONFIG).filter(([k]) => k !== 'GENERAL').map(([key, config]) => {
                    const isActive = activeCategories.has(key);
                    const count = stats.byCategory[key] || 0;
                    return (
                      <button
                        key={key}
                        onClick={() => toggleCategory(key)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '4px 8px',
                          fontSize: '10px',
                          fontWeight: 500,
                          borderRadius: '4px',
                          border: `1px solid ${isActive ? config.color + '50' : PRO_THEME.border.subtle}`,
                          cursor: 'pointer',
                          background: isActive ? config.color + '15' : 'transparent',
                          color: isActive ? config.color : PRO_THEME.text.muted,
                          opacity: isActive ? 1 : 0.7,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ width: '6px', height: '6px', borderRadius: '2px', background: config.color }} />
                        {config.label}
                        {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Regions Section */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '9px', color: PRO_THEME.text.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  Regions
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {PROVINCES.map(province => {
                    const isActive = selectedProvinces.has(province);
                    const color = PROVINCE_COLORS[province];
                    const eventCount = stats.byProvince[province] || 0;
                    return (
                      <button
                        key={province}
                        onClick={() => toggleProvince(province)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '4px 8px',
                          fontSize: '10px',
                          fontWeight: 500,
                          borderRadius: '4px',
                          border: `1px solid ${isActive ? color + '50' : PRO_THEME.border.subtle}`,
                          cursor: 'pointer',
                          background: isActive ? color + '15' : 'transparent',
                          color: isActive ? color : PRO_THEME.text.muted,
                          opacity: isActive ? 1 : 0.5,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ width: '6px', height: '6px', borderRadius: '2px', background: color, opacity: isActive ? 1 : 0.5 }} />
                        {province}
                        {eventCount > 0 && <span style={{ opacity: 0.7 }}>({eventCount})</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected District */}
              {selectedDistrict && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: PRO_THEME.accentMuted,
                  borderRadius: '4px',
                  marginBottom: '12px',
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: PRO_THEME.accent }}>
                    District: {selectedDistrict}
                  </span>
                  <button onClick={() => setSelectedDistrict(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <X size={14} color={PRO_THEME.accent} />
                  </button>
                </div>
              )}

              {/* Clear All */}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setActiveCategories(new Set(['DISASTER', 'POLITICAL', 'ECONOMIC', 'SECURITY', 'SOCIAL', 'GOVERNMENT']));
                    setSelectedProvinces(new Set(PROVINCES));
                    setSelectedDistrict(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '11px',
                    fontWeight: 500,
                    borderRadius: '4px',
                    border: `1px solid ${PRO_THEME.border.subtle}`,
                    cursor: 'pointer',
                    background: 'transparent',
                    color: PRO_THEME.text.secondary,
                    transition: 'all 0.15s',
                  }}
                >
                  Clear All Filters
                </button>
              )}
            </div>
          )}

          {/* Map Container */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

            {/* Compact Mode - Critical Events Summary (top-right overlay) */}
            {isCompactMode && !isElectionMode && (
              <div style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                padding: '8px 12px',
                background: PRO_THEME.bg.overlay,
                borderRadius: '6px',
                border: `1px solid ${PRO_THEME.border.default}`,
                backdropFilter: 'blur(12px)',
                zIndex: 1001,
                minWidth: '140px',
                boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
              }}>
                <div style={{ fontSize: '8px', color: PRO_THEME.text.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={10} />
                  High Priority Only
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#dc2626',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}>
                      {stats.bySeverity.CRITICAL || 0}
                    </div>
                    <div style={{ fontSize: '8px', color: '#dc2626', fontWeight: 600 }}>CRITICAL</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#ea580c',
                      fontFamily: 'var(--font-mono, monospace)'
                    }}>
                      {stats.bySeverity.HIGH || 0}
                    </div>
                    <div style={{ fontSize: '8px', color: '#ea580c', fontWeight: 600 }}>HIGH</div>
                  </div>
                </div>
                {/* Recent critical event title */}
                {filteredEvents.length > 0 && (
                  <div style={{
                    marginTop: '8px',
                    paddingTop: '6px',
                    borderTop: `1px solid ${PRO_THEME.border.subtle}`,
                    fontSize: '9px',
                    color: PRO_THEME.text.secondary,
                    lineHeight: 1.4,
                  }}>
                    <div style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {filteredEvents[0]?.title}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '8px', color: PRO_THEME.text.muted }}>
                      {filteredEvents[0]?.district || 'Nepal'} • {filteredEvents[0] ? getEventTimeLabel(filteredEvents[0]) : ''}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Minimal Last Update (bottom-left) - Only in normal mode */}
            {!isElectionMode && (
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                padding: '6px 10px',
                background: PRO_THEME.bg.overlay,
                borderRadius: '4px',
                border: `1px solid ${PRO_THEME.border.subtle}`,
                backdropFilter: 'blur(12px)',
                fontSize: '10px',
                color: PRO_THEME.text.muted,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}>
                <Activity size={10} />
                {lastUpdate.toLocaleTimeString()}
              </div>
            )}

            {/* Legend - Election Mode (Party or Anti-Incumbency) */}
            {isElectionMode && (
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '6px',
                border: '1px solid #e5e7eb',
                backdropFilter: 'blur(12px)',
                zIndex: 1000,
                maxWidth: '180px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              }}>
                {mapColorMode === 'anti-incumbency' ? (
                  /* Anti-Incumbency Legend */
                  <>
                    <div style={{ fontSize: '9px', color: '#8b5cf6', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                      Anti-Incumbency
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '8px', borderRadius: '2px', background: '#22c55e' }} />
                        <span style={{ fontSize: '10px', color: '#4b5563' }}>Party Retained</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '8px', borderRadius: '2px', background: '#dc2626' }} />
                        <span style={{ fontSize: '10px', color: '#4b5563' }}>Party Lost Seat</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '8px', borderRadius: '2px', background: '#9ca3af' }} />
                        <span style={{ fontSize: '10px', color: '#4b5563' }}>No Data</span>
                      </div>
                    </div>
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb', fontSize: '9px', color: '#6b7280' }}>
                      Comparing {electionYear} vs {electionYear === 2082 ? 2079 : electionYear === 2079 ? 2074 : 'N/A'}
                    </div>
                  </>
                ) : (
                  /* Party Colors Legend */
                  <>
                    <div style={{ fontSize: '9px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                      Party Colors
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {[
                        { party: 'Nepali Congress', color: PARTY_COLORS['Nepali Congress'].color, label: 'NC' },
                        { party: 'CPN (UML)', color: PARTY_COLORS['CPN (UML)'].color, label: 'UML' },
                        { party: 'CPN (Maoist Centre)', color: PARTY_COLORS['CPN (Maoist Centre)'].color, label: 'Maoist' },
                        { party: 'Rastriya Swatantra Party', color: PARTY_COLORS['Rastriya Swatantra Party'].color, label: 'RSP' },
                        { party: 'Other', color: PARTY_COLORS['Other'].color, label: 'Other' },
                      ].map(({ party, color, label }) => (
                        <div key={party} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '12px', height: '8px', borderRadius: '2px', background: color }} />
                          <span style={{ fontSize: '10px', color: '#4b5563' }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {(localNationalSummary?.turnout || nationalSummary?.turnout_pct) && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: '9px', color: '#6b7280', marginBottom: '2px' }}>National Turnout</div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#22c55e', fontFamily: 'var(--font-mono, monospace)' }}>
                      {(localNationalSummary?.turnout ?? nationalSummary?.turnout_pct ?? 0).toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cluster Events Panel - Professional Design (only in normal mode) */}
            {!isElectionMode && showClusterPanel && clusterEvents.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '16px',
                  left: '16px',
                  width: selectedEvent ? '520px' : '280px',
                  maxHeight: 'calc(100% - 32px)',
                  background: PRO_THEME.bg.overlay,
                  borderRadius: '6px',
                  border: `1px solid ${PRO_THEME.border.default}`,
                  zIndex: 1003,
                  display: 'flex',
                  overflow: 'hidden',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
                  transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                {/* Event List Column */}
                <div style={{
                  width: '280px',
                  minWidth: '280px',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRight: selectedEvent ? `1px solid ${PRO_THEME.border.default}` : 'none',
                }}>
                  {/* Header */}
                  <div style={{
                    padding: '12px 14px',
                    borderBottom: `1px solid ${PRO_THEME.border.default}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: PRO_THEME.bg.elevated,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: PRO_THEME.text.primary,
                        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      }}>
                        {groupedClusterEvents.length}
                      </span>
                      <span style={{ fontSize: '11px', color: PRO_THEME.text.muted, fontWeight: 500 }}>
                        stories near {clusterLocation}
                      </span>
                      {clusterEvents.length > groupedClusterEvents.length && (
                        <span style={{ fontSize: '9px', color: '#10b981', fontWeight: 500 }}>
                          ({clusterEvents.length} sources)
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <button
                        onClick={() => {
                          if (mapInstance.current && clusterEvents.length > 0) {
                            const bounds = L.latLngBounds(clusterEvents.map(e => [e.coordinates[1], e.coordinates[0]]));
                            mapInstance.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 });
                          }
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '4px',
                          display: 'flex',
                          color: PRO_THEME.text.muted,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = PRO_THEME.bg.hover; e.currentTarget.style.color = PRO_THEME.text.secondary; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = PRO_THEME.text.muted; }}
                        title="Zoom to area"
                      >
                        <ZoomIn size={14} />
                      </button>
                      <button
                        onClick={() => { setShowClusterPanel(false); setSelectedEvent(null); }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '4px',
                          display: 'flex',
                          color: PRO_THEME.text.muted,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = PRO_THEME.bg.hover; e.currentTarget.style.color = PRO_THEME.text.secondary; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = PRO_THEME.text.muted; }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Event List - Grouped by cluster_id */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {groupedClusterEvents.slice(0, 25).map((group) => {
                      const config = CATEGORY_CONFIG[group.category] || CATEGORY_CONFIG.GENERAL;
                      const isExpanded = expandedClusterId === group.id;
                      const severityColor = PALANTIR_COLORS.severity[group.severity.toLowerCase() as keyof typeof PALANTIR_COLORS.severity] || '#64748b';
                      const sourceCount = group.events.length;
                      const isMultiSource = sourceCount > 1;

                      return (
                        <div key={group.id}>
                          {/* Main story entry */}
                          <div
                            onClick={() => {
                              if (isMultiSource) {
                                setExpandedClusterId(isExpanded ? null : group.id);
                              }
                              setSelectedEvent(group.events[0]);
                            }}
                            style={{
                              padding: '10px 14px',
                              borderBottom: isExpanded ? 'none' : `1px solid ${PRO_THEME.border.subtle}`,
                              background: isExpanded ? PRO_THEME.accentMuted : 'transparent',
                              cursor: 'pointer',
                              transition: 'background 0.15s',
                              position: 'relative',
                            }}
                            onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = PRO_THEME.bg.hover; }}
                            onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = isExpanded ? PRO_THEME.accentMuted : 'transparent'; }}
                          >
                            {/* Left accent bar */}
                            <div style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: '2px',
                              background: isMultiSource ? '#10b981' : config.color,
                              opacity: 0.8,
                            }} />

                            {/* Content */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  color: PRO_THEME.text.primary,
                                  lineHeight: 1.4,
                                  marginBottom: '4px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                }}>
                                  {group.title}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', flexWrap: 'wrap' }}>
                                  <span style={{ color: config.color, fontWeight: 600 }}>{config.label}</span>
                                  <span style={{ color: PRO_THEME.text.disabled }}>•</span>
                                  <span style={{ color: PRO_THEME.text.muted }}>{getEventTimeLabel(group)}</span>
                                  {(group.severity === 'CRITICAL' || group.severity === 'HIGH') && (
                                    <>
                                      <span style={{ color: PRO_THEME.text.disabled }}>•</span>
                                      <span style={{ color: severityColor, fontWeight: 600, fontSize: '9px' }}>{group.severity}</span>
                                    </>
                                  )}
                                  {isMultiSource && (
                                    <>
                                      <span style={{ color: PRO_THEME.text.disabled }}>•</span>
                                      <span style={{
                                        color: '#10b981',
                                        fontWeight: 600,
                                        fontSize: '9px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                      }}>
                                        <Users size={10} />
                                        {sourceCount} sources
                                      </span>
                                    </>
                                  )}
                                  {sourceCount >= 2 && (
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', gap: '2px',
                                      fontSize: '8px', fontWeight: 700, letterSpacing: '0.3px',
                                      padding: '1px 4px', borderRadius: '2px',
                                      background: '#23855118', color: '#238551',
                                    }}>
                                      <CheckCircle size={8} />
                                      VERIFIED
                                    </span>
                                  )}
                                  {sourceCount >= 3 && (
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', gap: '2px',
                                      fontSize: '8px', fontWeight: 700, letterSpacing: '0.3px',
                                      padding: '1px 4px', borderRadius: '2px',
                                      background: '#2D72D218', color: '#2D72D2',
                                    }}>
                                      <ShieldCheck size={8} />
                                      FACT-CHECKED
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {groupedClusterEvents.length > 25 && (
                      <div style={{ padding: '10px 14px', fontSize: '10px', color: PRO_THEME.text.muted, textAlign: 'center' }}>
                        +{groupedClusterEvents.length - 25} more stories
                      </div>
                    )}
                  </div>
                </div>

                {/* Detail Panel - Slides in from right */}
                {selectedEvent && (
                  <div style={{
                    width: '240px',
                    display: 'flex',
                    flexDirection: 'column',
                    background: PRO_THEME.bg.surface,
                  }}>
                    {/* Detail Header */}
                    <div style={{
                      padding: '14px',
                      borderBottom: `1px solid ${PRO_THEME.border.default}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          color: (CATEGORY_CONFIG[selectedEvent.category] || CATEGORY_CONFIG.GENERAL).color,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          {(CATEGORY_CONFIG[selectedEvent.category] || CATEGORY_CONFIG.GENERAL).label}
                        </span>
                        <span style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          color: PALANTIR_COLORS.severity[selectedEvent.severity.toLowerCase() as keyof typeof PALANTIR_COLORS.severity] || '#6b7280',
                        }}>{selectedEvent.severity}</span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: PRO_THEME.text.primary, lineHeight: 1.4 }}>
                        {selectedEvent.title}
                      </div>
                      {/* Verification badges */}
                      {(selectedEvent.source_count || 1) > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '3px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 700,
                            background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)',
                            color: '#10b981',
                          }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            VERIFIED
                          </span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '3px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 700,
                            background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)',
                            color: '#3b82f6',
                          }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                            {selectedEvent.source_count} SOURCES
                          </span>
                          {selectedEvent.source_name && (
                            <span style={{ fontSize: '9px', color: PRO_THEME.text.muted }}>
                              via {selectedEvent.source_name}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Detail Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
                      {/* Casualties - Compact */}
                      {(selectedEvent.deaths || selectedEvent.injured || selectedEvent.magnitude) && (
                        <div style={{
                          display: 'flex',
                          gap: '16px',
                          marginBottom: '14px',
                          padding: '10px 12px',
                          background: 'rgba(220, 38, 38, 0.06)',
                          borderRadius: '4px',
                          border: '1px solid rgba(220, 38, 38, 0.1)',
                        }}>
                          {selectedEvent.deaths && (
                            <div>
                              <div style={{ fontSize: '16px', fontWeight: 700, color: '#dc2626', fontFamily: 'var(--font-mono, monospace)' }}>{selectedEvent.deaths}</div>
                              <div style={{ fontSize: '8px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dead</div>
                            </div>
                          )}
                          {selectedEvent.injured && (
                            <div>
                              <div style={{ fontSize: '16px', fontWeight: 700, color: '#ea580c', fontFamily: 'var(--font-mono, monospace)' }}>{selectedEvent.injured}</div>
                              <div style={{ fontSize: '8px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Injured</div>
                            </div>
                          )}
                          {selectedEvent.magnitude && (
                            <div>
                              <div style={{ fontSize: '16px', fontWeight: 700, color: '#d97706', fontFamily: 'var(--font-mono, monospace)' }}>M{selectedEvent.magnitude}</div>
                              <div style={{ fontSize: '8px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mag</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Summary */}
                      {selectedEvent.summary && (
                        <p style={{ fontSize: '11px', color: PRO_THEME.text.secondary, lineHeight: 1.6, marginBottom: '14px', margin: 0 }}>
                          {selectedEvent.summary}
                        </p>
                      )}

                      {/* Metadata */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: PRO_THEME.text.muted }}>
                          <MapPin size={12} style={{ opacity: 0.7 }} />
                          <span>{selectedEvent.district || 'Nepal'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: PRO_THEME.text.muted }}>
                          <Clock size={12} style={{ opacity: 0.7 }} />
                          <span>{getEventDetailTimeLabel(selectedEvent)}</span>
                        </div>
                        {selectedEvent.story_type && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: PRO_THEME.text.muted }}>
                            <Activity size={12} style={{ opacity: 0.7 }} />
                            <span>{selectedEvent.story_type}</span>
                          </div>
                        )}
                        {selectedEvent.source_name && (selectedEvent.source_count || 1) <= 1 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: PRO_THEME.text.muted }}>
                            <Rss size={12} style={{ opacity: 0.7 }} />
                            <span>{selectedEvent.source_name}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{
                      padding: '12px 14px',
                      borderTop: `1px solid ${PRO_THEME.border.default}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => {
                            const [lng, lat] = selectedEvent.coordinates;
                            mapInstance.current?.flyTo([lat, lng], 13, { duration: 0.6 });
                          }}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            fontSize: '10px',
                            fontWeight: 600,
                            background: PRO_THEME.bg.elevated,
                            border: `1px solid ${PRO_THEME.border.default}`,
                            borderRadius: '4px',
                            color: PRO_THEME.text.primary,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = PRO_THEME.bg.hover; }}
                          onMouseLeave={e => { e.currentTarget.style.background = PRO_THEME.bg.elevated; }}
                        >
                          <Crosshair size={12} />
                          Focus
                        </button>
                        {selectedEvent.source_url && (
                          <a
                            href={selectedEvent.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              flex: 1,
                              padding: '8px 12px',
                              fontSize: '10px',
                              fontWeight: 600,
                              background: 'rgba(99, 102, 241, 0.18)',
                              border: '1px solid rgba(99, 102, 241, 0.32)',
                              borderRadius: '4px',
                              color: PRO_THEME.accent,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              textDecoration: 'none',
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.26)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.18)'; }}
                          >
                            <ExternalLink size={12} />
                            Source
                          </a>
                        )}
                      </div>
                      {/* Fact-check button — own row */}
                      <button
                        onClick={() => {
                          if (factCheckRequested.has(selectedEvent.id)) return;
                          setFactCheckConfirm(selectedEvent.id);
                        }}
                        disabled={factCheckRequested.has(selectedEvent.id)}
                        style={{
                          width: '100%',
                          padding: '6px 12px',
                          fontSize: '10px',
                          fontWeight: 600,
                          background: factCheckRequested.has(selectedEvent.id) ? 'rgba(35, 133, 81, 0.12)' : 'transparent',
                          border: `1px solid ${factCheckRequested.has(selectedEvent.id) ? 'rgba(35, 133, 81, 0.3)' : PRO_THEME.border.default}`,
                          borderRadius: '4px',
                          color: factCheckRequested.has(selectedEvent.id) ? '#238551' : PRO_THEME.text.muted,
                          cursor: factCheckRequested.has(selectedEvent.id) ? 'default' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!factCheckRequested.has(selectedEvent.id)) { e.currentTarget.style.background = PRO_THEME.bg.hover; e.currentTarget.style.color = PRO_THEME.text.secondary; } }}
                        onMouseLeave={e => { if (!factCheckRequested.has(selectedEvent.id)) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = PRO_THEME.text.muted; } }}
                      >
                        <ShieldCheck size={11} />
                        {factCheckRequested.has(selectedEvent.id) ? 'Fact-check requested' : 'Request fact-check'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Toggle - Hidden in compact mode (non-election) */}
        {!(isCompactMode && !isElectionMode) && (
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              width: '16px',
              background: PRO_THEME.bg.elevated,
              border: 'none',
              borderLeft: `1px solid ${PRO_THEME.border.default}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.2s',
              color: PRO_THEME.text.muted,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = PRO_THEME.bg.surface; e.currentTarget.style.color = PRO_THEME.text.secondary; }}
            onMouseLeave={e => { e.currentTarget.style.background = PRO_THEME.bg.elevated; e.currentTarget.style.color = PRO_THEME.text.muted; }}
          >
            {sidebarCollapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
          </button>
        )}

        {/* Sidebar - Election Mode or Live Feed - Hidden in compact mode (non-election) */}
        {!(isCompactMode && !isElectionMode) && (
          <div style={{
            width: sidebarCollapsed ? '0' : '260px',
            minWidth: sidebarCollapsed ? '0' : '260px',
            overflow: 'hidden',
            background: PRO_THEME.bg.surface,
            borderLeft: sidebarCollapsed ? 'none' : `1px solid ${PRO_THEME.border.default}`,
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
          }}>
          {isElectionMode ? (
            /* ================================================================
               ELECTION MODE SIDEBAR
               ================================================================ */
            <>
              {/* Header */}
              <div style={{
                padding: '12px 14px',
                borderBottom: `1px solid ${PRO_THEME.border.default}`,
                background: PRO_THEME.bg.elevated,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Vote size={14} style={{ color: PRO_THEME.accent }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: PRO_THEME.text.primary, letterSpacing: '0.2px' }}>
                      Election Monitor
                    </div>
                    <div style={{ fontSize: '9px', color: PRO_THEME.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {isLiveElectionYear ? 'LIVE' : 'HISTORICAL'} • {electionYear} BS
                    </div>
                  </div>
                  <span style={{
                    marginLeft: 'auto',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '9px',
                    fontWeight: 700,
                    background: 'rgba(99, 102, 241, 0.18)',
                    border: `1px solid ${PRO_THEME.border.focus}`,
                    color: PRO_THEME.accent,
                    fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))',
                  }}>
                    {electionYear} BS
                  </span>
                </div>

                {(localNationalSummary || nationalSummary) && (
                  <div style={{
                    display: 'flex',
                    gap: '4px',
                    marginTop: '8px',
                  }}>
                    {[
                      { label: 'Called', value: localNationalSummary?.declared ?? nationalSummary?.declared ?? 0, color: '#22c55e' },
                      { label: 'Count', value: localNationalSummary?.counting ?? nationalSummary?.counting ?? 0, color: '#eab308' },
                      { label: 'Pend', value: localNationalSummary?.pending ?? nationalSummary?.pending ?? 0, color: PRO_THEME.text.secondary },
                    ].map((m) => (
                      <div key={m.label} style={{
                        flex: 1,
                        padding: '4px 6px',
                        borderRadius: '4px',
                        background: 'rgba(255,255,255,0.04)',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: m.color, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                          {m.value}
                        </div>
                        <div style={{ fontSize: '7px', color: PRO_THEME.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {m.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* Party Standings */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${PRO_THEME.border.default}` }}>
                  <div style={{
                    fontSize: '9px',
                    color: PRO_THEME.text.muted,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    marginBottom: '10px',
                  }}>
                    Party Standings
                  </div>
                  {(() => {
                    const partySeats = loadedElectionData?.national_summary?.party_seats
                      || nationalSummary?.party_seats
                      || [];
                    const maxSeats = partySeats[0]?.seats || 1;

                    return partySeats.slice(0, 3).map((ps) => {
                      const partyColor = getPartyColor(ps.party);
                      const widthPct = (ps.seats / maxSeats) * 100;
                      return (
                        <div key={ps.party} style={{ marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: partyColor, flexShrink: 0 }} />
                              <span style={{ fontSize: '11px', fontWeight: 700, color: PRO_THEME.text.primary }}>
                                {getPartyShortLabel(ps.party)}
                              </span>
                            </div>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: partyColor, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))', flexShrink: 0 }}>
                              {ps.seats}
                            </span>
                          </div>
                          <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${widthPct}%`, background: partyColor, borderRadius: '2px', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* District Spotlight */}
                <div style={{ padding: '12px 14px' }}>
                <div style={{
                  fontSize: '9px',
                  color: PRO_THEME.text.muted,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span>District Spotlight</span>
                  <span style={{ fontSize: '10px', color: PRO_THEME.text.disabled }}>
                    {selectedDistrict ? 'Selected' : 'None'}
                  </span>
                </div>

                {selectedDistrict ? (
                  (() => {
                    const data = districtElectionMap.get(normalizeDistrictName(selectedDistrict));
                    const total = data?.constituencies ?? 0;
                    const declared = data?.declared ?? 0;
                    const counting = data?.counting ?? 0;
                    const pending = data?.pending ?? 0;
                    const isComplete = total > 0 && declared >= total;

                    const sortedParties = data
                      ? (Object.entries(data.parties) as [string, number][])
                          .sort(([, a], [, b]) => b - a)
                      : [];
                    const topParty = sortedParties[0]?.[0] || null;
                    const topSeats = sortedParties[0]?.[1] || 0;

                    const headlineLabel = (!isComplete && isLiveElectionYear) ? 'Leading' : 'Winner';
                    const headlineValue = topParty ? `${getPartyShortLabel(topParty)} (${topSeats})` : 'TBD';
                    const headlineColor = topParty ? getPartyColor(topParty) : PRO_THEME.text.muted;

                    return (
                      <div style={{
                        borderRadius: '8px',
                        border: `1px solid ${PRO_THEME.border.default}`,
                        background: PRO_THEME.bg.elevated,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          padding: '10px 10px',
                          borderBottom: `1px solid ${PRO_THEME.border.subtle}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '12px', fontWeight: 800, color: PRO_THEME.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {selectedDistrict}
                            </div>
                            <div style={{ fontSize: '9px', color: PRO_THEME.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>
                              {isComplete ? 'Complete' : (isLiveElectionYear ? 'Live' : 'Partial')} • {declared}/{total || '—'} declared
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedDistrict(null)}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${PRO_THEME.border.subtle}`,
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '6px',
                              color: PRO_THEME.text.muted,
                              display: 'flex',
                              flexShrink: 0,
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <div style={{ padding: '10px 10px' }}>
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '9px', color: PRO_THEME.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Progress
                              </div>
                              <div style={{ fontSize: '16px', fontWeight: 900, color: PRO_THEME.text.primary, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                                {declared}/{total || '—'}
                              </div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '9px', color: PRO_THEME.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {headlineLabel}
                              </div>
                              <div style={{ fontSize: '14px', fontWeight: 900, color: headlineColor, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                                {headlineValue}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                            {[
                              { label: 'Declared', value: declared, color: '#22c55e' },
                              { label: 'Counting', value: counting, color: '#eab308' },
                              { label: 'Pending', value: pending, color: PRO_THEME.text.secondary },
                            ].map((m) => (
                              <div key={m.label} style={{
                                flex: 1,
                                padding: '6px 8px',
                                borderRadius: '6px',
                                border: `1px solid ${PRO_THEME.border.subtle}`,
                                background: PRO_THEME.bg.surface,
                              }}>
                                <div style={{ fontSize: '12px', fontWeight: 800, color: m.color, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                                  {m.value}
                                </div>
                                <div style={{ fontSize: '8px', color: PRO_THEME.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  {m.label}
                                </div>
                              </div>
                            ))}
                          </div>

                          {sortedParties.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {sortedParties.slice(0, 6).map(([party, seats]) => (
                                <span
                                  key={party}
                                  style={{
                                    padding: '3px 8px',
                                    borderRadius: '999px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    background: getPartyColor(party) + '22',
                                    border: `1px solid ${getPartyColor(party) + '44'}`,
                                    color: getPartyColor(party),
                                    fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))',
                                  }}
                                >
                                  {getPartyShortLabel(party)} {seats}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div style={{
                    padding: '12px 10px',
                    borderRadius: '8px',
                    border: `1px dashed ${PRO_THEME.border.emphasis}`,
                    background: PRO_THEME.bg.elevated,
                    color: PRO_THEME.text.muted,
                    fontSize: '11px',
                    lineHeight: 1.4,
                    textAlign: 'center',
                  }}>
                    Click a district on the map to view declared progress and leading/winning party.
                  </div>
                )}
                </div>
              </div>
            </>
          ) : (
            /* ================================================================
               NORMAL MODE - Live Feed
               ================================================================ */
            <>
              {/* Header */}
              <div style={{
                padding: '12px 14px',
                borderBottom: `1px solid ${PRO_THEME.border.default}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: PRO_THEME.bg.elevated,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#22c55e',
                  }} />
                  <span style={{ fontSize: '10px', fontWeight: 600, color: PRO_THEME.text.secondary, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Live Feed
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: PRO_THEME.text.muted, fontFamily: 'var(--font-mono, monospace)' }}>
                  {recentEvents.length}
                </span>
              </div>

              {/* Event List */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {recentEvents.map(event => {
              const config = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.GENERAL;
              const isSelected = selectedEvent?.id === event.id;
              const severityColor = PALANTIR_COLORS.severity[event.severity.toLowerCase() as keyof typeof PALANTIR_COLORS.severity] || '#6b7280';

              return (
                <div
                  key={event.id}
                  onClick={() => {
                    // Single-focus behavior: close any open marker tooltip / cluster panel when using the feed
                    const openMarker = openEventTooltipMarkerRef.current;
                    if (openMarker && openMarker.isTooltipOpen()) openMarker.closeTooltip();
                    openEventTooltipMarkerRef.current = null;
                    setShowClusterPanel(false);
                    setExpandedClusterId(null);

                    setSelectedEvent(event);
                    const [lng, lat] = event.coordinates;
                    mapInstance.current?.flyTo([lat, lng], 11, { duration: 0.5 });
                  }}
                  style={{
                    padding: '10px 14px',
                    borderBottom: `1px solid ${PRO_THEME.border.subtle}`,
                    background: isSelected ? PRO_THEME.accentMuted : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = PRO_THEME.bg.elevated; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Accent bar */}
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: '2px',
                    background: config.color,
                    opacity: isSelected ? 1 : 0.5,
                  }} />

                  {/* Meta row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 600, color: config.color }}>
                      {config.label}
                    </span>
                    {(event.severity === 'CRITICAL' || event.severity === 'HIGH') && (
                      <span style={{ fontSize: '8px', fontWeight: 700, color: severityColor }}>{event.severity}</span>
                    )}
                    {(() => {
                      const cSize = event.cluster_id ? (clusterSizeLookup.get(event.cluster_id) || 1) : 1;
                      return <>
                        {cSize >= 2 && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '2px',
                            fontSize: '7px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px',
                            background: '#23855118', color: '#238551',
                          }}>
                            <CheckCircle size={7} /> VERIFIED
                          </span>
                        )}
                        {cSize >= 3 && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '2px',
                            fontSize: '7px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px',
                            background: '#2D72D218', color: '#2D72D2',
                          }}>
                            <ShieldCheck size={7} /> FACT-CHECKED
                          </span>
                        )}
                      </>;
                    })()}
                    <span style={{ marginLeft: 'auto', fontSize: '9px', color: PRO_THEME.text.muted }}>
                      {getEventTimeLabel(event)}
                    </span>
                  </div>

                  {/* Title */}
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: PRO_THEME.text.primary,
                    lineHeight: 1.4,
                    marginBottom: '4px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {event.title}
                  </div>

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', color: PRO_THEME.text.muted }}>
                    <span>{event.district || 'Nepal'}</span>
                    {event.source_url && (
                      <>
                        <span>•</span>
                        <a
                          href={event.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: PRO_THEME.accent, textDecoration: 'none', display: 'flex' }}
                        >
                          <ExternalLink size={9} />
                        </a>
                      </>
                    )}
                    {(event.deaths || event.injured) && (
                      <>
                        <span>•</span>
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>
                          {event.deaths ? `${event.deaths}D` : ''}{event.deaths && event.injured ? ' ' : ''}{event.injured ? `${event.injured}I` : ''}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Load More */}
              {hasMoreEvents && (
                <button
                  onClick={() => setFeedLimit(prev => prev + 50)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: PRO_THEME.accent,
                    fontSize: '10px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = PRO_THEME.bg.elevated; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Load {filteredEvents.length - feedLimit} more
                </button>
              )}
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* Fact-check confirmation popup */}
      {factCheckConfirm && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        }} onClick={() => setFactCheckConfirm(null)}>
          <div
            style={{
              background: PRO_THEME.bg.elevated,
              border: `1px solid ${PRO_THEME.border.default}`,
              borderRadius: '8px', padding: '20px 24px',
              maxWidth: '320px', width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <ShieldCheck size={18} style={{ color: PRO_THEME.accent }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: PRO_THEME.text.primary }}>
                Request Fact Check
              </span>
            </div>
            <p style={{ fontSize: '12px', color: PRO_THEME.text.secondary, lineHeight: 1.5, marginBottom: '16px' }}>
              Do you want to put this story up for fact-check? Our AI analyst will verify the key claims.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setFactCheckConfirm(null)}
                style={{
                  padding: '6px 16px', fontSize: '11px', fontWeight: 600,
                  background: PRO_THEME.bg.surface, border: `1px solid ${PRO_THEME.border.default}`,
                  borderRadius: '4px', color: PRO_THEME.text.secondary, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const storyId = factCheckConfirm;
                  factCheckMutation.mutate(storyId, {
                    onSuccess: () => setFactCheckRequested(prev => new Set(prev).add(storyId)),
                  });
                  setFactCheckConfirm(null);
                }}
                style={{
                  padding: '6px 16px', fontSize: '11px', fontWeight: 600,
                  background: 'rgba(45, 114, 210, 0.2)', border: '1px solid rgba(45, 114, 210, 0.4)',
                  borderRadius: '4px', color: '#5C9CF5', cursor: 'pointer',
                }}
              >
                Yes, Fact Check
              </button>
            </div>
          </div>
        </div>
      )}
    </Widget>
  );
}

function MapWidgetElectionCompat() {
  return (
    <Widget id="map" title="Election Map" icon={<Vote size={14} />}>
      <ElectionMapContent sizeKey="map" />
    </Widget>
  );
}

export const MapWidget = memo(function MapWidget() {
  const { activePreset, widgetOrder, widgetVisibility } = useDashboardStore();
  const hasElectionMap = widgetOrder.includes('election-map') && !!widgetVisibility['election-map'];

  // Backward-compat for older persisted layouts that used "map" in the elections preset.
  if (activePreset === 'elections' && !hasElectionMap) {
    return <MapWidgetElectionCompat />;
  }

  return <SituationMapWidget />;
});
