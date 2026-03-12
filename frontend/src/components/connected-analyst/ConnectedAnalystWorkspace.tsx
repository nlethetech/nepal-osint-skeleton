import { useState } from 'react';
import { Button, Tag, Intent, Spinner } from '@blueprintjs/core';
import { TrendingUp } from 'lucide-react';
import { createPwttRun, runTradeIngest } from '../../api/connectedAnalyst';
import { QuickHotspotChecker } from '../damage-assessment/QuickHotspotChecker';
import { getThreePanelImageUrl, type QuickAnalyzeResult } from '../../api/damageAssessment';
import { EntitySearchBar } from '../entity-intelligence/EntitySearchBar';
import { InfluenceLeaderboard } from '../entity-intelligence/InfluenceLeaderboard';
import { UnifiedGraphPanel } from './UnifiedGraphPanel';
import { UnifiedTimelineAdapter } from './UnifiedTimelineAdapter';
import { PwttEvidencePanel } from './PwttEvidencePanel';
import { RightContextPanel } from './RightContextPanel';
import { BottomStrip } from './BottomStrip';
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore';
import { AnalystShell } from '../layout/AnalystShell';

export function ConnectedAnalystWorkspace() {
  const { selectedRunId, selectEntity, selectRun } = useConnectedAnalystStore();
  const [ingesting, setIngesting] = useState(false);
  const [ingestMessage, setIngestMessage] = useState<string | null>(null);
  const [showHotspotChecker, setShowHotspotChecker] = useState(false);
  const [persistingPwtt, setPersistingPwtt] = useState(false);

  async function handleTradeIngest() {
    setIngesting(true);
    setIngestMessage(null);
    try {
      const result = await runTradeIngest('trade_data');
      const summary = (result.summary as Record<string, unknown>) || {};
      setIngestMessage(
        `Trade ingest completed: files ${summary.processed_files ?? 0}, facts ${summary.facts_upserted ?? 0}, anomalies ${summary.anomalies_upserted ?? 0}`,
      );
    } catch (error) {
      setIngestMessage(error instanceof Error ? error.message : 'Trade ingest failed');
    } finally {
      setIngesting(false);
    }
  }

  function toAoiGeojson(bbox: [number, number, number, number]) {
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

  async function handleQuickPwttComplete(payload: {
    center_lat: number;
    center_lng: number;
    radius_km: number;
    event_date: string;
    result: QuickAnalyzeResult;
  }) {
    if (payload.result.error) {
      return;
    }

    setPersistingPwtt(true);
    try {
      const threePanelUrl = getThreePanelImageUrl({
        center_lat: payload.center_lat,
        center_lng: payload.center_lng,
        radius_km: payload.radius_km,
        event_date: payload.event_date,
        baseline_days: 365,
        post_event_days: 60,
      });
      const aoiGeojson = toAoiGeojson(payload.result.bbox);
      const created = await createPwttRun({
        algorithm_name: 'pwtt_hotspot',
        algorithm_version: 'quick-1.0',
        status: 'completed',
        aoi_geojson: aoiGeojson,
        event_date: payload.event_date,
        run_params: {
          center_lat: payload.center_lat,
          center_lng: payload.center_lng,
          radius_km: payload.radius_km,
          baseline_days: 365,
          post_event_days: 60,
        },
        summary: {
          total_area_km2: payload.result.total_area_km2,
          damaged_area_km2: payload.result.damaged_area_km2,
          damage_percentage: payload.result.damage_percentage,
        },
        confidence_score: payload.result.confidence_score,
        artifacts: [
          { artifact_type: 'three_panel', file_path: threePanelUrl, source_classification: 'independent' },
          payload.result.before_tile_url ? { artifact_type: 'before_tile', file_path: payload.result.before_tile_url, source_classification: 'independent' } : null,
          payload.result.after_tile_url ? { artifact_type: 'after_tile', file_path: payload.result.after_tile_url, source_classification: 'independent' } : null,
          payload.result.damage_tile_url ? { artifact_type: 'damage_tile', file_path: payload.result.damage_tile_url, source_classification: 'independent' } : null,
        ].filter((item): item is { artifact_type: string; file_path: string; source_classification: string } => item !== null),
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
            },
          },
        ],
      });

      const runId = typeof created.id === 'string' ? created.id : null;
      if (runId) {
        selectRun(runId);
      }
      setIngestMessage(
        `PWTT run persisted from hotspot analysis${runId ? `: ${runId}` : ''}.`,
      );
    } catch (error) {
      setIngestMessage(error instanceof Error ? error.message : 'Failed to persist hotspot PWTT run');
    } finally {
      setPersistingPwtt(false);
    }
  }

  return (
    <>
      <AnalystShell
        activePage="analyst"
        frameClassName="overflow-hidden p-3"
        contentClassName="overflow-hidden"
        density="compact"
        layoutConfig={{ centerScrollable: false }}
        toolbar={(
          <>
            <div className="flex items-center gap-3 px-4 py-1.5 flex-shrink-0 bg-bp-card border border-bp-border rounded-lg">
              <div className="w-[280px]">
                <EntitySearchBar
                  onSelect={(entity) => selectEntity(entity.id)}
                  placeholder="Search entities..."
                  className="w-full"
                />
              </div>
              <div className="flex-1" />
              <Button
                minimal
                small
                text={ingesting ? 'Ingesting...' : 'Run Trade Ingest'}
                icon={<TrendingUp size={12} />}
                loading={ingesting}
                onClick={() => { void handleTradeIngest(); }}
                className="text-bp-text-secondary text-xs"
              />
            </div>

            {ingestMessage && (
              <Tag
                minimal
                large
                intent={Intent.NONE}
                onRemove={() => setIngestMessage(null)}
                className="bg-bp-card border border-bp-border text-bp-text-secondary"
              >
                {ingestMessage}
              </Tag>
            )}
            {persistingPwtt && (
              <Tag minimal large intent={Intent.WARNING} icon={<Spinner size={12} />}>
                Persisting quick hotspot PWTT run into evidence graph...
              </Tag>
            )}
          </>
        )}
        leftRail={(
          <div className="h-full flex flex-col gap-2 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0">
              <InfluenceLeaderboard
                onEntityClick={(entityId) => selectEntity(entityId)}
                limit={15}
                className="h-full"
              />
            </div>
            <div className="flex-1 min-h-0">
              <PwttEvidencePanel
                selectedRunId={selectedRunId}
                onSelectRun={(runId) => selectRun(runId)}
              />
            </div>
          </div>
        )}
        center={(
          <div className="h-full flex flex-col gap-2 min-h-0 overflow-hidden">
            <div className="flex-[6] min-h-0">
              <UnifiedGraphPanel className="h-full" />
            </div>
            <div className="flex-[4] min-h-0">
              <UnifiedTimelineAdapter className="h-full" />
            </div>
          </div>
        )}
        rightRail={<RightContextPanel className="h-full" />}
        status={<BottomStrip />}
      >
        {null}
      </AnalystShell>

      {showHotspotChecker && (
        <QuickHotspotChecker
          onClose={() => setShowHotspotChecker(false)}
          onAnalysisComplete={(payload) => {
            void handleQuickPwttComplete(payload);
          }}
        />
      )}
    </>
  );
}
