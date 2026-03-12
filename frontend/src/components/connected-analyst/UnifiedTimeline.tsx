import { useEffect, useMemo, useState } from 'react';
import {
  getGraphTimeline,
  getPwttFindings,
  getTradeAnomalies,
  type GraphTimelineEvent,
  type PwttFinding,
  type TradeAnomaly,
} from '../../api/connectedAnalyst';

type TimelineItem = {
  id: string;
  kind: 'graph' | 'pwtt' | 'trade';
  title: string;
  timestamp: string;
  source_count: number;
  confidence: number;
  detail: string;
};

interface UnifiedTimelineProps {
  objectId: string | null;
  runId: string | null;
}

export function UnifiedTimeline({ objectId, runId }: UnifiedTimelineProps) {
  const [graphEvents, setGraphEvents] = useState<GraphTimelineEvent[]>([]);
  const [pwttFindings, setPwttFindings] = useState<PwttFinding[]>([]);
  const [tradeAnomalies, setTradeAnomalies] = useState<TradeAnomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTimeline() {
      setLoading(true);
      setError(null);
      try {
        const promises: Array<Promise<void>> = [];

        if (objectId) {
          promises.push(
            getGraphTimeline(objectId, 40).then((response) => {
              if (!cancelled) {
                setGraphEvents(response.events);
              }
            }),
          );
        } else {
          setGraphEvents([]);
        }

        if (runId) {
          promises.push(
            getPwttFindings(runId).then((response) => {
              if (!cancelled) {
                setPwttFindings(response.items);
              }
            }),
          );
        } else {
          setPwttFindings([]);
        }

        promises.push(
          getTradeAnomalies({ limit: 20, offset: 0 }).then((response) => {
            if (!cancelled) {
              setTradeAnomalies(response.items);
            }
          }),
        );

        await Promise.all(promises);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load unified timeline');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTimeline();
    return () => {
      cancelled = true;
    };
  }, [objectId, runId]);

  const items = useMemo(() => {
    const graphItems: TimelineItem[] = graphEvents.map((event, index) => ({
      id: `graph-${index}`,
      kind: 'graph',
      title: event.title,
      timestamp: event.timestamp ?? '',
      source_count: event.source_count ?? (event.provenance_refs?.length ?? 0),
      confidence: event.confidence ?? 0,
      detail: event.event_type,
    }));

    const pwttItems: TimelineItem[] = pwttFindings.map((finding) => ({
      id: `pwtt-${finding.id}`,
      kind: 'pwtt',
      title: finding.title ?? `PWTT ${finding.finding_type}`,
      timestamp: finding.provenance_refs?.[0]?.captured_at ?? '',
      source_count: finding.source_count ?? 0,
      confidence: finding.confidence,
      detail: `${finding.severity} ${finding.district ?? finding.customs_office ?? ''}`.trim(),
    }));

    const tradeItems: TimelineItem[] = tradeAnomalies.map((anomaly) => ({
      id: `trade-${anomaly.id}`,
      kind: 'trade',
      title: `Trade anomaly ${anomaly.dimension_key}`,
      timestamp: `${anomaly.fiscal_year_bs}-M${anomaly.month_ordinal.toString().padStart(2, '0')}`,
      source_count: anomaly.source_count,
      confidence: anomaly.confidence,
      detail: `${anomaly.severity} score ${anomaly.anomaly_score.toFixed(2)}`,
    }));

    return [...graphItems, ...pwttItems, ...tradeItems].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
  }, [graphEvents, pwttFindings, tradeAnomalies]);

  return (
    <section className="h-full flex flex-col bg-bp-card border border-bp-border rounded-lg">
      <header className="px-3 py-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wide text-bp-text uppercase">Unified Timeline</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && <p className="text-xs text-bp-text-muted px-2 py-1">Loading timeline...</p>}
        {error && <p className="text-xs text-severity-critical px-2 py-1">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <p className="text-xs text-bp-text-muted px-2 py-1">No timeline events available.</p>
        )}

        {items.map((item) => (
          <div key={item.id} className="rounded border border-bp-border bg-bp-surface px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-bp-text truncate">{item.title}</p>
              <span className="text-[10px] text-bp-text-muted uppercase">{item.kind}</span>
            </div>
            <p className="text-[10px] text-bp-text-secondary mt-1">{item.detail}</p>
            <div className="mt-1 flex items-center gap-3 text-[10px] text-bp-text-secondary">
              <span>{item.timestamp || 'n/a'}</span>
              <span>sources {item.source_count}</span>
              <span>confidence {item.confidence.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
