import { useEffect, useState } from 'react';
import { Tag, Intent, Spinner } from '@blueprintjs/core';
import {
  getPwttRun,
  getPwttThreePanel,
  getPwttArtifactStreamUrl,
  type PwttArtifact,
  type PwttRunDetail,
} from '../../api/connectedAnalyst';
import { ThreePanelView } from '../damage-assessment/ThreePanelView';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SeverityBadge } from '../ui/narada-ui';

interface ThreePanelInspectorProps {
  runId: string | null;
}

export function ThreePanelInspector({ runId }: ThreePanelInspectorProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<PwttArtifact[]>([]);
  const [runDetail, setRunDetail] = useState<PwttRunDetail | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!runId) {
        setArtifacts([]);
        setRunDetail(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [threePanelRes, runRes] = await Promise.all([
          getPwttThreePanel(runId),
          getPwttRun(runId),
        ]);
        if (!cancelled) {
          setArtifacts(threePanelRes.items);
          setRunDetail(runRes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load three-panel data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Extract run_params for ThreePanelView
  const centerLat = Number(runDetail?.run_params?.center_lat) || 0;
  const centerLng = Number(runDetail?.run_params?.center_lng) || 0;
  const radiusKm = Number(runDetail?.run_params?.radius_km) || 1;
  const eventDate = runDetail?.event_date || '';
  const baselineDays = Number(runDetail?.run_params?.baseline_days) || 365;
  const postEventDays = Number(runDetail?.run_params?.post_event_days) || 60;

  // Extract summary metrics
  const summary = runDetail?.summary || {};
  const damagePercentage = Number(summary.damage_percentage) || 0;
  const damagedAreaKm2 = Number(summary.damaged_area_km2) || 0;
  const totalAreaKm2 = Number(summary.total_area_km2) || 0;
  const hasParams = centerLat !== 0 && centerLng !== 0 && eventDate;

  // Map damage percentage to severity level for SeverityBadge
  const damageSeverity: string =
    damagePercentage >= 20 ? 'critical' :
    damagePercentage >= 10 ? 'high' :
    'low';

  return (
    <section className="h-full flex flex-col bg-bp-bg border border-bp-border rounded-xl">
      <header className="px-3 py-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-bp-text">
          Three Panel Inspector
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {!runId && (
          <p className="text-xs px-2 py-1 text-bp-text-secondary">Select a PWTT run to inspect artifacts.</p>
        )}
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1">
            <Spinner size={16} />
            <span className="text-xs text-bp-text-secondary">Loading three-panel data...</span>
          </div>
        )}
        {error && <p className="text-xs px-2 py-1 text-severity-critical">{error}</p>}

        {/* Damage metrics */}
        {runDetail && !loading && (
          <div className="rounded px-2 py-2 bg-bp-card border border-bp-border">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-bp-text-muted">Damage</p>
                <SeverityBadge severity={damageSeverity} className="mt-1" />
                <p className="text-sm font-semibold text-bp-text mt-0.5">
                  {damagePercentage.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] text-bp-text-muted">Damaged Area</p>
                <p className="text-sm font-semibold text-bp-text">
                  {damagedAreaKm2.toFixed(2)} km²
                </p>
              </div>
              <div>
                <p className="text-[10px] text-bp-text-muted">Total Area</p>
                <p className="text-sm font-semibold text-bp-text">
                  {totalAreaKm2.toFixed(2)} km²
                </p>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-center text-bp-text-muted">
              confidence {(runDetail.confidence ?? 0).toFixed(2)} · sources {runDetail.source_count}
            </p>
          </div>
        )}

        {/* Embedded ThreePanelView */}
        {runId && !loading && !error && hasParams && (
          <div className="rounded overflow-hidden bg-bp-bg border border-bp-border" style={{ minHeight: '250px' }}>
            <ThreePanelView
              centerLat={centerLat}
              centerLng={centerLng}
              radiusKm={radiusKm}
              eventDate={eventDate}
              baselineDays={baselineDays}
              postEventDays={postEventDays}
            />
          </div>
        )}

        {runId && !loading && !error && !hasParams && artifacts.length === 0 && (
          <p className="text-xs px-2 py-1 text-bp-text-secondary">
            No three-panel artifacts or run parameters found for this run.
          </p>
        )}

        {/* Collapsible artifact stream list */}
        {artifacts.length > 0 && (
          <div className="rounded bg-bp-card border border-bp-border">
            <button
              onClick={() => setShowArtifacts(!showArtifacts)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] text-bp-text-secondary"
            >
              {showArtifacts ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Artifact Stream ({artifacts.length})
            </button>
            {showArtifacts && (
              <div className="px-2 pb-2 space-y-1.5">
                {artifacts.map((artifact) => (
                  <div key={artifact.id} className="rounded px-2 py-1.5 bg-bp-bg border border-bp-border">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-medium text-bp-text">{artifact.artifact_type}</p>
                      <span className="text-[9px] uppercase text-bp-text-muted">{artifact.source_classification}</span>
                    </div>
                    {runId && (
                      <a
                        href={getPwttArtifactStreamUrl(runId, artifact.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block mt-1 text-[10px] underline text-bp-primary"
                      >
                        Open artifact stream
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
