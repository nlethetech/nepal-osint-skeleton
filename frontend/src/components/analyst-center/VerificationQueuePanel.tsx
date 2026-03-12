import { useState, useMemo } from 'react'
import {
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  Clock,
  User,
  ChevronDown,
  ChevronUp,
  LogIn,
} from 'lucide-react'
import { useVerificationQueue, useCastVote } from '../../api/hooks/useCollaboration'
import { useAuthStore } from '../../store/slices/authSlice'
import type { VerificationRequest, VoteChoice } from '../../api/collaboration'

// Demo verification requests for when API is unavailable
const DEMO_REQUESTS: VerificationRequest[] = [
  {
    id: 'demo-v1',
    item_type: 'story',
    item_id: 'story-123',
    claim: 'Dam breach reported near Koshi Barrage - Multiple villages under threat',
    context: 'Several local news sources reporting flooding, but official confirmation pending. Need to verify scale of impact.',
    evidence: null,
    source_urls: ['https://example.com/news1'],
    status: 'pending',
    priority: 'high',
    required_votes: 3,
    consensus_threshold: 0.7,
    requested_by: { id: 'demo-user', email: 'sarah.k@narada.io', full_name: 'Sarah K.' },
    agree_count: 2,
    disagree_count: 0,
    abstain_count: 0,
    needs_info_count: 1,
    final_verdict: null,
    resolution_notes: null,
    expires_at: null,
    resolved_at: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-v2',
    item_type: 'entity_link',
    item_id: 'link-456',
    claim: 'Merge duplicate entities: "K.P. Sharma Oli" and "KP Oli" - Same person',
    context: 'Both entities refer to the same political figure. Proposing merge to consolidate intelligence.',
    evidence: null,
    source_urls: null,
    status: 'pending',
    priority: 'medium',
    required_votes: 3,
    consensus_threshold: 0.7,
    requested_by: { id: 'demo-user-2', email: 'john.m@narada.io', full_name: 'John M.' },
    agree_count: 1,
    disagree_count: 0,
    abstain_count: 1,
    needs_info_count: 0,
    final_verdict: null,
    resolution_notes: null,
    expires_at: null,
    resolved_at: null,
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-v3',
    item_type: 'classification',
    item_id: 'class-789',
    claim: 'Reclassify story as "Security" instead of "Political" - Armed group involvement',
    context: 'Initial classification as political protest, but evidence suggests armed militia presence.',
    evidence: null,
    source_urls: null,
    status: 'pending',
    priority: 'high',
    required_votes: 5,
    consensus_threshold: 0.8,
    requested_by: { id: 'demo-user-3', email: 'priya.t@narada.io', full_name: 'Priya T.' },
    agree_count: 3,
    disagree_count: 1,
    abstain_count: 0,
    needs_info_count: 0,
    final_verdict: null,
    resolution_notes: null,
    expires_at: null,
    resolved_at: null,
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
]

function VoteBar({ agree, disagree, abstain, needsInfo }: {
  agree: number
  disagree: number
  abstain: number
  needsInfo: number
}) {
  const total = agree + disagree + abstain + needsInfo
  if (total === 0) return null

  const agreePercent = (agree / total) * 100
  const disagreePercent = (disagree / total) * 100
  const needsInfoPercent = (needsInfo / total) * 100

  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-[var(--pro-bg-hover)]">
      {agreePercent > 0 && (
        <div
          className="bg-green-500 transition-all"
          style={{ width: `${agreePercent}%` }}
        />
      )}
      {disagreePercent > 0 && (
        <div
          className="bg-red-500 transition-all"
          style={{ width: `${disagreePercent}%` }}
        />
      )}
      {needsInfoPercent > 0 && (
        <div
          className="bg-yellow-500 transition-all"
          style={{ width: `${needsInfoPercent}%` }}
        />
      )}
    </div>
  )
}

function VerificationItem({ request, isDemo }: { request: VerificationRequest; isDemo?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [reasoning, setReasoning] = useState('')
  const castVote = useCastVote()
  const { isAuthenticated } = useAuthStore()

  const handleVote = async (choice: VoteChoice) => {
    if (isDemo || !isAuthenticated) {
      alert('Log in as an analyst to vote on verifications')
      return
    }
    try {
      await castVote.mutateAsync({
        requestId: request.id,
        vote: {
          choice,
          reasoning: reasoning.trim() || undefined,
        },
      })
      setReasoning('')
      setExpanded(false)
    } catch (err) {
      console.error('Failed to cast vote:', err)
    }
  }

  const totalVotes = request.agree_count + request.disagree_count + request.abstain_count + request.needs_info_count
  const ageText = (() => {
    const created = new Date(request.created_at)
    const now = new Date()
    const diffMs = now.getTime() - created.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    return 'Just now'
  })()

  return (
    <div className="bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 hover:bg-[var(--pro-bg-hover)] transition-colors"
      >
        <div className="flex items-start gap-2 mb-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${
            request.priority === 'high'
              ? 'bg-red-500/20 text-red-400'
              : request.priority === 'medium'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-blue-500/20 text-blue-400'
          }`}>
            {request.item_type.replace('_', ' ')}
          </span>
          <span className="flex-1" />
          {expanded ? (
            <ChevronUp size={12} className="text-[var(--pro-text-muted)]" />
          ) : (
            <ChevronDown size={12} className="text-[var(--pro-text-muted)]" />
          )}
        </div>

        <p className="text-xs text-[var(--pro-text-primary)] mb-2 line-clamp-2">
          {request.claim}
        </p>

        <div className="flex items-center justify-between text-[10px] text-[var(--pro-text-muted)]">
          <span className="flex items-center gap-1">
            <User size={10} />
            {request.requested_by.full_name || request.requested_by.email.split('@')[0]}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {ageText}
          </span>
        </div>

        {/* Vote distribution */}
        <div className="mt-2 space-y-1">
          <VoteBar
            agree={request.agree_count}
            disagree={request.disagree_count}
            abstain={request.abstain_count}
            needsInfo={request.needs_info_count}
          />
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-green-400">{request.agree_count} agree</span>
            <span className="text-red-400">{request.disagree_count} disagree</span>
            <span className="text-[var(--pro-text-disabled)]">{totalVotes} votes</span>
          </div>
        </div>
      </button>

      {/* Expanded voting section */}
      {expanded && (
        <div className="border-t border-[var(--pro-border-subtle)] p-3 space-y-3">
          {/* Context */}
          {request.context && (
            <div className="text-[10px] text-[var(--pro-text-muted)] bg-[var(--pro-bg-surface)] p-2 rounded">
              {request.context}
            </div>
          )}

          {/* Reasoning input */}
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="Optional: Add your reasoning..."
            rows={2}
            className="w-full bg-[var(--pro-bg-surface)] border border-[var(--pro-border-subtle)] rounded-lg px-2 py-1.5 text-[10px] text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
          />

          {/* Vote buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleVote('agree')}
              disabled={castVote.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50"
            >
              <ThumbsUp size={12} />
              Agree
            </button>
            <button
              onClick={() => handleVote('disagree')}
              disabled={castVote.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              <ThumbsDown size={12} />
              Disagree
            </button>
            <button
              onClick={() => handleVote('needs_info')}
              disabled={castVote.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
            >
              <HelpCircle size={12} />
              Need Info
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function VerificationQueuePanel() {
  const { isAuthenticated } = useAuthStore()
  const { data, isLoading, error } = useVerificationQueue({
    status: 'pending',
    limit: 20,
  })

  // Use demo data when not authenticated or on error
  const requests = useMemo(() => {
    if (data?.items && data.items.length > 0) {
      return data.items
    }
    if (error || !isAuthenticated) {
      return DEMO_REQUESTS
    }
    return []
  }, [data, error, isAuthenticated])

  const isUsingDemo = (!data?.items || data.items.length === 0) && requests.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-[var(--pro-accent)]" />
          <h2 className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
            Verification Queue
          </h2>
          {requests.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
              {requests.length} pending
            </span>
          )}
          {isUsingDemo && (
            <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
              Demo
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--pro-text-muted)] mt-1">
          Help verify claims from the community
        </p>
      </div>

      {/* Login prompt for non-authenticated users */}
      {!isAuthenticated && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
          <div className="flex items-center gap-2 text-[10px] text-blue-400">
            <LogIn size={12} />
            <span>Log in as analyst to vote on verifications</span>
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 bg-[var(--pro-bg-elevated)] rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8">
            <ShieldCheck size={24} className="mx-auto text-green-400/50 mb-2" />
            <p className="text-xs text-[var(--pro-text-muted)] mb-1">Queue is clear!</p>
            <p className="text-[10px] text-[var(--pro-text-disabled)]">
              No pending verifications
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((request) => (
              <VerificationItem key={request.id} request={request} isDemo={isUsingDemo} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
