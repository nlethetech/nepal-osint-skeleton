import { useEffect } from 'react';
import { Tab, Tabs } from '@blueprintjs/core';
import { ClipboardCheck, Satellite, User } from 'lucide-react';
import { useConnectedAnalystStore, type RightPanelMode } from '../../stores/connectedAnalystStore';
import { EntityProfilePanel } from '../entity-intelligence/EntityProfilePanel';
import { GraphCorrectionsPanel } from './GraphCorrectionsPanel';
import { ThreePanelInspector } from './ThreePanelInspector';
import { UnifiedNodeProfilePanel } from './UnifiedNodeProfilePanel';

const INVESTIGATION_V2_ENABLED = import.meta.env.VITE_FEATURE_INVESTIGATION_V2 !== 'false';
const GRAPH_CORRECTIONS_ENABLED = import.meta.env.VITE_FEATURE_GRAPH_CORRECTIONS !== 'false';

type InvestigationMode = Extract<RightPanelMode, 'profile' | 'satellite' | 'corrections'>;

const TABS: Array<{ mode: InvestigationMode; label: string; icon: typeof User }> = [
  { mode: 'profile', label: 'Profile', icon: User },
  { mode: 'satellite', label: 'Satellite', icon: Satellite },
  ...(GRAPH_CORRECTIONS_ENABLED
    ? [{ mode: 'corrections' as InvestigationMode, label: 'Fixes', icon: ClipboardCheck }]
    : []),
];

function isAllowedMode(mode: RightPanelMode): mode is InvestigationMode {
  return mode === 'profile' || mode === 'satellite' || mode === 'corrections';
}

export function InvestigationContextPanel({ className = '' }: { className?: string }) {
  const { rightPanelMode, setRightPanelMode, selectedEntityId, selectedRunId } = useConnectedAnalystStore();

  useEffect(() => {
    if (!isAllowedMode(rightPanelMode)) {
      setRightPanelMode('profile');
    }
  }, [rightPanelMode, setRightPanelMode]);

  const activeMode: InvestigationMode = isAllowedMode(rightPanelMode) ? rightPanelMode : 'profile';

  return (
    <div className={`flex flex-col h-full investigation-panel-chrome rounded-lg ${className}`}>
      <div className="px-2 py-1.5 border-b border-bp-border bg-bp-card">
        <div className="px-1 pb-1">
          <span className="investigation-rail-title">Context Intelligence</span>
        </div>
        <Tabs
          id="investigation-context-tabs"
          selectedTabId={activeMode}
          onChange={(newTab) => setRightPanelMode(newTab as RightPanelMode)}
          large={false}
        >
          {TABS.map(({ mode, label, icon: Icon }) => (
            <Tab
              key={mode}
              id={mode}
              title={(
                <span className={`flex items-center gap-1 text-xs ${activeMode === mode ? 'text-bp-text' : 'text-bp-text-secondary'}`}>
                  <Icon size={10} />
                  {label}
                </span>
              )}
            />
          ))}
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeMode === 'profile' && (
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

        {activeMode === 'satellite' && (
          <ThreePanelInspector runId={selectedRunId} />
        )}

        {GRAPH_CORRECTIONS_ENABLED && activeMode === 'corrections' && (
          <GraphCorrectionsPanel selectedNodeId={selectedEntityId} />
        )}
      </div>
    </div>
  );
}
