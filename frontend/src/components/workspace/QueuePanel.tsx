import { useEffect, useState } from 'react'
import { Inbox, FolderKanban, Eye, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useWorkspaceStore, type QueueTab } from '../../stores/workspaceStore'
import { getEventInbox, type OpsEventInboxItem, type WorkflowStatus } from '../../api/ops'

const TABS: { id: QueueTab; label: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'cases', label: 'Cases', icon: FolderKanban },
  { id: 'watchlist', label: 'Watch', icon: Eye },
]

function formatAge(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return '-'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function severityIndicator(severity?: string | null) {
  const colors: Record<string, string> = {
    critical: 'bg-[var(--pro-critical)]',
    high: 'bg-[var(--pro-high)]',
    medium: 'bg-[var(--pro-medium)]',
    low: 'bg-[var(--pro-low)]',
  }
  return colors[severity || 'low'] || colors.low
}

function statusBadge(status: WorkflowStatus) {
  const styles: Record<WorkflowStatus, string> = {
    unreviewed: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    monitoring: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    verified: 'bg-green-500/15 text-green-300 border-green-500/30',
    published: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
  }
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border uppercase ${styles[status]}`}>
      {status}
    </span>
  )
}

export function QueuePanel() {
  const {
    activeQueueTab,
    setActiveQueueTab,
    selectedItemId,
    selectItem,
    bulkMode,
    selectedItems,
    toggleItemSelection,
  } = useWorkspaceStore()

  const [items, setItems] = useState<OpsEventInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadInbox = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getEventInbox({
        hours: 72,
        limit: 80,
        minAgeMinutes: 0,
      })
      setItems(data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeQueueTab === 'inbox') {
      loadInbox()
      const interval = setInterval(loadInbox, 60_000)
      return () => clearInterval(interval)
    }
  }, [activeQueueTab])

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-[var(--pro-border-subtle)]">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeQueueTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveQueueTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-[var(--pro-accent)] border-b-2 border-[var(--pro-accent)] bg-[var(--pro-accent-muted)]'
                  : 'text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeQueueTab === 'inbox' && (
          <>
            {/* Inbox Header */}
            <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--pro-border-subtle)]">
              <span className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
                Events ({items.length})
              </span>
              <button
                onClick={loadInbox}
                disabled={loading}
                className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="mx-3 mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Item List */}
            <div className="flex-1 overflow-y-auto">
              {loading && items.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--pro-text-muted)]">
                  Loading...
                </div>
              ) : items.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--pro-text-muted)]">
                  No events in queue
                </div>
              ) : (
                <div className="divide-y divide-[var(--pro-border-subtle)]">
                  {items.map((item) => {
                    const isSelected = selectedItemId === item.id
                    const isBulkSelected = selectedItems.has(item.id)

                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          if (bulkMode) {
                            toggleItemSelection(item.id)
                          } else {
                            selectItem(item.id, 'cluster')
                          }
                        }}
                        className={`w-full text-left p-3 transition-colors ${
                          isSelected
                            ? 'bg-[var(--pro-accent-muted)] border-l-2 border-[var(--pro-accent)]'
                            : isBulkSelected
                            ? 'bg-blue-500/10 border-l-2 border-blue-500'
                            : 'hover:bg-[var(--pro-bg-hover)] border-l-2 border-transparent'
                        }`}
                      >
                        {/* Meta row */}
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          {/* Severity indicator */}
                          <div className={`w-1.5 h-1.5 rounded-full ${severityIndicator(item.severity)}`} />

                          {statusBadge(item.workflow_status)}

                          {item.uncertainty_score >= 0.5 && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded border bg-orange-500/15 text-orange-300 border-orange-500/30">
                              <AlertTriangle size={8} />
                              REVIEW
                            </span>
                          )}

                          {item.ready_for_publish && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded border bg-green-500/15 text-green-300 border-green-500/30">
                              <CheckCircle2 size={8} />
                              READY
                            </span>
                          )}

                          <span className="ml-auto text-[10px] text-[var(--pro-text-disabled)] font-mono">
                            {formatAge(item.age_minutes)}
                          </span>
                        </div>

                        {/* Headline */}
                        <div className="text-xs font-medium text-[var(--pro-text-primary)] line-clamp-2 leading-relaxed">
                          {item.headline}
                        </div>

                        {/* Footer */}
                        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--pro-text-muted)]">
                          <span className="capitalize">{item.category || 'unknown'}</span>
                          <span className="text-[var(--pro-border-emphasis)]">|</span>
                          <span>{item.source_count} sources</span>
                          <span className="text-[var(--pro-border-emphasis)]">|</span>
                          <span>{item.story_count} stories</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeQueueTab === 'cases' && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center">
              <FolderKanban size={32} className="mx-auto mb-2 text-[var(--pro-text-disabled)]" />
              <p className="text-xs text-[var(--pro-text-muted)]">Investigation cases</p>
              <p className="text-[10px] text-[var(--pro-text-disabled)] mt-1">Coming soon</p>
            </div>
          </div>
        )}

        {activeQueueTab === 'watchlist' && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center">
              <Eye size={32} className="mx-auto mb-2 text-[var(--pro-text-disabled)]" />
              <p className="text-xs text-[var(--pro-text-muted)]">Entity watchlist</p>
              <p className="text-[10px] text-[var(--pro-text-disabled)] mt-1">Coming soon</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
