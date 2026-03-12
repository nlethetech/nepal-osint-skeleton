import { ReactNode } from 'react'
import { PanelLeftClose, PanelRightClose, Command } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'

interface WorkspaceLayoutProps {
  queuePanel: ReactNode
  mainCanvas: ReactNode
  contextPanel: ReactNode
  commandBar?: ReactNode
  statusBar?: ReactNode
}

/**
 * @deprecated Transitional legacy layout.
 * Prefer /frontend/src/components/layout/AnalystShell.tsx for new analyst surfaces.
 */
export function WorkspaceLayout({
  queuePanel,
  mainCanvas,
  contextPanel,
  commandBar,
  statusBar,
}: WorkspaceLayoutProps) {
  const {
    contextPanelOpen,
    toggleContextPanel,
    openCommandBar,
    commandBarOpen,
  } = useWorkspaceStore()

  return (
    <div className="h-screen flex flex-col bg-[var(--pro-bg-base)] overflow-hidden">
      {/* Command Bar Overlay */}
      {commandBar}

      {/* Top Bar - Command trigger + global actions */}
      <div className="h-12 flex items-center px-4 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)]">
        {/* Command bar trigger */}
        <button
          onClick={openCommandBar}
          className="flex items-center gap-2 px-3 py-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg text-[var(--pro-text-muted)] hover:border-[var(--pro-border-default)] hover:text-[var(--pro-text-secondary)] transition-colors"
        >
          <Command size={14} />
          <span className="text-xs">Search or command...</span>
          <kbd className="ml-4 text-[10px] px-1.5 py-0.5 bg-[var(--pro-bg-surface)] border border-[var(--pro-border-subtle)] rounded">
            {'\u2318'}K
          </kbd>
        </button>

        <div className="flex-1" />

        {/* Context panel toggle */}
        <button
          onClick={toggleContextPanel}
          className={`p-2 rounded-lg transition-colors ${
            contextPanelOpen
              ? 'bg-[var(--pro-accent-muted)] text-[var(--pro-accent)]'
              : 'text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
          }`}
          title={contextPanelOpen ? 'Hide context panel' : 'Show context panel'}
        >
          {contextPanelOpen ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Main three-panel layout */}
      <div className="flex-1 flex min-h-0">
        {/* Queue Panel - Left (280px fixed) */}
        <div className="w-[280px] flex-shrink-0 border-r border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)] overflow-hidden flex flex-col">
          {queuePanel}
        </div>

        {/* Main Canvas - Center (flexible) */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col bg-[var(--pro-bg-base)]">
          {mainCanvas}
        </div>

        {/* Context Panel - Right (360px, collapsible) */}
        {contextPanelOpen && (
          <div className="w-[360px] flex-shrink-0 border-l border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)] overflow-hidden flex flex-col">
            {contextPanel}
          </div>
        )}
      </div>

      {/* Status Bar - Bottom */}
      {statusBar && (
        <div className="h-7 border-t border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)]">
          {statusBar}
        </div>
      )}
    </div>
  )
}
