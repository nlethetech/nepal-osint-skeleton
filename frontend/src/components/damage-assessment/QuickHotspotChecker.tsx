/**
 * Quick Hotspot Checker - Draw on Map & Analyze
 *
 * Allows analysts to:
 * 1. Click anywhere on the map to place a circle
 * 2. Adjust circle radius with a slider
 * 3. Set an event date
 * 4. Run instant PWTT damage analysis
 *
 * This is for quick exploration without creating a full assessment.
 */

import { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Circle, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Crosshair,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  X,
  Target,
  Ruler,
  Play,
  RotateCcw,
} from 'lucide-react';
import { Button, Intent, Spinner, Switch, Tag } from '@blueprintjs/core';
import type { QuickAnalyzeResult } from '../../api/damageAssessment';
import { quickAnalyzeV2, type QuickAnalyzeV2Result } from '../../api/damageAssessmentV2';
import { ThreePanelView } from './ThreePanelView';

import 'leaflet/dist/leaflet.css';

interface QuickHotspotCheckerProps {
  onClose: () => void;
  initialCenter?: [number, number];
  onAnalysisComplete?: (payload: {
    center_lat: number;
    center_lng: number;
    radius_km: number;
    event_date: string;
    result: QuickAnalyzeResult;
    v2Result?: QuickAnalyzeV2Result;
  }) => void;
}

// Default to Kathmandu center
const DEFAULT_CENTER: [number, number] = [27.7172, 85.324];
const DEFAULT_RADIUS = 0.5; // km

// Map click handler component
function MapClickHandler({
  onMapClick,
  isActive,
}: {
  onMapClick: (lat: number, lng: number) => void;
  isActive: boolean;
}) {
  useMapEvents({
    click(e) {
      if (isActive) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

// Fit to circle bounds
function FitToCircle({ center, radius }: { center: [number, number]; radius: number }) {
  const map = useMap();

  useEffect(() => {
    if (center && radius > 0) {
      // Create bounds from circle
      const latOffset = radius / 111;
      const lngOffset = radius / (111 * Math.cos((center[0] * Math.PI) / 180));

      const bounds = L.latLngBounds(
        [center[0] - latOffset * 1.5, center[1] - lngOffset * 1.5],
        [center[0] + latOffset * 1.5, center[1] + lngOffset * 1.5]
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, center, radius]);

  return null;
}

export function QuickHotspotChecker({ onClose, initialCenter, onAnalysisComplete }: QuickHotspotCheckerProps) {
  // State
  const [center, setCenter] = useState<[number, number] | null>(initialCenter || null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [eventDate, setEventDate] = useState(() => {
    // Default to 30 days ago
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [isDrawMode, setIsDrawMode] = useState(!initialCenter);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<QuickAnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enableTerrainFlattening, setEnableTerrainFlattening] = useState(true);
  const [enableOptical, setEnableOptical] = useState(true);
  const [v2Result, setV2Result] = useState<QuickAnalyzeV2Result | null>(null);

  // Handle map click
  const handleMapClick = useCallback((lat: number, lng: number) => {
    setCenter([lat, lng]);
    setIsDrawMode(false);
    setResult(null);
    setError(null);
  }, []);

  // Reset selection
  const handleReset = useCallback(() => {
    setCenter(null);
    setIsDrawMode(true);
    setResult(null);
    setError(null);
  }, []);

  // Run analysis
  const handleAnalyze = useCallback(async () => {
    if (!center) return;

    setIsAnalyzing(true);
    setError(null);
    setV2Result(null);

    try {
      const v2AnalysisResult = await quickAnalyzeV2({
        center_lat: center[0],
        center_lng: center[1],
        radius_km: radius,
        event_date: eventDate,
        baseline_days: 365,
        post_event_days: 60,
        enable_terrain_flattening: enableTerrainFlattening,
        enable_optical: enableOptical,
      });

      setResult(v2AnalysisResult);
      setV2Result(v2AnalysisResult);
      onAnalysisComplete?.({
        center_lat: center[0],
        center_lng: center[1],
        radius_km: radius,
        event_date: eventDate,
        result: v2AnalysisResult,
        v2Result: v2AnalysisResult,
      });

      if (v2AnalysisResult.error) {
        setError(v2AnalysisResult.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  }, [center, radius, eventDate, enableTerrainFlattening, enableOptical]);

  return (
    <div className="fixed inset-0 z-[2000] bg-bp-bg/50 flex items-center justify-center p-4">
      <div className="rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden bg-bp-bg border border-bp-border">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-bp-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-bp-primary/20">
              <Target size={20} className="text-bp-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-bp-text">Quick Hotspot Checker</h2>
              <p className="text-xs text-bp-text-muted">Click on map to analyze any location instantly</p>
            </div>
          </div>
          <Button
            minimal
            icon={<X size={18} />}
            onClick={onClose}
            className="text-bp-text-muted"
          />
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Map */}
          <div className="flex-1 relative">
            {/* Draw Mode Indicator */}
            {isDrawMode && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 backdrop-blur-sm rounded-lg text-sm font-medium flex items-center gap-2 bg-bp-primary/90 text-bp-text">
                <Crosshair size={16} className="animate-pulse" />
                Click anywhere on the map to place analysis circle
              </div>
            )}

            <MapContainer
              center={center || DEFAULT_CENTER}
              zoom={center ? 14 : 12}
              className="h-full w-full"
              style={{ background: '#0c0c0e', cursor: isDrawMode ? 'crosshair' : 'grab' }}
              zoomControl={false}
            >
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="Esri"
                maxZoom={18}
              />

              {/* Click handler */}
              <MapClickHandler onMapClick={handleMapClick} isActive={isDrawMode} />

              {/* Analysis circle */}
              {center && (
                <>
                  <Circle
                    center={center}
                    radius={radius * 1000} // km to meters
                    pathOptions={{
                      color: result
                        ? result.damage_percentage > 10
                          ? '#ef4444'
                          : '#22c55e'
                        : '#06b6d4',
                      fillColor: result
                        ? result.damage_percentage > 10
                          ? '#ef4444'
                          : '#22c55e'
                        : '#06b6d4',
                      fillOpacity: 0.2,
                      weight: 2,
                    }}
                  />
                  <FitToCircle center={center} radius={radius} />
                </>
              )}

              {/* Result damage tiles */}
              {result?.damage_tile_url && (
                <TileLayer
                  url={result.damage_tile_url}
                  opacity={0.7}
                  maxZoom={18}
                />
              )}
            </MapContainer>
          </div>

          {/* Control Panel */}
          <div className="w-80 flex flex-col overflow-hidden border-l border-bp-border">
            {/* Controls */}
            <div className="p-4 space-y-4 border-b border-bp-border">
              {/* Location */}
              <div>
                <label className="text-xs font-medium uppercase tracking-wide block mb-2 text-bp-text-muted">
                  Location
                </label>
                {center ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2 bg-bp-surface">
                    <span className="text-sm text-bp-text">
                      {center[0].toFixed(5)}, {center[1].toFixed(5)}
                    </span>
                    <button
                      onClick={handleReset}
                      className="p-1 transition-colors text-bp-text-muted hover:text-bp-text"
                      title="Reset location"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg px-3 py-2 text-sm text-center bg-bp-surface text-bp-text-muted">
                    Click on map to select
                  </div>
                )}
              </div>

              {/* Radius Slider */}
              <div>
                <label className="text-xs font-medium uppercase tracking-wide flex items-center gap-2 mb-2 text-bp-text-muted">
                  <Ruler size={12} />
                  Radius: {radius.toFixed(1)} km
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer accent-bp-primary bg-bp-surface"
                />
                <div className="flex justify-between text-[10px] mt-1 text-bp-text-muted">
                  <span>100m</span>
                  <span>5km</span>
                </div>
              </div>

              {/* Event Date */}
              <div>
                <label className="text-xs font-medium uppercase tracking-wide flex items-center gap-2 mb-2 text-bp-text-muted">
                  <Calendar size={12} />
                  Event Date
                </label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-bp-primary/50 bg-bp-surface border border-bp-border text-bp-text"
                />
              </div>

              {/* Analysis Options */}
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-bp-text-muted">Options</div>
                <Switch
                  checked={enableTerrainFlattening}
                  onChange={(e) => setEnableTerrainFlattening((e.target as HTMLInputElement).checked)}
                  label="Terrain Flattening"
                  className="text-bp-text-muted text-xs !mb-0"
                />
                <Switch
                  checked={enableOptical}
                  onChange={(e) => setEnableOptical((e.target as HTMLInputElement).checked)}
                  label="Optical Corroboration"
                  className="text-bp-text-muted text-xs !mb-0"
                />
              </div>

              {/* Analyze Button */}
              <Button
                intent={Intent.PRIMARY}
                fill
                loading={isAnalyzing}
                disabled={!center}
                icon={isAnalyzing ? undefined : <Play size={14} />}
                text={isAnalyzing ? 'Analyzing...' : 'Analyze Hotspot'}
                onClick={handleAnalyze}
                className="text-xs"
              />
            </div>

            {/* Results Panel */}
            <div className="flex-1 overflow-y-auto p-4">
              {error && (
                <div className="mb-4 p-3 bg-severity-critical/10 border border-severity-critical/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-severity-critical flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-severity-critical">{error}</div>
                  </div>
                </div>
              )}

              {result && !result.error && (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="rounded-lg p-4 bg-bp-surface">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 size={16} className="text-bp-success" />
                      <span className="text-sm font-medium text-bp-text">Analysis Complete</span>
                      {v2Result && (
                        <Tag minimal intent={Intent.PRIMARY} className="text-[10px] ml-auto">
                          v2 {v2Result.terrain_flattened ? '+ TF' : ''}
                        </Tag>
                      )}
                    </div>

                    {/* Damage Percentage */}
                    <div className="text-center mb-4">
                      <div
                        className={`text-4xl font-bold ${
                          result.damage_percentage > 20
                            ? 'text-severity-critical'
                            : result.damage_percentage > 10
                            ? 'text-severity-high'
                            : 'text-bp-success'
                        }`}
                      >
                        {result.damage_percentage.toFixed(1)}%
                      </div>
                      <div className="text-xs text-bp-text-muted">Damage Detected</div>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2 rounded-full overflow-hidden mb-4 bg-bp-bg">
                      <div
                        className={`h-full rounded-full transition-all ${
                          result.damage_percentage > 20
                            ? 'bg-severity-critical'
                            : result.damage_percentage > 10
                            ? 'bg-severity-high'
                            : 'bg-bp-success'
                        }`}
                        style={{ width: `${Math.min(result.damage_percentage, 100)}%` }}
                      />
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-bp-text-muted">Total Area</div>
                        <div className="font-medium text-bp-text">
                          {result.total_area_km2.toFixed(3)} km²
                        </div>
                      </div>
                      <div>
                        <div className="text-bp-text-muted">Damaged Area</div>
                        <div className="text-severity-critical font-medium">
                          {result.damaged_area_km2.toFixed(4)} km²
                        </div>
                      </div>
                      <div>
                        <div className="text-bp-text-muted">Confidence</div>
                        <div className="font-medium text-bp-text">
                          {(result.confidence_score * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-bp-text-muted">SAR Images</div>
                        <div className="font-medium text-bp-text">
                          {result.baseline_images_count} + {result.post_images_count}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Severity Breakdown */}
                  <div className="rounded-lg p-4 bg-bp-surface">
                    <div className="text-xs font-medium uppercase tracking-wide mb-3 text-bp-text-muted">
                      Severity Breakdown
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: 'Critical', value: result.critical_area_km2, color: 'bg-severity-critical' },
                        { label: 'Severe', value: result.severe_area_km2, color: 'bg-severity-high' },
                        { label: 'Moderate', value: result.moderate_area_km2, color: 'bg-severity-medium' },
                        { label: 'Minor', value: result.minor_area_km2, color: 'bg-severity-low' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${item.color}`} />
                          <span className="text-xs flex-1 text-bp-text-muted">{item.label}</span>
                          <span className="text-xs font-mono text-bp-text">
                            {(item.value * 1000000).toFixed(0)} m²
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* v2 Building Stats */}
                  {v2Result?.building_damage_v2 && v2Result.building_damage_v2.length > 0 && (
                    <div className="rounded-lg p-4 bg-bp-surface">
                      <div className="text-xs font-medium uppercase tracking-wide mb-3 text-bp-text-muted">
                        Building Analysis (v2)
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-bp-text-muted">Total Buildings</div>
                          <div className="font-medium text-bp-text">{v2Result.building_damage_v2.length}</div>
                        </div>
                        <div>
                          <div className="text-bp-text-muted">Damaged</div>
                          <div className="text-severity-critical font-medium">
                            {v2Result.building_damage_v2.filter(b => b.properties.severity !== 'undamaged').length}
                          </div>
                        </div>
                        <div>
                          <div className="text-bp-text-muted">Critical</div>
                          <div className="text-severity-medium font-medium">
                            {v2Result.building_damage_v2.filter(b => b.properties.severity === 'critical').length}
                          </div>
                        </div>
                        <div>
                          <div className="text-bp-text-muted">Terrain Flat.</div>
                          <div className="font-medium text-bp-text">{v2Result.terrain_flattened ? 'Yes' : 'No'}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3-Panel Satellite Comparison */}
                  {center && (
                    <div className="rounded-lg p-4 bg-bp-surface">
                      <div className="text-xs font-medium uppercase tracking-wide mb-3 text-bp-text-muted">
                        Satellite Comparison
                      </div>
                      <ThreePanelView
                        centerLat={center[0]}
                        centerLng={center[1]}
                        radiusKm={radius}
                        eventDate={eventDate}
                        baselineDays={365}
                        postEventDays={60}
                        beforeTileUrl={result.before_tile_url}
                        afterTileUrl={result.after_tile_url}
                        pwttTileUrl={result.t_stat_tile_url}
                        bbox={result.bbox}
                      />
                    </div>
                  )}

                  {/* Create Full Assessment Button */}
                  <Button
                    fill
                    outlined
                    text="Create Full Assessment"
                    onClick={() => {
                      // TODO: Create full assessment from quick analysis
                      alert(
                        `Would create assessment at ${center?.[0].toFixed(5)}, ${center?.[1].toFixed(5)}`
                      );
                    }}
                    className="text-bp-text text-xs"
                  />
                </div>
              )}

              {/* Empty State */}
              {!result && !error && !isAnalyzing && (
                <div className="text-center py-8">
                  <Target size={48} className="mx-auto mb-3 text-bp-border" />
                  <div className="text-sm mb-1 text-bp-text-muted">No Analysis Yet</div>
                  <div className="text-xs text-bp-text-muted">
                    {center
                      ? 'Click "Analyze Hotspot" to run damage detection'
                      : 'Click on the map to select a location'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
