import { useState, useMemo } from 'react'
import {
  FolderKanban,
  Plus,
  Clock,
  FileText,
  MessageSquare,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Minus,
  LogIn,
} from 'lucide-react'
import { useCases, useCreateCase } from '../../api/hooks/useCollaboration'
import { useAnalystCenterStore } from '../../stores/analystCenterStore'
import { useAuthStore } from '../../store/slices/authSlice'
import type { Case, CaseStatus, CasePriority } from '../../api/collaboration'

export interface CaseBoardPanelProps {
  selectedCaseId?: string | null
  onSelectCase?: (caseId: string | null) => void
  onRequestNewCase?: () => void
  newCaseModalOpen?: boolean
  onNewCaseModalOpenChange?: (open: boolean) => void
  newCaseLinkedClusterId?: string | null
}

const STATUS_COLUMNS: { key: CaseStatus; label: string; color: string }[] = [
  { key: 'draft', label: 'Draft', color: 'text-[var(--pro-text-muted)]' },
  { key: 'active', label: 'Active', color: 'text-blue-400' },
  { key: 'review', label: 'Review', color: 'text-yellow-400' },
  { key: 'closed', label: 'Closed', color: 'text-green-400' },
]

const PRIORITY_ICONS: Record<CasePriority, { icon: typeof AlertTriangle; color: string }> = {
  critical: { icon: AlertTriangle, color: 'text-red-400' },
  high: { icon: AlertCircle, color: 'text-orange-400' },
  medium: { icon: Minus, color: 'text-yellow-400' },
  low: { icon: Minus, color: 'text-green-400' },
}

// Demo cases for when API is unavailable
const DEMO_CASES: Case[] = [
  {
    id: 'demo-1',
    title: 'Border Activity Investigation - Birgunj Checkpoint',
    description: 'Unusual patterns detected at border crossing',
    status: 'active',
    priority: 'high',
    visibility: 'team',
    category: 'security',
    tags: ['border', 'smuggling'],
    created_by: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
    assigned_to: null,
    team_id: null,
    linked_cluster_id: null,
    hypothesis: 'Potential organized smuggling network',
    conclusion: null,
    evidence_count: 5,
    comment_count: 3,
    started_at: new Date().toISOString(),
    closed_at: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    title: 'Election Misinformation Tracking - Kathmandu Valley',
    description: 'Coordinated disinformation campaign detected',
    status: 'active',
    priority: 'critical',
    visibility: 'public',
    category: 'political',
    tags: ['election', 'disinformation'],
    created_by: { id: 'demo-user-2', email: 'senior@narada.io', full_name: 'Senior Analyst' },
    assigned_to: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
    team_id: null,
    linked_cluster_id: null,
    hypothesis: 'Foreign actor involvement suspected',
    conclusion: null,
    evidence_count: 12,
    comment_count: 8,
    started_at: new Date().toISOString(),
    closed_at: null,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'demo-3',
    title: 'Flood Impact Assessment - Koshi Basin',
    description: 'Damage assessment from recent flooding',
    status: 'review',
    priority: 'high',
    visibility: 'public',
    category: 'disaster',
    tags: ['flood', 'damage'],
    created_by: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
    assigned_to: null,
    team_id: null,
    linked_cluster_id: null,
    hypothesis: null,
    conclusion: 'Over 500 households affected, 3 bridges damaged',
    evidence_count: 8,
    comment_count: 5,
    started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    closed_at: null,
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
]

function CaseCard({
  caseItem,
  onClick,
  isSelected,
}: {
  caseItem: Case
  onClick: () => void
  isSelected?: boolean
}) {
  const priority = PRIORITY_ICONS[caseItem.priority]
  const PriorityIcon = priority.icon

  const ageText = (() => {
    const created = new Date(caseItem.created_at)
    const now = new Date()
    const diffMs = now.getTime() - created.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays > 0) return `${diffDays}d`
    return `${diffHours}h`
  })()

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 bg-[var(--pro-bg-elevated)] hover:bg-[var(--pro-bg-hover)] border rounded-lg transition-colors group relative ${
        isSelected
          ? 'border-[var(--pro-accent)] bg-[var(--pro-accent-muted)]'
          : 'border-[var(--pro-border-subtle)]'
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <PriorityIcon size={12} className={`mt-0.5 ${priority.color}`} />
        <p className="text-xs font-medium text-[var(--pro-text-primary)] line-clamp-2 flex-1">
          {caseItem.title}
        </p>
      </div>

      <div className="flex items-center justify-between text-[10px] text-[var(--pro-text-muted)]">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-0.5">
            <FileText size={10} />
            {caseItem.evidence_count}
          </span>
          <span className="flex items-center gap-0.5">
            <MessageSquare size={10} />
            {caseItem.comment_count}
          </span>
        </div>
        <span className="flex items-center gap-0.5">
          <Clock size={10} />
          {ageText}
        </span>
      </div>

      {caseItem.assigned_to && (
        <div className="mt-2 pt-2 border-t border-[var(--pro-border-subtle)]">
          <p className="text-[10px] text-[var(--pro-text-disabled)]">
            {caseItem.assigned_to.full_name || caseItem.assigned_to.email}
          </p>
        </div>
      )}

      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <ChevronRight size={14} className="text-[var(--pro-text-muted)]" />
      </div>
    </button>
  )
}

function NewCaseModal({
  isOpen,
  onClose,
  onCreated,
  linkedClusterId,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated?: (created: Case) => void
  linkedClusterId?: string | null
}) {
  const [title, setTitle] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [priority, setPriority] = useState<CasePriority>('medium')
  const createCase = useCreateCase()
  const { isAuthenticated } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    if (!isAuthenticated) {
      alert('Please log in to create cases')
      onClose()
      return
    }

    try {
      const created = await createCase.mutateAsync({
        title: title.trim(),
        hypothesis: hypothesis.trim() || undefined,
        priority,
        linked_cluster_id: linkedClusterId || undefined,
      })
      onCreated?.(created)
      setTitle('')
      setHypothesis('')
      setPriority('medium')
      onClose()
    } catch (err) {
      console.error('Failed to create case:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--pro-bg-surface)] border border-[var(--pro-border-default)] rounded-lg p-4 w-96 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--pro-text-primary)] mb-4">New Case</h3>

        {linkedClusterId && (
          <div className="mb-4 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-[10px] text-blue-300">
            Linked to event cluster: <span className="font-mono">{linkedClusterId}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief case title..."
              className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              Initial Hypothesis
            </label>
            <textarea
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="What do you suspect is happening?"
              rows={3}
              className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              Priority
            </label>
            <div className="flex gap-2">
              {(['critical', 'high', 'medium', 'low'] as CasePriority[]).map((p) => {
                const info = PRIORITY_ICONS[p]
                const Icon = info.icon
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors ${
                      priority === p
                        ? `${info.color} border-current bg-current/10`
                        : 'text-[var(--pro-text-muted)] border-[var(--pro-border-subtle)] hover:border-[var(--pro-border-default)]'
                    }`}
                  >
                    <Icon size={10} />
                    <span className="capitalize">{p}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createCase.isPending}
              className="px-3 py-1.5 text-xs font-medium bg-[var(--pro-accent)] text-white rounded-lg hover:bg-[var(--pro-accent-hover)] transition-colors disabled:opacity-50"
            >
              {createCase.isPending ? 'Creating...' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function CaseBoardPanel({
  selectedCaseId: selectedCaseIdProp,
  onSelectCase,
  onRequestNewCase,
  newCaseModalOpen,
  onNewCaseModalOpenChange,
  newCaseLinkedClusterId,
}: CaseBoardPanelProps) {
  const [internalShowNewCase, setInternalShowNewCase] = useState(false)
  const [activeStatus, setActiveStatus] = useState<CaseStatus | 'all'>('all')
  const { selectedCaseId: fallbackSelectedCaseId, setSelectedCase: fallbackSetSelectedCase } = useAnalystCenterStore()
  const { isAuthenticated } = useAuthStore()

  const selectedCaseId = selectedCaseIdProp ?? fallbackSelectedCaseId
  const selectCase = onSelectCase ?? fallbackSetSelectedCase

  const { data: casesData, isLoading, error } = useCases({
    status: activeStatus === 'all' ? undefined : activeStatus,
    limit: 50,
  })

  // Use demo data when not authenticated or on error
  const cases = useMemo(() => {
    if (casesData?.items && casesData.items.length > 0) {
      return casesData.items
    }
    // Return demo data when API fails or returns empty
    if (error || !isAuthenticated) {
      return DEMO_CASES.filter(c => activeStatus === 'all' || c.status === activeStatus)
    }
    return []
  }, [casesData, error, isAuthenticated, activeStatus])

  const isUsingDemo = (!casesData?.items || casesData.items.length === 0) && cases.length > 0

  // Group cases by status for kanban view
  const casesByStatus = STATUS_COLUMNS.reduce(
    (acc, col) => {
      acc[col.key] = cases.filter((c) => c.status === col.key)
      return acc
    },
    {} as Record<CaseStatus, Case[]>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FolderKanban size={14} className="text-[var(--pro-accent)]" />
            <h2 className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
              Cases
            </h2>
            {cases.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[var(--pro-bg-elevated)] text-[var(--pro-text-muted)] rounded">
                {cases.length}
              </span>
            )}
            {isUsingDemo && (
              <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                Demo
              </span>
            )}
          </div>
          <button
            onClick={() => {
              onRequestNewCase?.()
              if (onNewCaseModalOpenChange) {
                onNewCaseModalOpenChange(true)
                return
              }
              setInternalShowNewCase(true)
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-[var(--pro-accent)] text-white rounded hover:bg-[var(--pro-accent-hover)] transition-colors"
          >
            <Plus size={10} />
            New Case
          </button>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveStatus('all')}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${
              activeStatus === 'all'
                ? 'bg-[var(--pro-accent)] text-white'
                : 'text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)]'
            }`}
          >
            All
          </button>
          {STATUS_COLUMNS.map((col) => (
            <button
              key={col.key}
              onClick={() => setActiveStatus(col.key)}
              className={`px-2 py-1 text-[10px] rounded transition-colors ${
                activeStatus === col.key
                  ? `bg-[var(--pro-accent)] text-white`
                  : `${col.color} hover:bg-[var(--pro-bg-hover)]`
              }`}
            >
              {col.label}
              {casesByStatus[col.key]?.length > 0 && (
                <span className="ml-1 opacity-70">({casesByStatus[col.key].length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Login prompt for non-authenticated users */}
      {!isAuthenticated && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
          <div className="flex items-center gap-2 text-[10px] text-blue-400">
            <LogIn size={12} />
            <span>Log in as analyst to create and manage cases</span>
          </div>
        </div>
      )}

      {/* Cases List */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-[var(--pro-bg-elevated)] rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div className="text-center py-8">
            <FolderKanban size={24} className="mx-auto text-[var(--pro-text-disabled)] mb-2" />
            <p className="text-xs text-[var(--pro-text-muted)] mb-1">No cases yet</p>
            <p className="text-[10px] text-[var(--pro-text-disabled)]">
              Create your first case to start investigating
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {cases.map((caseItem) => (
              <CaseCard
                key={caseItem.id}
                caseItem={caseItem}
                isSelected={selectedCaseId === caseItem.id}
                onClick={() => selectCase(caseItem.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewCaseModal
        isOpen={newCaseModalOpen ?? internalShowNewCase}
        onClose={() => {
          if (onNewCaseModalOpenChange) {
            onNewCaseModalOpenChange(false)
            return
          }
          setInternalShowNewCase(false)
        }}
        onCreated={(created) => {
          selectCase(created.id)
        }}
        linkedClusterId={newCaseLinkedClusterId}
      />
    </div>
  )
}
