import { useEffect, useState, useMemo } from 'react'
import {
  X,
  Newspaper,
  FileText,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Eye,
  Edit3,
} from 'lucide-react'
import { useCaseEvidence } from '../../api/hooks/useCollaboration'
import { publishCase, updateCase } from '../../api/collaboration'
import { getEventInbox, type OpsEventInboxItem } from '../../api/ops'
import type { Case, CaseEvidence } from '../../api/collaboration'

interface PublishCaseModalProps {
  caseData: Case
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function PublishCaseModal({ caseData, isOpen, onClose, onSuccess }: PublishCaseModalProps) {
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [editableHeadline, setEditableHeadline] = useState(caseData.title)
  const [editableSummary, setEditableSummary] = useState(
    caseData.conclusion || caseData.hypothesis || ''
  )
  const [changeNote, setChangeNote] = useState('')
  const [linkClusterId, setLinkClusterId] = useState<string>(caseData.linked_cluster_id || '')
  const [recentEvents, setRecentEvents] = useState<OpsEventInboxItem[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [isPreviewMode, setIsPreviewMode] = useState(true)

  // Fetch evidence for the case
  const { data: evidence, isLoading: evidenceLoading } = useCaseEvidence(caseData.id)

  // Key evidence items
  const keyEvidence = useMemo(() => {
    if (!evidence) return []
    return evidence.filter((e) => e.is_key_evidence)
  }, [evidence])

  // Reset modal-local state on open
  useEffect(() => {
    if (!isOpen) return
    setPublishError(null)
    setIsPreviewMode(true)
    setEditableHeadline(caseData.title)
    setEditableSummary(caseData.conclusion || caseData.hypothesis || '')
    setChangeNote('')
    setLinkClusterId(caseData.linked_cluster_id || '')
  }, [isOpen, caseData])

  // Load recent events for linking (only if case is not already linked)
  useEffect(() => {
    const loadRecent = async () => {
      if (!isOpen) return
      if (caseData.linked_cluster_id) return
      setLoadingEvents(true)
      try {
        const inbox = await getEventInbox({ hours: 72, limit: 25, includePublished: true })
        setRecentEvents(inbox.items)
      } catch {
        setRecentEvents([])
      } finally {
        setLoadingEvents(false)
      }
    }

    void loadRecent()
  }, [isOpen, caseData.linked_cluster_id])

  const handlePublish = async () => {
    setIsPublishing(true)
    setPublishError(null)

    try {
      const targetClusterId = caseData.linked_cluster_id || linkClusterId
      if (!targetClusterId) {
        setPublishError('This case is not linked to an event. Link an event before publishing.')
        return
      }

      // Link case -> event if needed
      if (!caseData.linked_cluster_id) {
        await updateCase(caseData.id, { linked_cluster_id: targetClusterId })
      }

      await publishCase(caseData.id, {
        headline: editableHeadline,
        category: caseData.category || undefined,
        severity: caseData.priority,
        customer_brief: editableSummary,
        change_note: changeNote.trim() || undefined,
      })

      onSuccess?.()
      handleClose()
    } catch (err) {
      const message =
        (err as any)?.response?.data?.detail ||
        (err as any)?.message ||
        'Failed to publish case. Please try again.'
      setPublishError(message)
    } finally {
      setIsPublishing(false)
    }
  }

  const handleClose = () => {
    setPublishError(null)
    setIsPreviewMode(true)
    onClose()
  }

  const getCategoryColor = (category?: string | null) => {
    switch (category) {
      case 'security':
        return 'bg-red-500/20 text-red-400'
      case 'political':
        return 'bg-blue-500/20 text-blue-400'
      case 'disaster':
        return 'bg-orange-500/20 text-orange-400'
      case 'economic':
        return 'bg-green-500/20 text-green-400'
      case 'social':
        return 'bg-purple-500/20 text-purple-400'
      default:
        return 'bg-gray-500/20 text-gray-400'
    }
  }

  const getSeverityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-500/20 text-red-400'
      case 'high':
        return 'bg-orange-500/20 text-orange-400'
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-400'
      case 'low':
        return 'bg-green-500/20 text-green-400'
      default:
        return 'bg-gray-500/20 text-gray-400'
    }
  }

  if (!isOpen) return null

  // Check if case is ready to publish
  const canPublish =
    caseData.status !== 'draft' &&
    (caseData.conclusion || caseData.hypothesis) &&
    (evidence?.length || 0) > 0 &&
    (!!caseData.linked_cluster_id || !!linkClusterId) &&
    editableSummary.trim().length > 0

  const publishWarnings: string[] = []
  if (!caseData.linked_cluster_id && !linkClusterId) {
    publishWarnings.push('Case is not linked to an event cluster')
  }
  if (!editableSummary.trim()) {
    publishWarnings.push('Summary is empty')
  }
  if (!caseData.conclusion && !caseData.hypothesis) {
    publishWarnings.push('No hypothesis or conclusion written')
  }
  if (!evidence || evidence.length === 0) {
    publishWarnings.push('No evidence linked to this case')
  }
  if (keyEvidence.length === 0 && evidence && evidence.length > 0) {
    publishWarnings.push('No key evidence marked')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--pro-bg-surface)] border border-[var(--pro-border-default)] rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--pro-border-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Newspaper size={16} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--pro-text-primary)]">
                Publish as Story
              </h2>
              <p className="text-[10px] text-[var(--pro-text-muted)]">
                Share your findings with the community
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="px-5 py-2 border-b border-[var(--pro-border-subtle)] flex gap-2">
          <button
            onClick={() => setIsPreviewMode(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              isPreviewMode
                ? 'bg-[var(--pro-accent)] text-white'
                : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
            }`}
          >
            <Eye size={12} />
            Preview
          </button>
          <button
            onClick={() => setIsPreviewMode(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              !isPreviewMode
                ? 'bg-[var(--pro-accent)] text-white'
                : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
            }`}
          >
            <Edit3 size={12} />
            Edit
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isPreviewMode ? (
            /* Preview Mode */
            <div className="p-5">
              {/* Story Preview Card */}
              <div className="bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-xl overflow-hidden">
                {/* Header badges */}
                <div className="px-4 py-2 border-b border-[var(--pro-border-subtle)] flex items-center gap-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${getCategoryColor(caseData.category)}`}>
                    {caseData.category || 'General'}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${getSeverityColor(caseData.priority)}`}>
                    {caseData.priority}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
                    Analyst Report
                  </span>
                </div>

                {/* Headline */}
                <div className="p-4">
                  <h3 className="text-base font-semibold text-[var(--pro-text-primary)] mb-2">
                    {editableHeadline}
                  </h3>
                  <p className="text-xs text-[var(--pro-text-secondary)] leading-relaxed">
                    {editableSummary}
                  </p>
                </div>

                {/* Evidence sources */}
                {evidence && evidence.length > 0 && (
                  <div className="px-4 py-3 border-t border-[var(--pro-border-subtle)]">
                    <h4 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-2">
                      Sources ({evidence.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {evidence.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-1.5 px-2 py-1 bg-[var(--pro-bg-surface)] rounded text-[10px] text-[var(--pro-text-secondary)]"
                        >
                          {item.evidence_type === 'story' ? (
                            <Newspaper size={10} className="text-blue-400" />
                          ) : (
                            <FileText size={10} className="text-purple-400" />
                          )}
                          <span className="truncate max-w-[120px]">{item.title}</span>
                          {item.is_key_evidence && (
                            <CheckCircle size={10} className="text-yellow-400" />
                          )}
                        </div>
                      ))}
                      {evidence.length > 5 && (
                        <span className="text-[10px] text-[var(--pro-text-muted)] px-2 py-1">
                          +{evidence.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Author */}
                <div className="px-4 py-2 border-t border-[var(--pro-border-subtle)] flex items-center justify-between text-[10px] text-[var(--pro-text-disabled)]">
                  <span>By {caseData.created_by.full_name || caseData.created_by.email.split('@')[0]}</span>
                  <span>Just now</span>
                </div>
              </div>

              {/* Warnings */}
              {publishWarnings.length > 0 && (
                <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-yellow-400 mb-1">Before publishing</p>
                      <ul className="text-[10px] text-yellow-400/80 space-y-0.5">
                        {publishWarnings.map((warning, i) => (
                          <li key={i}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Edit Mode */
            <div className="p-5 space-y-4">
              {/* Link to Event (required) */}
              {caseData.linked_cluster_id ? (
                <div className="p-3 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg">
                  <p className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
                    Linked Event
                  </p>
                  <p className="text-xs text-[var(--pro-text-secondary)] font-mono mt-1">
                    {caseData.linked_cluster_id}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                    Link to Event (required)
                  </label>
                  <select
                    value={linkClusterId}
                    onChange={(e) => setLinkClusterId(e.target.value)}
                    className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)]"
                  >
                    <option value="">
                      {loadingEvents ? 'Loading events…' : 'Select an event'}
                    </option>
                    {recentEvents.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.headline}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--pro-text-disabled)] mt-1">
                    Tip: Create cases from `/workspace` to auto-link them to an event.
                  </p>
                </div>
              )}

              {/* Headline */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Headline
                </label>
                <input
                  type="text"
                  value={editableHeadline}
                  onChange={(e) => setEditableHeadline(e.target.value)}
                  className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)]"
                />
              </div>

              {/* Summary */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Summary
                </label>
                <textarea
                  value={editableSummary}
                  onChange={(e) => setEditableSummary(e.target.value)}
                  rows={6}
                  className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
                  placeholder="Write a clear summary of your findings..."
                />
                <p className="text-[10px] text-[var(--pro-text-disabled)] mt-1">
                  Publishing enforces multi-source corroboration (prefers official + independent).
                </p>
              </div>

              {/* Update note (optional) */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Update Note (optional)
                </label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)]"
                  placeholder="What changed and why?"
                />
              </div>

              {/* Evidence list */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Linked Evidence
                </label>
                {evidenceLoading ? (
                  <div className="mt-2 flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-[var(--pro-text-muted)]" />
                  </div>
                ) : evidence && evidence.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {evidence.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 p-2 bg-[var(--pro-bg-elevated)] rounded-lg"
                      >
                        {item.evidence_type === 'story' ? (
                          <Newspaper size={12} className="text-blue-400 flex-shrink-0" />
                        ) : (
                          <FileText size={12} className="text-purple-400 flex-shrink-0" />
                        )}
                        <span className="flex-1 text-[11px] text-[var(--pro-text-secondary)] truncate">
                          {item.title}
                        </span>
                        {item.is_key_evidence && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                            KEY
                          </span>
                        )}
                        {item.reference_url && (
                          <a
                            href={item.reference_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-[var(--pro-text-muted)] hover:text-[var(--pro-accent)]"
                          >
                            <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 p-3 bg-[var(--pro-bg-elevated)] rounded-lg text-center">
                    <p className="text-[10px] text-[var(--pro-text-muted)]">
                      No evidence linked to this case
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error message */}
        {publishError && (
          <div className="px-5 py-2 bg-red-500/10 border-t border-red-500/20">
            <p className="text-xs text-red-400">{publishError}</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--pro-border-subtle)] flex items-center justify-between">
          <p className="text-[10px] text-[var(--pro-text-disabled)]">
            Publishing will share this case with all NARADA users
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-xs text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={!canPublish || isPublishing}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPublishing ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Newspaper size={12} />
                  Publish Story
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
