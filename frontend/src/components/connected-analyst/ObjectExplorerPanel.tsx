import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { searchGraphObjects, type GraphObject } from '../../api/connectedAnalyst';

interface ObjectExplorerPanelProps {
  selectedObjectId: string | null;
  onSelectObject: (objectId: string) => void;
}

export function ObjectExplorerPanel({ selectedObjectId, onSelectObject }: ObjectExplorerPanelProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objects, setObjects] = useState<GraphObject[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadObjects() {
      setLoading(true);
      setError(null);
      try {
        const response = await searchGraphObjects({ q: query || undefined, limit: 25, offset: 0 });
        if (!cancelled) {
          setObjects(response.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load graph objects');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    const handle = window.setTimeout(loadObjects, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  return (
    <section className="h-full flex flex-col bg-bp-card border border-bp-border rounded-lg">
      <header className="px-3 py-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wide text-bp-text uppercase">Object Explorer</h2>
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded bg-bp-surface border border-bp-border">
          <Search size={14} className="text-bp-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search entities, customs, HS, districts"
            className="w-full bg-transparent text-xs text-bp-text outline-none placeholder:text-bp-text-muted"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && <p className="text-xs text-bp-text-muted px-2 py-1">Loading objects...</p>}
        {error && <p className="text-xs text-severity-critical px-2 py-1">{error}</p>}

        {!loading && !error && objects.length === 0 && (
          <p className="text-xs text-bp-text-muted px-2 py-1">No matching objects.</p>
        )}

        {objects.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectObject(item.id)}
            className={`w-full text-left rounded border px-2 py-2 transition-colors ${
              selectedObjectId === item.id
                ? 'bg-bp-primary/20 border-bp-primary'
                : 'bg-bp-surface border-bp-border hover:bg-bp-hover'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-bp-text truncate">{item.title}</p>
              <span className="text-[10px] text-bp-text-muted uppercase">{item.object_type}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[10px] text-bp-text-secondary">
              <span>sources {item.source_count}</span>
              <span>confidence {item.confidence.toFixed(2)}</span>
              <span>{item.verification_status}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
