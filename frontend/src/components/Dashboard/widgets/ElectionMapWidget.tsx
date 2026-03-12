import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Vote, Map as MapIcon, List, Layers, TrendingUp, ArrowLeftRight, Search } from 'lucide-react';
import { Widget } from '../Widget';
import { loadElectionData, type ElectionData, type RawConstituencyResult, type RawCandidate } from '../../elections/electionDataLoader';
import { useElectionStore, type ElectionMode } from '../../../stores/electionStore';
import { PROVINCES, normalizeDistrictName, type Province } from '../../../data/districts';
import { getPartyColor, getPartyShortLabel } from '../../../utils/partyColors';

type ViewLevel = 'province' | 'district' | 'constituency';
type ShadeMode = 'party' | 'margin' | 'incumbency';

type RegionAgg = {
  total: number;
  declared: number;
  counting: number;
  pending: number;
  partySeats: Record<string, number>;
  dominantParty: string | null;
  dominantSeats: number;
  avgMarginPct: number | null;
  retained: number;
  lost: number;
};

type ConstituencyDerived = {
  constituencyId: string;
  name: string;
  district: string;
  province: Province;
  status: 'declared' | 'counting' | 'pending';
  winnerParty: string | null;
  winnerName: string | null;
  leaderParty: string | null;
  leaderName: string | null;
  marginVotes: number | null;
  marginPct: number | null;
  totalVotes: number;
  lastUpdated: string | null;
  candidates: RawCandidate[];
};

type ProvinceGeoJSON = GeoJSON.FeatureCollection<GeoJSON.Geometry, { ADM1_EN?: string | number }>;
type DistrictGeoJSON = GeoJSON.FeatureCollection<GeoJSON.Geometry, { name?: string; province?: string; centroid?: { lat: number; lng: number } }>;

const THEME = {
  bg: {
    base: 'var(--pro-bg-base, #08090a)',
    surface: 'var(--pro-bg-surface, #0c0d0f)',
    elevated: 'var(--pro-bg-elevated, #111214)',
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
} as const;

function provinceIdToName(adm1: string | number | undefined): Province | null {
  const n = typeof adm1 === 'string' ? Number(adm1) : typeof adm1 === 'number' ? adm1 : NaN;
  switch (n) {
    case 1: return 'Koshi';
    case 2: return 'Madhesh';
    case 3: return 'Bagmati';
    case 4: return 'Gandaki';
    case 5: return 'Lumbini';
    case 6: return 'Karnali';
    case 7: return 'Sudurpashchim';
    default: return null;
  }
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function getStatusChip(declared: number, counting: number, pending: number) {
  if (declared > 0 && counting === 0 && pending === 0) return { label: 'CALLED', color: '#22c55e' };
  if (declared > 0 && (counting > 0 || pending > 0)) return { label: 'PARTIAL', color: '#eab308' };
  if (counting > 0) return { label: 'COUNTING', color: '#f97316' };
  return { label: 'PENDING', color: '#94a3b8' };
}

function marginOpacity(marginPct: number | null): number {
  if (marginPct === null || marginPct === undefined) return 0.22;
  if (marginPct < 2) return 0.18;
  if (marginPct < 5) return 0.24;
  if (marginPct < 10) return 0.32;
  return 0.42;
}

function deterministicJitter(seed: string): { dLat: number; dLng: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r1 = ((h >>> 0) % 1000) / 1000;
  const r2 = (((h >>> 0) * 2654435761) % 1000) / 1000;
  const max = 0.06; // degrees, small enough to stay visually inside district
  return { dLat: (r1 - 0.5) * max, dLng: (r2 - 0.5) * max };
}

function useElectionData(year: number) {
  const [data, setData] = useState<ElectionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!year || year <= 0) {
        setData(null);
        setIsLoading(false);
        setError(null);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const loaded = await loadElectionData(year);
        if (!cancelled) setData(loaded);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load election data');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    run();

    // Auto-refresh for 2082 live data every 60 seconds
    let interval: ReturnType<typeof setInterval> | null = null;
    if (year === 2082) {
      interval = setInterval(async () => {
        try {
          const loaded = await loadElectionData(year);
          if (!cancelled && loaded) setData(loaded);
        } catch { /* ignore refresh errors */ }
      }, 60_000);
    }

    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [year]);

  return { data, isLoading, error };
}

function computeConstituencyDerived(r: RawConstituencyResult): Omit<ConstituencyDerived, 'province'> {
  const candidates = [...(r.candidates || [])].sort((a: RawCandidate, b: RawCandidate) => (b.votes || 0) - (a.votes || 0));
  const winner = candidates.find(c => c.is_winner) || null;
  const leader = candidates[0] || null;
  const marginVotes = candidates.length >= 2 ? (candidates[0].votes - candidates[1].votes) : null;
  const totalVotes = typeof r.total_votes === 'number' ? r.total_votes : candidates.reduce((s, c) => s + (c.votes || 0), 0);
  const marginPct = marginVotes !== null && totalVotes > 0 ? (marginVotes / totalVotes) * 100 : null;

  return {
    constituencyId: r.constituency_id,
    name: r.name_en,
    district: r.district,
    status: r.status,
    winnerParty: r.winner_party || (winner ? winner.party : null),
    winnerName: r.winner_name || (winner ? winner.name_en : null),
    leaderParty: leader ? leader.party : null,
    leaderName: leader ? leader.name_en : null,
    marginVotes,
    marginPct,
    totalVotes,
    lastUpdated: r.last_updated || null,
    candidates: r.candidates || [],
  };
}

function buildAggregates(data: ElectionData | null, prev: ElectionData | null) {
  const constituencyIndex = new Map<string, ConstituencyDerived>();
  const provinceAgg = new Map<Province, RegionAgg>();
  const districtAgg = new Map<string, RegionAgg>(); // key: normalized district name
  const districtNameByKey = new Map<string, string>(); // normalized -> display
  const districtToProvince = new Map<string, Province>();

  for (const p of PROVINCES) {
    provinceAgg.set(p, {
      total: 0, declared: 0, counting: 0, pending: 0,
      partySeats: {}, dominantParty: null, dominantSeats: 0,
      avgMarginPct: null,
      retained: 0, lost: 0,
    });
  }

  if (!data) {
    return {
      constituencyIndex,
      provinceAgg,
      districtAgg,
      districtNameByKey,
      districtToProvince,
      partySeatTotals: [] as Array<[string, number]>,
      isNominationsOnly: false,
    };
  }

  const isNominationsOnly = (data.national_summary?.declared || 0) === 0 && (data.national_summary?.counting || 0) === 0;

  // Precompute previous winners by constituency id for incumbency analysis
  const prevWinnerById = new Map<string, string>();
  if (prev && !isNominationsOnly) {
    for (const pr of prev.constituencies) {
      const winner = pr.candidates?.find(c => c.is_winner);
      if (winner?.party) prevWinnerById.set(pr.constituency_id, winner.party);
    }
  }

  // Walk constituencies
  for (const r of data.constituencies) {
    const prov = (r.province as Province) || null;
    if (!prov || !provinceAgg.has(prov)) continue;

    const derived = computeConstituencyDerived(r);
    const full: ConstituencyDerived = { ...derived, province: prov };
    constituencyIndex.set(full.constituencyId, full);

    const districtKey = normalizeDistrictName(r.district);
    if (!districtNameByKey.has(districtKey)) districtNameByKey.set(districtKey, r.district);
    districtToProvince.set(districtKey, prov);

    const pAgg = provinceAgg.get(prov)!;
    pAgg.total += 1;
    if (r.status === 'declared') pAgg.declared += 1;
    else if (r.status === 'counting') pAgg.counting += 1;
    else pAgg.pending += 1;

    if (!districtAgg.has(districtKey)) {
      districtAgg.set(districtKey, {
        total: 0, declared: 0, counting: 0, pending: 0,
        partySeats: {}, dominantParty: null, dominantSeats: 0,
        avgMarginPct: null,
        retained: 0, lost: 0,
      });
    }
    const dAgg = districtAgg.get(districtKey)!;
    dAgg.total += 1;
    if (r.status === 'declared') dAgg.declared += 1;
    else if (r.status === 'counting') dAgg.counting += 1;
    else dAgg.pending += 1;

    // Seat aggregation for declared + counting constituencies (leader counts during counting)
    const seatParty = r.status === 'declared' ? full.winnerParty : (r.status === 'counting' ? full.leaderParty : null);
    if (seatParty) {
      pAgg.partySeats[seatParty] = (pAgg.partySeats[seatParty] || 0) + 1;
      dAgg.partySeats[seatParty] = (dAgg.partySeats[seatParty] || 0) + 1;
    }

    // Margin aggregation (declared only)
    if (r.status === 'declared' && full.marginPct !== null) {
      (pAgg as any).__margins = ((pAgg as any).__margins || []);
      (dAgg as any).__margins = ((dAgg as any).__margins || []);
      (pAgg as any).__margins.push(full.marginPct);
      (dAgg as any).__margins.push(full.marginPct);
    }

    // Incumbency aggregation (declared only)
    if (r.status === 'declared' && full.winnerParty && prevWinnerById.size > 0) {
      const prevParty = prevWinnerById.get(r.constituency_id);
      if (prevParty) {
        if (prevParty === full.winnerParty) {
          pAgg.retained += 1; dAgg.retained += 1;
        } else {
          pAgg.lost += 1; dAgg.lost += 1;
        }
      }
    }
  }

  // Compute dominant party + avg margins
  for (const [prov, agg] of provinceAgg.entries()) {
    const entries = Object.entries(agg.partySeats).sort(([, a], [, b]) => b - a);
    if (entries.length > 0) {
      agg.dominantParty = entries[0][0];
      agg.dominantSeats = entries[0][1];
    }
    const margins: number[] = (agg as any).__margins || [];
    if (margins.length > 0) agg.avgMarginPct = margins.reduce((s, x) => s + x, 0) / margins.length;
    delete (agg as any).__margins;
    provinceAgg.set(prov, agg);
  }
  for (const [dist, agg] of districtAgg.entries()) {
    const entries = Object.entries(agg.partySeats).sort(([, a], [, b]) => b - a);
    if (entries.length > 0) {
      agg.dominantParty = entries[0][0];
      agg.dominantSeats = entries[0][1];
    }
    const margins: number[] = (agg as any).__margins || [];
    if (margins.length > 0) agg.avgMarginPct = margins.reduce((s, x) => s + x, 0) / margins.length;
    delete (agg as any).__margins;
    districtAgg.set(dist, agg);
  }

  // Party seat totals (prefer national_summary.party_seats; fallback to compute)
  let partySeatTotals: Array<[string, number]> = [];
  if (data.national_summary?.party_seats && data.national_summary.party_seats.length > 0) {
    partySeatTotals = data.national_summary.party_seats.map(p => [p.party, p.seats] as [string, number]).sort(([, a], [, b]) => b - a);
  } else {
    const totals: Record<string, number> = {};
    for (const r of data.constituencies) {
      if (r.status === 'pending') continue;
      // Declared: use winner; Counting: use leading candidate
      const p = r.status === 'declared'
        ? (r.winner_party || r.candidates?.find(c => c.is_winner)?.party)
        : (r.candidates?.length ? [...r.candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0]?.party : null);
      if (!p) continue;
      totals[p] = (totals[p] || 0) + 1;
    }
    partySeatTotals = Object.entries(totals).sort(([, a], [, b]) => b - a);
  }

  return { constituencyIndex, provinceAgg, districtAgg, districtNameByKey, districtToProvince, partySeatTotals, isNominationsOnly };
}

function getPrevYear(currentYear: number): number | null {
  if (currentYear === 2082) return 2079;
  if (currentYear === 2079) return 2074;
  return null;
}

function injectElectionMapStyles() {
  if (document.getElementById('election-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'election-map-styles';
  style.textContent = `
    .leaflet-container { background: #e5e7eb !important; overflow: visible !important; }
    .leaflet-pane { overflow: visible !important; }
    .leaflet-tooltip-pane { overflow: visible !important; z-index: 9999 !important; }
    .leaflet-map-pane { overflow: visible !important; }
    [data-widget-id="election-map"] { overflow: visible !important; }
    [data-widget-id="election-map"] .widget-body { overflow: visible !important; }
    .election-tooltip {
      background: ${THEME.bg.elevated} !important;
      border: 1px solid ${THEME.border.default} !important;
      border-radius: 8px !important;
      color: ${THEME.text.primary} !important;
      padding: 10px 12px !important;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45) !important;
    }
    .election-tooltip:before { display: none !important; }
    .election-tooltip-expanded {
      background: ${THEME.bg.elevated} !important;
      border: 1px solid ${THEME.border.emphasis} !important;
      border-radius: 8px !important;
      color: ${THEME.text.primary} !important;
      padding: 10px 12px !important;
      box-shadow: 0 10px 30px rgba(0,0,0,0.55) !important;
      max-width: 320px !important;
      max-height: 260px !important;
      overflow-y: auto !important;
      z-index: 9999 !important;
    }
    .election-tooltip-expanded:before { display: none !important; }
    .leaflet-control-zoom { border: none !important; box-shadow: 0 10px 30px rgba(0,0,0,0.35) !important; }
    .leaflet-control-zoom a {
      background: ${THEME.bg.elevated} !important;
      border: 1px solid ${THEME.border.default} !important;
      color: ${THEME.text.secondary} !important;
      width: 32px !important;
      height: 32px !important;
      line-height: 32px !important;
      font-size: 16px !important;
    }
    .leaflet-control-zoom a:hover { background: ${THEME.bg.surface} !important; color: ${THEME.text.primary} !important; }
  `;
  document.head.appendChild(style);
}

export function ElectionMapContent({ sizeKey = 'election-map' }: { sizeKey?: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const provinceLayerRef = useRef<L.GeoJSON | null>(null);
  const districtLayerRef = useRef<L.GeoJSON | null>(null);
  const provinceOutlineLayerRef = useRef<L.GeoJSON | null>(null);
  const districtOutlineLayerRef = useRef<L.GeoJSON | null>(null);
  const pinLayerRef = useRef<L.LayerGroup | null>(null);
  const boundsByProvinceRef = useRef<Map<Province, L.LatLngBounds>>(new Map());
  const boundsByDistrictRef = useRef<Map<string, L.LatLngBounds>>(new Map()); // key: normalized district

  // Hover intent: force single tooltip (prevents “tooltip explosion” on rapid hover)
  const openHoverLayerRef = useRef<L.Layer | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverExpandedLayerRef = useRef<L.Layer | null>(null);

  const {
    mode,
    setMode,
    electionYear,
    setElectionYear,
    availableYears,
    mapViewLevel,
    setMapViewLevel,
    selectedProvince,
    selectProvince,
    selectedDistrict,
    selectDistrict,
    selectedConstituencyId,
    selectConstituency,
    pinnedConstituencyId,
  } = useElectionStore();

  const mapViewLevelRef = useRef<ViewLevel>(mapViewLevel);
  useEffect(() => {
    mapViewLevelRef.current = mapViewLevel as ViewLevel;
  }, [mapViewLevel]);

  const { data, isLoading, error } = useElectionData(electionYear);
  const prevYear = useMemo(() => getPrevYear(electionYear), [electionYear]);
  const { data: prevData } = useElectionData(prevYear || 0);

  const aggregates = useMemo(() => buildAggregates(data, prevYear ? prevData : null), [data, prevData, prevYear]);
  const national = data?.national_summary || null;
  const isNominationsOnly = aggregates.isNominationsOnly;

  const [shadeMode, setShadeMode] = useState<ShadeMode>('party');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);

  // If another widget selects a constituency, ensure the map is in constituency view.
  useEffect(() => {
    if (selectedConstituencyId && mapViewLevel !== 'constituency') {
      setMapViewLevel('constituency');
    }
  }, [selectedConstituencyId, mapViewLevel, setMapViewLevel]);

  const closeOpenHoverTooltip = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    const openLayer = openHoverLayerRef.current;
    if (openLayer && (openLayer as any).closeTooltip) {
      try { (openLayer as any).closeTooltip(); } catch { /* ignore */ }
    }
    openHoverLayerRef.current = null;
    hoverExpandedLayerRef.current = null;
  }, []);

  // Load geojson
  const [provinceGeo, setProvinceGeo] = useState<ProvinceGeoJSON | null>(null);
  const [districtGeo, setDistrictGeo] = useState<DistrictGeoJSON | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [pRes, dRes] = await Promise.all([
          fetch('/geo/nepal-provinces.geojson', { cache: 'no-cache' }),
          fetch('/geo/nepal-districts.geojson', { cache: 'no-cache' }),
        ]);
        const [pJson, dJson] = await Promise.all([pRes.json(), dRes.json()]);
        if (cancelled) return;
        setProvinceGeo(pJson as ProvinceGeoJSON);
        setDistrictGeo(dJson as DistrictGeoJSON);
      } catch (e) {
        console.error('[ElectionMapWidget] Failed to load geojson:', e);
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  // Init map
  useEffect(() => {
    injectElectionMapStyles();
    if (!mapRef.current || mapInstance.current) return;

    const nepalBounds = L.latLngBounds(L.latLng(26.347, 80.058), L.latLng(30.447, 88.201));
    mapInstance.current = L.map(mapRef.current, {
      center: [28.3949, 84.1240],
      zoom: 7,
      minZoom: 7,
      maxZoom: 18,
      maxBounds: nepalBounds,
      maxBoundsViscosity: 1.0,
      preferCanvas: true,
      renderer: L.canvas({ padding: 0.5 }),
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
    }).addTo(mapInstance.current);

    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);

    pinLayerRef.current = L.layerGroup().addTo(mapInstance.current);

    return () => {
      closeOpenHoverTooltip();
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, [closeOpenHoverTooltip]);

  // Close tooltip only on map background click (not on district click or pan/zoom)
  const districtClickedRef = useRef(false);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const handler = () => {
      // Skip if a district click just set this flag
      if (districtClickedRef.current) {
        districtClickedRef.current = false;
        return;
      }
      closeOpenHoverTooltip();
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [closeOpenHoverTooltip]);

  const getRegionStyle = useCallback((agg: RegionAgg | null, isSelected: boolean): L.PathOptions => {
    const declared = agg?.declared || 0;
    const counting = agg?.counting || 0;
    const pending = agg?.pending || 0;
    const total = agg?.total || 0;
    const chip = getStatusChip(declared, counting, pending);

    const pendingFill = '#64748b';
    const partyColor = agg?.dominantParty ? getPartyColor(agg.dominantParty) : pendingFill;
    const neutral = '#475569';

    let fillColor = partyColor;
    let fillOpacity = 0.22;
    let color = partyColor;
    let weight = 2;
    let dashArray: string | undefined = undefined;

    if (!agg || total === 0) {
      fillColor = neutral;
      color = neutral;
      fillOpacity = 0.08;
      weight = 1;
      dashArray = '2,4';
    } else if (declared === 0 && counting === 0) {
      fillColor = neutral;
      color = neutral;
      fillOpacity = 0.08;
      weight = 1;
      dashArray = '2,4';
    } else if (declared > 0 && declared === total) {
      fillOpacity = shadeMode === 'margin' ? marginOpacity(agg.avgMarginPct) : 0.34;
      weight = 2.5;
    } else {
      // partial/counting
      fillOpacity = shadeMode === 'margin' ? Math.min(0.26, marginOpacity(agg.avgMarginPct)) : 0.16;
      weight = 3;
      dashArray = '4,4';
    }

    if (shadeMode === 'incumbency') {
      if (agg && (agg.retained > 0 || agg.lost > 0)) {
        if (agg.retained > agg.lost) fillColor = '#22c55e';
        else if (agg.lost > agg.retained) fillColor = '#ef4444';
        else fillColor = '#eab308';
        color = fillColor;
        fillOpacity = declared > 0 ? 0.28 : 0.12;
      } else {
        fillColor = neutral;
        color = neutral;
        fillOpacity = 0.08;
      }
    }

    if (isSelected) {
      return { fillColor, fillOpacity: Math.min(0.55, fillOpacity + 0.12), color: '#ffffff', weight: 4, opacity: 1, dashArray };
    }

    return { fillColor, fillOpacity, color, weight, opacity: 0.9, dashArray };
  }, [shadeMode]);

  // Create base vector layers once (avoids re-creating GeoJSON on every state change)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !provinceGeo || !districtGeo) return;

    // Reset existing layers if geojson reloads (rare, but keeps behavior correct)
    provinceLayerRef.current?.remove(); provinceLayerRef.current = null;
    districtLayerRef.current?.remove(); districtLayerRef.current = null;
    provinceOutlineLayerRef.current?.remove(); provinceOutlineLayerRef.current = null;
    districtOutlineLayerRef.current?.remove(); districtOutlineLayerRef.current = null;
    closeOpenHoverTooltip();
    boundsByProvinceRef.current = new Map();
    boundsByDistrictRef.current = new Map();

    const tooltipOpts = { className: 'election-tooltip', sticky: false, direction: 'top' as const, offset: L.point(0, -8) };

    const clickToggleTooltip = (layer: any, e: any) => {
      // Prevent map click handler from immediately closing tooltips.
      try {
        if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      } catch { /* ignore */ }

      // Toggle current layer tooltip; ensure only one tooltip is open at a time.
      const openLayer = openHoverLayerRef.current as any;
      if (openLayer && openLayer === layer) {
        try { openLayer.closeTooltip?.(); } catch { /* ignore */ }
        openHoverLayerRef.current = null;
        return;
      }
      if (openLayer && openLayer !== layer) {
        try { openLayer.closeTooltip?.(); } catch { /* ignore */ }
      }
      openHoverLayerRef.current = layer;
      try { layer.openTooltip?.(); } catch { /* ignore */ }
    };

    const provinceFill = L.geoJSON(provinceGeo as any, {
      style: () => ({ fillColor: '#475569', fillOpacity: 0.08, color: '#475569', weight: 1, opacity: 0.9, dashArray: '2,4' }),
      onEachFeature: (feature, l) => {
        const prov = provinceIdToName((feature as any)?.properties?.ADM1_EN);
        if (!prov) return;

        l.bindTooltip(`<div style="font-weight:800;font-size:12px;">${prov}</div>`, tooltipOpts);
        l.off('mouseover'); l.off('mouseout'); l.off('mousemove');
        // Click handler set in update effect below

        boundsByProvinceRef.current.set(prov, (l as any).getBounds());
      },
    });
    provinceLayerRef.current = provinceFill;

    const districtFill = L.geoJSON(districtGeo as any, {
      style: () => ({ fillColor: '#475569', fillOpacity: 0.08, color: '#475569', weight: 1, opacity: 0.9, dashArray: '2,4' }),
      onEachFeature: (feature, l) => {
        const name = (feature as any)?.properties?.name || '';
        const key = normalizeDistrictName(name);
        const prov = (feature as any)?.properties?.province || '';

        l.bindTooltip(`<div style="font-weight:800;font-size:12px;">${name}</div>`, tooltipOpts);
        l.off('mouseover'); l.off('mouseout'); l.off('mousemove');
        // Click handler is set in the update effect below (with access to constituency data)

        boundsByDistrictRef.current.set(key, (l as any).getBounds());
      },
    });
    districtLayerRef.current = districtFill;

    const districtOutline = L.geoJSON(districtGeo as any, {
      style: () => ({ fillOpacity: 0, opacity: 0.35, color: '#0f172a', weight: 1.2 }),
      interactive: false as any,
    } as any);
    districtOutlineLayerRef.current = districtOutline;

    const provinceOutline = L.geoJSON(provinceGeo as any, {
      style: () => ({ fillOpacity: 0, opacity: 0.25, color: '#0f172a', weight: 1.2, dashArray: '6,6' }),
      interactive: false as any,
    } as any);
    provinceOutlineLayerRef.current = provinceOutline;
  }, [
    provinceGeo,
    districtGeo,
    closeOpenHoverTooltip,
    setMapViewLevel,
    selectProvince,
    selectDistrict,
    selectConstituency,
  ]);

  // Toggle which layers are visible based on view level
  useEffect(() => {
    const map = mapInstance.current;
    const provinceFill = provinceLayerRef.current;
    const districtFill = districtLayerRef.current;
    const provinceOutline = provinceOutlineLayerRef.current;
    const districtOutline = districtOutlineLayerRef.current;
    if (!map || !provinceFill || !districtFill || !provinceOutline || !districtOutline) return;

    const removeIfPresent = (layer: L.Layer) => { if (map.hasLayer(layer)) map.removeLayer(layer); };
    removeIfPresent(provinceFill);
    removeIfPresent(districtFill);
    removeIfPresent(provinceOutline);
    removeIfPresent(districtOutline);

    if (mapViewLevel === 'province') {
      provinceFill.addTo(map);
      districtOutline.addTo(map);
    } else {
      districtFill.addTo(map);
      provinceOutline.addTo(map);
    }
  }, [mapViewLevel, provinceGeo, districtGeo]);

  // Update styles/tooltips when aggregates or selection changes
  useEffect(() => {
    const provinceFill = provinceLayerRef.current;
    const districtFill = districtLayerRef.current;
    if (!provinceFill || !districtFill) return;

    const tooltipOpts = { className: 'election-tooltip', sticky: false, direction: 'top' as const, offset: L.point(0, -8) };

    // Compute tooltip direction based on whether feature is in the top or bottom of the viewport
    const getTooltipDirection = (layer: any): 'top' | 'bottom' => {
      const map = mapInstance.current;
      if (!map) return 'top';
      try {
        const bounds = layer.getBounds?.();
        if (!bounds) return 'top';
        const center = bounds.getCenter();
        const point = map.latLngToContainerPoint(center);
        const mapSize = map.getSize();
        // If feature center is in the top 40% of the map, show tooltip below
        return point.y < mapSize.y * 0.4 ? 'bottom' : 'top';
      } catch { return 'top'; }
    };

    // Close all tooltips helpers
    const closeAllProvinceTooltips = () => {
      provinceFill.eachLayer((layer: any) => {
        try { layer.closeTooltip?.(); } catch { /* */ }
      });
    };
    const closeAllDistrictTooltips = () => {
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      districtFill.eachLayer((layer: any) => {
        try { layer.closeTooltip?.(); } catch { /* */ }
      });
      openHoverLayerRef.current = null;
      hoverExpandedLayerRef.current = null;
    };

    provinceFill.eachLayer((l: any) => {
      const prov = provinceIdToName(l.feature?.properties?.ADM1_EN);
      if (!prov) return;
      const agg = aggregates.provinceAgg.get(prov) || null;
      const isSel = selectedProvince === prov && mapViewLevel === 'province';
      l.setStyle(getRegionStyle(agg, !!isSel));

      const chip = getStatusChip(agg?.declared || 0, agg?.counting || 0, agg?.pending || 0);

      // Build expanded province tooltip with party seat breakdown
      const buildProvinceHtml = () => {
        const total = agg?.total || 0;
        const parties = Object.entries(agg?.partySeats || {}).sort(([, a], [, b]) => b - a);

        let rows = '';
        for (const [party, seats] of parties) {
          const short = getPartyShortLabel(party);
          const color = getPartyColor(party);
          const pct = total > 0 ? ((seats / total) * 100).toFixed(0) : '0';
          const barW = total > 0 ? Math.max(2, (seats / total) * 100) : 0;
          rows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:3px 6px 3px 0;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle;"></span><span style="color:${color};font-weight:700;">${short}</span></td>
            <td style="padding:3px 4px;width:80px;"><div style="background:rgba(255,255,255,0.06);border-radius:2px;height:10px;overflow:hidden;"><div style="background:${color};height:100%;width:${barW}%;border-radius:2px;"></div></div></td>
            <td style="padding:3px 0 3px 6px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${seats}/${total}</td>
            <td style="padding:3px 0 3px 4px;text-align:right;color:${THEME.text.muted};font-variant-numeric:tabular-nums;font-size:10px;">${pct}%</td>
          </tr>`;
        }

        if (parties.length === 0) {
          rows = `<tr><td colspan="4" style="padding:4px 0;color:${THEME.text.muted};font-size:10px;">No results yet</td></tr>`;
        }

        return `<div style="font-weight:800;font-size:12px;margin-bottom:2px;">${prov}</div>
          <div style="font-size:10px;color:${THEME.text.muted};margin-bottom:6px;">${chip.label} · ${(agg?.declared || 0)}/${total} called</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="color:${THEME.text.muted};border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="text-align:left;padding:2px 6px 2px 0;font-weight:500;font-size:9px;">Party</th>
              <th style="padding:2px 4px;font-size:9px;"></th>
              <th style="text-align:right;padding:2px 0 2px 6px;font-weight:500;font-size:9px;">Seats</th>
              <th style="text-align:right;padding:2px 0 2px 4px;font-weight:500;font-size:9px;">%</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      };

      const existingT = l.getTooltip?.();
      if (existingT) { existingT.options.className = 'election-tooltip-expanded'; }
      else l.bindTooltip('', { ...tooltipOpts, interactive: false, className: 'election-tooltip-expanded' });

      l.off('mouseover'); l.off('mouseout'); l.off('mousemove'); l.off('click');

      l.on('click', (e: any) => {
        try { if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); } catch { /* */ }
        districtClickedRef.current = true;

        // If already open on this province, close it
        if (openHoverLayerRef.current === l) {
          try { l.closeTooltip?.(); } catch { /* */ }
          openHoverLayerRef.current = null;
          return;
        }

        // Close all other tooltips
        closeAllProvinceTooltips();
        closeAllDistrictTooltips();

        const tooltip = l.getTooltip?.();
        if (tooltip) {
          tooltip.setContent(buildProvinceHtml());
          tooltip.options.className = 'election-tooltip-expanded';
          const dir = getTooltipDirection(l);
          tooltip.options.direction = dir;
          tooltip.options.offset = dir === 'bottom' ? L.point(0, 8) : L.point(0, -8);
        }
        try { l.openTooltip?.(); } catch { /* */ }
        openHoverLayerRef.current = l;

        // Center map on clicked province so tooltip is visible
        const map = mapInstance.current;
        if (map) {
          const bounds = l.getBounds?.();
          if (bounds) {
            const center = bounds.getCenter();
            map.panTo(center, { animate: true, duration: 0.35 } as any);
          }
        }

        selectProvince(prov);
        selectDistrict(null);
        selectConstituency(null);
      });
    });

    districtFill.eachLayer((l: any) => {
      const name = l.feature?.properties?.name || '';
      const key = normalizeDistrictName(name);
      const prov = l.feature?.properties?.province || '';
      const agg = aggregates.districtAgg.get(key) || null;
      const isSel = selectedDistrict && normalizeDistrictName(selectedDistrict) === key && mapViewLevel !== 'province';
      l.setStyle(getRegionStyle(agg, !!isSel));

      const chip = getStatusChip(agg?.declared || 0, agg?.counting || 0, agg?.pending || 0);
      const briefHtml =
        `<div style="font-weight:800;font-size:12px;margin-bottom:4px;">${name}</div>
         <div style="font-size:10px;color:${THEME.text.muted};margin-bottom:6px;">${prov} · ${chip.label} · ${(agg?.declared || 0)}/${(agg?.total || 0)} called</div>
         <div style="font-size:10px;color:${THEME.text.secondary};">Top: <span style="color:${agg?.dominantParty ? getPartyColor(agg.dominantParty) : THEME.text.muted};font-weight:700;">${agg?.dominantParty ? getPartyShortLabel(agg.dominantParty) : '—'}</span></div>`;

      // Build expanded tooltip with constituency breakdown
      const buildExpandedHtml = () => {
        const consts: ConstituencyDerived[] = [];
        for (const c of aggregates.constituencyIndex.values()) {
          if (normalizeDistrictName(c.district) === key) consts.push(c);
        }
        consts.sort((a, b) => {
          const numA = parseInt(a.constituencyId.split('-').pop() || '0');
          const numB = parseInt(b.constituencyId.split('-').pop() || '0');
          return numA - numB;
        });

        if (consts.length === 0) return briefHtml;

        let rows = '';
        for (const c of consts) {
          const constNo = c.constituencyId.split('-').pop() || '?';
          const leader = c.status === 'declared' ? c.winnerParty : c.leaderParty;
          const leaderName = c.status === 'declared' ? (c.winnerName || '') : (c.leaderName || '');
          const short = leader ? getPartyShortLabel(leader) : '—';
          const color = leader ? getPartyColor(leader) : THEME.text.muted;
          const statusLabel = c.status === 'declared' ? 'WON' : c.status === 'counting' ? 'LIVE' : '—';
          const statusColor = c.status === 'declared' ? '#10B981' : c.status === 'counting' ? '#FBBF24' : THEME.text.muted;
          const margin = c.marginPct !== null ? `+${c.marginPct.toFixed(1)}%` : '';
          const displayName = leaderName.length > 16 ? leaderName.slice(0, 16) + '..' : leaderName;
          rows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:3px 4px 3px 0;font-weight:600;white-space:nowrap;color:${THEME.text.secondary};">${constNo}</td>
            <td style="padding:3px 6px;font-size:9px;font-weight:700;letter-spacing:0.3px;color:${statusColor};">${statusLabel}</td>
            <td style="padding:3px 4px;"><span style="color:${color};font-weight:700;">${short}</span></td>
            <td style="padding:3px 4px;color:${THEME.text.secondary};font-size:10px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayName}</td>
            <td style="padding:3px 0 3px 4px;text-align:right;color:${THEME.text.muted};font-size:10px;font-variant-numeric:tabular-nums;">${margin}</td>
          </tr>`;
        }

        return `<div style="font-weight:800;font-size:12px;margin-bottom:2px;">${name}</div>
          <div style="font-size:10px;color:${THEME.text.muted};margin-bottom:6px;">${prov} · ${chip.label} · ${(agg?.declared || 0)}/${(agg?.total || 0)} called</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="color:${THEME.text.muted};border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="text-align:left;padding:2px 4px 2px 0;font-weight:500;font-size:9px;">#</th>
              <th style="padding:2px 6px;font-weight:500;font-size:9px;">Status</th>
              <th style="text-align:left;padding:2px 4px;font-weight:500;font-size:9px;">Party</th>
              <th style="text-align:left;padding:2px 4px;font-weight:500;font-size:9px;">Leader</th>
              <th style="text-align:right;padding:2px 0 2px 4px;font-weight:500;font-size:9px;">Margin</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      };

      // Tooltip for click-to-show constituency detail
      const existingT = l.getTooltip?.();
      if (existingT) { existingT.setContent(''); existingT.options.className = 'election-tooltip-expanded'; }
      else l.bindTooltip('', { ...tooltipOpts, interactive: false, className: 'election-tooltip-expanded' });

      l.off('mouseover'); l.off('mouseout'); l.off('mousemove'); l.off('click');

      // Click: toggle expanded constituency tooltip (no zoom)
      l.on('click', (e: any) => {
        try { if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); } catch { /* */ }
        districtClickedRef.current = true;

        // If this district's tooltip is already open, close it
        if (openHoverLayerRef.current === l) {
          try { l.closeTooltip?.(); } catch { /* */ }
          openHoverLayerRef.current = null;
          hoverExpandedLayerRef.current = null;
          return;
        }

        // Close any other open tooltip
        closeAllProvinceTooltips();
        closeAllDistrictTooltips();

        // Show expanded tooltip
        const tooltip = l.getTooltip?.();
        if (tooltip) {
          tooltip.setContent(buildExpandedHtml());
          tooltip.options.className = 'election-tooltip-expanded';
          const dir = getTooltipDirection(l);
          tooltip.options.direction = dir;
          tooltip.options.offset = dir === 'bottom' ? L.point(0, 8) : L.point(0, -8);
        }
        try { l.openTooltip?.(); } catch { /* */ }
        openHoverLayerRef.current = l;
        hoverExpandedLayerRef.current = l;

        // Center map on clicked district so tooltip is always visible
        const map = mapInstance.current;
        if (map) {
          const bounds = l.getBounds?.();
          if (bounds) {
            const center = bounds.getCenter();
            map.panTo(center, { animate: true, duration: 0.35 } as any);
          }
        }

        // Also update sidebar selection (without zoom)
        selectDistrict(name);
        selectProvince((prov && (PROVINCES as readonly string[]).includes(prov) ? (prov as Province) : null) as any);
        selectConstituency(null);
      });
    });
  }, [aggregates, selectedProvince, selectedDistrict, mapViewLevel, getRegionStyle, provinceGeo, districtGeo]);

  // If view level or constituency changes via other widgets, close tooltips
  // (but NOT on selectedDistrict change, since our click handler sets that)
  useEffect(() => {
    closeOpenHoverTooltip();
  }, [mapViewLevel, selectedConstituencyId, closeOpenHoverTooltip]);

  // Zoom on selection
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (mapViewLevel === 'province' && selectedProvince) {
      const b = boundsByProvinceRef.current.get(selectedProvince);
      if (b) map.fitBounds(b, { padding: [24, 24], animate: true, duration: 0.45 });
    }
    // District zoom disabled — click shows tooltip instead of zooming
  }, [mapViewLevel, selectedProvince, selectedDistrict]);

  // Constituency pin (explicitly pinned only)
  useEffect(() => {
    const map = mapInstance.current;
    const pins = pinLayerRef.current;
    if (!map || !pins) return;
    pins.clearLayers();
    if (mapViewLevel !== 'constituency' || !pinnedConstituencyId || !districtGeo) return;
    const c = aggregates.constituencyIndex.get(pinnedConstituencyId);
    if (!c) return;
    const distKey = normalizeDistrictName(c.district);
    const feature = districtGeo.features.find(f => normalizeDistrictName((f.properties as any)?.name || '') === distKey) || null;
    const centroid = feature?.properties?.centroid;
    if (!centroid) return;
    const j = deterministicJitter(pinnedConstituencyId);
    const latlng = L.latLng(centroid.lat + j.dLat, centroid.lng + j.dLng);
    const color = c.status === 'declared' ? (c.winnerParty ? getPartyColor(c.winnerParty) : THEME.accent) : THEME.accent;
    const marker = L.circleMarker(latlng, {
      radius: 8,
      color: '#0b1220',
      weight: 3,
      fillColor: color,
      fillOpacity: 0.95,
    });
    marker.bindTooltip(
      `<div style="font-weight:800;font-size:12px;margin-bottom:4px;">${c.name}</div>
       <div style="font-size:10px;color:${THEME.text.muted};">${c.district} • ${c.status.toUpperCase()}</div>`,
      { className: 'election-tooltip', sticky: false, direction: 'top', offset: L.point(0, -8) }
    );
    marker.addTo(pins);
    map.panTo(latlng, { animate: true, duration: 0.35 } as any);
  }, [mapViewLevel, pinnedConstituencyId, districtGeo, aggregates]);

  // Derived UI collections
  const majorityLine = 83;
  const totalSeats = national?.total_constituencies || 165;

  const provincesSorted = useMemo(() => {
    const defaultAgg = { total: 0, declared: 0, counting: 0, pending: 0, partySeats: {}, dominantParty: null, dominantSeats: 0, avgMarginPct: null, retained: 0, lost: 0 };
    const items = PROVINCES.map(p => ({ name: p, agg: aggregates.provinceAgg.get(p) || defaultAgg }));
    return items.sort((a, b) => (b.agg.declared / Math.max(1, b.agg.total)) - (a.agg.declared / Math.max(1, a.agg.total)));
  }, [aggregates]);

  const districtsSorted = useMemo(() => {
    const items = Array.from(aggregates.districtAgg.entries()).map(([k, agg]) => ({
      key: k,
      displayName: aggregates.districtNameByKey.get(k) || k,
      agg,
      province: aggregates.districtToProvince.get(k) || null,
    }));
    items.sort((a, b) => (b.agg.declared / Math.max(1, b.agg.total)) - (a.agg.declared / Math.max(1, a.agg.total)));
    return items;
  }, [aggregates]);

  const constituenciesSorted = useMemo(() => {
    const items = Array.from(aggregates.constituencyIndex.values());
    const q = search.trim().toLowerCase();
    const filteredByQuery = q
      ? items.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.district.toLowerCase().includes(q) ||
          c.province.toLowerCase().includes(q) ||
          c.candidates?.some(x => (x.name_en || '').toLowerCase().includes(q) || (x.aliases || []).some(a => a.toLowerCase().includes(q)))
        )
      : items;

    // When in constituency view, scope the list to the selected region so the UI feels deterministic.
    const filtered = mapViewLevel !== 'constituency'
      ? filteredByQuery
      : selectedDistrict
        ? filteredByQuery.filter(c => normalizeDistrictName(c.district) === normalizeDistrictName(selectedDistrict))
        : selectedProvince
          ? filteredByQuery.filter(c => c.province === selectedProvince)
          : filteredByQuery;
    filtered.sort((a, b) => {
      // closest races first when results exist, else by name
      const am = a.marginPct ?? 999;
      const bm = b.marginPct ?? 999;
      if (am !== bm) return am - bm;
      return a.name.localeCompare(b.name);
    });
    return filtered;
  }, [aggregates, search, mapViewLevel, selectedDistrict, selectedProvince]);

  type QuickSearchHit = {
    kind: 'candidate' | 'constituency'
    key: string
    label: string
    sublabel: string
    district: string
    province: Province
    constituencyId: string
    score: number
  };

  const quickSearchHits = useMemo(() => {
    const qRaw = search.trim();
    const q = qRaw.toLowerCase();
    if (!q) return [] as QuickSearchHit[];

    // Keep typing smooth: avoid deep candidate scans for 1-char queries.
    const scanCandidates = q.length >= 2;

    const hits: QuickSearchHit[] = [];
    const seen = new Set<string>();

    const scoreText = (text: string) => {
      const t = text.toLowerCase();
      if (t === q) return 120;
      if (t.startsWith(q)) return 95;
      if (t.includes(q)) return 60;
      return 0;
    };

    for (const c of aggregates.constituencyIndex.values()) {
      const sName = scoreText(c.name);
      const sDistrict = scoreText(c.district);
      const s = Math.max(sName, sDistrict);
      if (s > 0) {
        const key = `con:${c.constituencyId}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({
            kind: 'constituency',
            key,
            label: c.name,
            sublabel: `${c.district} • ${c.province}`,
            district: c.district,
            province: c.province,
            constituencyId: c.constituencyId,
            score: s + (c.status === 'declared' ? 6 : c.status === 'counting' ? 3 : 0),
          });
        }
      }

      if (!scanCandidates) continue;
      for (const cand of (c.candidates || [])) {
        const candName = (cand.name_en || '').trim();
        if (!candName) continue;
        const base = scoreText(candName);
        const aliasScore = (cand.aliases || []).reduce((m: number, a: string) => Math.max(m, scoreText(a)), 0);
        const partyScore = cand.party ? (cand.party.toLowerCase().includes(q) ? 25 : 0) : 0;
        const score = Math.max(base, aliasScore, partyScore);
        if (score <= 0) continue;

        const key = `cand:${cand.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        hits.push({
          kind: 'candidate',
          key,
          label: candName,
          sublabel: `${getPartyShortLabel(cand.party)} • ${c.name}`,
          district: c.district,
          province: c.province,
          constituencyId: c.constituencyId,
          score: score + (cand.is_winner ? 8 : 0) + Math.min(10, Math.floor((cand.votes || 0) / 5000)),
        });
      }
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.label.localeCompare(b.label);
    });

    return hits.slice(0, 10);
  }, [aggregates, search]);

  const focusHit = useCallback((hit: QuickSearchHit) => {
    // We don't have constituency polygons yet; jump to and highlight the district.
    setMapViewLevel('constituency');
    selectProvince(hit.province);
    selectDistrict(hit.district);
    selectConstituency(hit.constituencyId);
    setSearchFocused(false);
  }, [setMapViewLevel, selectProvince, selectDistrict, selectConstituency]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [search]);

  const selectedConstituency = selectedConstituencyId ? aggregates.constituencyIndex.get(selectedConstituencyId) || null : null;

  const statusLabel = useMemo(() => {
    if (!national) return '—';
    if (isNominationsOnly) return 'NOMINATIONS / PENDING';
    const chip = getStatusChip(national.declared, national.counting, national.pending);
    return chip.label;
  }, [national, isNominationsOnly]);

  const showLeading = useMemo(() => {
    if (!national || isNominationsOnly) return false;
    if (mode === 'historical') return national.declared > 0;
    // live: show leading when any results (counting or declared)
    return (national.declared > 0 || national.counting > 0) && national.declared < totalSeats;
  }, [national, isNominationsOnly, mode, totalSeats]);

  const leadingLabel = mode === 'historical' ? 'Winner' : (showLeading ? 'Leading' : 'Winner');

  const selectProvinceRow = (p: Province) => {
    setMapViewLevel('province');
    selectProvince(p);
    selectDistrict(null);
    selectConstituency(null);
  };

  const selectDistrictRow = (districtName: string) => {
    setMapViewLevel('district');
    selectDistrict(districtName);
    selectProvince((aggregates.districtToProvince.get(normalizeDistrictName(districtName)) || null) as any);
    selectConstituency(null);
  };

  const selectConstituencyRow = (id: string) => {
    setMapViewLevel('constituency');
    const c = aggregates.constituencyIndex.get(id);
    if (c) {
      selectProvince(c.province);
      selectDistrict(c.district);
    }
    selectConstituency(id);
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: THEME.bg.base, position: 'relative', overflow: 'hidden' }}>
      {/* Left: Map + control bar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 12px',
          background: THEME.bg.surface,
          borderBottom: `1px solid ${THEME.border.subtle}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Vote size={14} style={{ color: THEME.accent }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: THEME.text.primary, letterSpacing: 0.2 }}>Election Map</div>
                <div style={{ fontSize: 9, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {statusLabel} • {electionYear} BS
                </div>
              </div>
            </div>

            <div style={{ width: 1, height: 18, background: THEME.border.subtle }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={electionYear}
                onChange={(e) => setElectionYear(Number(e.target.value))}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: THEME.bg.elevated,
                  border: `1px solid ${THEME.border.default}`,
                  color: THEME.text.secondary,
                  borderRadius: 6,
                  padding: '4px 8px',
                }}
              >
                {availableYears.map(y => <option key={y} value={y}>{y} BS</option>)}
              </select>

              <button
                onClick={() => setMode(mode === 'live' ? 'historical' : 'live')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: `1px solid ${THEME.border.default}`,
                  background: THEME.bg.elevated,
                  color: THEME.text.secondary,
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
                title="Toggle live/historical labeling"
              >
                <ArrowLeftRight size={12} />
                {mode.toUpperCase()}
              </button>
            </div>

            <div style={{ width: 1, height: 18, background: THEME.border.subtle }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {([
                { id: 'province', label: 'Province', icon: <MapIcon size={12} /> },
                { id: 'district', label: 'District', icon: <Layers size={12} /> },
                { id: 'constituency', label: 'Constituency', icon: <List size={12} /> },
              ] as Array<{ id: ViewLevel; label: string; icon: any }>).map(v => (
                <button
                  key={v.id}
                  onClick={() => setMapViewLevel(v.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: `1px solid ${v.id === mapViewLevel ? THEME.border.focus : THEME.border.default}`,
                    background: v.id === mapViewLevel ? THEME.bg.active : THEME.bg.elevated,
                    color: v.id === mapViewLevel ? THEME.text.primary : THEME.text.secondary,
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {v.icon}
                  {v.label}
                </button>
              ))}
            </div>

            <div style={{ width: 1, height: 18, background: THEME.border.subtle }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {([
                { id: 'party', label: 'Party' },
                { id: 'margin', label: 'Margin' },
                { id: 'incumbency', label: 'Incumbency' },
              ] as Array<{ id: ShadeMode; label: string }>).map(s => (
                <button
                  key={s.id}
                  onClick={() => setShadeMode(s.id)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: `1px solid ${s.id === shadeMode ? THEME.border.focus : THEME.border.default}`,
                    background: s.id === shadeMode ? THEME.bg.active : THEME.bg.elevated,
                    color: s.id === shadeMode ? THEME.text.primary : THEME.text.secondary,
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <TrendingUp size={12} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                borderRadius: 8,
                border: `1px solid ${THEME.border.default}`,
                background: THEME.bg.elevated,
                minWidth: 260,
              }}>
                <Search size={14} style={{ color: THEME.text.muted }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => { window.setTimeout(() => setSearchFocused(false), 120); }}
                  onKeyDown={(e) => {
                    if (!quickSearchHits.length) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSearchActiveIndex((i) => Math.min(i + 1, quickSearchHits.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSearchActiveIndex((i) => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const hit = quickSearchHits[searchActiveIndex] || quickSearchHits[0];
                      if (hit) focusHit(hit);
                    } else if (e.key === 'Escape') {
                      setSearch('');
                      setSearchFocused(false);
                    }
                  }}
                  placeholder="Search candidate or constituency…"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: THEME.text.primary,
                    fontSize: 11,
                    width: '100%',
                  }}
                />
              </div>

              {searchFocused && search.trim() && quickSearchHits.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  zIndex: 3000,
                  borderRadius: 10,
                  border: `1px solid ${THEME.border.emphasis}`,
                  background: THEME.bg.elevated,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
                  overflow: 'hidden',
                }}>
                  {quickSearchHits.map((hit, idx) => {
                    const active = idx === searchActiveIndex;
                    return (
                      <button
                        key={hit.key}
                        type="button"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          focusHit(hit);
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 10px',
                          border: 'none',
                          background: active ? THEME.bg.active : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{
                              fontSize: 9,
                              fontWeight: 900,
                              letterSpacing: 0.6,
                              textTransform: 'uppercase',
                              color: hit.kind === 'candidate' ? '#60a5fa' : '#a78bfa',
                              flexShrink: 0,
                            }}>
                              {hit.kind}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: THEME.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {hit.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {hit.sublabel}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: THEME.text.secondary, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))', fontWeight: 800 }}>
                          {hit.district}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div ref={mapRef} style={{ position: 'absolute', inset: 0 }} />
        </div>
      </div>

      {/* Right: Results board */}
      <div style={{
        width: 360,
        minWidth: 360,
        borderLeft: `1px solid ${THEME.border.default}`,
        background: THEME.bg.surface,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* National scoreboard — compact */}
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${THEME.border.subtle}`, background: THEME.bg.elevated }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {[
              { label: 'Called', value: national?.declared ?? 0, color: '#22c55e' },
              { label: 'Counting', value: national?.counting ?? 0, color: '#eab308' },
              { label: 'Pending', value: national?.pending ?? 0, color: THEME.text.secondary },
            ].map(x => (
              <div key={x.label} style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: x.color, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>{x.value}</div>
                <div style={{ fontSize: 8, fontWeight: 800, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{x.label}</div>
              </div>
            ))}
          </div>

        </div>

        {/* Scrollable: Party seats + Region list */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* Party totals */}
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${THEME.border.subtle}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 900, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Party seats</div>
              {!isNominationsOnly && showLeading && national?.leading_party ? (
                <div style={{ fontSize: 10, fontWeight: 900, color: THEME.text.secondary }}>
                  {leadingLabel}:{' '}
                  <span style={{ color: getPartyColor(national.leading_party), fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                    {getPartyShortLabel(national.leading_party)} {national.leading_party_seats}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 10, color: THEME.text.muted }}>{isNominationsOnly ? 'No results yet' : ''}</div>
              )}
            </div>

            {aggregates.partySeatTotals.length === 0 ? (
              <div style={{ padding: 10, borderRadius: 8, border: `1px dashed ${THEME.border.emphasis}`, background: THEME.bg.surface, color: THEME.text.muted, fontSize: 11 }}>
                Waiting for called seats…
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {aggregates.partySeatTotals.slice(0, 10).map(([party, seats]) => {
                  const color = getPartyColor(party);
                  const pct = Math.min(100, (seats / majorityLine) * 100);
                  return (
                    <div key={party}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 900, color: THEME.text.primary }}>
                            {getPartyShortLabel(party)}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 900, color, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>{seats}</div>
                      </div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ padding: 12, borderBottom: `1px solid ${THEME.border.subtle}` }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {mapViewLevel === 'province' ? 'Provinces' : mapViewLevel === 'district' ? 'Districts' : 'Constituencies'}
            </div>
            {mapViewLevel === 'constituency' && (selectedDistrict || selectedProvince) && (
              <div style={{ marginTop: 3, fontSize: 10, color: THEME.text.secondary, fontWeight: 800 }}>
                {selectedDistrict ? selectedDistrict : selectedProvince}
              </div>
            )}
          </div>

          {isLoading ? (
            <div style={{ padding: 16, color: THEME.text.muted, fontSize: 12 }}>Loading election data…</div>
          ) : error ? (
            <div style={{ padding: 16, color: '#ef4444', fontSize: 12 }}>{error}</div>
          ) : (
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mapViewLevel === 'province' && provincesSorted.map(({ name, agg }) => {
                const isSel = selectedProvince === name;
                const top = agg.dominantParty;
                const topColor = top ? getPartyColor(top) : THEME.text.muted;
                return (
                  <button
                    key={name}
                    onClick={() => selectProvinceRow(name)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 10px',
                      borderRadius: 10,
                      border: `1px solid ${isSel ? THEME.border.focus : THEME.border.subtle}`,
                      background: isSel ? THEME.bg.active : THEME.bg.elevated,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: THEME.text.primary }}>{name}</div>
                        <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                          {agg.declared}/{agg.total} {agg.declared > 0 ? 'called' : 'counting'} • Top:{' '}
                          <span style={{ color: topColor, fontWeight: 900, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                            {top ? getPartyShortLabel(top) : '—'} {top ? agg.dominantSeats : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const entries = Object.entries(agg.partySeats).sort(([, a], [, b]) => b - a);
                      const totalSeats = entries.reduce((s, [, v]) => s + v, 0);
                      if (totalSeats === 0) return (
                        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 999, marginTop: 8 }} />
                      );
                      return (
                        <div style={{ display: 'flex', height: 5, borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                          {entries.map(([party, seats]) => (
                            <div
                              key={party}
                              style={{
                                width: `${(seats / totalSeats) * 100}%`,
                                background: getPartyColor(party),
                                minWidth: 2,
                              }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </button>
                );
              })}

              {mapViewLevel === 'district' && districtsSorted.map(({ key, displayName, agg, province }) => {
                const isSel = selectedDistrict ? normalizeDistrictName(selectedDistrict) === key : false;
                const top = agg.dominantParty;
                const topColor = top ? getPartyColor(top) : THEME.text.muted;
                return (
                  <button
                    key={key}
                    onClick={() => selectDistrictRow(displayName)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 10px',
                      borderRadius: 10,
                      border: `1px solid ${isSel ? THEME.border.focus : THEME.border.subtle}`,
                      background: isSel ? THEME.bg.active : THEME.bg.elevated,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: THEME.text.primary }}>{displayName}</div>
                        <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                          {province ? `${province} • ` : ''}{agg.declared}/{agg.total} called • Top:{' '}
                          <span style={{ color: topColor, fontWeight: 900, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                            {top ? getPartyShortLabel(top) : '—'} {top ? agg.dominantSeats : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const entries = Object.entries(agg.partySeats).sort(([, a], [, b]) => b - a);
                      const totalSeats = entries.reduce((s, [, v]) => s + v, 0);
                      if (totalSeats === 0) return (
                        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 999, marginTop: 8 }} />
                      );
                      return (
                        <div style={{ display: 'flex', height: 5, borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                          {entries.map(([party, seats]) => (
                            <div
                              key={party}
                              style={{
                                width: `${(seats / totalSeats) * 100}%`,
                                background: getPartyColor(party),
                                minWidth: 2,
                              }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </button>
                );
              })}

              {mapViewLevel === 'constituency' && constituenciesSorted.slice(0, 250).map((c) => {
                const isSel = selectedConstituencyId === c.constituencyId;
                const labelParty = c.status === 'declared' ? c.winnerParty : c.leaderParty;
                const labelName = c.status === 'declared' ? c.winnerName : c.leaderName;
                const color = labelParty ? getPartyColor(labelParty) : THEME.text.muted;
                const topCandidates = [...(c.candidates || [])].sort((a, b) => (b.votes || 0) - (a.votes || 0)).slice(0, 5);
                return (
                  <button
                    key={c.constituencyId}
                    onClick={() => selectConstituencyRow(c.constituencyId)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 10px',
                      borderRadius: 10,
                      border: `1px solid ${isSel ? THEME.border.focus : THEME.border.subtle}`,
                      background: isSel ? THEME.bg.active : THEME.bg.elevated,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: THEME.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                          {c.district} • {c.province} • {c.status.toUpperCase()}
                          {c.lastUpdated && (
                            <span style={{ marginLeft: 4, color: THEME.text.muted, fontSize: 9 }}>
                              • {formatRelativeTime(c.lastUpdated)}
                            </span>
                          )}
                        </div>
                        {!isSel && (
                          <div style={{ fontSize: 10, color: THEME.text.secondary, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {labelParty ? (
                              <>
                                <span style={{ color, fontWeight: 900, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>{getPartyShortLabel(labelParty)}</span>
                                <span style={{ color: THEME.text.muted }}> • </span>
                                <span style={{ color: THEME.text.secondary }}>{labelName || ''}</span>
                              </>
                            ) : (
                              <span style={{ color: THEME.text.muted }}>No leader yet</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: THEME.text.secondary, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                          {formatPct(c.marginPct)}
                        </div>
                        <div style={{ fontSize: 9, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>margin</div>
                      </div>
                    </div>

                    {/* Expanded: top 5 candidates inline */}
                    {isSel && topCandidates.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 9, fontWeight: 900, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
                          Top {topCandidates.length} Candidates
                        </div>
                        {topCandidates.map((cand, idx) => {
                          const ccol = getPartyColor(cand.party);
                          const maxVotes = topCandidates[0]?.votes || 1;
                          const barPct = Math.min(100, ((cand.votes || 0) / maxVotes) * 100);
                          return (
                            <div key={cand.id || idx} style={{
                              padding: '6px 8px',
                              borderRadius: 8,
                              border: `1px solid ${THEME.border.subtle}`,
                              background: THEME.bg.surface,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                                  <div style={{ width: 8, height: 8, borderRadius: 2, background: ccol, flexShrink: 0 }} />
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 11, fontWeight: 900, color: THEME.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {cand.name_en}
                                      {cand.is_winner && (
                                        <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 900, color: '#22c55e', textTransform: 'uppercase' }}>W</span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 9, color: ccol, fontWeight: 800, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                                      {getPartyShortLabel(cand.party)}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ fontSize: 11, fontWeight: 900, color: THEME.text.secondary, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))', flexShrink: 0 }}>
                                  {(cand.votes || 0).toLocaleString('en-US')}
                                </div>
                              </div>
                              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden', marginTop: 4 }}>
                                <div style={{ height: '100%', width: `${barPct}%`, background: ccol, borderRadius: 999 }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail drawer */}
        <div style={{ borderTop: `1px solid ${THEME.border.default}`, background: THEME.bg.elevated, padding: 12 }}>
          {mapViewLevel === 'province' && selectedProvince ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: THEME.text.primary }}>{selectedProvince}</div>
              <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                {(() => {
                  const agg = aggregates.provinceAgg.get(selectedProvince);
                  if (!agg) return '';
                  const top = agg.dominantParty;
                  const label = mode === 'historical' ? 'Winner' : (agg.declared > 0 && agg.declared < agg.total ? 'Leading' : 'Winner');
                  return `${agg.declared}/${agg.total} called • ${label}: ${top ? getPartyShortLabel(top) : '—'}`;
                })()}
              </div>
              <div style={{ fontSize: 10, color: THEME.text.secondary, marginTop: 6 }}>
                Click District view to drill down.
              </div>
            </div>
          ) : mapViewLevel !== 'province' && selectedDistrict ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: THEME.text.primary, textTransform: 'capitalize' }}>{selectedDistrict}</div>
              <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                {(() => {
                  const agg = aggregates.districtAgg.get(normalizeDistrictName(selectedDistrict));
                  if (!agg) return '—';
                  const top = agg.dominantParty;
                  const label = mode === 'historical' ? 'Winner' : (agg.declared > 0 && agg.declared < agg.total ? 'Leading' : 'Winner');
                  return `${agg.declared}/${agg.total} called • ${label}: ${top ? getPartyShortLabel(top) : '—'}`;
                })()}
              </div>
              <div style={{ fontSize: 10, color: THEME.text.secondary, marginTop: 6 }}>
                Switch to Constituency view for candidate tables.
              </div>
            </div>
          ) : mapViewLevel === 'constituency' && selectedConstituency ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: THEME.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedConstituency.name}
              </div>
              <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                {selectedConstituency.district} • {selectedConstituency.province} • {selectedConstituency.status.toUpperCase()}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${THEME.border.subtle}`, background: THEME.bg.surface }}>
                  <div style={{ fontSize: 9, fontWeight: 900, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Margin</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: THEME.text.secondary, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                    {formatPct(selectedConstituency.marginPct)}
                  </div>
                </div>
                <div style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${THEME.border.subtle}`, background: THEME.bg.surface }}>
                  <div style={{ fontSize: 9, fontWeight: 900, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Leader/Winner</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: selectedConstituency.status === 'declared' && selectedConstituency.winnerParty ? getPartyColor(selectedConstituency.winnerParty) : THEME.text.secondary }}>
                    {selectedConstituency.status === 'declared'
                      ? (selectedConstituency.winnerParty ? `${getPartyShortLabel(selectedConstituency.winnerParty)}` : '—')
                      : (selectedConstituency.leaderParty ? `${getPartyShortLabel(selectedConstituency.leaderParty)}` : '—')}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 900, color: THEME.text.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                  Candidates
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflow: 'auto' }}>
                  {[...(selectedConstituency.candidates || [])]
                    .sort((a, b) => (b.votes || 0) - (a.votes || 0))
                    .slice(0, 8)
                    .map((cand) => {
                      const ccol = getPartyColor(cand.party);
                      return (
                        <div key={cand.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '8px 8px',
                          borderRadius: 10,
                          border: `1px solid ${THEME.border.subtle}`,
                          background: THEME.bg.surface,
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: ccol }} />
                              <div style={{ fontSize: 11, fontWeight: 900, color: THEME.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {cand.name_en}
                              </div>
                              {cand.is_winner && (
                                <span style={{ fontSize: 9, fontWeight: 900, color: '#22c55e', textTransform: 'uppercase', letterSpacing: 0.6 }}>W</span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: THEME.text.muted, marginTop: 2 }}>
                              <span style={{ color: ccol, fontWeight: 900, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                                {getPartyShortLabel(cand.party)}
                              </span>
                              <span style={{ color: THEME.text.muted }}> • </span>
                              {cand.party}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: THEME.text.secondary, fontFamily: 'var(--pro-font-mono, var(--font-mono, monospace))' }}>
                              {(cand.votes || 0).toLocaleString('en-US')}
                            </div>
                            <div style={{ fontSize: 10, color: THEME.text.muted }}>
                              {formatPct(cand.vote_pct)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: THEME.text.muted, fontSize: 11 }}>
              Select a {mapViewLevel === 'province' ? 'province' : mapViewLevel === 'district' ? 'district' : 'constituency'} to see details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ElectionMapWidget = memo(function ElectionMapWidget() {
  return (
    <Widget id="election-map" icon={<Vote size={14} />}>
      <ElectionMapContent sizeKey="election-map" />
    </Widget>
  );
});
