import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, Wifi, Clock, Keyboard } from 'lucide-react'
import { Button } from '@blueprintjs/core'
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout'
import { QueuePanel } from '../components/workspace/QueuePanel'
import { MainCanvas } from '../components/workspace/MainCanvas'
import { ContextPanel } from '../components/workspace/ContextPanel'
import { CommandBar } from '../components/workspace/CommandBar'
import { useWorkspaceStore } from '../stores/workspaceStore'
import '../styles/professional-dashboard.css'

function StatusBar() {
  const { bulkMode, selectedItems, toggleShortcutsHelp } = useWorkspaceStore()

  return (
    <div className="h-full flex items-center px-4 gap-4 text-[10px] font-mono text-bp-text-muted">
      {/* Pipeline status */}
      <div className="flex items-center gap-2">
        <Wifi size={12} className="text-bp-success" />
        <span className="text-bp-text-secondary">LIVE</span>
      </div>

      <div className="w-px h-3.5 bg-bp-border" />

      {/* Activity indicator */}
      <div className="flex items-center gap-2">
        <Activity size={12} />
        <span>Pipeline healthy</span>
      </div>

      <div className="w-px h-3.5 bg-bp-border" />

      {/* Time */}
      <div className="flex items-center gap-2">
        <Clock size={12} />
        <span>{new Date().toLocaleTimeString('en-US', { hour12: false })} NPT</span>
      </div>

      {/* Bulk selection indicator */}
      {bulkMode && selectedItems.size > 0 && (
        <>
          <div className="w-px h-3.5 bg-bp-border" />
          <div className="flex items-center gap-2 text-bp-primary">
            <span>{selectedItems.size} selected</span>
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Keyboard shortcut hints */}
      <Button
        minimal
        small
        onClick={toggleShortcutsHelp}
        className="flex items-center gap-2 text-bp-text-muted hover:text-bp-text-secondary transition-colors"
      >
        <Keyboard size={12} />
        <span>
          <kbd className="px-1 py-0.5 bg-bp-surface border border-bp-border rounded text-[9px]">
            {'\u2318'}K
          </kbd>
          {' '}commands
        </span>
      </Button>
    </div>
  )
}

export default function AnalystWorkspace() {
  const [searchParams] = useSearchParams()
  const { shortcutsHelpOpen, toggleShortcutsHelp, selectItem } = useWorkspaceStore()

  // Handle URL params - auto-select cluster from Analyst Center
  useEffect(() => {
    const clusterId = searchParams.get('cluster')
    if (clusterId) {
      selectItem(clusterId, 'cluster')
    }
  }, [searchParams, selectItem])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }

      // Cmd+/ for shortcuts help
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        toggleShortcutsHelp()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleShortcutsHelp])

  return (
    <>
      <WorkspaceLayout
        queuePanel={<QueuePanel />}
        mainCanvas={<MainCanvas />}
        contextPanel={<ContextPanel />}
        commandBar={<CommandBar />}
        statusBar={<StatusBar />}
      />

      {/* Shortcuts Help Modal */}
      {shortcutsHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={toggleShortcutsHelp}
          />
          <div className="relative bg-bp-surface border border-bp-border rounded-xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-bp-text mb-4">
              Keyboard Shortcuts
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-bp-text-muted uppercase tracking-wide mb-2">
                  Global
                </h3>
                <div className="space-y-2">
                  <ShortcutRow keys={['\u2318', 'K']} description="Open command palette" />
                  <ShortcutRow keys={['\u2318', '/']} description="Show keyboard shortcuts" />
                  <ShortcutRow keys={['\u2318', 'N']} description="Create new story" />
                  <ShortcutRow keys={['Esc']} description="Close panel / Cancel" />
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-bp-text-muted uppercase tracking-wide mb-2">
                  Navigation
                </h3>
                <div className="space-y-2">
                  <ShortcutRow keys={['J']} description="Next item" />
                  <ShortcutRow keys={['K']} description="Previous item" />
                  <ShortcutRow keys={['Enter']} description="Open selected item" />
                  <ShortcutRow keys={['G', 'I']} description="Go to Inbox" />
                  <ShortcutRow keys={['G', 'C']} description="Go to Cases" />
                  <ShortcutRow keys={['G', 'W']} description="Go to Watchlist" />
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-bp-text-muted uppercase tracking-wide mb-2">
                  Actions
                </h3>
                <div className="space-y-2">
                  <ShortcutRow keys={['V']} description="Verify event" />
                  <ShortcutRow keys={['P']} description="Publish event" />
                  <ShortcutRow keys={['R']} description="Reject event" />
                  <ShortcutRow keys={['N']} description="Add note" />
                  <ShortcutRow keys={['A']} description="Add to case" />
                  <ShortcutRow keys={['Space']} description="Toggle selection" />
                </div>
              </div>
            </div>

            <Button
              onClick={toggleShortcutsHelp}
              fill
              className="mt-6 bg-bp-card border border-bp-border rounded-lg text-sm text-bp-text-secondary hover:border-bp-border-strong transition-colors"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-bp-text-secondary">{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="min-w-[24px] px-1.5 py-1 bg-bp-card border border-bp-border rounded text-xs text-bp-text-muted text-center"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}
