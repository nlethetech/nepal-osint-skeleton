import { Tabs, Tab } from '@blueprintjs/core';
import { User, Satellite, FlaskConical, TrendingUp, Scale, ClipboardCheck } from 'lucide-react';
import { useConnectedAnalystStore, type RightPanelMode } from '../../stores/connectedAnalystStore';
import { EntityProfilePanel } from '../entity-intelligence/EntityProfilePanel';
import { UnifiedNodeProfilePanel } from './UnifiedNodeProfilePanel';
import { ThreePanelInspector } from './ThreePanelInspector';
import { HypothesisBoard } from './HypothesisBoard';
import { TradeInvestigationWorkbench } from './TradeInvestigationWorkbench';
import { ProcurementAnalysisPanel } from './ProcurementAnalysisPanel';
import { GraphCorrectionsPanel } from './GraphCorrectionsPanel';

const INVESTIGATION_V2_ENABLED = import.meta.env.VITE_FEATURE_INVESTIGATION_V2 !== 'false';
const GRAPH_CORRECTIONS_ENABLED = import.meta.env.VITE_FEATURE_GRAPH_CORRECTIONS !== 'false';

const TABS: { mode: RightPanelMode; label: string; icon: typeof User }[] = [
  { mode: 'profile', label: 'Profile', icon: User },
  { mode: 'satellite', label: 'Satellite', icon: Satellite },
  { mode: 'hypothesis', label: 'Hypothesis', icon: FlaskConical },
  { mode: 'trade', label: 'Trade', icon: TrendingUp },
  { mode: 'procurement', label: 'Procure', icon: Scale },
  ...(GRAPH_CORRECTIONS_ENABLED ? [{ mode: 'corrections' as RightPanelMode, label: 'Fixes', icon: ClipboardCheck }] : []),
];

export function RightContextPanel({ className = '' }: { className?: string }) {
  const { rightPanelMode, setRightPanelMode, selectedEntityId, selectedRunId } =
    useConnectedAnalystStore();

  return (
    <div className={`flex flex-col h-full investigation-panel-chrome rounded-lg ${className}`}>
      {/* Tab bar - Blueprint Tabs */}
      <div className="px-2 py-1.5 border-b border-bp-border bg-bp-card">
        <div className="px-1 pb-1">
          <span className="investigation-rail-title">Context Intelligence</span>
        </div>
        <Tabs
          id="right-panel-tabs"
          selectedTabId={rightPanelMode}
          onChange={(newTab) => setRightPanelMode(newTab as RightPanelMode)}
          large={false}
        >
          {TABS.map(({ mode, label, icon: Icon }) => (
            <Tab
              key={mode}
              id={mode}
              title={
                <span className={`flex items-center gap-1 text-xs ${
                  rightPanelMode === mode ? 'text-bp-text' : 'text-bp-text-secondary'
                }`}>
                  <Icon size={10} />
                  {label}
                </span>
              }
            />
          ))}
        </Tabs>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanelMode === 'profile' && (
          selectedEntityId ? (
            INVESTIGATION_V2_ENABLED ? (
              <UnifiedNodeProfilePanel nodeId={selectedEntityId} className="h-full" />
            ) : (
              <EntityProfilePanel
                entityId={selectedEntityId}
                onEntityClick={(id) => useConnectedAnalystStore.getState().selectEntity(id)}
                className="h-full"
              />
            )
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-bp-text-secondary">Select an entity to view profile.</p>
            </div>
          )
        )}

        {rightPanelMode === 'satellite' && (
          <ThreePanelInspector runId={selectedRunId} />
        )}

        {rightPanelMode === 'hypothesis' && (
          <HypothesisBoard />
        )}

        {rightPanelMode === 'trade' && (
          <TradeInvestigationWorkbench />
        )}

        {rightPanelMode === 'procurement' && (
          <ProcurementAnalysisPanel />
        )}

        {GRAPH_CORRECTIONS_ENABLED && rightPanelMode === 'corrections' && (
          <GraphCorrectionsPanel selectedNodeId={selectedEntityId} />
        )}
      </div>
    </div>
  );
}
