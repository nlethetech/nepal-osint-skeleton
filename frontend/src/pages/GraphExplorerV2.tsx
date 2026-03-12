import UnifiedGraphExplorer from '../components/graph/UnifiedGraphExplorer'

/**
 * GraphExplorerV2 — Full-page wrapper for the unified graph explorer.
 *
 * This page renders the new unified graph component that queries
 * the `/api/v1/unified-graph/*` endpoints for progressive exploration
 * of the 180K+ entity / 500K+ relationship knowledge graph.
 */
export default function GraphExplorerV2() {
  return (
    <div className="h-screen w-full bg-bp-bg">
      <UnifiedGraphExplorer />
    </div>
  )
}
