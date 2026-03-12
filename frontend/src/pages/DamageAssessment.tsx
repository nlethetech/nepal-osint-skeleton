import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Map,
  Clock,
  Building2,
  FileSearch,
  Package,
  TreePine,
  Users,
  Bell,
  Search,
  Plus,
  AlertTriangle,
  Satellite,
  Target,
} from 'lucide-react';
import { Button, HTMLSelect, Tag, Intent, Spinner, Tabs, Tab } from '@blueprintjs/core';
import { AnalystShell } from '../components/layout/AnalystShell';

import {
  createPwttRun,
  getPwttFindings,
  getPwttRun,
  getPwttRuns,
  getPwttThreePanel,
  getPwttArtifactDisplayUrl,
  type PwttArtifact,
  type PwttFinding,
  type PwttRunDetail,
} from '../api/connectedAnalyst';
import {
  getThreePanelImageUrl,
  type Assessment,
  type AssessmentStats,
  type BuildingDamageFeature,
  type QuickAnalyzeResult,
} from '../api/damageAssessment';
import type { QuickAnalyzeV2Result, BuildingDamageFeatureV2 } from '../api/damageAssessmentV2';
import { OverviewTab } from '../components/damage-assessment/tabs/OverviewTab';
import { SpatialTab } from '../components/damage-assessment/tabs/SpatialTab';
import { PwttEvidenceTab } from '../components/damage-assessment/tabs/PwttEvidenceTab';
import { QuickHotspotChecker } from '../components/damage-assessment/QuickHotspotChecker';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Key metrics and findings' },
  { id: 'spatial', label: 'Spatial Analysis', icon: Map, description: 'PWTT and Sentinel analysis' },
  { id: 'timeline', label: 'Timeline', icon: Clock, description: 'Temporal progression' },
  { id: 'infrastructure', label: 'Infrastructure', icon: Building2, description: 'Roads, bridges, utilities' },
  { id: 'evidence', label: 'Evidence', icon: FileSearch, description: 'Source provenance' },
  { id: 'resources', label: 'Resources', icon: Package, description: 'Aid allocation' },
  { id: 'environmental', label: 'Environmental', icon: TreePine, description: 'Secondary effects' },
  { id: 'community', label: 'Community', icon: Users, description: 'Population impact' },
  { id: 'alerts', label: 'Alerts', icon: Bell, description: 'Real-time notifications' },
  { id: 'query', label: 'Query Builder', icon: Search, description: 'Custom analysis' },
] as const;

type TabId = (typeof TABS)[number]['id'];

type ZoneLite = {
  id: string;
  zone_name?: string;
  severity: 'critical' | 'severe' | 'moderate' | 'minor' | 'safe';
  damage_percentage: number;
  area_km2: number;
  centroid_lat: number;
  centroid_lng: number;
  confidence: number;
  zone_type: string;
  satellite_detected: boolean;
  ground_verified: boolean;
  created_at: string;
  geometry?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
};

type AssessmentView = Assessment & { zones: ZoneLite[] };

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toAoiGeojsonFromBbox(bbox: [number, number, number, number]) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return {
    type: 'Polygon',
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]],
  };
}

function severityFromDamage(damagePct: number): 'critical' | 'high' | 'moderate' | 'low' {
  if (damagePct >= 35) return 'critical';
  if (damagePct >= 20) return 'high';
  if (damagePct >= 10) return 'moderate';
  return 'low';
}

function normalizeFindingSeverity(rawSeverity: string): ZoneLite['severity'] {
  const normalized = (rawSeverity || '').toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'severe' || normalized === 'high') return 'severe';
  if (normalized === 'moderate') return 'moderate';
  if (normalized === 'minor' || normalized === 'low') return 'minor';
  return 'safe';
}

function extractBboxFromGeojson(geojson: Record<string, unknown> | null | undefined): [number, number, number, number] | null {
  if (!geojson) return null;
  const type = asString(geojson.type);
  const rawCoords = geojson.coordinates;
  if (!Array.isArray(rawCoords)) return null;

  const points: Array<[number, number]> = [];
  const pushPoint = (item: unknown) => {
    if (Array.isArray(item) && item.length >= 2) {
      const lng = asNumber(item[0], Number.NaN);
      const lat = asNumber(item[1], Number.NaN);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        points.push([lng, lat]);
      }
    }
  };

  if (type === 'Polygon') {
    rawCoords.forEach((ring) => {
      if (Array.isArray(ring)) ring.forEach(pushPoint);
    });
  } else if (type === 'MultiPolygon') {
    rawCoords.forEach((poly) => {
      if (!Array.isArray(poly)) return;
      poly.forEach((ring) => {
        if (Array.isArray(ring)) ring.forEach(pushPoint);
      });
    });
  }

  if (points.length === 0) return null;
  const lngs = points.map((item) => item[0]);
  const lats = points.map((item) => item[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function bboxFromCenterRadius(centerLat: number, centerLng: number, radiusKm: number): [number, number, number, number] {
  const safeRadius = Math.max(radiusKm, 0.1);
  const latOffset = safeRadius / 111;
  const lngOffset = safeRadius / Math.max(1, 111 * Math.cos((centerLat * Math.PI) / 180));
  return [centerLng - lngOffset, centerLat - latOffset, centerLng + lngOffset, centerLat + latOffset];
}

function artifactTypeMatches(artifactType: string, candidates: string[]): boolean {
  const normalized = artifactType.trim().toLowerCase();
  return candidates.some((candidate) => normalized === candidate || normalized.includes(candidate));
}

function pickArtifactUrl(runId: string, artifacts: PwttArtifact[], candidates: string[]): string | undefined {
  const match = artifacts.find((artifact) => artifactTypeMatches(artifact.artifact_type, candidates));
  return match ? getPwttArtifactDisplayUrl(runId, match) : undefined;
}

function deriveZones(findings: PwttFinding[], fallbackCenter: [number, number]): ZoneLite[] {
  return findings.map((finding) => {
    const metrics = asRecord(finding.metrics);
    const geometry = (finding.geometry || null) as ZoneLite['geometry'] | null;
    let centroidLat = fallbackCenter[0];
    let centroidLng = fallbackCenter[1];

    if (geometry && geometry.type === 'Polygon' && Array.isArray(geometry.coordinates[0])) {
      const ring = geometry.coordinates[0] as number[][];
      if (ring.length > 0) {
        const latSum = ring.reduce((acc, point) => acc + asNumber(point[1]), 0);
        const lngSum = ring.reduce((acc, point) => acc + asNumber(point[0]), 0);
        centroidLat = latSum / ring.length;
        centroidLng = lngSum / ring.length;
      }
    }

    return {
      id: finding.id,
      zone_name: finding.title || finding.finding_type,
      severity: normalizeFindingSeverity(finding.severity),
      damage_percentage: asNumber(metrics.damage_percentage, asNumber(metrics.avg_damage_percentage, finding.confidence * 100)),
      area_km2: asNumber(metrics.area_km2, asNumber(metrics.damaged_area_km2, 0)),
      centroid_lat: centroidLat,
      centroid_lng: centroidLng,
      confidence: finding.confidence,
      zone_type: finding.finding_type || 'damage_signal',
      satellite_detected: true,
      ground_verified: false,
      created_at: new Date().toISOString(),
      geometry: geometry || undefined,
    };
  });
}

function buildAssessmentView(
  run: PwttRunDetail | undefined,
  findings: PwttFinding[],
  threePanelArtifacts: PwttArtifact[],
): AssessmentView | null {
  if (!run) return null;

  const runParams = asRecord(run.run_params);
  const summary = asRecord(run.summary);
  const artifacts = [...(run.artifacts || []), ...threePanelArtifacts].filter(
    (artifact, idx, all) => all.findIndex((item) => item.id === artifact.id) === idx,
  );

  const centerLat = asNumber(runParams.center_lat, 27.7172);
  const centerLng = asNumber(runParams.center_lng, 85.324);
  const radiusKm = asNumber(runParams.radius_km, 1.0);
  const aoiBbox = extractBboxFromGeojson((run.aoi_geojson || null) as Record<string, unknown> | null);
  const bbox = aoiBbox || bboxFromCenterRadius(centerLat, centerLng, radiusKm);
  const center: [number, number] = [
    (bbox[1] + bbox[3]) / 2,
    (bbox[0] + bbox[2]) / 2,
  ];

  const zones = deriveZones(findings, center);
  const districts = Array.from(new Set(findings.map((finding) => finding.district).filter(Boolean) as string[]));
  const keyFindings = Array.from(
    new Set(findings.map((finding) => finding.title || finding.finding_type).filter(Boolean)),
  ).slice(0, 8);

  const beforeRgbTileUrl = pickArtifactUrl(run.id, artifacts, ['before_tile', 'before_rgb', 'three_panel_before']);
  const afterRgbTileUrl = pickArtifactUrl(run.id, artifacts, ['after_tile', 'after_rgb', 'three_panel_after']);
  const damageTileUrl = pickArtifactUrl(run.id, artifacts, ['damage_tile', 'damage_classification']);
  const tStatTileUrl = pickArtifactUrl(run.id, artifacts, ['t_stat_tile', 'tstat', 'three_panel_damage', 'pwtt_heatmap']);
  const beforeSarTileUrl = pickArtifactUrl(run.id, artifacts, ['before_sar']);
  const afterSarTileUrl = pickArtifactUrl(run.id, artifacts, ['after_sar']);

  const criticalArea = asNumber(summary.critical_area_km2, 0);
  const severeArea = asNumber(summary.severe_area_km2, 0);
  const moderateArea = asNumber(summary.moderate_area_km2, 0);
  const minorArea = asNumber(summary.minor_area_km2, 0);
  const damagedArea = asNumber(summary.damaged_area_km2, criticalArea + severeArea + moderateArea + minorArea);
  const totalArea = asNumber(summary.total_area_km2, Math.max(damagedArea * 4, 0.1));
  const damagePct = asNumber(summary.damage_percentage, totalArea > 0 ? (damagedArea / totalArea) * 100 : 0);

  const eventDate = run.event_date || asString(runParams.event_date, new Date().toISOString());
  const statusMap: Record<string, Assessment['status']> = {
    completed: 'completed',
    in_progress: 'in_progress',
    failed: 'draft',
  };
  const mappedStatus = statusMap[asString(run.status).toLowerCase()] || 'completed';
  const eventName = asString(summary.event_name) || `${run.algorithm_name} ${run.algorithm_version}`;

  return {
    id: run.id,
    event_name: eventName,
    event_type: 'civil_unrest',
    event_date: eventDate,
    status: mappedStatus,
    bbox,
    center_lat: center[0],
    center_lng: center[1],
    districts,
    total_area_km2: totalArea,
    damaged_area_km2: damagedArea,
    damage_percentage: damagePct,
    critical_area_km2: criticalArea,
    severe_area_km2: severeArea,
    moderate_area_km2: moderateArea,
    minor_area_km2: minorArea,
    confidence_score: asNumber(run.confidence, 0),
    affected_population: asNumber(summary.affected_population, 0),
    displaced_estimate: asNumber(summary.displaced_estimate, 0),
    buildings_affected: asNumber(summary.buildings_affected, 0),
    roads_damaged_km: asNumber(summary.roads_damaged_km, 0),
    bridges_affected: asNumber(summary.bridges_affected, 0),
    key_findings: keyFindings,
    tags: ['pwtt', run.algorithm_name, run.algorithm_version],
    damage_tile_url: damageTileUrl || tStatTileUrl,
    t_stat_tile_url: tStatTileUrl,
    before_tile_url: beforeRgbTileUrl,
    after_tile_url: afterRgbTileUrl,
    before_sar_tile_url: beforeSarTileUrl,
    after_sar_tile_url: afterSarTileUrl,
    baseline_images_count: asNumber(summary.baseline_images_count, 0),
    post_images_count: asNumber(summary.post_images_count, 0),
    baseline_start: asString(runParams.baseline_start, ''),
    baseline_end: asString(runParams.baseline_end, ''),
    post_event_start: asString(runParams.post_event_start, ''),
    post_event_end: asString(runParams.post_event_end, ''),
    created_at: run.created_at || new Date().toISOString(),
    updated_at: run.updated_at || new Date().toISOString(),
    zones,
  };
}

function buildStats(view: AssessmentView | null, findings: PwttFinding[]): AssessmentStats | undefined {
  if (!view) return undefined;
  const severityBuckets = { critical: 0, severe: 0, moderate: 0, minor: 0 };
  view.zones.forEach((zone) => {
    if (zone.severity in severityBuckets) {
      severityBuckets[zone.severity as keyof typeof severityBuckets] += 1;
    }
  });
  return {
    total_zones: view.zones.length,
    zones_by_severity: severityBuckets,
    total_evidence: findings.reduce((acc, finding) => acc + (finding.source_count || 0), 0),
    verified_evidence: findings.filter((finding) => finding.verification_status === 'verified').length,
    total_notes: 0,
    open_notes: 0,
    ground_verified_zones: 0,
  };
}

function statusIntent(status: string): Intent {
  const map: Record<string, Intent> = {
    draft: Intent.NONE,
    in_progress: Intent.WARNING,
    completed: Intent.PRIMARY,
    verified: Intent.SUCCESS,
    archived: Intent.NONE,
  };
  return map[status] || Intent.NONE;
}

export default function DamageAssessment() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showQuickChecker, setShowQuickChecker] = useState(false);
  const [v2BuildingData, setV2BuildingData] = useState<QuickAnalyzeV2Result | null>(null);

  const runsQuery = useQuery({
    queryKey: ['pwtt-runs', 'damage-page'],
    queryFn: () => getPwttRuns({ limit: 200, offset: 0 }),
  });

  const selectedRunQuery = useQuery({
    queryKey: ['pwtt-run', selectedRunId],
    queryFn: () => getPwttRun(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const findingsQuery = useQuery({
    queryKey: ['pwtt-run-findings', selectedRunId],
    queryFn: () => getPwttFindings(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const threePanelQuery = useQuery({
    queryKey: ['pwtt-run-three-panel', selectedRunId],
    queryFn: () => getPwttThreePanel(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const createRunMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createPwttRun(payload),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pwtt-runs', 'damage-page'] }),
        queryClient.invalidateQueries({ queryKey: ['pwtt-run'] }),
      ]);
      if (typeof created.id === 'string') {
        setSelectedRunId(created.id);
      }
    },
  });

  useEffect(() => {
    if (!selectedRunId && runsQuery.data?.items?.length) {
      setSelectedRunId(runsQuery.data.items[0].id);
    }
  }, [selectedRunId, runsQuery.data]);

  const findings = findingsQuery.data?.items || [];
  const threePanelArtifacts = threePanelQuery.data?.items || [];
  const assessmentView = useMemo(
    () => buildAssessmentView(selectedRunQuery.data, findings, threePanelArtifacts),
    [selectedRunQuery.data, findings, threePanelArtifacts],
  );
  const stats = useMemo(() => buildStats(assessmentView, findings), [assessmentView, findings]);

  const handlePersistQuickAnalysis = useCallback(
    async (payload: {
      center_lat: number;
      center_lng: number;
      radius_km: number;
      event_date: string;
      result: QuickAnalyzeResult;
      v2Result?: QuickAnalyzeV2Result;
    }) => {
      if (payload.result.error) return;

      // Store v2 building data if available
      if (payload.v2Result) {
        setV2BuildingData(payload.v2Result);
      }

      try {
        const threePanelUrl = getThreePanelImageUrl({
          center_lat: payload.center_lat,
          center_lng: payload.center_lng,
          radius_km: payload.radius_km,
          event_date: payload.event_date,
          baseline_days: 365,
          post_event_days: 60,
        });

        const runPayload = {
          algorithm_name: 'pwtt_v2_hotspot',
          algorithm_version: payload.v2Result?.algorithm_version || 'pwtt-v2.0',
          status: 'completed',
          aoi_geojson: toAoiGeojsonFromBbox(payload.result.bbox),
          event_date: payload.event_date,
          run_params: {
            center_lat: payload.center_lat,
            center_lng: payload.center_lng,
            radius_km: payload.radius_km,
            baseline_days: 365,
            post_event_days: 60,
          },
          summary: {
            event_name: `PWTT hotspot ${payload.center_lat.toFixed(4)}, ${payload.center_lng.toFixed(4)}`,
            total_area_km2: payload.result.total_area_km2,
            damaged_area_km2: payload.result.damaged_area_km2,
            damage_percentage: payload.result.damage_percentage,
            critical_area_km2: payload.result.critical_area_km2,
            severe_area_km2: payload.result.severe_area_km2,
            moderate_area_km2: payload.result.moderate_area_km2,
            minor_area_km2: payload.result.minor_area_km2,
            baseline_images_count: payload.result.baseline_images_count,
            post_images_count: payload.result.post_images_count,
          },
          confidence_score: payload.result.confidence_score,
          artifacts: [
            { artifact_type: 'three_panel', file_path: threePanelUrl, source_classification: 'independent' },
            payload.result.before_tile_url ? { artifact_type: 'before_tile', file_path: payload.result.before_tile_url, source_classification: 'independent' } : null,
            payload.result.after_tile_url ? { artifact_type: 'after_tile', file_path: payload.result.after_tile_url, source_classification: 'independent' } : null,
            payload.result.damage_tile_url ? { artifact_type: 'damage_tile', file_path: payload.result.damage_tile_url, source_classification: 'independent' } : null,
            payload.result.t_stat_tile_url ? { artifact_type: 't_stat_tile', file_path: payload.result.t_stat_tile_url, source_classification: 'independent' } : null,
            payload.result.before_sar_tile_url ? { artifact_type: 'before_sar', file_path: payload.result.before_sar_tile_url, source_classification: 'independent' } : null,
            payload.result.after_sar_tile_url ? { artifact_type: 'after_sar', file_path: payload.result.after_sar_tile_url, source_classification: 'independent' } : null,
            payload.result.before_tile_url ? { artifact_type: 'three_panel_before', file_path: payload.result.before_tile_url, source_classification: 'independent' } : null,
            payload.result.after_tile_url ? { artifact_type: 'three_panel_after', file_path: payload.result.after_tile_url, source_classification: 'independent' } : null,
            payload.result.t_stat_tile_url ? { artifact_type: 'three_panel_damage', file_path: payload.result.t_stat_tile_url, source_classification: 'independent' } : null,
          ].filter(Boolean),
          findings: [
            {
              finding_type: 'damage_signal',
              title: `PWTT hotspot ${payload.center_lat.toFixed(4)}, ${payload.center_lng.toFixed(4)}`,
              severity: severityFromDamage(payload.result.damage_percentage),
              confidence: payload.result.confidence_score,
              metrics: {
                damage_percentage: payload.result.damage_percentage,
                damaged_area_km2: payload.result.damaged_area_km2,
                total_area_km2: payload.result.total_area_km2,
                critical_area_km2: payload.result.critical_area_km2,
                severe_area_km2: payload.result.severe_area_km2,
                moderate_area_km2: payload.result.moderate_area_km2,
                minor_area_km2: payload.result.minor_area_km2,
              },
            },
            // Building-level damage findings from v2
            ...((payload.v2Result?.building_damage_v2 || []) as BuildingDamageFeatureV2[])
              .filter((b) => b.properties.severity !== 'undamaged')
              .map((b) => ({
                finding_type: 'building_damage',
                title: `Building (${b.properties.centroid_lat.toFixed(5)}, ${b.properties.centroid_lng.toFixed(5)})`,
                severity: b.properties.severity,
                confidence: b.properties.confidence,
                geometry: b.geometry,
                metrics: {
                  mean_t_stat: b.properties.mean_t_stat,
                  max_t_stat: b.properties.max_t_stat,
                  quadratic_t: b.properties.quadratic_t,
                  pixel_count: b.properties.pixel_count,
                  size_class: b.properties.size_class,
                  area_km2: b.properties.area_m2 / 1_000_000,
                  damage_percentage: b.properties.severity === 'critical' ? 85
                    : b.properties.severity === 'severe' ? 60
                    : b.properties.severity === 'moderate' ? 35 : 15,
                },
              })),
          ],
        };

        await createRunMutation.mutateAsync(runPayload);
        setShowQuickChecker(false);
        setActiveTab('spatial');
      } catch (error) {
        console.error('Failed to persist PWTT run from quick checker', error);
      }
    },
    [createRunMutation],
  );

  const isLoading = runsQuery.isLoading;
  const selectedRun = selectedRunQuery.data;
  const artifacts: PwttArtifact[] = selectedRun?.artifacts || [];
  const allEvidenceArtifacts = [...artifacts, ...threePanelArtifacts].filter(
    (artifact, idx, all) => all.findIndex((item) => item.id === artifact.id) === idx,
  );

  return (
    <>
      <AnalystShell
        activePage="damage"
        toolbar={(
          <>
            <div className="flex items-center gap-3 px-4 py-1.5 flex-shrink-0 bg-bp-card border-b border-bp-border">
              <Button
                minimal
                small
                icon="refresh"
                onClick={() => { void runsQuery.refetch(); }}
                className="text-bp-text-secondary"
              />
              <HTMLSelect
                minimal
                value={selectedRunId || ''}
                onChange={(event) => setSelectedRunId(event.target.value || null)}
                options={[
                  { value: '', label: 'Select PWTT run...' },
                  ...(runsQuery.data?.items || []).map((run) => ({
                    value: run.id,
                    label: `${run.algorithm_name} ${run.algorithm_version} | ${run.status} | ${run.created_at ? new Date(run.created_at).toLocaleString() : run.id.slice(0, 8)}`,
                  })),
                ]}
                className="min-w-[340px] text-xs bg-bp-surface text-bp-text border border-bp-border"
              />
              <div className="flex-1" />
              <Button
                minimal
                small
                outlined
                icon={<Target size={13} />}
                text="Quick Checker"
                onClick={() => setShowQuickChecker(true)}
                className="text-bp-text-secondary text-xs"
              />
              <Button
                minimal
                small
                outlined
                icon={<Plus size={13} />}
                text="New Run"
                onClick={() => setShowQuickChecker(true)}
                className="text-bp-text-secondary text-xs"
              />
            </div>

            {assessmentView && (
              <div className="flex items-center gap-6 px-4 py-2 bg-bp-card border-b border-bp-border">
                <Tag minimal intent={statusIntent(assessmentView.status)} className="uppercase text-xs">
                  {assessmentView.status.replace('_', ' ')}
                </Tag>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-bp-text-muted">Damaged:</span>
                  <span className="text-severity-critical font-medium">{assessmentView.damaged_area_km2?.toFixed(2)} km²</span>
                  <span className="text-bp-text-muted">({assessmentView.damage_percentage?.toFixed(1)}%)</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-bp-text-muted">Confidence:</span>
                  <span className="text-bp-success font-medium">{((assessmentView.confidence_score || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-bp-text-muted">Sources:</span>
                  <span className="text-bp-primary font-medium">
                    {findings.reduce((acc, finding) => acc + (finding.source_count || 0), 0)}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
        status={(
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-bp-border bg-bp-bg text-bp-text-muted font-mono text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-bp-success" />
                LIVE
              </span>
              <span>Tab: {TABS.find(t => t.id === activeTab)?.label}</span>
              {selectedRunId && <span>Run: {selectedRunId.slice(0, 8)}</span>}
            </div>
            <div className="flex items-center gap-4">
              <span>{new Date().toLocaleTimeString('en-US', { hour12: false })} NPT</span>
            </div>
          </div>
        )}
      >
        <div className="h-full flex flex-col min-h-0">
          {/* eslint-disable-next-line @blueprintjs/classes-constants */}
          <div className="px-4 pt-1 border-b border-bp-border bg-bp-card">
            <Tabs id="damage-tabs" selectedTabId={activeTab} onChange={(newTab) => setActiveTab(newTab as TabId)} animate large={false}>
              {TABS.map(tab => (
                <Tab key={tab.id} id={tab.id} title={
                  <span className={`flex items-center gap-1.5 ${activeTab === tab.id ? 'text-bp-text' : 'text-bp-text-muted'}`}>
                    <tab.icon size={14} />
                    {tab.label}
                  </span>
                } />
              ))}
            </Tabs>
          </div>

          <div className="flex-1 overflow-hidden">
            {isLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex items-center gap-3 text-bp-text-muted">
                  <Spinner size={24} />
                  <span>Loading PWTT runs...</span>
                </div>
              </div>
            ) : !selectedRunId ? (
              <div className="h-full flex flex-col items-center justify-center text-bp-text-muted">
                <Satellite size={48} className="mb-4 text-bp-text-muted" />
                <p className="text-lg font-medium mb-2 text-bp-text-muted">No PWTT Run Selected</p>
                <p className="text-sm mb-4">Run a quick hotspot analysis to create and persist a new run.</p>
                <Button
                  intent={Intent.PRIMARY}
                  icon={<Plus size={14} />}
                  text="New PWTT Run"
                  onClick={() => setShowQuickChecker(true)}
                  className="text-xs"
                />
              </div>
            ) : selectedRunQuery.isLoading || findingsQuery.isLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex items-center gap-3 text-bp-text-muted">
                  <Spinner size={24} />
                  <span>Loading PWTT run details...</span>
                </div>
              </div>
            ) : assessmentView ? (
              <div className="h-full overflow-auto">
                {activeTab === 'overview' && <OverviewTab assessment={assessmentView} stats={stats} />}
                {activeTab === 'spatial' && (
                  <SpatialTab
                    assessment={assessmentView}
                    onRunAnalysis={() => setShowQuickChecker(true)}
                    isRunningAnalysis={createRunMutation.isPending}
                    zonesOverride={assessmentView.zones}
                    disableLegacyZoneApi
                    enableLegacyBuildingDetection={false}
                    v2BuildingData={v2BuildingData?.building_damage_v2}
                  />
                )}
                {activeTab === 'evidence' && (
                  <PwttEvidenceTab
                    runId={selectedRunId}
                    artifacts={allEvidenceArtifacts}
                    findings={findings}
                  />
                )}
                {activeTab !== 'overview' && activeTab !== 'spatial' && activeTab !== 'evidence' && (
                  <PlaceholderTab
                    title={TABS.find((tab) => tab.id === activeTab)?.label || 'Coming Soon'}
                    description="This operational tab is next in the rollout. Core PWTT, provenance, and evidence tabs are active."
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>
      </AnalystShell>

      {showQuickChecker && (
        <QuickHotspotChecker
          onClose={() => setShowQuickChecker(false)}
          initialCenter={assessmentView ? [assessmentView.center_lat, assessmentView.center_lng] : undefined}
          onAnalysisComplete={(payload) => {
            void handlePersistQuickAnalysis(payload);
          }}
        />
      )}
    </>
  );
}

function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-bp-text-muted">
      <AlertTriangle size={48} className="mb-4 text-severity-medium/50" />
      <h2 className="text-lg font-medium mb-2 text-bp-text-muted">{title}</h2>
      <p className="text-sm text-center max-w-md">{description}</p>
    </div>
  );
}
