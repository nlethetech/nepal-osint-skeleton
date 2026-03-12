import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileWarning, Sparkles, Target } from 'lucide-react'
import {
  approveDevelopingStory,
  approveFactCheck,
  approveStoryTracker,
  fetchDevelopingStoryDetail,
  fetchDevelopingStoriesInbox,
  fetchFactCheckDetail,
  fetchFactCheckInbox,
  fetchStoryTrackerInbox,
  patchDevelopingStory,
  patchFactCheck,
  patchStoryTracker,
  rejectDevelopingStory,
  rejectFactCheck,
  rejectStoryTracker,
  rerunDevelopingStory,
  rerunFactCheck,
  rerunStoryTracker,
} from '../../api/editorial'
import { ActionReasonModal } from './ActionReasonModal'

const PAGE_SIZE = 40

type EditorialSection = 'fact-checks' | 'developing' | 'tracker'

type PendingModalAction =
  | { type: 'factCheckSave' | 'factCheckApprove' | 'factCheckReject' | 'factCheckSuppress' | 'factCheckRerun'; id: string }
  | { type: 'clusterSave' | 'clusterApprove' | 'clusterReject' | 'clusterRerun'; id: string }
  | { type: 'trackerSave' | 'trackerApprove' | 'trackerReject' | 'trackerRerun'; id: string }
  | null

function formatRelative(value?: string | null) {
  if (!value) return 'never'
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function QueueItem({
  title,
  meta,
  active,
  status,
  onClick,
}: {
  title: string
  meta: string
  active: boolean
  status: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
        active
          ? 'border-blue-400/30 bg-blue-500/10'
          : 'border-white/8 bg-black/20 hover:border-white/20'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="line-clamp-2 text-sm font-medium text-white">{title}</div>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
          {status}
        </span>
      </div>
      <div className="mt-2 text-xs text-white/40">{meta}</div>
    </button>
  )
}

function QueuePagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/8 pt-3 text-xs text-white/40">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <span>Page {page} / {Math.max(totalPages, 1)}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages || 1, page + 1))}
          disabled={page >= totalPages}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          Next
        </button>
      </div>
    </div>
  )
}

function QueueColumn({
  items,
  pagination,
}: {
  items: ReactNode
  pagination: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto pr-1">{items}</div>
      <div className="mt-3">{pagination}</div>
    </div>
  )
}

function DetailColumn({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-y-auto pr-1">{children}</div>
}

function SectionShell({
  icon,
  title,
  description,
  queue,
  detail,
}: {
  icon: ReactNode
  title: string
  description: string
  queue: ReactNode
  detail: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0e1220]">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex items-center gap-2 text-white">
          <span className="text-blue-400">{icon}</span>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        <p className="mt-1 text-sm text-white/45">{description}</p>
      </div>
      <div className="grid min-h-[calc(100vh-360px)] grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden border-r border-white/8 p-4">{queue}</div>
        <div className="min-h-0 overflow-hidden p-5">{detail}</div>
      </div>
    </section>
  )
}

export function EditorialControlPanel() {
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState<EditorialSection>('fact-checks')
  const [factCheckId, setFactCheckId] = useState<string | null>(null)
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [trackerId, setTrackerId] = useState<string | null>(null)
  const [factCheckPage, setFactCheckPage] = useState(1)
  const [clusterPage, setClusterPage] = useState(1)
  const [trackerPage, setTrackerPage] = useState(1)
  const [pendingAction, setPendingAction] = useState<PendingModalAction>(null)

  const factCheckInbox = useQuery({
    queryKey: ['editorial-fact-check-inbox', factCheckPage],
    queryFn: () => fetchFactCheckInbox({ page: factCheckPage, per_page: PAGE_SIZE }),
    refetchInterval: 60000,
  })
  const clusterInbox = useQuery({
    queryKey: ['editorial-developing-inbox', clusterPage],
    queryFn: () => fetchDevelopingStoriesInbox({ page: clusterPage, per_page: PAGE_SIZE }),
    refetchInterval: 60000,
  })
  const trackerInbox = useQuery({
    queryKey: ['editorial-story-tracker-inbox', trackerPage],
    queryFn: () => fetchStoryTrackerInbox({ page: trackerPage, per_page: PAGE_SIZE }),
    refetchInterval: 60000,
  })

  useEffect(() => {
    const firstId = factCheckInbox.data?.items[0]?.story_id
    const exists = factCheckInbox.data?.items.some((item) => item.story_id === factCheckId)
    if (firstId && (!factCheckId || !exists)) setFactCheckId(firstId)
  }, [factCheckInbox.data, factCheckId])

  useEffect(() => {
    const firstId = clusterInbox.data?.items[0]?.cluster_id
    const exists = clusterInbox.data?.items.some((item) => item.cluster_id === clusterId)
    if (firstId && (!clusterId || !exists)) setClusterId(firstId)
  }, [clusterInbox.data, clusterId])

  useEffect(() => {
    const firstId = trackerInbox.data?.items[0]?.narrative_id
    const exists = trackerInbox.data?.items.some((item) => item.narrative_id === trackerId)
    if (firstId && (!trackerId || !exists)) setTrackerId(firstId)
  }, [trackerInbox.data, trackerId])

  const factCheckDetail = useQuery({
    queryKey: ['editorial-fact-check-detail', factCheckId],
    queryFn: () => fetchFactCheckDetail(factCheckId!),
    enabled: Boolean(factCheckId),
  })

  const clusterDetail = useQuery({
    queryKey: ['editorial-developing-detail', clusterId],
    queryFn: () => fetchDevelopingStoryDetail(clusterId!),
    enabled: Boolean(clusterId),
  })

  const [factCheckDraft, setFactCheckDraft] = useState({
    final_verdict: '',
    final_verdict_summary: '',
    final_confidence: '',
    final_key_finding: '',
    final_context: '',
    override_notes: '',
  })
  const [clusterDraft, setClusterDraft] = useState({
    analyst_headline: '',
    analyst_summary: '',
    analyst_category: '',
    analyst_severity: '',
    analyst_notes: '',
  })
  const [trackerDraft, setTrackerDraft] = useState({
    label: '',
    thesis: '',
    review_notes: '',
  })

  useEffect(() => {
    const item = factCheckDetail.data
    if (!item) return
    setFactCheckDraft({
      final_verdict: item.review.final_verdict || item.effective.verdict || '',
      final_verdict_summary: item.review.final_verdict_summary || item.effective.verdict_summary || '',
      final_confidence: item.review.final_confidence != null ? String(item.review.final_confidence) : String(item.effective.confidence),
      final_key_finding: item.review.final_key_finding || item.effective.key_finding || '',
      final_context: item.review.final_context || item.effective.context || '',
      override_notes: item.review.override_notes || '',
    })
  }, [factCheckDetail.data])

  useEffect(() => {
    const item = clusterDetail.data
    if (!item) return
    setClusterDraft({
      analyst_headline: item.headline || '',
      analyst_summary: item.summary || '',
      analyst_category: item.category || '',
      analyst_severity: item.severity || '',
      analyst_notes: item.analyst_notes || '',
    })
  }, [clusterDetail.data])

  useEffect(() => {
    const item = trackerInbox.data?.items.find((entry) => entry.narrative_id === trackerId)
    if (!item) return
    setTrackerDraft({
      label: item.label || '',
      thesis: item.thesis || '',
      review_notes: item.review_notes || '',
    })
  }, [trackerInbox.data, trackerId])

  const selectedTracker = useMemo(
    () => trackerInbox.data?.items.find((entry) => entry.narrative_id === trackerId) || null,
    [trackerInbox.data, trackerId],
  )

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['editorial-overview'] })
    queryClient.invalidateQueries({ queryKey: ['editorial-fact-check-inbox'] })
    queryClient.invalidateQueries({ queryKey: ['editorial-fact-check-detail'] })
    queryClient.invalidateQueries({ queryKey: ['editorial-developing-inbox'] })
    queryClient.invalidateQueries({ queryKey: ['editorial-developing-detail'] })
    queryClient.invalidateQueries({ queryKey: ['editorial-story-tracker-inbox'] })
  }

  const actionMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: PendingModalAction; reason: string }) => {
      if (!action) return null

      if (action.type === 'factCheckSave' && factCheckId) {
        return patchFactCheck(factCheckId, {
          ...factCheckDraft,
          final_confidence: Number(factCheckDraft.final_confidence),
          reason,
        })
      }
      if (action.type === 'factCheckApprove' && factCheckId) return approveFactCheck(factCheckId, reason)
      if (action.type === 'factCheckReject' && factCheckId) return rejectFactCheck(factCheckId, reason, 'rejected')
      if (action.type === 'factCheckSuppress' && factCheckId) return rejectFactCheck(factCheckId, reason, 'suppressed')
      if (action.type === 'factCheckRerun' && factCheckId) return rerunFactCheck(factCheckId, reason)

      if (action.type === 'clusterSave' && clusterId) return patchDevelopingStory(clusterId, { ...clusterDraft, reason })
      if (action.type === 'clusterApprove' && clusterId) return approveDevelopingStory(clusterId, reason)
      if (action.type === 'clusterReject' && clusterId) return rejectDevelopingStory(clusterId, reason)
      if (action.type === 'clusterRerun' && clusterId) return rerunDevelopingStory(clusterId, reason)

      if (action.type === 'trackerSave' && trackerId) return patchStoryTracker(trackerId, { ...trackerDraft, reason })
      if (action.type === 'trackerApprove' && trackerId) return approveStoryTracker(trackerId, reason)
      if (action.type === 'trackerReject' && trackerId) return rejectStoryTracker(trackerId, reason)
      if (action.type === 'trackerRerun' && trackerId) return rerunStoryTracker(trackerId, reason)

      return null
    },
    onSuccess: () => {
      invalidateAll()
      setPendingAction(null)
    },
  })

  const modalCopy = useMemo(() => {
    if (!pendingAction) return null
    const map: Record<Exclude<PendingModalAction, null>['type'], { title: string; description: string; confirmLabel: string }> = {
      factCheckSave: {
        title: 'Save fact-check override',
        description: 'This updates the internal override draft and returns the item to pending review.',
        confirmLabel: 'Save override',
      },
      factCheckApprove: {
        title: 'Approve fact-check',
        description: 'The approved version becomes the public fact-check result.',
        confirmLabel: 'Approve fact-check',
      },
      factCheckReject: {
        title: 'Reject fact-check',
        description: 'This removes the system output from public use but preserves the raw result internally.',
        confirmLabel: 'Reject fact-check',
      },
      factCheckSuppress: {
        title: 'Suppress fact-check',
        description: 'Suppress hides the result from public use without deleting the raw system output.',
        confirmLabel: 'Suppress result',
      },
      factCheckRerun: {
        title: 'Request fact-check rerun',
        description: 'This flags the story for regeneration by the fact-check worker.',
        confirmLabel: 'Request rerun',
      },
      clusterSave: {
        title: 'Save developing-story draft',
        description: 'This stores developer overrides for the developing story.',
        confirmLabel: 'Save draft',
      },
      clusterApprove: {
        title: 'Approve developing story',
        description: 'This marks the story cluster as verified.',
        confirmLabel: 'Approve story',
      },
      clusterReject: {
        title: 'Reject developing story',
        description: 'This marks the story cluster as rejected for editorial feeds.',
        confirmLabel: 'Reject story',
      },
      clusterRerun: {
        title: 'Rerun BLUF generation',
        description: 'This regenerates the developing-story BLUF for the selected cluster.',
        confirmLabel: 'Rerun BLUF',
      },
      trackerSave: {
        title: 'Save story-tracker draft',
        description: 'This updates the narrative label, thesis, or review notes.',
        confirmLabel: 'Save draft',
      },
      trackerApprove: {
        title: 'Approve story-tracker narrative',
        description: 'This marks the narrative as approved for ongoing tracker use.',
        confirmLabel: 'Approve narrative',
      },
      trackerReject: {
        title: 'Reject story-tracker narrative',
        description: 'This removes the narrative from approved tracker use.',
        confirmLabel: 'Reject narrative',
      },
      trackerRerun: {
        title: 'Queue story-tracker rerun',
        description: 'This queues a tracker refresh while keeping the current record for context.',
        confirmLabel: 'Queue rerun',
      },
    }
    return map[pendingAction.type]
  }, [pendingAction])

  const sectionTabs = [
    { key: 'fact-checks' as const, label: 'Fact Checks', count: factCheckInbox.data?.total || 0 },
    { key: 'developing' as const, label: 'Developing Stories', count: clusterInbox.data?.total || 0 },
    { key: 'tracker' as const, label: 'Story Tracker', count: trackerInbox.data?.total || 0 },
  ]

  const factCheckSection = (
    <SectionShell
      icon={<FileWarning size={16} />}
      title="Fact-Check Moderation"
      description="Raw system verdicts, internal overrides, and developer approval flow for public fact checks."
      queue={
        <QueueColumn
          items={
            <div className="space-y-3">
              {(factCheckInbox.data?.items || []).map((item) => (
                <QueueItem
                  key={item.story_id}
                  title={item.title || item.raw.verdict_summary}
                  meta={`${item.source_name || 'Unknown source'} · ${item.request_count} requests · ${formatRelative(item.checked_at)}`}
                  active={factCheckId === item.story_id}
                  status={item.review.workflow_status}
                  onClick={() => setFactCheckId(item.story_id)}
                />
              ))}
            </div>
          }
          pagination={
            <QueuePagination
              page={factCheckInbox.data?.page || factCheckPage}
              totalPages={factCheckInbox.data?.total_pages || 1}
              total={factCheckInbox.data?.total || 0}
              onPageChange={setFactCheckPage}
            />
          }
        />
      }
      detail={
        !factCheckDetail.data ? (
          <div className="text-sm text-white/35">Select a fact-check from the queue.</div>
        ) : (
          <DetailColumn>
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-white">{factCheckDetail.data.title}</h3>
                  <p className="mt-1 text-sm text-white/45">
                    {factCheckDetail.data.source_name || 'Unknown source'} · {formatRelative(factCheckDetail.data.checked_at)}
                  </p>
                </div>
                {factCheckDetail.data.url && (
                  <a href={factCheckDetail.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/55 hover:border-white/20 hover:text-white transition-colors">
                    <ExternalLink size={14} />
                    Source
                  </a>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-white/35">Raw System Output</div>
                <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-sm text-white">Verdict</div>
                    <div className="mt-1 text-sm text-white/65">{factCheckDetail.data.raw.verdict}</div>
                  </div>
                  <div>
                    <div className="text-sm text-white">Confidence</div>
                    <div className="mt-1 text-sm text-white/65">{Math.round(factCheckDetail.data.raw.confidence * 100)}%</div>
                  </div>
                  <div className="text-sm text-white/60 lg:col-span-2">{factCheckDetail.data.raw.verdict_summary}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Final Verdict</label>
                  <input value={factCheckDraft.final_verdict} onChange={(event) => setFactCheckDraft((prev) => ({ ...prev, final_verdict: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Final Confidence</label>
                  <input value={factCheckDraft.final_confidence} onChange={(event) => setFactCheckDraft((prev) => ({ ...prev, final_confidence: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Final Verdict Summary</label>
                  <textarea value={factCheckDraft.final_verdict_summary} onChange={(event) => setFactCheckDraft((prev) => ({ ...prev, final_verdict_summary: event.target.value }))} className="min-h-28 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Key Finding</label>
                  <textarea value={factCheckDraft.final_key_finding} onChange={(event) => setFactCheckDraft((prev) => ({ ...prev, final_key_finding: event.target.value }))} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Context</label>
                  <textarea value={factCheckDraft.final_context} onChange={(event) => setFactCheckDraft((prev) => ({ ...prev, final_context: event.target.value }))} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Override Notes</label>
                  <textarea value={factCheckDraft.override_notes} onChange={(event) => setFactCheckDraft((prev) => ({ ...prev, override_notes: event.target.value }))} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPendingAction({ type: 'factCheckSave', id: factCheckDetail.data.story_id })} className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-200 hover:bg-blue-500/20 transition-colors">Save Draft</button>
                <button type="button" onClick={() => setPendingAction({ type: 'factCheckApprove', id: factCheckDetail.data.story_id })} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/20 transition-colors">Approve</button>
                <button type="button" onClick={() => setPendingAction({ type: 'factCheckReject', id: factCheckDetail.data.story_id })} className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 transition-colors">Reject</button>
                <button type="button" onClick={() => setPendingAction({ type: 'factCheckSuppress', id: factCheckDetail.data.story_id })} className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 hover:bg-amber-500/20 transition-colors">Suppress</button>
                <button type="button" onClick={() => setPendingAction({ type: 'factCheckRerun', id: factCheckDetail.data.story_id })} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60 hover:border-white/20 hover:text-white transition-colors">Request Rerun</button>
              </div>
            </div>
          </DetailColumn>
        )
      }
    />
  )

  const developingSection = (
    <SectionShell
      icon={<Sparkles size={16} />}
      title="Developing Stories"
      description="Developer overrides, verification, and BLUF reruns for fast-moving event clusters."
      queue={
        <QueueColumn
          items={
            <div className="space-y-3">
              {(clusterInbox.data?.items || []).map((item) => (
                <QueueItem
                  key={item.cluster_id}
                  title={item.headline}
                  meta={`${item.source_count} sources · ${item.story_count} stories · ${formatRelative(item.last_updated)}`}
                  active={clusterId === item.cluster_id}
                  status={item.workflow_status}
                  onClick={() => setClusterId(item.cluster_id)}
                />
              ))}
            </div>
          }
          pagination={
            <QueuePagination
              page={clusterInbox.data?.page || clusterPage}
              totalPages={clusterInbox.data?.total_pages || 1}
              total={clusterInbox.data?.total || 0}
              onPageChange={setClusterPage}
            />
          }
        />
      }
      detail={
        !clusterDetail.data ? (
          <div className="text-sm text-white/35">Select a developing story from the queue.</div>
        ) : (
          <DetailColumn>
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-semibold text-white">{clusterDetail.data.headline}</h3>
                <p className="mt-1 text-sm text-white/45">
                  {clusterDetail.data.story_count} stories · {clusterDetail.data.source_count} sources · {formatRelative(clusterDetail.data.last_updated)}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
                <div className="text-xs uppercase tracking-[0.22em] text-white/35">System Draft</div>
                <div className="mt-3 space-y-2">
                  <div><span className="text-white/35">Headline:</span> {clusterDetail.data.system_headline}</div>
                  <div><span className="text-white/35">Summary:</span> {clusterDetail.data.system_summary || 'No summary'}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Headline Override</label>
                  <input value={clusterDraft.analyst_headline} onChange={(event) => setClusterDraft((prev) => ({ ...prev, analyst_headline: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Category</label>
                  <input value={clusterDraft.analyst_category} onChange={(event) => setClusterDraft((prev) => ({ ...prev, analyst_category: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Severity</label>
                  <input value={clusterDraft.analyst_severity} onChange={(event) => setClusterDraft((prev) => ({ ...prev, analyst_severity: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Summary Override</label>
                  <textarea value={clusterDraft.analyst_summary} onChange={(event) => setClusterDraft((prev) => ({ ...prev, analyst_summary: event.target.value }))} className="min-h-28 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Internal Notes</label>
                  <textarea value={clusterDraft.analyst_notes} onChange={(event) => setClusterDraft((prev) => ({ ...prev, analyst_notes: event.target.value }))} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-white/35">Evidence Stories</div>
                <div className="mt-3 space-y-3">
                  {clusterDetail.data.stories.map((story) => (
                    <div key={story.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                      <div className="text-sm text-white">{story.title}</div>
                      <div className="mt-1 text-xs text-white/40">{story.source_name || 'Unknown source'} · {formatRelative(story.published_at)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPendingAction({ type: 'clusterSave', id: clusterDetail.data.cluster_id })} className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-200 hover:bg-blue-500/20 transition-colors">Save Draft</button>
                <button type="button" onClick={() => setPendingAction({ type: 'clusterApprove', id: clusterDetail.data.cluster_id })} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/20 transition-colors">Approve</button>
                <button type="button" onClick={() => setPendingAction({ type: 'clusterReject', id: clusterDetail.data.cluster_id })} className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 transition-colors">Reject</button>
                <button type="button" onClick={() => setPendingAction({ type: 'clusterRerun', id: clusterDetail.data.cluster_id })} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60 hover:border-white/20 hover:text-white transition-colors">Rerun BLUF</button>
              </div>
            </div>
          </DetailColumn>
        )
      }
    />
  )

  const trackerSection = (
    <SectionShell
      icon={<Target size={16} />}
      title="Story Tracker"
      description="Narrative-level tracker controls for strategic labels, theses, approval state, and refresh requests."
      queue={
        <QueueColumn
          items={
            <div className="space-y-3">
              {(trackerInbox.data?.items || []).map((item) => (
                <QueueItem
                  key={item.narrative_id}
                  title={item.label}
                  meta={`${item.cluster_count} clusters · ${item.category || 'uncategorized'} · ${formatRelative(item.last_updated)}`}
                  active={trackerId === item.narrative_id}
                  status={item.workflow_status}
                  onClick={() => setTrackerId(item.narrative_id)}
                />
              ))}
            </div>
          }
          pagination={
            <QueuePagination
              page={trackerInbox.data?.page || trackerPage}
              totalPages={trackerInbox.data?.total_pages || 1}
              total={trackerInbox.data?.total || 0}
              onPageChange={setTrackerPage}
            />
          }
        />
      }
      detail={
        !selectedTracker ? (
          <div className="text-sm text-white/35">Select a narrative from the tracker queue.</div>
        ) : (
          <DetailColumn>
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-semibold text-white">{selectedTracker.label}</h3>
                <p className="mt-1 text-sm text-white/45">
                  {selectedTracker.cluster_count} clusters · {selectedTracker.direction || 'stable'} · {formatRelative(selectedTracker.last_updated)}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Narrative Label</label>
                  <input value={trackerDraft.label} onChange={(event) => setTrackerDraft((prev) => ({ ...prev, label: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Thesis</label>
                  <textarea value={trackerDraft.thesis} onChange={(event) => setTrackerDraft((prev) => ({ ...prev, thesis: event.target.value }))} className="min-h-28 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-white/35">Review Notes</label>
                  <textarea value={trackerDraft.review_notes} onChange={(event) => setTrackerDraft((prev) => ({ ...prev, review_notes: event.target.value }))} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-white/35">Linked Clusters</div>
                <div className="mt-3 space-y-3">
                  {selectedTracker.clusters.map((cluster) => (
                    <div key={cluster.cluster_id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                      <div className="text-sm text-white">{cluster.headline}</div>
                      <div className="mt-1 text-xs text-white/40">
                        {cluster.source_count} sources · {cluster.story_count} stories · {formatRelative(cluster.last_updated)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPendingAction({ type: 'trackerSave', id: selectedTracker.narrative_id })} className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-200 hover:bg-blue-500/20 transition-colors">Save Draft</button>
                <button type="button" onClick={() => setPendingAction({ type: 'trackerApprove', id: selectedTracker.narrative_id })} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/20 transition-colors">Approve</button>
                <button type="button" onClick={() => setPendingAction({ type: 'trackerReject', id: selectedTracker.narrative_id })} className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 transition-colors">Reject</button>
                <button type="button" onClick={() => setPendingAction({ type: 'trackerRerun', id: selectedTracker.narrative_id })} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60 hover:border-white/20 hover:text-white transition-colors">Queue Refresh</button>
              </div>
            </div>
          </DetailColumn>
        )
      }
    />
  )

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {sectionTabs.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => setActiveSection(section.key)}
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              activeSection === section.key
                ? 'border-blue-400/30 bg-blue-500/10 text-blue-200'
                : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white'
            }`}
          >
            {section.label}
            <span className="ml-2 text-white/35">{section.count}</span>
          </button>
        ))}
      </div>

      {activeSection === 'fact-checks' && factCheckSection}
      {activeSection === 'developing' && developingSection}
      {activeSection === 'tracker' && trackerSection}

      {pendingAction && modalCopy && (
        <ActionReasonModal
          isOpen
          title={modalCopy.title}
          description={modalCopy.description}
          confirmLabel={modalCopy.confirmLabel}
          isLoading={actionMutation.isPending}
          onClose={() => setPendingAction(null)}
          onConfirm={(reason) => actionMutation.mutate({ action: pendingAction, reason })}
        />
      )}
    </section>
  )
}
