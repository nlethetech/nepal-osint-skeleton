/**
 * SpatialTab - PWTT-Style Satellite Damage Analysis
 *
 * Production-grade infrastructure damage detection using:
 * - Sentinel-1 SAR pixel-wise t-test change detection
 * - Before/after swipe comparison with actual satellite imagery
 * - Viridis color scale for statistical significance
 * - Building footprint damage classification overlay
 * - Comprehensive analysis statistics
 *
 * Methodology: https://oballinger.github.io/PWTT/blast.html
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import {
  Layers,
  Satellite,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Grid3X3,
  SplitSquareHorizontal,
  Blend,
  BarChart3,
  Building2,
  Info,
} from 'lucide-react';
import { Button, Intent } from '@blueprintjs/core';
import type { Assessment, DamageZone } from '../../../api/damageAssessment';
import { listZones, detectBuildings } from '../../../api/damageAssessment';
import type { BuildingDamageFeatureV2 } from '../../../api/damageAssessmentV2';
import { buildingPopupV2Html } from '../BuildingPopupV2';

import 'leaflet/dist/leaflet.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface SpatialTabProps {
  assessment: Assessment;
  onRunAnalysis: () => void;
  isRunningAnalysis: boolean;
  zonesOverride?: DamageZone[];
  disableLegacyZoneApi?: boolean;
  enableLegacyBuildingDetection?: boolean;
  v2BuildingData?: BuildingDamageFeatureV2[];
}

type ViewMode = 'swipe' | 'side-by-side' | 'overlay' | 'analysis';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS - VIRIDIS COLOR SCALE (like PWTT Beirut analysis)
// ═══════════════════════════════════════════════════════════════════════════════

const VIRIDIS_COLORS = [
  { value: 0, color: '#440154', label: '0' },
  { value: 1, color: '#482878', label: '1' },
  { value: 2, color: '#3e4989', label: '2' },
  { value: 3, color: '#31688e', label: '3' },
  { value: 4, color: '#26828e', label: '4' },
  { value: 5, color: '#1f9e89', label: '5' },
  { value: 6, color: '#35b779', label: '6' },
  { value: 7, color: '#6ece58', label: '7' },
  { value: 8, color: '#b5de2b', label: '8' },
  { value: 9, color: '#fde725', label: '9+' },
];

// PWTT-aligned severity colors for building footprints (viridis-based)
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#fde725',  // Yellow - highest t-stat
  severe: '#6ece58',    // Light green - high t-stat
  moderate: '#26828e',   // Teal - moderate t-stat
  minor: '#3e4989',      // Indigo - low t-stat
  safe: '#440154',       // Purple - no damage
};

// ═══════════════════════════════════════════════════════════════════════════════
// SWIPE COMPARISON CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

interface SwipeControlProps {
  position: number;
  onPositionChange: (position: number) => void;
  beforeLabel: string;
  afterLabel: string;
}

function SwipeControl({ position, onPositionChange, beforeLabel, afterLabel }: SwipeControlProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      onPositionChange((x / rect.width) * 100);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onPositionChange]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[1000] pointer-events-none"
    >
      {/* Swipe line */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-bp-text shadow-lg pointer-events-auto cursor-ew-resize"
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        onMouseDown={handleMouseDown}
      >
        {/* Handle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-bp-text rounded-full shadow-xl flex items-center justify-center border-2 border-bp-border">
          <ChevronLeft className="w-4 h-4 text-bp-bg" />
          <ChevronRight className="w-4 h-4 text-bp-bg" />
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 px-3 py-1.5 bg-bp-bg/80 backdrop-blur-sm rounded-lg text-bp-text text-sm font-medium pointer-events-auto">
        {beforeLabel}
      </div>
      <div className="absolute top-4 right-4 px-3 py-1.5 bg-bp-bg/80 backdrop-blur-sm rounded-lg text-bp-text text-sm font-medium pointer-events-auto">
        {afterLabel}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAP COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// Component to fit map to assessment bounds
function FitBounds({ bbox }: { bbox: [number, number, number, number] }) {
  const map = useMap();
  useEffect(() => {
    const bounds: L.LatLngBoundsExpression = [
      [bbox[1], bbox[0]], // SW
      [bbox[3], bbox[2]], // NE
    ];
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [map, bbox]);
  return null;
}

// Clipped tile layer for swipe comparison - handles z-index and error detection
function ClippedTileLayer({
  url,
  clipPosition,
  side,
  opacity = 1,
  zIndex = 100,
  onLoadError,
  onLoadSuccess,
}: {
  url: string;
  clipPosition: number;
  side: 'left' | 'right';
  opacity?: number;
  zIndex?: number;
  onLoadError?: (side: 'left' | 'right') => void;
  onLoadSuccess?: (side: 'left' | 'right') => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!url) {
      console.log(`[ClippedTileLayer ${side}] No URL provided`);
      return;
    }

    console.log(`[ClippedTileLayer ${side}] Loading tiles from:`, url.slice(0, 100) + '...');

    const layer = L.tileLayer(url, {
      opacity,
      maxZoom: 18,
      attribution: 'Google Earth Engine / Copernicus',
      zIndex: zIndex,
      errorTileUrl: '', // Don't show error tiles - they just clutter the view
    });

    // Track tile loading for debugging
    let tilesLoaded = 0;
    let tilesErrored = 0;

    layer.on('tileload', () => {
      tilesLoaded++;
      if (tilesLoaded === 1) {
        console.log(`[ClippedTileLayer ${side}] First tile loaded successfully`);
        onLoadSuccess?.(side);
      }
    });

    layer.on('tileerror', (e) => {
      tilesErrored++;
      if (tilesErrored === 1) {
        console.error(`[ClippedTileLayer ${side}] First tile error:`, e);
        onLoadError?.(side);
      }
    });

    layer.addTo(map);

    // Apply CSS clip and ensure proper layering
    const updateClip = () => {
      const container = layer.getContainer();
      if (container) {
        // Set z-index to ensure proper stacking
        container.style.zIndex = String(zIndex);

        if (side === 'left') {
          container.style.clipPath = `inset(0 ${100 - clipPosition}% 0 0)`;
        } else {
          container.style.clipPath = `inset(0 0 0 ${clipPosition}%)`;
        }
      }
    };

    // Initial update after layer loads
    layer.on('load', updateClip);
    updateClip();
    map.on('move', updateClip);
    map.on('zoom', updateClip);

    return () => {
      map.removeLayer(layer);
      layer.off('load', updateClip);
      layer.off('tileload');
      layer.off('tileerror');
      map.off('move', updateClip);
      map.off('zoom', updateClip);
    };
  }, [map, url, clipPosition, side, opacity, zIndex, onLoadError, onLoadSuccess]);

  return null;
}

// Simple tile layer
function SatelliteTileLayer({ url, opacity = 1 }: { url: string; opacity?: number }) {
  if (!url) return null;
  return (
    <TileLayer
      url={url}
      opacity={opacity}
      maxZoom={18}
      attribution="Google Earth Engine / Copernicus"
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYSIS STATISTICS PANEL
// ═══════════════════════════════════════════════════════════════════════════════

interface StatsPanelProps {
  assessment: Assessment;
  zones: DamageZone[];
}

function StatsPanel({ assessment, zones }: StatsPanelProps) {
  const severityCounts = useMemo(() => {
    const counts = { critical: 0, severe: 0, moderate: 0, minor: 0, safe: 0 };
    zones.forEach((zone) => {
      if (zone.severity in counts) {
        counts[zone.severity as keyof typeof counts]++;
      }
    });
    return counts;
  }, [zones]);

  return (
    <div className="absolute bottom-4 right-4 z-[1000] w-72 shadow-2xl overflow-hidden bg-bp-bg/95 backdrop-blur-md border border-bp-border rounded-xl">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-bp-border">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-bp-primary" />
          <span className="text-sm font-semibold text-bp-text">Analysis Results</span>
        </div>
        <span className="text-xs text-bp-text-muted">
          {assessment.baseline_images_count || 0}/{assessment.post_images_count || 0} images
        </span>
      </div>

      {/* Damage Summary */}
      <div className="px-4 py-3 border-b border-bp-border">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs mb-1 text-bp-text-muted">Total Area</div>
            <div className="text-lg font-semibold text-bp-text">
              {(assessment.total_area_km2 || 0).toFixed(2)} km<sup>2</sup>
            </div>
          </div>
          <div>
            <div className="text-xs mb-1 text-bp-text-muted">Damaged Area</div>
            <div className="text-lg font-semibold text-severity-critical">
              {(assessment.damaged_area_km2 || 0).toFixed(2)} km<sup>2</sup>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-bp-text-muted">Damage Extent</span>
            <span className="font-medium text-bp-text">
              {(assessment.damage_percentage || 0).toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-bp-surface">
            <div
              className="h-full bg-gradient-to-r from-severity-critical to-severity-high rounded-full transition-all"
              style={{ width: `${Math.min(assessment.damage_percentage || 0, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="px-4 py-3 border-b border-bp-border">
        <div className="text-xs mb-2 flex items-center gap-1 text-bp-text-muted">
          <Building2 size={12} />
          Damage Zones by Severity
        </div>
        <div className="space-y-2">
          {Object.entries(severityCounts).map(([severity, count]) => (
            <div key={severity} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: SEVERITY_COLORS[severity] }}
              />
              <span className="text-xs capitalize flex-1 text-bp-text-muted">{severity}</span>
              <span className="text-xs font-medium text-bp-text">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Confidence Score */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-bp-text-muted">Analysis Confidence</div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 rounded-full overflow-hidden bg-bp-surface">
              <div
                className="h-full bg-bp-success rounded-full"
                style={{ width: `${(assessment.confidence_score || 0) * 100}%` }}
              />
            </div>
            <span className="text-xs text-bp-success font-medium">
              {((assessment.confidence_score || 0) * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRIDIS LEGEND (T-STATISTIC SCALE)
// ═══════════════════════════════════════════════════════════════════════════════

function ViridisLegend({ showTStat }: { showTStat: boolean }) {
  if (!showTStat) return null;

  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg p-3 shadow-xl bg-bp-bg/95 backdrop-blur-md border border-bp-border">
      <div className="flex items-center gap-2 mb-2">
        <Info size={12} className="text-bp-primary" />
        <span className="text-xs font-medium text-bp-text">T-Statistic (Change Significance)</span>
      </div>
      <div className="flex items-center">
        {VIRIDIS_COLORS.map((stop, i) => (
          <div key={i} className="flex flex-col items-center">
            <div
              className="w-5 h-4 first:rounded-l last:rounded-r"
              style={{ backgroundColor: stop.color }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-bp-text-muted">No Change</span>
        <span className="text-[10px] text-bp-text-muted">Significant</span>
      </div>
      <div className="text-[10px] mt-2 max-w-[200px] text-bp-text-muted">
        Values &gt;3 indicate significant damage (PWTT threshold)
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER CONTROL SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

interface LayerControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  layers: Record<string, boolean>;
  onToggleLayer: (layer: string) => void;
  opacity: Record<string, number>;
  onOpacityChange: (layer: string, value: number) => void;
  assessment: Assessment;
  onRunAnalysis: () => void;
  isRunningAnalysis: boolean;
  onDetectBuildings: () => void;
  isDetectingBuildings: boolean;
  showDetectBuildings: boolean;
  hasAnalysisResults: boolean;
}

function LayerControls({
  viewMode,
  onViewModeChange,
  layers,
  onToggleLayer,
  opacity,
  onOpacityChange,
  assessment,
  onRunAnalysis,
  isRunningAnalysis,
  onDetectBuildings,
  isDetectingBuildings,
  showDetectBuildings,
  hasAnalysisResults,
}: LayerControlsProps) {
  return (
    <div className="w-72 flex flex-col overflow-hidden bg-bp-bg border-l border-bp-border">
      {/* View Mode Selection */}
      <div className="p-4 border-b border-bp-border">
        <div className="text-xs font-medium uppercase tracking-wide mb-3 text-bp-text-muted">
          View Mode
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ViewModeButton
            icon={<SplitSquareHorizontal size={14} />}
            label="Swipe"
            active={viewMode === 'swipe'}
            onClick={() => onViewModeChange('swipe')}
          />
          <ViewModeButton
            icon={<Grid3X3 size={14} />}
            label="Side by Side"
            active={viewMode === 'side-by-side'}
            onClick={() => onViewModeChange('side-by-side')}
          />
          <ViewModeButton
            icon={<Blend size={14} />}
            label="Overlay"
            active={viewMode === 'overlay'}
            onClick={() => onViewModeChange('overlay')}
          />
          <ViewModeButton
            icon={<BarChart3 size={14} />}
            label="Analysis"
            active={viewMode === 'analysis'}
            onClick={() => onViewModeChange('analysis')}
          />
        </div>
      </div>

      {/* Layer Controls */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-xs font-medium uppercase tracking-wide mb-3 text-bp-text-muted">
          <Layers size={12} className="inline mr-1" />
          Analysis Layers
        </div>

        <div className="space-y-3">
          {/* T-Statistic Layer - Raw PWTT statistical output */}
          <LayerItem
            label="T-Statistic Heatmap"
            sublabel="Raw PWTT statistical values (-5 to +5)"
            active={layers.tstat}
            available={!!assessment.t_stat_tile_url}
            color="#fde725"
            onToggle={() => onToggleLayer('tstat')}
            opacity={opacity.tstat}
            onOpacityChange={(v) => onOpacityChange('tstat', v)}
          />

          {/* Building Footprints */}
          <LayerItem
            label="Building Footprints"
            sublabel="Damage-classified structures"
            active={layers.buildings}
            available={true}
            color="#3b82f6"
            onToggle={() => onToggleLayer('buildings')}
            opacity={opacity.buildings}
            onOpacityChange={(v) => onOpacityChange('buildings', v)}
          />

          <div className="pt-3 mt-3 border-t border-bp-border">
            <div className="text-xs mb-2 text-bp-text-muted">Optical Imagery (Sentinel-2, reference)</div>
          </div>

          {/* Before RGB */}
          <LayerItem
            label="Before Event"
            sublabel="True color composite"
            active={layers.rgbBefore}
            available={!!assessment.before_tile_url}
            color="#22c55e"
            onToggle={() => onToggleLayer('rgbBefore')}
            opacity={opacity.rgbBefore}
            onOpacityChange={(v) => onOpacityChange('rgbBefore', v)}
          />

          {/* After RGB */}
          <LayerItem
            label="After Event"
            sublabel="True color composite (optical)"
            active={layers.rgbAfter}
            available={!!assessment.after_tile_url}
            color="#ef4444"
            onToggle={() => onToggleLayer('rgbAfter')}
            opacity={opacity.rgbAfter}
            onOpacityChange={(v) => onOpacityChange('rgbAfter', v)}
          />

          <div className="pt-3 mt-3 border-t border-bp-border">
            <div className="text-xs mb-2 text-bp-text-muted">SAR Imagery (Sentinel-1)</div>
          </div>

          {/* Before SAR */}
          <LayerItem
            label="Before SAR"
            sublabel="VV backscatter"
            active={layers.sarBefore}
            available={!!assessment.before_sar_tile_url}
            color="#8b5cf6"
            onToggle={() => onToggleLayer('sarBefore')}
            opacity={opacity.sarBefore}
            onOpacityChange={(v) => onOpacityChange('sarBefore', v)}
          />

          {/* After SAR */}
          <LayerItem
            label="After SAR"
            sublabel="VV backscatter"
            active={layers.sarAfter}
            available={!!assessment.after_sar_tile_url}
            color="#a855f7"
            onToggle={() => onToggleLayer('sarAfter')}
            opacity={opacity.sarAfter}
            onOpacityChange={(v) => onOpacityChange('sarAfter', v)}
          />
        </div>
      </div>

      {/* Analysis Actions */}
      <div className="p-4 space-y-3 border-t border-bp-border">
        <Button
          fill
          intent={Intent.DANGER}
          loading={isRunningAnalysis}
          icon={isRunningAnalysis ? undefined : <Satellite size={14} />}
          text={hasAnalysisResults ? 'Re-run Analysis' : 'Run PWTT Analysis'}
          onClick={onRunAnalysis}
          className="text-xs"
        />

        {/* Detect Buildings Button */}
        {showDetectBuildings && hasAnalysisResults && (
          <Button
            fill
            intent={Intent.PRIMARY}
            loading={isDetectingBuildings}
            icon={isDetectingBuildings ? undefined : <Building2 size={14} />}
            text={isDetectingBuildings ? 'Detecting...' : 'Detect Buildings (OSM)'}
            onClick={onDetectBuildings}
            className="text-xs"
          />
        )}

        <div className="text-[10px] text-center text-bp-text-muted">
          {showDetectBuildings && hasAnalysisResults
            ? 'Auto-detect building damage from OpenStreetMap'
            : 'Sentinel-1 SAR pixel-wise t-test'}
        </div>
      </div>
    </div>
  );
}

function ViewModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
        active
          ? 'bg-bp-primary/20 text-bp-primary outline outline-1 outline-bp-primary/30'
          : 'bg-bp-surface text-bp-text-muted'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface LayerItemProps {
  label: string;
  sublabel: string;
  active: boolean;
  available: boolean;
  color: string;
  onToggle: () => void;
  opacity: number;
  onOpacityChange: (value: number) => void;
}

function LayerItem({
  label,
  sublabel,
  active,
  available,
  color,
  onToggle,
  opacity,
  onOpacityChange,
}: LayerItemProps) {
  return (
    <div className={`rounded-lg transition-colors ${!available ? 'opacity-40' : ''}`}>
      <button
        onClick={available ? onToggle : undefined}
        disabled={!available}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${!available ? 'cursor-not-allowed' : ''} ${active ? 'bg-bp-surface' : ''}`}
      >
        <div
          className={`w-3 h-3 rounded-sm transition-all ${active ? '' : 'opacity-40'}`}
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${active ? 'text-bp-text' : 'text-bp-text-muted'}`}>{label}</div>
          <div className="text-[10px] text-bp-text-muted">{sublabel}</div>
        </div>
        {active ? (
          <Eye size={14} className="text-bp-text-muted" />
        ) : (
          <EyeOff size={14} className="text-bp-text-muted" />
        )}
      </button>

      {/* Opacity slider */}
      {active && (
        <div className="px-3 pb-2 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              value={opacity * 100}
              onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
              className="flex-1 h-1 rounded-full appearance-none cursor-pointer accent-bp-primary bg-bp-surface"
            />
            <span className="text-[10px] w-8 text-bp-text-muted">{Math.round(opacity * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function SpatialTab({
  assessment,
  onRunAnalysis,
  isRunningAnalysis,
  zonesOverride,
  disableLegacyZoneApi = false,
  enableLegacyBuildingDetection = true,
  v2BuildingData,
}: SpatialTabProps) {
  const hasV2Data = !!(v2BuildingData && v2BuildingData.length > 0);
  const [viewMode, setViewMode] = useState<ViewMode>('swipe');
  const [swipePosition, setSwipePosition] = useState(50);
  const [zones, setZones] = useState<DamageZone[]>([]);
  const [isDetectingBuildings, setIsDetectingBuildings] = useState(false);

  const [layers, setLayers] = useState({
    tstat: true,
    buildings: true, // Show building footprints by default
    rgbBefore: false,
    rgbAfter: false,
    sarBefore: false,
    sarAfter: false,
  });

  const [opacity, setOpacity] = useState({
    tstat: 0.7,
    buildings: 0.8,
    rgbBefore: 1,
    rgbAfter: 1,
    sarBefore: 0.8,
    sarAfter: 0.8,
  });

  // Fetch damage zones
  useEffect(() => {
    if (zonesOverride) {
      setZones(zonesOverride);
      return;
    }
    if (disableLegacyZoneApi || !assessment.id) {
      setZones([]);
      return;
    }

    let cancelled = false;
    listZones(assessment.id)
      .then((items) => {
        if (!cancelled) {
          setZones(items);
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [assessment.id, zonesOverride, disableLegacyZoneApi]);

  // Handle building detection from OSM
  const handleDetectBuildings = useCallback(async () => {
    if (!enableLegacyBuildingDetection) return;
    if (!assessment.id || isDetectingBuildings) return;

    setIsDetectingBuildings(true);
    try {
      const result = await detectBuildings(assessment.id, 40, 150);
      setZones(result.zones);
      // Enable buildings layer if not already
      setLayers(prev => ({ ...prev, buildings: true }));
    } catch (error) {
      console.error('Failed to detect buildings:', error);
    } finally {
      setIsDetectingBuildings(false);
    }
  }, [assessment.id, isDetectingBuildings, enableLegacyBuildingDetection]);

  const toggleLayer = useCallback((layer: string) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer as keyof typeof prev] }));
  }, []);

  const updateOpacity = useCallback((layer: string, value: number) => {
    setOpacity((prev) => ({ ...prev, [layer]: value }));
  }, []);

  const hasAnalysisResults = Boolean(
    assessment.t_stat_tile_url ||
    assessment.before_tile_url ||
    assessment.after_tile_url ||
    assessment.before_sar_tile_url ||
    assessment.after_sar_tile_url
  );
  const center: [number, number] = [assessment.center_lat, assessment.center_lng];
  const bbox = assessment.bbox as [number, number, number, number];

  // No analysis yet - show run analysis prompt
  if (!hasAnalysisResults) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-bp-bg">
        <div className="p-8 max-w-lg text-center bg-bp-card border border-bp-border rounded-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-severity-critical/10 flex items-center justify-center">
            <Satellite size={32} className="text-severity-critical" />
          </div>
          <h3 className="text-xl font-semibold mb-2 text-bp-text">Run Damage Analysis</h3>
          <p className="text-sm mb-6 leading-relaxed text-bp-text-muted">
            Execute PWTT (Pixel-Wise T-Test) analysis using Sentinel-1 SAR imagery.
            This compares pre-event and post-event radar backscatter to detect
            infrastructure damage with statistical confidence.
          </p>

          <div className="rounded-lg p-4 mb-6 text-left bg-bp-surface">
            <div className="text-xs font-medium uppercase mb-3 text-bp-text-muted">Methodology</div>
            <ul className="space-y-2 text-xs text-bp-text-muted">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 bg-bp-primary" />
                Multiple pre/post event SAR images compared
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 bg-bp-primary" />
                Pixel-wise t-statistic calculated for each location
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 bg-bp-primary" />
                T-value &gt;3 indicates significant damage (PWTT threshold)
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 bg-bp-primary" />
                Results validated against building footprints
              </li>
            </ul>
          </div>

          <Button
            fill
            large
            intent={Intent.DANGER}
            loading={isRunningAnalysis}
            icon={isRunningAnalysis ? undefined : <Satellite size={16} />}
            text={isRunningAnalysis ? 'Running Analysis...' : 'Run PWTT Analysis'}
            onClick={onRunAnalysis}
            className="text-sm"
          />
        </div>
      </div>
    );
  }

  // Main analysis view with swipe comparison
  return (
    <div className="h-full flex bg-bp-bg">
      {/* Map Container */}
      <div className="flex-1 relative">
        {viewMode === 'swipe' ? (
          <SwipeComparisonMap
            assessment={assessment}
            swipePosition={swipePosition}
            onSwipePositionChange={setSwipePosition}
            layers={layers}
            opacity={opacity}
            zones={zones}
            bbox={bbox}
            center={center}
            v2BuildingData={hasV2Data ? v2BuildingData : undefined}
          />
        ) : viewMode === 'side-by-side' ? (
          <SideBySideMap
            assessment={assessment}
            layers={layers}
            opacity={opacity}
            zones={zones}
            bbox={bbox}
            center={center}
            v2BuildingData={hasV2Data ? v2BuildingData : undefined}
          />
        ) : (
          <OverlayMap
            assessment={assessment}
            layers={layers}
            opacity={opacity}
            zones={zones}
            bbox={bbox}
            center={center}
            v2BuildingData={hasV2Data ? v2BuildingData : undefined}
          />
        )}

        {/* Viridis Legend */}
        <ViridisLegend showTStat={layers.tstat} />

        {/* Statistics Panel */}
        {viewMode === 'analysis' && (
          <StatsPanel assessment={assessment} zones={zones} />
        )}
      </div>

      {/* Layer Controls */}
      <LayerControls
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        layers={layers}
        onToggleLayer={toggleLayer}
        opacity={opacity}
        onOpacityChange={updateOpacity}
        assessment={assessment}
        onRunAnalysis={onRunAnalysis}
        isRunningAnalysis={isRunningAnalysis}
        onDetectBuildings={handleDetectBuildings}
        isDetectingBuildings={isDetectingBuildings}
        showDetectBuildings={enableLegacyBuildingDetection}
        hasAnalysisResults={hasAnalysisResults}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWIPE COMPARISON MAP
// ═══════════════════════════════════════════════════════════════════════════════

function SwipeComparisonMap({
  assessment,
  swipePosition,
  onSwipePositionChange,
  layers,
  opacity,
  zones,
  bbox,
  center,
  v2BuildingData,
}: {
  assessment: Assessment;
  swipePosition: number;
  onSwipePositionChange: (pos: number) => void;
  layers: Record<string, boolean>;
  opacity: Record<string, number>;
  zones: DamageZone[];
  bbox: [number, number, number, number];
  center: [number, number];
  v2BuildingData?: BuildingDamageFeatureV2[];
}) {
  // Track tile loading status
  const [tileStatus, setTileStatus] = useState<{
    beforeLoaded: boolean;
    afterLoaded: boolean;
    beforeError: boolean;
    afterError: boolean;
  }>({
    beforeLoaded: false,
    afterLoaded: false,
    beforeError: false,
    afterError: false,
  });

  // Get Sentinel imagery URLs - prioritize SAR (source data for PWTT), fallback to RGB
  const beforeUrl = assessment.before_sar_tile_url || assessment.before_tile_url;
  const afterUrl = assessment.after_sar_tile_url || assessment.after_tile_url;
  const tStatUrl = assessment.t_stat_tile_url;

  // Check if Sentinel URLs exist (they may have expired)
  const hasSentinelBefore = !!beforeUrl;
  const hasSentinelAfter = !!afterUrl;

  // High-res satellite base URL (always available as fallback)
  const baseImageryUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  // Decide which URL to actually use for each side
  // If Sentinel URL exists but has errors, fall back to base
  const leftUrl = (hasSentinelBefore && !tileStatus.beforeError) ? beforeUrl! : baseImageryUrl;
  const rightUrl = (hasSentinelAfter && !tileStatus.afterError) ? afterUrl! : baseImageryUrl;

  // Track if we're actually using Sentinel (not base) AND it's working
  const usingSentinelBefore = hasSentinelBefore && !tileStatus.beforeError;
  const usingSentinelAfter = hasSentinelAfter && !tileStatus.afterError;

  // Format dates for labels - show if using SAR/Sentinel or base imagery
  const beforeLabel = usingSentinelBefore
    ? (assessment.baseline_end
        ? `Pre Destruction (${new Date(assessment.baseline_end).toLocaleDateString()})`
        : 'Pre Destruction')
    : 'Base Satellite';
  const afterLabel = usingSentinelAfter
    ? (assessment.post_event_start
        ? `Post Destruction (${new Date(assessment.post_event_start).toLocaleDateString()})`
        : 'Post Destruction')
    : 'Base Satellite';

  // Tile error/success handlers
  const handleTileError = useCallback((side: 'left' | 'right') => {
    console.warn(`[SwipeMap] ${side} tiles failed to load - likely expired GEE URLs`);
    setTileStatus(prev => ({
      ...prev,
      [side === 'left' ? 'beforeError' : 'afterError']: true,
    }));
  }, []);

  const handleTileSuccess = useCallback((side: 'left' | 'right') => {
    setTileStatus(prev => ({
      ...prev,
      [side === 'left' ? 'beforeLoaded' : 'afterLoaded']: true,
    }));
  }, []);

  // Log current status for debugging
  useEffect(() => {
    console.log('[SwipeMap] URLs status:', {
      beforeUrl: beforeUrl?.slice(0, 60) + '...',
      afterUrl: afterUrl?.slice(0, 60) + '...',
      hasSentinelBefore,
      hasSentinelAfter,
      tileStatus,
    });
  }, [beforeUrl, afterUrl, hasSentinelBefore, hasSentinelAfter, tileStatus]);

  // Determine status message
  const getStatusMessage = () => {
    if (usingSentinelBefore && usingSentinelAfter) {
      return { color: 'text-bp-success', dot: '●', message: 'Sentinel imagery loaded - Swipe to compare before/after' };
    }
    if (!hasSentinelBefore && !hasSentinelAfter) {
      return { color: 'text-severity-high', dot: '●', message: 'No Sentinel URLs - Click "Re-run Analysis" to generate' };
    }
    if (tileStatus.beforeError || tileStatus.afterError) {
      return { color: 'text-severity-high', dot: '●', message: 'GEE tiles expired - Click "Re-run Analysis" to refresh' };
    }
    return { color: 'text-bp-primary', dot: '○', message: 'Loading Sentinel tiles...' };
  };

  const status = getStatusMessage();

  return (
    <div className="h-full relative">
      <MapContainer
        center={center}
        zoom={16}
        className="h-full w-full"
        style={{ background: '#1a1a2e' }}
        zoomControl={false}
      >
        <FitBounds bbox={bbox} />

        {/*
          SWIPE COMPARISON ARCHITECTURE:
          - LEFT side: Shows "before" imagery (baseline) - clipped from right edge inward
          - RIGHT side: Shows "after" imagery (post-event) - clipped from left edge inward
          - Each side uses Sentinel imagery if available and working, else falls back to base satellite
          - The swipe divider position determines the clip boundary
        */}

        {/* LEFT SIDE (BEFORE): Full layer clipped to show only left portion */}
        <ClippedTileLayer
          url={leftUrl}
          clipPosition={swipePosition}
          side="left"
          opacity={1}
          zIndex={100}
          onLoadError={handleTileError}
          onLoadSuccess={handleTileSuccess}
        />

        {/* RIGHT SIDE (AFTER): Full layer clipped to show only right portion */}
        <ClippedTileLayer
          url={rightUrl}
          clipPosition={swipePosition}
          side="right"
          opacity={1}
          zIndex={101}
          onLoadError={handleTileError}
          onLoadSuccess={handleTileSuccess}
        />

        {/* T-Statistic heatmap overlay (right side only - shows change magnitude) */}
        {layers.tstat && tStatUrl && (
          <ClippedTileLayer
            url={tStatUrl}
            clipPosition={swipePosition}
            side="right"
            opacity={opacity.tstat}
            zIndex={200}
          />
        )}

        {/* Building footprints (show on both sides) */}
        {layers.buildings && (zones.length > 0 || (v2BuildingData && v2BuildingData.length > 0)) && (
          <BuildingFootprints zones={zones} opacity={opacity.buildings} v2Data={v2BuildingData} />
        )}
      </MapContainer>

      {/* Swipe Control with dynamic labels */}
      <SwipeControl
        position={swipePosition}
        onPositionChange={onSwipePositionChange}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
      />

      {/* Info banner showing what imagery is being used */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-bp-bg/80 backdrop-blur-sm rounded-lg text-bp-text text-xs font-medium flex items-center gap-2">
        <span className={status.color}>{status.dot}</span>
        <span>{status.message}</span>
      </div>

      {/* Show indicator if both sides are using the same base imagery */}
      {!usingSentinelBefore && !usingSentinelAfter && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-severity-critical/90 backdrop-blur-sm rounded-lg text-bp-text text-xs font-medium">
          Both sides showing same base imagery - Run analysis for before/after comparison
        </div>
      )}

      {/* Map Controls */}
      <MapControls />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDE BY SIDE MAP
// ═══════════════════════════════════════════════════════════════════════════════

function SideBySideMap({
  assessment,
  layers,
  opacity,
  zones,
  bbox,
  center,
  v2BuildingData,
}: {
  assessment: Assessment;
  layers: Record<string, boolean>;
  opacity: Record<string, number>;
  zones: DamageZone[];
  bbox: [number, number, number, number];
  center: [number, number];
  v2BuildingData?: BuildingDamageFeatureV2[];
}) {
  // Prioritize SAR (source data for PWTT analysis) over RGB
  const beforeUrl = assessment.before_sar_tile_url || assessment.before_tile_url;
  const afterUrl = assessment.after_sar_tile_url || assessment.after_tile_url;

  return (
    <div className="h-full flex">
      {/* Before Map */}
      <div className="flex-1 relative border-r border-bp-border">
        <div className="absolute top-4 left-4 z-[1000] px-3 py-1.5 bg-bp-bg/80 backdrop-blur-sm rounded-lg text-bp-text text-sm font-medium">
          Pre Destruction
        </div>
        <MapContainer
          center={center}
          zoom={13}
          className="h-full w-full"
          style={{ background: '#0c0c0e' }}
          zoomControl={false}
        >
          <FitBounds bbox={bbox} />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Esri"
            maxZoom={18}
          />
          {beforeUrl && <SatelliteTileLayer url={beforeUrl} opacity={1} />}
        </MapContainer>
      </div>

      {/* After Map */}
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 z-[1000] px-3 py-1.5 bg-bp-bg/80 backdrop-blur-sm rounded-lg text-bp-text text-sm font-medium">
          PWTT Analysis
        </div>

        <MapContainer
          center={center}
          zoom={13}
          className="h-full w-full"
          style={{ background: '#0c0c0e' }}
          zoomControl={false}
        >
          <FitBounds bbox={bbox} />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Esri"
            maxZoom={18}
          />
          {afterUrl && <SatelliteTileLayer url={afterUrl} opacity={1} />}
          {/* T-Statistic heatmap - raw statistical values */}
          {layers.tstat && assessment.t_stat_tile_url && (
            <SatelliteTileLayer url={assessment.t_stat_tile_url} opacity={opacity.tstat} />
          )}
          {/* Building footprints */}
          {layers.buildings && (zones.length > 0 || (v2BuildingData && v2BuildingData.length > 0)) && (
            <BuildingFootprints zones={zones} opacity={opacity.buildings} v2Data={v2BuildingData} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERLAY MAP (ANALYSIS VIEW)
// ═══════════════════════════════════════════════════════════════════════════════

function OverlayMap({
  assessment,
  layers,
  opacity,
  zones,
  bbox,
  center,
  v2BuildingData,
}: {
  assessment: Assessment;
  layers: Record<string, boolean>;
  opacity: Record<string, number>;
  zones: DamageZone[];
  bbox: [number, number, number, number];
  center: [number, number];
  v2BuildingData?: BuildingDamageFeatureV2[];
}) {
  return (
    <div className="h-full relative">
      <MapContainer
        center={center}
        zoom={13}
        className="h-full w-full"
        style={{ background: '#0c0c0e' }}
        zoomControl={false}
      >
        <FitBounds bbox={bbox} />

        {/* Satellite base */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Esri, Maxar"
          maxZoom={18}
        />

        {/* RGB layers */}
        {layers.rgbBefore && assessment.before_tile_url && (
          <SatelliteTileLayer url={assessment.before_tile_url} opacity={opacity.rgbBefore} />
        )}
        {layers.rgbAfter && assessment.after_tile_url && (
          <SatelliteTileLayer url={assessment.after_tile_url} opacity={opacity.rgbAfter} />
        )}

        {/* SAR layers */}
        {layers.sarBefore && assessment.before_sar_tile_url && (
          <SatelliteTileLayer url={assessment.before_sar_tile_url} opacity={opacity.sarBefore} />
        )}
        {layers.sarAfter && assessment.after_sar_tile_url && (
          <SatelliteTileLayer url={assessment.after_sar_tile_url} opacity={opacity.sarAfter} />
        )}

        {/* T-Statistic heatmap - raw PWTT statistical values */}
        {layers.tstat && assessment.t_stat_tile_url && (
          <SatelliteTileLayer url={assessment.t_stat_tile_url} opacity={opacity.tstat} />
        )}

        {/* Building footprints */}
        {layers.buildings && (zones.length > 0 || (v2BuildingData && v2BuildingData.length > 0)) && (
          <BuildingFootprints zones={zones} opacity={opacity.buildings} v2Data={v2BuildingData} />
        )}
      </MapContainer>

      <MapControls />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDING FOOTPRINTS LAYER
// ═══════════════════════════════════════════════════════════════════════════════

function BuildingFootprints({ zones, opacity, v2Data }: { zones: DamageZone[]; opacity: number; v2Data?: BuildingDamageFeatureV2[] }) {
  const useV2 = !!(v2Data && v2Data.length > 0);

  // Build GeoJSON — v2 features directly when available, else zones
  const geojsonData = useMemo(() => {
    if (useV2) {
      // v2 features already have proper Google Open Buildings polygon geometry
      return {
        type: 'FeatureCollection' as const,
        features: v2Data!.map((f) => ({
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: { ...f.properties, _v2: true },
        })),
      };
    }

    return {
      type: 'FeatureCollection' as const,
      features: zones.map((zone) => ({
        type: 'Feature' as const,
        properties: {
          id: zone.id,
          zone_name: zone.zone_name,
          zone_type: zone.zone_type,
          building_type: zone.building_type,
          severity: zone.severity,
          damage_percentage: zone.damage_percentage,
          confidence: zone.confidence,
          area_km2: zone.area_km2,
        },
        geometry: zone.geometry || {
          type: 'Polygon' as const,
          coordinates: [[
            [zone.centroid_lng - 0.0003, zone.centroid_lat - 0.0002],
            [zone.centroid_lng + 0.0003, zone.centroid_lat - 0.0002],
            [zone.centroid_lng + 0.0003, zone.centroid_lat + 0.0002],
            [zone.centroid_lng - 0.0003, zone.centroid_lat + 0.0002],
            [zone.centroid_lng - 0.0003, zone.centroid_lat - 0.0002],
          ]],
        },
      })),
    };
  }, [zones, v2Data, useV2]);

  const getColor = (severity: string) => SEVERITY_COLORS[severity] || '#6b7280';

  return (
    <GeoJSON
      key={useV2 ? `v2-${v2Data!.length}` : zones.map(z => z.id).join('-')}
      data={geojsonData}
      style={(feature) => {
        const severity = feature?.properties?.severity || 'moderate';
        const color = getColor(severity);
        const isCritical = severity === 'critical' || severity === 'severe';

        if (feature?.properties?._v2) {
          // v2: confidence-based border styling
          const conf = feature.properties.confidence ?? 0;
          let borderColor = 'rgba(156,163,175,0.6)';
          let borderDash = '2,4';
          let borderWeight = 1;
          if (conf >= 0.7) {
            borderColor = 'rgba(255,255,255,0.9)';
            borderDash = '0';
            borderWeight = 2;
          } else if (conf >= 0.4) {
            borderColor = 'rgba(255,255,255,0.7)';
            borderDash = '5,4';
            borderWeight = 1.5;
          }
          return {
            color: borderColor,
            weight: borderWeight,
            opacity,
            fillColor: color,
            fillOpacity: severity === 'undamaged' ? opacity * 0.15 : (isCritical ? opacity * 0.8 : opacity * 0.5),
            dashArray: borderDash,
          };
        }

        // v1 style
        return {
          color: 'rgba(255,255,255,0.6)',
          weight: 1.5,
          opacity,
          fillColor: color,
          fillOpacity: isCritical ? opacity * 0.8 : opacity * 0.5,
          dashArray: isCritical ? '0' : '3,2',
        };
      }}
      onEachFeature={(feature, layer) => {
        if (feature?.properties?._v2) {
          // v2 popup directly — feature has all BuildingDamageFeatureV2 properties
          const v2Feature = { type: 'Feature' as const, geometry: feature.geometry, properties: feature.properties } as unknown as BuildingDamageFeatureV2;
          layer.bindPopup(buildingPopupV2Html(v2Feature), { maxWidth: 300 });
        } else {
          // v1 popup from zone properties
          const { zone_name, building_type, severity, damage_percentage, confidence, area_km2 } = feature.properties;
          const severityColor = getColor(severity);
          layer.bindPopup(`
            <div style="font-family: system-ui; font-size: 12px; min-width: 180px;">
              <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #1a1a1a;">${zone_name || 'Damage Zone'}</div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 2px; background: ${severityColor};"></span>
                <span style="text-transform: capitalize; font-weight: 500; color: ${severityColor};">${severity} Damage</span>
              </div>
              <div style="color: #666; line-height: 1.6;">
                ${building_type ? `<div><strong>Type:</strong> ${building_type}</div>` : ''}
                <div><strong>Damage:</strong> ${(damage_percentage || 0).toFixed(1)}%</div>
                <div><strong>Confidence:</strong> ${((confidence || 0) * 100).toFixed(0)}%</div>
                <div><strong>Area:</strong> ${((area_km2 || 0) * 1000000).toFixed(0)} m²</div>
              </div>
            </div>
          `);
        }

        // Highlight on hover
        layer.on('mouseover', function() {
          (layer as L.Path).setStyle({
            weight: 3,
            color: '#ffffff',
            fillOpacity: opacity * 0.9,
          });
        });
        layer.on('mouseout', function() {
          const sev = feature?.properties?.severity || 'moderate';
          const isCrit = sev === 'critical' || sev === 'severe';
          (layer as L.Path).setStyle({
            weight: 1.5,
            color: 'rgba(255,255,255,0.6)',
            fillOpacity: isCrit ? opacity * 0.8 : opacity * 0.5,
          });
        });
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAP CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════

function MapControls() {
  return (
    <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
      <button className="p-2 rounded-lg transition-colors bg-bp-bg/90 backdrop-blur-md border border-bp-border text-bp-text-muted hover:text-bp-text hover:bg-bp-hover">
        <ZoomIn size={18} />
      </button>
      <button className="p-2 rounded-lg transition-colors bg-bp-bg/90 backdrop-blur-md border border-bp-border text-bp-text-muted hover:text-bp-text hover:bg-bp-hover">
        <ZoomOut size={18} />
      </button>
      <button className="p-2 rounded-lg transition-colors bg-bp-bg/90 backdrop-blur-md border border-bp-border text-bp-text-muted hover:text-bp-text hover:bg-bp-hover">
        <Maximize2 size={18} />
      </button>
    </div>
  );
}
