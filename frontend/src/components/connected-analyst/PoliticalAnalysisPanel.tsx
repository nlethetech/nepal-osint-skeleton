import { useState } from 'react';
import { EntityNetworkPanel, EntityProfilePanel, EntitySearchBar } from '../entity-intelligence';
import type { SearchResult } from '../../api/entityIntelligence';

interface PoliticalAnalysisPanelProps {
  onClose: () => void;
}

export function PoliticalAnalysisPanel({ onClose }: PoliticalAnalysisPanelProps) {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  function handleSelect(entity: SearchResult) {
    setSelectedEntityId(entity.id);
  }

  return (
    <div className="fixed inset-0 z-[1600] bg-black/60 p-4">
      <div className="h-full w-full rounded-lg border border-bp-border bg-bp-bg text-bp-text flex flex-col">
        <header className="px-4 py-3 border-b border-bp-border flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-bp-text">
              Political Network Analysis
            </h2>
            <p className="text-xs text-bp-text-secondary mt-1">
              Explore people, parties, and relationship power structure with evidence-backed network metrics.
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-bp-surface border border-bp-border text-xs text-bp-text-secondary hover:text-bp-text hover:bg-bp-hover"
          >
            Close
          </button>
        </header>

        <div className="px-4 py-3 border-b border-bp-border">
          <EntitySearchBar
            onSelect={handleSelect}
            placeholder="Search person, party, institution (e.g., KP Oli, UML)"
          />
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-3 p-3">
          <section className="xl:col-span-7 min-h-[20rem] xl:min-h-0 border border-bp-border rounded-lg overflow-hidden">
            <EntityNetworkPanel
              entityId={selectedEntityId ?? undefined}
              onNodeClick={(nodeId) => setSelectedEntityId(nodeId)}
              className="h-full"
            />
          </section>
          <section className="xl:col-span-5 min-h-[20rem] xl:min-h-0 border border-bp-border rounded-lg overflow-hidden">
            {selectedEntityId ? (
              <EntityProfilePanel entityId={selectedEntityId} className="h-full" />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-bp-text-muted px-4 text-center">
                Select an entity from search or click a node in the network to inspect dossier details.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
