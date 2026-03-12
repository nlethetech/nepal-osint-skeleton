import { useState, useEffect, useCallback } from 'react'
import {
  getReviewStats,
  getPendingLinkReviews,
  getPendingMergeReviews,
  getPendingEntities,
  approveLink,
  rejectLink,
  approveMerge,
  rejectMerge,
  approvePendingEntity,
  rejectPendingEntity,
  mergePendingEntity,
  searchKBEntities,
  runAutoLinking,
  detectDuplicates,
  type ReviewStats,
  type LinkReviewItem,
  type MergeReviewItem,
  type PendingEntityItem,
  type KBEntitySearchResult,
} from '../api/reviewQueue'
import {
  getRecentClassifications,
  submitClassificationFeedback,
  getAccuracyMetrics,
  type ClassificationItem,
  type AccuracyMetrics,
} from '../api/pipelineFeedback'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

// Entity type colors
const TYPE_COLORS: Record<string, string> = {
  PERSON: 'bg-red-500/20 text-red-400 border-red-500/30',
  PARTY: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  LOCATION: 'bg-green-500/20 text-green-400 border-green-500/30',
  ORG: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  CONSTITUENCY: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

// Category colors for classification display
const CATEGORY_COLORS: Record<string, string> = {
  disaster: 'bg-red-500/20 text-red-400 border-red-500/30',
  security: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  crime: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  political: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  economic: 'bg-green-500/20 text-green-400 border-green-500/30',
  social: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-amber-400',
  low: 'text-zinc-400',
}

const ALL_CATEGORIES = ['political', 'economic', 'social', 'crime', 'disaster', 'security']

type TabType = 'classifications' | 'links' | 'merges' | 'pending'

export default function ReviewQueue() {
  const [activeTab, setActiveTab] = useState<TabType>('classifications')
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [linkReviews, setLinkReviews] = useState<LinkReviewItem[]>([])
  const [mergeReviews, setMergeReviews] = useState<MergeReviewItem[]>([])
  const [pendingEntities, setPendingEntities] = useState<PendingEntityItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [classifications, setClassifications] = useState<ClassificationItem[]>([])
  const [accuracyMetrics, setAccuracyMetrics] = useState<AccuracyMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [runningJob, setRunningJob] = useState(false)
  const [detectingDuplicates, setDetectingDuplicates] = useState(false)

  const reviewer = 'analyst' // Would come from auth context in production

  const loadStats = useCallback(async () => {
    try {
      const data = await getReviewStats()
      setStats(data)
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }, [])

  const loadLinkReviews = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getPendingLinkReviews(page, 20)
      setLinkReviews(data.reviews)
      setTotal(data.total)
    } catch (error) {
      console.error('Failed to load link reviews:', error)
    } finally {
      setLoading(false)
    }
  }, [page])

  const loadMergeReviews = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getPendingMergeReviews(page, 20)
      setMergeReviews(data.reviews)
      setTotal(data.total)
    } catch (error) {
      console.error('Failed to load merge reviews:', error)
    } finally {
      setLoading(false)
    }
  }, [page])

  const loadPendingEntities = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getPendingEntities(page, 20)
      setPendingEntities(data.entities)
      setTotal(data.total)
      setPendingCount(data.total)
    } catch (error) {
      console.error('Failed to load pending entities:', error)
    } finally {
      setLoading(false)
    }
  }, [page])

  const loadClassifications = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRecentClassifications(page, 20, 'confidence_asc')
      setClassifications(data.items)
      setTotal(data.total)
    } catch (error) {
      console.error('Failed to load classifications:', error)
    } finally {
      setLoading(false)
    }
  }, [page])

  const loadAccuracyMetrics = useCallback(async () => {
    try {
      const data = await getAccuracyMetrics(30)
      setAccuracyMetrics(data)
    } catch (error) {
      console.error('Failed to load accuracy metrics:', error)
    }
  }, [])

  useEffect(() => {
    loadStats()
    loadAccuracyMetrics()
    getPendingEntities(1, 1).then(data => setPendingCount(data.total)).catch(() => {})
  }, [loadStats, loadAccuracyMetrics])

  useEffect(() => {
    if (activeTab === 'classifications') {
      loadClassifications()
    } else if (activeTab === 'links') {
      loadLinkReviews()
    } else if (activeTab === 'merges') {
      loadMergeReviews()
    } else {
      loadPendingEntities()
    }
  }, [activeTab, loadClassifications, loadLinkReviews, loadMergeReviews, loadPendingEntities])

  const handleApproveLink = async (linkId: string) => {
    setProcessing(linkId)
    try {
      await approveLink(linkId, reviewer)
      setLinkReviews((prev) => prev.filter((r) => r.link_id !== linkId))
      loadStats()
    } catch (error) {
      console.error('Failed to approve link:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleRejectLink = async (linkId: string) => {
    setProcessing(linkId)
    try {
      await rejectLink(linkId, reviewer)
      setLinkReviews((prev) => prev.filter((r) => r.link_id !== linkId))
      loadStats()
    } catch (error) {
      console.error('Failed to reject link:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleApproveMerge = async (mergeId: string) => {
    setProcessing(mergeId)
    try {
      await approveMerge(mergeId, reviewer)
      setMergeReviews((prev) => prev.filter((r) => r.merge_request_id !== mergeId))
      loadStats()
    } catch (error) {
      console.error('Failed to approve merge:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleRejectMerge = async (mergeId: string, addToCannotLink: boolean = false) => {
    setProcessing(mergeId)
    try {
      await rejectMerge(mergeId, reviewer, undefined, addToCannotLink)
      setMergeReviews((prev) => prev.filter((r) => r.merge_request_id !== mergeId))
      loadStats()
    } catch (error) {
      console.error('Failed to reject merge:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleApprovePendingEntity = async (pendingId: string) => {
    setProcessing(pendingId)
    try {
      await approvePendingEntity(pendingId, reviewer)
      setPendingEntities((prev) => prev.filter((e) => e.id !== pendingId))
      setPendingCount((prev) => prev - 1)
    } catch (error) {
      console.error('Failed to approve pending entity:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleRejectPendingEntity = async (pendingId: string, reason: string) => {
    setProcessing(pendingId)
    try {
      await rejectPendingEntity(pendingId, reviewer, reason)
      setPendingEntities((prev) => prev.filter((e) => e.id !== pendingId))
      setPendingCount((prev) => prev - 1)
    } catch (error) {
      console.error('Failed to reject pending entity:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleMergePendingEntity = async (pendingId: string, targetEntityId: string) => {
    setProcessing(pendingId)
    try {
      await mergePendingEntity(pendingId, reviewer, targetEntityId)
      setPendingEntities((prev) => prev.filter((e) => e.id !== pendingId))
      setPendingCount((prev) => prev - 1)
    } catch (error) {
      console.error('Failed to merge pending entity:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleClassificationFeedback = async (
    storyId: string,
    systemCategory: string,
    humanCategory: string,
    confidence?: number,
  ) => {
    setProcessing(storyId)
    try {
      await submitClassificationFeedback(storyId, systemCategory, humanCategory, confidence)
      // Update local state to mark as corrected
      setClassifications((prev) =>
        prev.map((item) =>
          item.story_id === storyId
            ? { ...item, is_corrected: true, corrected_category: humanCategory }
            : item
        )
      )
      loadAccuracyMetrics()
    } catch (error) {
      console.error('Failed to submit classification feedback:', error)
    } finally {
      setProcessing(null)
    }
  }

  const handleRunAutoLinking = async () => {
    setRunningJob(true)
    try {
      await runAutoLinking(50, true, true)
      loadStats()
      if (activeTab === 'links') {
        loadLinkReviews()
      } else if (activeTab === 'merges') {
        loadMergeReviews()
      } else {
        loadPendingEntities()
      }
    } catch (error) {
      console.error('Failed to run auto-linking:', error)
    } finally {
      setRunningJob(false)
    }
  }

  const handleDetectDuplicates = async () => {
    setDetectingDuplicates(true)
    try {
      const result = await detectDuplicates()
      loadStats()
      if (activeTab === 'merges') {
        loadMergeReviews()
      }
      alert(result.message)
    } catch (error) {
      console.error('Failed to detect duplicates:', error)
    } finally {
      setDetectingDuplicates(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Entity Review Queue</h1>
          <p className="text-zinc-400 mt-1">
            Review and approve entity suggestions, links, and merge proposals
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDetectDuplicates}
            disabled={detectingDuplicates}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800
                       text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            {detectingDuplicates ? (
              <>
                <LoadingSpinner size="sm" />
                Detecting...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Detect Duplicates
              </>
            )}
          </button>
          <button
            onClick={handleRunAutoLinking}
            disabled={runningJob}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800
                       text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            {runningJob ? (
              <>
                <LoadingSpinner size="sm" />
                Running...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Run Auto-Linking
              </>
            )}
          </button>
        </div>
      </div>

      {/* Accuracy Metrics Widget */}
      {accuracyMetrics && (
        <div className="bg-osint-card border border-osint-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-zinc-300">Pipeline Accuracy</div>
            <div className="text-xs text-zinc-500">Last {accuracyMetrics.window_days} days</div>
          </div>
          <div className="grid grid-cols-6 gap-3">
            <div>
              <div className={`text-2xl font-bold ${
                accuracyMetrics.overall_accuracy >= 0.8 ? 'text-green-400' :
                accuracyMetrics.overall_accuracy >= 0.5 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {accuracyMetrics.total_reviewed > 0
                  ? `${(accuracyMetrics.overall_accuracy * 100).toFixed(0)}%`
                  : '—'}
              </div>
              <div className="text-zinc-500 text-xs">Overall</div>
            </div>
            {Object.entries(accuracyMetrics.per_category_accuracy).slice(0, 3).map(([cat, acc]) => (
              <div key={cat}>
                <div className={`text-lg font-bold ${
                  acc >= 0.8 ? 'text-green-400' :
                  acc >= 0.5 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {(acc * 100).toFixed(0)}%
                </div>
                <div className="text-zinc-500 text-xs capitalize">{cat}</div>
              </div>
            ))}
            <div>
              <div className="text-lg font-bold text-cyan-400">
                {accuracyMetrics.rl_samples.classification}
              </div>
              <div className="text-zinc-500 text-xs">
                RL Samples / {accuracyMetrics.rl_thresholds.classifier_min}
              </div>
            </div>
            <div>
              <div className="text-lg font-bold text-zinc-300">
                {accuracyMetrics.total_reviewed}
              </div>
              <div className="text-zinc-500 text-xs">Reviewed</div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-3xl font-bold text-cyan-400">
              {pendingCount}
            </div>
            <div className="text-zinc-400 text-sm">Pending Entities</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-3xl font-bold text-amber-400">
              {stats.pending_link_reviews}
            </div>
            <div className="text-zinc-400 text-sm">Pending Link Reviews</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-3xl font-bold text-purple-400">
              {stats.pending_merge_reviews}
            </div>
            <div className="text-zinc-400 text-sm">Pending Merge Reviews</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-3xl font-bold text-green-400">
              {stats.reviewed_today}
            </div>
            <div className="text-zinc-400 text-sm">Reviewed Today</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-400">
              {stats.auto_linked_total}
            </div>
            <div className="text-zinc-400 text-sm">Auto-Linked Total</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-osint-border">
        <button
          onClick={() => { setActiveTab('classifications'); setPage(1) }}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'classifications'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-zinc-400 hover:text-white'
          }`}
        >
          Classifications
        </button>
        <button
          onClick={() => { setActiveTab('pending'); setPage(1) }}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'pending'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-zinc-400 hover:text-white'
          }`}
        >
          Entity Suggestions ({pendingCount})
        </button>
        <button
          onClick={() => { setActiveTab('links'); setPage(1) }}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'links'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-zinc-400 hover:text-white'
          }`}
        >
          Link Reviews ({stats?.pending_link_reviews || 0})
        </button>
        <button
          onClick={() => { setActiveTab('merges'); setPage(1) }}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'merges'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-zinc-400 hover:text-white'
          }`}
        >
          Merge Reviews ({stats?.pending_merge_reviews || 0})
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : activeTab === 'classifications' ? (
        <div className="space-y-3">
          {classifications.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              No classified stories yet. Pipeline will process stories every 5 minutes.
            </div>
          ) : (
            classifications.map((item) => (
              <ClassificationCard
                key={item.story_id}
                item={item}
                processing={processing === item.story_id}
                onConfirm={() => handleClassificationFeedback(
                  item.story_id,
                  item.category || 'unknown',
                  item.category || 'unknown',
                  item.confidence ?? undefined,
                )}
                onChange={(newCategory) => handleClassificationFeedback(
                  item.story_id,
                  item.category || 'unknown',
                  newCategory,
                  item.confidence ?? undefined,
                )}
                onReject={() => handleClassificationFeedback(
                  item.story_id,
                  item.category || 'unknown',
                  'international',
                  item.confidence ?? undefined,
                )}
              />
            ))
          )}
        </div>
      ) : activeTab === 'pending' ? (
        <div className="space-y-4">
          {pendingEntities.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              No pending entity suggestions
            </div>
          ) : (
            pendingEntities.map((entity) => (
              <PendingEntityCard
                key={entity.id}
                entity={entity}
                processing={processing === entity.id}
                onApprove={() => handleApprovePendingEntity(entity.id)}
                onReject={(reason) => handleRejectPendingEntity(entity.id, reason)}
                onMerge={(targetId) => handleMergePendingEntity(entity.id, targetId)}
              />
            ))
          )}
        </div>
      ) : activeTab === 'links' ? (
        <div className="space-y-4">
          {linkReviews.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              No pending link reviews
            </div>
          ) : (
            linkReviews.map((review) => (
              <LinkReviewCard
                key={review.link_id}
                review={review}
                processing={processing === review.link_id}
                onApprove={() => handleApproveLink(review.link_id)}
                onReject={() => handleRejectLink(review.link_id)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {mergeReviews.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              No pending merge reviews
            </div>
          ) : (
            mergeReviews.map((review) => (
              <MergeReviewCard
                key={review.merge_request_id}
                review={review}
                processing={processing === review.merge_request_id}
                onApprove={() => handleApproveMerge(review.merge_request_id)}
                onReject={() => handleRejectMerge(review.merge_request_id)}
                onRejectWithCannotLink={() => handleRejectMerge(review.merge_request_id, true)}
              />
            ))
          )}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-osint-card border border-osint-border rounded-lg
                       disabled:opacity-50 hover:bg-osint-border transition-colors"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-zinc-400">
            Page {page} of {Math.ceil(total / 20)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 20)}
            className="px-4 py-2 bg-osint-card border border-osint-border rounded-lg
                       disabled:opacity-50 hover:bg-osint-border transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

// Pending Entity Card Component
function PendingEntityCard({
  entity,
  processing,
  onApprove,
  onReject,
  onMerge,
}: {
  entity: PendingEntityItem
  processing: boolean
  onApprove: () => void
  onReject: (reason: string) => void
  onMerge: (targetEntityId: string) => void
}) {
  const [showMergeSearch, setShowMergeSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KBEntitySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const typeColor = TYPE_COLORS[entity.proposed_type] || 'bg-zinc-500/20 text-zinc-400'

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const results = await searchKBEntities(searchQuery, entity.proposed_type, 10)
      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          {/* Entity Name */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded text-xs border ${typeColor}`}>
                {entity.proposed_type}
              </span>
              <span className="text-cyan-400 text-xs">NEW ENTITY SUGGESTION</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-lg">{entity.proposed_name}</span>
              {entity.proposed_name_ne && entity.proposed_name_ne !== entity.proposed_name && (
                <span className="text-zinc-400">({entity.proposed_name_ne})</span>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-zinc-500">Mentions: </span>
              <span className="text-white font-medium">{entity.mention_count}</span>
            </div>
            <div>
              <span className="text-zinc-500">Sources: </span>
              <span className="text-white font-medium">{entity.source_count}</span>
            </div>
            {entity.first_seen_at && (
              <div>
                <span className="text-zinc-500">First seen: </span>
                <span className="text-zinc-400">
                  {new Date(entity.first_seen_at).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          {/* Sample Contexts */}
          {entity.sample_mentions.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">SAMPLE CONTEXTS</div>
              <div className="space-y-1">
                {entity.sample_mentions.slice(0, 3).map((mention, idx) => (
                  <div key={idx} className="text-sm text-zinc-400 bg-black/20 p-2 rounded">
                    {mention.source && (
                      <span className="text-zinc-500">[{mention.source}] </span>
                    )}
                    ...{mention.context}...
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Merge Search */}
          {showMergeSearch && (
            <div className="bg-black/20 rounded-lg p-3 space-y-3">
              <div className="text-xs text-amber-400">MERGE INTO EXISTING ENTITY</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search KB entities..."
                  className="flex-1 px-3 py-2 bg-osint-bg border border-osint-border rounded-lg
                             text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  {searching ? <LoadingSpinner size="sm" /> : 'Search'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  {searchResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center justify-between p-2 bg-osint-bg rounded-lg
                                 hover:bg-osint-border cursor-pointer transition-colors"
                      onClick={() => onMerge(result.id)}
                    >
                      <div>
                        <div className="text-white font-medium">{result.canonical_name}</div>
                        {result.canonical_name_ne && (
                          <div className="text-zinc-400 text-sm">{result.canonical_name_ne}</div>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {result.total_mentions} mentions
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowMergeSearch(false)}
                className="text-xs text-zinc-500 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Reject Modal */}
          {showRejectModal && (
            <div className="bg-black/20 rounded-lg p-3 space-y-3">
              <div className="text-xs text-red-400">REJECT REASON</div>
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 bg-osint-bg border border-osint-border rounded-lg
                           text-white focus:outline-none focus:border-red-500"
              >
                <option value="">Select a reason...</option>
                <option value="Not a real entity">Not a real entity</option>
                <option value="Too generic">Too generic</option>
                <option value="Misspelling">Misspelling</option>
                <option value="Duplicate in KB">Already exists in KB</option>
                <option value="Invalid type">Invalid entity type</option>
                <option value="Other">Other</option>
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (rejectReason) {
                      onReject(rejectReason)
                      setShowRejectModal(false)
                    }
                  }}
                  disabled={!rejectReason}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800
                             text-white rounded-lg"
                >
                  Confirm Reject
                </button>
                <button
                  onClick={() => setShowRejectModal(false)}
                  className="px-4 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {!showMergeSearch && !showRejectModal && (
          <div className="flex flex-col gap-2">
            <button
              onClick={onApprove}
              disabled={processing}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800
                         text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              {processing ? <LoadingSpinner size="sm" /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Create
            </button>
            <button
              onClick={() => setShowMergeSearch(true)}
              disabled={processing}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800
                         text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Merge
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              disabled={processing}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800
                         text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Link Review Card Component
function LinkReviewCard({
  review,
  processing,
  onApprove,
  onReject,
}: {
  review: LinkReviewItem
  processing: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const typeColor = TYPE_COLORS[review.mention.type] || 'bg-zinc-500/20 text-zinc-400'

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          {/* Mention */}
          <div>
            <div className="text-xs text-zinc-500 mb-1">MENTION</div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs border ${typeColor}`}>
                {review.mention.type}
              </span>
              <span className="text-white font-medium">{review.mention.text}</span>
              <span className="text-zinc-500">→</span>
              <span className="text-zinc-400">{review.mention.normalized}</span>
            </div>
          </div>

          {/* Context */}
          {review.mention.context && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">CONTEXT</div>
              <div className="text-sm text-zinc-400 bg-black/20 p-2 rounded">
                ...{review.mention.context}...
              </div>
            </div>
          )}

          {/* Proposed Entity */}
          {review.proposed_entity && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">PROPOSED ENTITY</div>
              <div className="flex items-center gap-2">
                <span className="text-blue-400 font-medium">
                  {review.proposed_entity.name}
                </span>
                {review.proposed_entity.name_ne && (
                  <span className="text-zinc-400">
                    ({review.proposed_entity.name_ne})
                  </span>
                )}
                <span className="text-xs text-zinc-500">
                  {review.proposed_entity.total_mentions} mentions
                </span>
              </div>
            </div>
          )}

          {/* Confidence & Rule */}
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-zinc-500">Confidence: </span>
              <span className={`font-medium ${
                review.confidence >= 0.9 ? 'text-green-400' :
                review.confidence >= 0.7 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {(review.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Rule: </span>
              <span className="text-zinc-300">{review.rule}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onApprove}
            disabled={processing}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800
                       text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            {processing ? <LoadingSpinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Approve
          </button>
          <button
            onClick={onReject}
            disabled={processing}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800
                       text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            {processing ? <LoadingSpinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}

// Classification Card Component
function ClassificationCard({
  item,
  processing,
  onConfirm,
  onChange,
  onReject,
}: {
  item: ClassificationItem
  processing: boolean
  onConfirm: () => void
  onChange: (newCategory: string) => void
  onReject: () => void
}) {
  const [showDropdown, setShowDropdown] = useState(false)
  const categoryColor = CATEGORY_COLORS[item.category || ''] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  const severityColor = SEVERITY_COLORS[item.severity || 'low'] || 'text-zinc-400'
  const confidenceColor = (item.confidence ?? 0) >= 0.8
    ? 'text-green-400'
    : (item.confidence ?? 0) >= 0.5
      ? 'text-amber-400'
      : 'text-red-400'

  if (item.is_corrected) {
    return (
      <div className="bg-osint-card border border-green-500/20 rounded-lg p-3 opacity-60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded text-xs border ${categoryColor}`}>
              {item.category}
            </span>
            <span className="text-white text-sm truncate max-w-md">{item.title}</span>
            <span className="text-green-400 text-xs">Reviewed</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          {/* Title and source */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs border ${categoryColor}`}>
              {item.category || 'unclassified'}
            </span>
            {item.severity && (
              <span className={`text-xs font-medium ${severityColor}`}>
                {item.severity.toUpperCase()}
              </span>
            )}
            <span className="text-zinc-500 text-xs">{item.source_id}</span>
            {item.created_at && (
              <span className="text-zinc-600 text-xs">
                {new Date(item.created_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="text-white text-sm">{item.title}</div>

          {/* Details row */}
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-zinc-500">Confidence: </span>
              <span className={`font-medium ${confidenceColor}`}>
                {item.confidence != null ? `${(item.confidence * 100).toFixed(0)}%` : '—'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Priority: </span>
              <span className="text-zinc-300">{item.tier2_priority ?? '—'}</span>
            </div>
            {item.districts_mentioned.length > 0 && (
              <div>
                <span className="text-zinc-500">Districts: </span>
                <span className="text-zinc-300">{item.districts_mentioned.slice(0, 3).join(', ')}</span>
              </div>
            )}
            {item.entities_mentioned.length > 0 && (
              <div>
                <span className="text-zinc-500">Entities: </span>
                <span className="text-zinc-300">{item.entities_mentioned.slice(0, 3).join(', ')}</span>
              </div>
            )}
            {item.constituencies_mentioned.length > 0 && (
              <div>
                <span className="text-zinc-500">Constituencies: </span>
                <span className="text-blue-400">{item.constituencies_mentioned.join(', ')}</span>
              </div>
            )}
          </div>

          {/* Keywords */}
          {item.keywords.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {item.keywords.slice(0, 6).map((kw, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded text-xs">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {/* Category dropdown */}
          {showDropdown && (
            <div className="bg-black/30 rounded-lg p-3 space-y-2">
              <div className="text-xs text-amber-400">SELECT CORRECT CATEGORY</div>
              <div className="flex gap-2 flex-wrap">
                {ALL_CATEGORIES.filter(c => c !== item.category).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { onChange(cat); setShowDropdown(false) }}
                    className={`px-3 py-1.5 rounded text-xs border transition-colors hover:opacity-80 ${
                      CATEGORY_COLORS[cat] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
                <button
                  onClick={() => setShowDropdown(false)}
                  className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {!showDropdown && (
          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              disabled={processing}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-800
                         text-white rounded-lg text-xs transition-colors"
              title="Confirm classification is correct"
            >
              {processing ? <LoadingSpinner size="sm" /> : 'Confirm'}
            </button>
            <button
              onClick={() => setShowDropdown(true)}
              disabled={processing}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800
                         text-white rounded-lg text-xs transition-colors"
              title="Change category"
            >
              Change
            </button>
            <button
              onClick={onReject}
              disabled={processing}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-800
                         text-white rounded-lg text-xs transition-colors"
              title="Mark as irrelevant"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}


// Merge Review Card Component
function MergeReviewCard({
  review,
  processing,
  onApprove,
  onReject,
  onRejectWithCannotLink,
}: {
  review: MergeReviewItem
  processing: boolean
  onApprove: () => void
  onReject: () => void
  onRejectWithCannotLink: () => void
}) {
  const typeColor = TYPE_COLORS[review.source_entity.type || ''] || 'bg-zinc-500/20 text-zinc-400'

  return (
    <div className="bg-osint-card border border-osint-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs border ${typeColor}`}>
              {review.source_entity.type}
            </span>
            <span className="text-amber-400 font-medium">
              Merge Proposal
            </span>
            <span className="text-zinc-500">
              Similarity: {(review.similarity_score * 100).toFixed(1)}%
            </span>
          </div>

          {/* Entities comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/20 rounded-lg p-3">
              <div className="text-xs text-red-400 mb-2">SOURCE (will be deleted)</div>
              <div className="text-white font-medium">{review.source_entity.name}</div>
              {review.source_entity.name_ne && (
                <div className="text-zinc-400 text-sm">{review.source_entity.name_ne}</div>
              )}
              <div className="text-xs text-zinc-500 mt-1">
                {review.source_entity.total_mentions} mentions, {review.source_entity.total_links} links
              </div>
            </div>
            <div className="bg-black/20 rounded-lg p-3">
              <div className="text-xs text-green-400 mb-2">TARGET (will remain)</div>
              <div className="text-white font-medium">{review.target_entity.name}</div>
              {review.target_entity.name_ne && (
                <div className="text-zinc-400 text-sm">{review.target_entity.name_ne}</div>
              )}
              <div className="text-xs text-zinc-500 mt-1">
                {review.target_entity.total_mentions} mentions, {review.target_entity.total_links} links
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onApprove}
            disabled={processing}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800
                       text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            {processing ? <LoadingSpinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Merge
          </button>
          <button
            onClick={onReject}
            disabled={processing}
            className="px-4 py-2 bg-zinc-600 hover:bg-zinc-700 disabled:bg-zinc-800
                       text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={onRejectWithCannotLink}
            disabled={processing}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800
                       text-white rounded-lg flex items-center gap-2 text-xs transition-colors"
          >
            {processing ? <LoadingSpinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
            Never Merge
          </button>
        </div>
      </div>
    </div>
  )
}
