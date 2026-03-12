import { useEffect, useState } from 'react';
import { Spinner } from '@blueprintjs/core';
import {
  getPwttRuns,
  listPwttAois,
  type AnalystAOI,
  type PwttRunSummary,
} from '../../api/connectedAnalyst';
import { StatusTag } from '../ui/narada-ui';

interface PwttEvidencePanelProps {
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

function confidenceColor(c: number | null | undefined): string {
  const v = c ?? 0;
  if (v >= 0.7) return 'bg-bp-success';
  if (v >= 0.4) return 'bg-bp-warning';
  return 'bg-severity-critical';
}


export function PwttEvidencePanel({ selectedRunId, onSelectRun }: PwttEvidencePanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<PwttRunSummary[]>([]);
  const [aois, setAois] = useState<AnalystAOI[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      setLoading(true);
      setError(null);
      try {
        const [runsPayload, aoisPayload] = await Promise.all([
          getPwttRuns({ limit: 40, offset: 0 }),
          listPwttAois(30),
        ]);
        if (!cancelled) {
          setRuns(runsPayload.items);
          setAois(aoisPayload.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PWTT runs');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="h-full flex flex-col bg-bp-card border border-bp-border rounded-xl">
      <header className="px-3 py-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wider text-bp-text uppercase">PWTT Evidence Panel</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {!loading && aois.length > 0 && (
          <div className="rounded px-2 py-2 border border-bp-border bg-bp-surface">
            <p className="text-xs uppercase text-bp-text-secondary mb-1">Saved AOIs</p>
            <div className="space-y-1">
              {aois.slice(0, 6).map((item) => (
                <p key={item.id} className="truncate text-xs text-bp-text-secondary">
                  {item.name} ({item.radius_km.toFixed(2)} km)
                </p>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 px-2 py-1">
            <Spinner size={16} />
            <span className="text-xs text-bp-text-secondary">Loading PWTT runs...</span>
          </div>
        )}
        {error && <p className="px-2 py-1 text-xs text-severity-critical">{error}</p>}

        {!loading && !error && runs.length === 0 && (
          <p className="px-2 py-1 text-xs text-bp-text-secondary">No persisted PWTT runs yet.</p>
        )}

        {runs.map((run) => (
          <button
            key={run.id}
            onClick={() => onSelectRun(run.id)}
            className={`w-full text-left px-2 py-2 rounded-lg border transition-colors duration-150 ${
              selectedRunId === run.id
                ? 'bg-bp-success/10 border-bp-success'
                : 'bg-bp-surface border-bp-border hover:bg-bp-hover'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-bp-text">
                {run.algorithm_name} v{run.algorithm_version}
              </p>
              <StatusTag status={run.status} className="uppercase tracking-wider" />
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-bp-text-secondary">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${confidenceColor(run.confidence)}`} />
              <span>sources {run.source_count}</span>
              <span>confidence {(run.confidence ?? 0).toFixed(2)}</span>
              <span>findings {run.findings_count}</span>
            </div>
            <div className="mt-1 font-mono text-xs text-bp-text-muted">run {run.id.slice(0, 8)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
