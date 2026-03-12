import { useEffect, useState } from 'react';
import {
  getGraphNeighbors,
  getGraphObject,
  type GraphNeighbor,
  type GraphObject,
  type ProvenanceRef,
} from '../../api/connectedAnalyst';

interface GraphEvidenceDrawerProps {
  objectId: string | null;
}

function ProvenanceList({ refs }: { refs: ProvenanceRef[] }) {
  if (!refs.length) {
    return <p className="text-[10px] text-bp-text-muted">No provenance refs</p>;
  }

  return (
    <div className="space-y-1">
      {refs.map((ref) => (
        <div key={ref.id} className="rounded border border-bp-border bg-bp-surface px-2 py-1">
          <p className="text-[10px] text-bp-text">{ref.source_name ?? ref.evidence_type}</p>
          <p className="text-[10px] text-bp-text-secondary">
            sources 1 confidence {ref.confidence.toFixed(2)} {ref.source_classification ?? 'unknown'}
          </p>
          {ref.excerpt && <p className="text-[10px] text-bp-text-muted truncate">{ref.excerpt}</p>}
        </div>
      ))}
    </div>
  );
}

export function GraphEvidenceDrawer({ objectId }: GraphEvidenceDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectItem, setObjectItem] = useState<GraphObject | null>(null);
  const [neighbors, setNeighbors] = useState<GraphNeighbor[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!objectId) {
        setObjectItem(null);
        setNeighbors([]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [obj, nbr] = await Promise.all([getGraphObject(objectId), getGraphNeighbors(objectId, 25)]);
        if (!cancelled) {
          setObjectItem(obj);
          setNeighbors(nbr.neighbors);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load graph evidence');
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
  }, [objectId]);

  return (
    <section className="h-full flex flex-col bg-bp-card border border-bp-border rounded-lg">
      <header className="px-3 py-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wide text-bp-text uppercase">Graph Evidence Drawer</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {!objectId && <p className="text-xs text-bp-text-muted px-2 py-1">Select an object to inspect graph evidence.</p>}
        {loading && <p className="text-xs text-bp-text-muted px-2 py-1">Loading evidence graph...</p>}
        {error && <p className="text-xs text-severity-critical px-2 py-1">{error}</p>}

        {objectItem && (
          <div className="rounded border border-bp-primary/30 bg-bp-primary/10 px-2 py-2">
            <p className="text-xs font-medium text-bp-text">{objectItem.title}</p>
            <p className="text-[10px] text-bp-text-secondary mt-1">
              sources {objectItem.source_count} confidence {objectItem.confidence.toFixed(2)} {objectItem.verification_status}
            </p>
            <div className="mt-2">
              <ProvenanceList refs={objectItem.provenance_refs ?? []} />
            </div>
          </div>
        )}

        {neighbors.map((item) => (
          <div key={item.link.id} className="rounded border border-bp-border bg-bp-surface px-2 py-2">
            <p className="text-xs text-bp-text">
              {item.link.predicate} {item.neighbor.title}
            </p>
            <p className="text-[10px] text-bp-text-secondary mt-1">
              sources {item.link.source_count} confidence {item.link.confidence.toFixed(2)} {item.link.verification_status}
            </p>
            <div className="mt-2">
              <ProvenanceList refs={item.link.provenance_refs ?? []} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
