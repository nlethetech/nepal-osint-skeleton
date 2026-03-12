import { Orbit, Network, ShieldAlert, Waves } from 'lucide-react'
import { AnalystShell } from '../layout/AnalystShell'
import { EntityBrowserPanel } from './EntityBrowserPanel'
import { InvestigationGraphPanel } from './InvestigationGraphPanel'
import { InvestigationContextPanel } from './InvestigationContextPanel'
import { RightContextPanel } from './RightContextPanel'
import { useInvestigationStore } from '../../stores/investigationStore'
import '../../styles/investigation-palantir.css'

const INVESTIGATION_GRAPH_CONTEXT_ONLY_ENABLED = import.meta.env.VITE_FEATURE_INVESTIGATION_GRAPH_CONTEXT_ONLY !== 'false'

// ============================================================================
// Investigation Workspace
// ============================================================================

export function InvestigationWorkspace() {
  const { pinnedNodeIds, elements } = useInvestigationStore()

  const nodeCount = elements.filter((el) => el.group === 'nodes').length
  const edgeCount = elements.filter((el) => el.group === 'edges').length

  return (
    <AnalystShell
      activePage="investigation"
      frameClassName="overflow-hidden p-3 investigation-v2-root"
      contentClassName="overflow-hidden"
      density="compact"
      layoutConfig={{ centerScrollable: false }}
      toolbar={(
        <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0 investigation-command-strip rounded-lg">
          <span className="flex items-center gap-2 text-sm font-semibold text-bp-text">
            <Orbit size={15} className="text-bp-primary" />
            Investigation Operations Deck
          </span>
          <span className="investigation-metric-chip">Pinned<strong>{pinnedNodeIds.length}</strong></span>
          <span className="investigation-metric-chip">Nodes<strong>{nodeCount}</strong></span>
          <span className="investigation-metric-chip">Edges<strong>{edgeCount}</strong></span>
          <div className="flex-1" />
          <span className="investigation-tactical-note">
            {'Search -> Resolve -> Expand -> Hypothesize -> Correct'}
          </span>
        </div>
      )}
      leftRail={(
        <EntityBrowserPanel className="h-full" />
      )}
      center={(
        <InvestigationGraphPanel className="h-full" />
      )}
      rightRail={
        INVESTIGATION_GRAPH_CONTEXT_ONLY_ENABLED
          ? <InvestigationContextPanel className="h-full" />
          : <RightContextPanel className="h-full" />
      }
      status={(
        <div className="flex items-center justify-between px-4 py-1.5 investigation-statusbar text-[10px]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Network size={11} className="text-bp-primary" />
              LIVE GRAPH OPS
            </span>
            <span className="flex items-center gap-1.5"><ShieldAlert size={11} className="text-bp-warning" /> Analyst workflow enabled</span>
            <span className="flex items-center gap-1.5"><Waves size={11} className="text-bp-primary" /> Unified graph</span>
          </div>
          <div className="flex items-center gap-4">
            <span>{pinnedNodeIds.length} pinned</span>
            <span>{nodeCount} nodes</span>
            <span>{edgeCount} edges</span>
          </div>
        </div>
      )}
    >
      {null}
    </AnalystShell>
  )
}
