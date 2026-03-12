import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  ExternalLink,
  CheckCircle2,
  UploadCloud,
  XCircle,
  Save,
  Trash2,
  Plus,
  Loader2,
  FolderKanban,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
} from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  getEventDetail,
  updateEvent,
  publishEvent,
  rejectEvent,
  removeStoryFromCluster,
  addStoryToCluster,
  getCandidateStories,
  type OpsEventDetailResponse,
  type WorkflowStatus,
  type CandidateStory,
} from '../../api/ops'
import { createCase } from '../../api/collaboration'
import { getPublicEvent, type PublicEventDetail } from '../../api/publicEvents'
import { upsertPeerReview, type PeerReviewVerdict } from '../../api/peerReviews'

const CATEGORIES = ['political', 'security', 'disaster', 'economic', 'social'] as const
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

function severityColor(severity?: string | null) {
  const colors: Record<string, string> = {
    critical: 'border-l-[var(--pro-critical)]',
    high: 'border-l-[var(--pro-high)]',
    medium: 'border-l-[var(--pro-medium)]',
    low: 'border-l-[var(--pro-low)]',
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
    <span className={`px-2 py-1 text-xs font-semibold rounded border uppercase ${styles[status]}`}>
      {status}
    </span>
  )
}

export function MainCanvas() {
  const { selectedItemId, selectedItemType, canvasView } = useWorkspaceStore()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<OpsEventDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creatingCase, setCreatingCase] = useState(false)
  const [removingStoryId, setRemovingStoryId] = useState<string | null>(null)
  const [addingStoryId, setAddingStoryId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<CandidateStory[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)

  const [publicEvent, setPublicEvent] = useState<PublicEventDetail | null>(null)
  const [loadingPublicEvent, setLoadingPublicEvent] = useState(false)
  const [peerReviewVerdict, setPeerReviewVerdict] = useState<PeerReviewVerdict>('agree')
  const [peerReviewNotes, setPeerReviewNotes] = useState('')
  const [submittingPeerReview, setSubmittingPeerReview] = useState(false)

  // Draft fields for editing
  const [draftHeadline, setDraftHeadline] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [draftSeverity, setDraftSeverity] = useState('')
  const [draftBrief, setDraftBrief] = useState('')
  const [draftNotes, setDraftNotes] = useState('')

  // Load detail when selection changes
  useEffect(() => {
    const loadDetail = async () => {
      if (!selectedItemId || selectedItemType !== 'cluster') {
        setDetail(null)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const d = await getEventDetail(selectedItemId)
        setDetail(d)
        // Pre-fill drafts
        setDraftHeadline(d.headline || '')
        setDraftCategory(d.category || '')
        setDraftSeverity(d.severity || '')
        setDraftBrief(d.customer_brief || d.summary || '')
        setDraftNotes(d.analyst_notes || '')
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Failed to load event'
        if (errMsg.includes('404')) {
          setError('Event not found. This story may not be part of a cluster yet, or the cluster was removed.')
        } else {
          setError(errMsg)
        }
      } finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [selectedItemId, selectedItemType])

  // Load public metadata (peer review + citations counts) for published clusters
  useEffect(() => {
    const loadPublic = async () => {
      if (!selectedItemId || selectedItemType !== 'cluster' || !detail?.is_published) {
        setPublicEvent(null)
        return
      }

      setLoadingPublicEvent(true)
      try {
        const data = await getPublicEvent(selectedItemId)
        setPublicEvent(data)
      } catch {
        setPublicEvent(null)
      } finally {
        setLoadingPublicEvent(false)
      }
    }

    void loadPublic()
  }, [selectedItemId, selectedItemType, detail?.is_published])

  // Load candidate stories when cluster is selected
  useEffect(() => {
    const loadCandidates = async () => {
      if (!selectedItemId || selectedItemType !== 'cluster') {
        setCandidates([])
        return
      }

      setLoadingCandidates(true)
      try {
        const data = await getCandidateStories(selectedItemId, 15)
        setCandidates(data.candidates)
      } catch {
        // Silently fail - candidates are optional enhancement
        setCandidates([])
      } finally {
        setLoadingCandidates(false)
      }
    }
    loadCandidates()
  }, [selectedItemId, selectedItemType])

  const handleSave = async () => {
    if (!selectedItemId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateEvent(selectedItemId, {
        analyst_headline: draftHeadline || null,
        analyst_category: draftCategory || null,
        analyst_severity: draftSeverity || null,
        analyst_notes: draftNotes || null,
      })
      setDetail(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleVerify = async () => {
    if (!selectedItemId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateEvent(selectedItemId, {
        analyst_headline: draftHeadline || null,
        analyst_category: draftCategory || null,
        analyst_severity: draftSeverity || null,
        analyst_notes: draftNotes || null,
        workflow_status: 'verified',
      })
      setDetail(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to verify')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    if (!selectedItemId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await publishEvent(selectedItemId, {
        customer_brief: draftBrief || null,
        analyst_headline: draftHeadline || null,
        analyst_category: draftCategory || null,
        analyst_severity: draftSeverity || null,
      })
      setDetail(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setSaving(false)
    }
  }

  const handleReject = async () => {
    if (!selectedItemId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await rejectEvent(selectedItemId, draftNotes || undefined)
      setDetail(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateCase = async () => {
    if (!selectedItemId || !detail) return
    setCreatingCase(true)
    setError(null)
    try {
      const newCase = await createCase({
        title: detail.headline,
        hypothesis: (detail.customer_brief || detail.summary || '').slice(0, 2000) || undefined,
        priority: (detail.severity as any) || 'medium',
        linked_cluster_id: selectedItemId,
      })
      navigate(`/analyst?case=${newCase.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create case')
    } finally {
      setCreatingCase(false)
    }
  }

  const handleSubmitPeerReview = async () => {
    if (!selectedItemId || !detail?.is_published) return
    setSubmittingPeerReview(true)
    try {
      await upsertPeerReview(selectedItemId, {
        verdict: peerReviewVerdict,
        notes: peerReviewNotes.trim() || undefined,
      })
      setPeerReviewNotes('')
      // Refresh public metadata
      const refreshed = await getPublicEvent(selectedItemId)
      setPublicEvent(refreshed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit peer review')
    } finally {
      setSubmittingPeerReview(false)
    }
  }

  const handleRemoveStory = async (storyId: string) => {
    if (!selectedItemId) return

    // Confirm before removing
    const confirmed = window.confirm(
      'Remove this story from the cluster? It will return to the unclustered pool.'
    )
    if (!confirmed) return

    setRemovingStoryId(storyId)
    setError(null)
    try {
      const result = await removeStoryFromCluster(selectedItemId, storyId)
      // Refresh detail to show updated counts and stories
      const updated = await getEventDetail(selectedItemId)
      setDetail(updated)
      // Show success feedback briefly (could use toast in future)
      console.log(`Story removed: ${result.message}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove story')
    } finally {
      setRemovingStoryId(null)
    }
  }

  const handleAddStory = async (storyId: string, fromCluster?: string | null) => {
    if (!selectedItemId) return

    // Confirm if story is from another cluster
    if (fromCluster) {
      const confirmed = window.confirm(
        'This story is in another cluster. Move it to this cluster?'
      )
      if (!confirmed) return
    }

    setAddingStoryId(storyId)
    setError(null)
    try {
      await addStoryToCluster(selectedItemId, storyId)
      // Refresh detail and candidates
      const [updated, candidatesData] = await Promise.all([
        getEventDetail(selectedItemId),
        getCandidateStories(selectedItemId, 15),
      ])
      setDetail(updated)
      setCandidates(candidatesData.candidates)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add story')
    } finally {
      setAddingStoryId(null)
    }
  }

  // Empty state
  if (canvasView === 'empty' || !selectedItemId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4 text-[var(--pro-text-disabled)]" />
          <h2 className="text-lg font-medium text-[var(--pro-text-secondary)] mb-2">
            No Event Selected
          </h2>
          <p className="text-sm text-[var(--pro-text-muted)]">
            Select an event from the queue to view details
          </p>
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto mb-4 text-[var(--pro-accent)] animate-spin" />
          <p className="text-sm text-[var(--pro-text-muted)]">Loading event...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !detail) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <XCircle size={48} className="mx-auto mb-4 text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className={`p-6 border-b border-[var(--pro-border-subtle)] border-l-4 ${severityColor(detail.severity)}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {statusBadge(detail.workflow_status)}
              <span className="text-xs text-[var(--pro-text-muted)]">
                {detail.source_count} sources | {detail.story_count} stories
              </span>
            </div>
            <h1 className="text-xl font-semibold text-[var(--pro-text-primary)] leading-tight">
              {detail.headline}
            </h1>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* System vs Analyst comparison */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              System Headline
            </label>
            <p className="text-sm text-[var(--pro-text-secondary)] p-3 bg-[var(--pro-bg-surface)] rounded-lg border border-[var(--pro-border-subtle)]">
              {detail.system_headline}
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              Analyst Headline
            </label>
            <input
              value={draftHeadline}
              onChange={(e) => setDraftHeadline(e.target.value)}
              className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)] transition-colors"
              placeholder="Override headline..."
            />
          </div>
        </div>

        {/* Category and Severity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              Category
            </label>
            <select
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value)}
              className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)]"
            >
              <option value="">Auto: {detail.system_category || 'unknown'}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
              Severity
            </label>
            <select
              value={draftSeverity}
              onChange={(e) => setDraftSeverity(e.target.value)}
              className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)]"
            >
              <option value="">Auto: {detail.system_severity || 'unknown'}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Customer Brief */}
        <div>
          <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
            Customer Brief
          </label>
          <textarea
            value={draftBrief}
            onChange={(e) => setDraftBrief(e.target.value)}
            rows={4}
            className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
            placeholder="Write customer-facing summary..."
          />
        </div>

        {/* Analyst Notes */}
        <div>
          <label className="block text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide mb-1">
            Analyst Notes (Internal)
          </label>
          <textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            rows={3}
            className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
            placeholder="Internal analysis notes..."
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg text-sm text-[var(--pro-text-secondary)] hover:border-[var(--pro-border-default)] hover:text-[var(--pro-text-primary)] disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            Save
          </button>
          <button
            onClick={handleCreateCase}
            disabled={creatingCase || saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500/15 border border-blue-500/30 rounded-lg text-sm text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            title="Create a collaboration case linked to this event"
          >
            <FolderKanban size={14} />
            {creatingCase ? 'Creating…' : 'Create Case'}
          </button>
          <button
            onClick={handleVerify}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-green-500/15 border border-green-500/30 rounded-lg text-sm text-green-300 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={14} />
            Verify
          </button>
          <button
            onClick={handlePublish}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500/15 border border-purple-500/30 rounded-lg text-sm text-purple-300 hover:bg-purple-500/20 disabled:opacity-50 transition-colors"
          >
            <UploadCloud size={14} />
            Publish
          </button>
          <button
            onClick={handleReject}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 border border-red-500/30 rounded-lg text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
          >
            <XCircle size={14} />
            Reject
          </button>
        </div>

        {/* Peer Review (post-publication) */}
        {detail.is_published && (
          <div className="pt-4 border-t border-[var(--pro-border-subtle)]">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide flex items-center gap-2">
                <ShieldCheck size={14} className="text-[var(--pro-accent)]" />
                Peer Review
              </h2>
              {loadingPublicEvent && (
                <Loader2 size={14} className="text-[var(--pro-text-muted)] animate-spin" />
              )}
            </div>

            {publicEvent?.peer_review && (
              <div className="text-[11px] text-[var(--pro-text-muted)] mb-3 flex flex-wrap gap-3">
                <span className="font-mono">
                  state: {publicEvent.peer_review.peer_state}
                </span>
                <span className="font-mono">
                  agree: {publicEvent.peer_review.agree_count}
                </span>
                <span className="font-mono">
                  correction: {publicEvent.peer_review.needs_correction_count}
                </span>
                <span className="font-mono">
                  dispute: {publicEvent.peer_review.dispute_count}
                </span>
                {publicEvent.peer_review.official_confirmation === false && (
                  <span className="text-yellow-400 font-medium">Not officially confirmed</span>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-2">
              <button
                onClick={() => setPeerReviewVerdict('agree')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  peerReviewVerdict === 'agree'
                    ? 'bg-green-500/15 border-green-500/30 text-green-300'
                    : 'bg-[var(--pro-bg-elevated)] border-[var(--pro-border-subtle)] text-[var(--pro-text-muted)] hover:border-[var(--pro-border-default)]'
                }`}
              >
                <ThumbsUp size={14} />
                Reviewed
              </button>
              <button
                onClick={() => setPeerReviewVerdict('needs_correction')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  peerReviewVerdict === 'needs_correction'
                    ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300'
                    : 'bg-[var(--pro-bg-elevated)] border-[var(--pro-border-subtle)] text-[var(--pro-text-muted)] hover:border-[var(--pro-border-default)]'
                }`}
              >
                <MessageSquare size={14} />
                Needs correction
              </button>
              <button
                onClick={() => setPeerReviewVerdict('dispute')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  peerReviewVerdict === 'dispute'
                    ? 'bg-red-500/15 border-red-500/30 text-red-300'
                    : 'bg-[var(--pro-bg-elevated)] border-[var(--pro-border-subtle)] text-[var(--pro-text-muted)] hover:border-[var(--pro-border-default)]'
                }`}
              >
                <ThumbsDown size={14} />
                Dispute
              </button>
            </div>

            <textarea
              value={peerReviewNotes}
              onChange={(e) => setPeerReviewNotes(e.target.value)}
              rows={2}
              className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--pro-text-primary)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
              placeholder="Optional: add reasoning, corrections, or counter-evidence…"
            />

            <div className="flex justify-end mt-2">
              <button
                onClick={handleSubmitPeerReview}
                disabled={submittingPeerReview}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--pro-accent)] text-white rounded-lg hover:bg-[var(--pro-accent-hover)] disabled:opacity-50 transition-colors text-sm"
              >
                {submittingPeerReview ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                Submit Review
              </button>
            </div>
          </div>
        )}

        {/* Sources Section - CRITICAL FEATURE */}
        <div className="pt-4 border-t border-[var(--pro-border-subtle)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
              Sources ({detail.story_groups.length} groups, {detail.all_stories.length} stories)
            </h2>
            <button className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--pro-accent)] hover:bg-[var(--pro-accent-muted)] rounded transition-colors">
              <Plus size={12} />
              Add Story
            </button>
          </div>

          <div className="space-y-2">
            {detail.story_groups.map((group) => (
              <div
                key={group.canonical.id}
                className="p-3 bg-[var(--pro-bg-surface)] border border-[var(--pro-border-subtle)] rounded-lg group hover:border-[var(--pro-border-default)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-semibold text-[var(--pro-accent)] uppercase">
                        {group.canonical.source_name || group.canonical.source_id}
                      </span>
                      {group.duplicates.length > 0 && (
                        <span className="text-[10px] text-[var(--pro-text-muted)]">
                          +{group.duplicates.length} duplicates
                        </span>
                      )}
                    </div>
                    <a
                      href={group.canonical.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--pro-text-primary)] hover:text-[var(--pro-accent)] line-clamp-2"
                    >
                      {group.canonical.title}
                    </a>
                  </div>

                  {/* Action buttons (visible on hover) */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={group.canonical.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
                      title="Open source"
                    >
                      <ExternalLink size={14} />
                    </a>
                    <button
                      onClick={() => handleRemoveStory(group.canonical.id)}
                      disabled={removingStoryId === group.canonical.id}
                      className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                      title="Remove from cluster"
                    >
                      {removingStoryId === group.canonical.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Similar Stories - Candidates to Add */}
        <div className="pt-4 border-t border-[var(--pro-border-subtle)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
              Similar Stories {candidates.length > 0 && `(${candidates.length})`}
            </h2>
            {loadingCandidates && (
              <Loader2 size={14} className="text-[var(--pro-text-muted)] animate-spin" />
            )}
          </div>

          {candidates.length === 0 && !loadingCandidates ? (
            <p className="text-xs text-[var(--pro-text-muted)] py-2">
              No similar stories found to add
            </p>
          ) : (
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <div
                  key={candidate.story_id}
                  className="p-3 bg-[var(--pro-bg-surface)] border border-[var(--pro-border-subtle)] rounded-lg group hover:border-[var(--pro-border-default)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-semibold text-[var(--pro-accent)] uppercase">
                          {candidate.source_name || candidate.source_id}
                        </span>
                        <span className="px-1.5 py-0.5 text-[9px] font-mono bg-blue-500/15 text-blue-300 rounded">
                          {candidate.similarity}% match
                        </span>
                        {candidate.is_unclustered ? (
                          <span className="px-1.5 py-0.5 text-[9px] bg-green-500/15 text-green-300 rounded">
                            UNCLUSTERED
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[9px] bg-orange-500/15 text-orange-300 rounded" title={candidate.current_cluster_headline || undefined}>
                            IN OTHER CLUSTER
                          </span>
                        )}
                      </div>
                      <a
                        href={candidate.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[var(--pro-text-primary)] hover:text-[var(--pro-accent)] line-clamp-2"
                      >
                        {candidate.title}
                      </a>
                      {candidate.current_cluster_headline && (
                        <p className="text-[10px] text-[var(--pro-text-muted)] mt-1 truncate">
                          Currently in: {candidate.current_cluster_headline}
                        </p>
                      )}
                    </div>

                    {/* Add button */}
                    <button
                      onClick={() => handleAddStory(candidate.story_id, candidate.current_cluster_id)}
                      disabled={addingStoryId === candidate.story_id}
                      className="flex items-center gap-1 px-2 py-1.5 bg-green-500/15 border border-green-500/30 rounded text-xs text-green-300 hover:bg-green-500/20 disabled:opacity-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Add to this cluster"
                    >
                      {addingStoryId === candidate.story_id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Plus size={12} />
                      )}
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Related Events (Other Clusters) */}
        {detail.related_events.length > 0 && (
          <div className="pt-4 border-t border-[var(--pro-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide mb-3">
              Related Events ({detail.related_events.length})
            </h2>
            <div className="space-y-2">
              {detail.related_events.map((rel) => (
                <div
                  key={rel.cluster_id}
                  className="p-3 bg-[var(--pro-bg-surface)] border border-[var(--pro-border-subtle)] rounded-lg hover:border-[var(--pro-border-default)] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1 text-[10px] text-[var(--pro-text-muted)]">
                    <span className="font-mono">{(rel.similarity * 100).toFixed(0)}% match</span>
                    <span>|</span>
                    <span className="capitalize">{rel.category}</span>
                    <span>|</span>
                    <span className="capitalize">{rel.severity}</span>
                  </div>
                  <p className="text-sm text-[var(--pro-text-primary)] line-clamp-2">{rel.headline}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
