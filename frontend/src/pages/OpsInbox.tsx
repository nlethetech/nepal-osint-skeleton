import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, UploadCloud, Link2, AlertTriangle, CheckCircle } from 'lucide-react'
import {
  getEventInbox,
  getEventDetail,
  publishEvent,
  rejectEvent,
  updateEvent,
  type OpsEventDetailResponse,
  type OpsEventInboxItem,
  type WorkflowStatus,
} from '../api/ops'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

const CATEGORIES = ['political', 'security', 'disaster', 'economic', 'social'] as const
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

function formatAge(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return '-'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function statusBadge(status: WorkflowStatus) {
  const styles: Record<WorkflowStatus, string> = {
    unreviewed: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    monitoring: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    verified: 'bg-green-500/15 text-green-300 border-green-500/30',
    published: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
  }
  return <span className={`px-2 py-0.5 text-xs rounded border ${styles[status]}`}>{status}</span>
}

export default function OpsInbox() {
  const [items, setItems] = useState<OpsEventInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OpsEventDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false)

  // Draft edits (analyst overrides + customer brief)
  const [draftHeadline, setDraftHeadline] = useState('')
  const [draftCategory, setDraftCategory] = useState<string>('')
  const [draftSeverity, setDraftSeverity] = useState<string>('')
  const [draftBrief, setDraftBrief] = useState('')
  const [draftNotes, setDraftNotes] = useState('')

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId],
  )

  const loadInbox = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getEventInbox({
        hours: 72,
        limit: 80,
        minAgeMinutes: 30,
        needsReviewOnly
      })
      setItems(data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInbox()
    const interval = setInterval(loadInbox, 60_000)
    return () => clearInterval(interval)
  }, [needsReviewOnly])

  useEffect(() => {
    const loadDetail = async () => {
      if (!selectedId) {
        setDetail(null)
        return
      }
      setDetailLoading(true)
      setError(null)
      try {
        const d = await getEventDetail(selectedId)
        setDetail(d)

        // Pre-fill drafts
        setDraftHeadline(d.headline || '')
        setDraftCategory(d.category || '')
        setDraftSeverity(d.severity || '')
        setDraftBrief(d.customer_brief || d.summary || '')
        setDraftNotes(d.analyst_notes || '')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load event detail')
      } finally {
        setDetailLoading(false)
      }
    }
    loadDetail()
  }, [selectedId])

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateEvent(selectedId, {
        analyst_headline: draftHeadline || null,
        analyst_category: draftCategory || null,
        analyst_severity: draftSeverity || null,
        analyst_notes: draftNotes || null,
      })
      setDetail(updated)
      await loadInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleVerify = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateEvent(selectedId, {
        analyst_headline: draftHeadline || null,
        analyst_category: draftCategory || null,
        analyst_severity: draftSeverity || null,
        analyst_notes: draftNotes || null,
        workflow_status: 'verified',
      })
      setDetail(updated)
      await loadInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to verify')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await publishEvent(
        selectedId,
        {
          customer_brief: draftBrief || null,
          analyst_headline: draftHeadline || null,
          analyst_category: draftCategory || null,
          analyst_severity: draftSeverity || null,
        },
        30,
      )
      setDetail(updated)
      await loadInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setSaving(false)
    }
  }

  const handleReject = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await rejectEvent(selectedId, draftNotes || undefined)
      setDetail(updated)
      await loadInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h1 className="text-xl font-semibold text-osint-text">Ops Inbox</h1>
          <p className="text-sm text-osint-muted">Verify events, collapse duplicates, and publish to customers</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNeedsReviewOnly(!needsReviewOnly)}
            className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
              needsReviewOnly
                ? 'bg-orange-500/15 border-orange-500/40 text-orange-200'
                : 'bg-osint-card border-osint-border text-osint-text hover:border-osint-accent/50'
            }`}
          >
            <AlertTriangle size={14} />
            {needsReviewOnly ? 'Needs Review' : 'All Events'}
          </button>
          <button
            onClick={loadInbox}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-osint-card border border-osint-border rounded-lg text-sm hover:border-osint-accent/50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Inbox list */}
        <div className="lg:col-span-1 bg-osint-card border border-osint-border rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-osint-border flex items-center justify-between">
            <span className="text-sm font-medium text-osint-text">Candidate Events</span>
            <span className="text-xs text-osint-muted">{items.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4">
                <LoadingSpinner message="Loading inbox..." />
              </div>
            ) : items.length === 0 ? (
              <div className="p-6 text-sm text-osint-muted">No events in inbox (last 72h).</div>
            ) : (
              <div className="divide-y divide-osint-border">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left p-4 hover:bg-osint-surface transition-colors ${
                      selectedId === item.id ? 'bg-osint-surface' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {statusBadge(item.workflow_status)}
                      {item.uncertainty_score >= 0.5 ? (
                        <span className="review-badge needs-review">NEEDS REVIEW</span>
                      ) : (
                        <span className="review-badge auto-ok">AUTO-OK</span>
                      )}
                      {item.ready_for_publish && (
                        <span className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-300 border-green-500/30">
                          ready
                        </span>
                      )}
                      <span className="ml-auto text-xs text-osint-muted tabular-nums">
                        age {formatAge(item.age_minutes)}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-osint-text line-clamp-2">{item.headline}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-osint-muted">
                      <span className="capitalize">{item.category || 'unknown'}</span>
                      <span>•</span>
                      <span className="capitalize">{item.severity || 'low'}</span>
                      <span>•</span>
                      <span>{item.source_count} sources</span>
                      <span>•</span>
                      <span>{item.story_count} stories</span>
                    </div>
                    {item.reasons.length > 0 && (
                      <div className="mt-2 text-[11px] text-osint-muted">
                        Needs review: {item.reasons.join(', ')}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2 bg-osint-card border border-osint-border rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-osint-border flex items-center justify-between">
            <span className="text-sm font-medium text-osint-text">Event Detail</span>
            {selectedItem && (
              <div className="flex items-center gap-2">
                {statusBadge(selectedItem.workflow_status)}
                <span className="text-xs text-osint-muted tabular-nums">
                  impact {(selectedItem.impact_score * 100).toFixed(0)}% • uncertainty{' '}
                  {(selectedItem.uncertainty_score * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          {!selectedId ? (
            <div className="p-6 text-sm text-osint-muted">Select an event from the inbox to review.</div>
          ) : detailLoading || !detail ? (
            <div className="p-6">
              <LoadingSpinner message="Loading event..." />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* System vs analyst */}
              <div className="space-y-2">
                <div className="text-xs text-osint-muted">System headline</div>
                <div className="text-sm text-osint-text-secondary">{detail.system_headline}</div>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs text-osint-muted mb-1">Analyst headline</label>
                  <input
                    value={draftHeadline}
                    onChange={(e) => setDraftHeadline(e.target.value)}
                    className="w-full bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text focus:outline-none focus:border-osint-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-osint-muted mb-1">Category</label>
                  <select
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    className="w-full bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text"
                  >
                    <option value="">(unchanged)</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-osint-muted mb-1">Severity</label>
                  <select
                    value={draftSeverity}
                    onChange={(e) => setDraftSeverity(e.target.value)}
                    className="w-full bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text"
                  >
                    <option value="">(unchanged)</option>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-osint-muted mb-1">Customer brief</label>
                  <textarea
                    value={draftBrief}
                    onChange={(e) => setDraftBrief(e.target.value)}
                    rows={4}
                    className="w-full bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text focus:outline-none focus:border-osint-accent"
                    placeholder="Write a short, customer-facing brief with sources/citations."
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-osint-muted mb-1">Analyst notes (internal)</label>
                  <textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    rows={3}
                    className="w-full bg-osint-surface border border-osint-border rounded-lg px-3 py-2 text-sm text-osint-text focus:outline-none focus:border-osint-accent"
                    placeholder="Why this matters, uncertainty, what to watch next…"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-2 bg-osint-surface border border-osint-border rounded-lg text-sm text-osint-text hover:border-osint-accent/50 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={handleVerify}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2 bg-green-500/15 border border-green-500/30 rounded-lg text-sm text-green-200 hover:bg-green-500/20 disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  Verify
                </button>
                <button
                  onClick={handlePublish}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-500/15 border border-purple-500/30 rounded-lg text-sm text-purple-200 hover:bg-purple-500/20 disabled:opacity-50"
                >
                  <UploadCloud size={14} />
                  Publish
                </button>
                <button
                  onClick={handleReject}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2 bg-red-500/15 border border-red-500/30 rounded-lg text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                >
                  <XCircle size={14} />
                  Reject
                </button>
              </div>

              {/* Evidence groups (soft dedup) */}
              <div>
                <h2 className="text-sm font-medium text-osint-text mb-2">Evidence (soft dedup)</h2>
                <div className="space-y-2">
                  {detail.story_groups.map((g) => (
                    <div key={g.canonical.id} className="bg-osint-surface border border-osint-border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs text-osint-muted">
                            {g.canonical.source_name || g.canonical.source_id}{' '}
                            {g.duplicates.length > 0 && (
                              <span className="ml-2 text-[11px] text-osint-muted">
                                +{g.duplicates.length} duplicates
                              </span>
                            )}
                          </div>
                          <a
                            href={g.canonical.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-osint-text hover:text-osint-accent line-clamp-2"
                          >
                            {g.canonical.title}
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Related events */}
              {detail.related_events.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-osint-text mb-2">Related events (embeddings)</h2>
                  <div className="space-y-2">
                    {detail.related_events.map((r) => (
                      <div key={r.cluster_id} className="bg-osint-surface border border-osint-border rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-osint-muted mb-1">
                          <Link2 size={12} />
                          <span>sim {(r.similarity * 100).toFixed(0)}%</span>
                          <span className="capitalize">{r.category || 'unknown'}</span>
                          <span className="capitalize">{r.severity || 'low'}</span>
                        </div>
                        <div className="text-sm text-osint-text line-clamp-2">{r.headline}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

