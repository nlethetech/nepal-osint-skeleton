import { useState, useMemo } from 'react'
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Clock,
  User,
  AlertTriangle,
  AlertCircle,
  Minus,
  Plus,
  Send,
  ExternalLink,
  Newspaper,
  Tag,
  MapPin,
  Building2,
  Loader2,
} from 'lucide-react'
import { useCase, useUpdateCase, useCaseEvidence, useCaseComments, useAddComment } from '../../api/hooks/useCollaboration'
import { useAuthStore } from '../../store/slices/authSlice'
import { AddEvidenceModal } from '../analyst-center/AddEvidenceModal'
import { PublishCaseModal } from '../analyst-center/PublishCaseModal'
import type { Case, CasePriority, CaseEvidence, CaseComment } from '../../api/collaboration'

// Demo case details for when API is unavailable
const DEMO_CASES: Record<string, Case> = {
  'demo-1': {
    id: 'demo-1',
    title: 'Border Activity Investigation - Birgunj Checkpoint',
    description: 'Unusual patterns detected at border crossing. Multiple reports of suspicious cargo movement during non-standard hours.',
    status: 'active',
    priority: 'high',
    visibility: 'team',
    category: 'security',
    tags: ['border', 'smuggling', 'customs'],
    created_by: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
    assigned_to: null,
    team_id: null,
    linked_cluster_id: null,
    hypothesis: 'Evidence suggests an organized smuggling network operating at Birgunj border crossing. Preliminary analysis indicates possible customs official involvement based on timing patterns and cargo manifests. Further investigation required to identify key actors.',
    conclusion: null,
    evidence_count: 5,
    comment_count: 3,
    started_at: new Date().toISOString(),
    closed_at: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  'demo-2': {
    id: 'demo-2',
    title: 'Election Misinformation Tracking - Kathmandu Valley',
    description: 'Coordinated disinformation campaign detected across social media platforms targeting upcoming elections.',
    status: 'active',
    priority: 'critical',
    visibility: 'public',
    category: 'political',
    tags: ['election', 'disinformation', 'social-media'],
    created_by: { id: 'demo-user-2', email: 'senior@narada.io', full_name: 'Senior Analyst' },
    assigned_to: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
    team_id: null,
    linked_cluster_id: null,
    hypothesis: 'Multiple coordinated social media accounts spreading false information about election procedures. Pattern analysis suggests foreign actor involvement with possible state-sponsored backing. Accounts show similar creation dates and posting patterns.',
    conclusion: null,
    evidence_count: 12,
    comment_count: 8,
    started_at: new Date().toISOString(),
    closed_at: null,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  'demo-3': {
    id: 'demo-3',
    title: 'Flood Impact Assessment - Koshi Basin',
    description: 'Damage assessment from recent flooding in the Koshi river basin region.',
    status: 'review',
    priority: 'high',
    visibility: 'public',
    category: 'disaster',
    tags: ['flood', 'damage', 'koshi'],
    created_by: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
    assigned_to: null,
    team_id: null,
    linked_cluster_id: null,
    hypothesis: 'Initial reports indicate significant infrastructure damage in the flood-affected areas.',
    conclusion: 'Over 500 households affected across 12 villages. 3 bridges damaged, 2 completely destroyed. Road access cut off to 5 remote communities. Emergency supplies delivered via helicopter to most critical areas.',
    evidence_count: 8,
    comment_count: 5,
    started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    closed_at: null,
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
}

// Demo evidence for demo cases
const DEMO_EVIDENCE: Record<string, CaseEvidence[]> = {
  'demo-1': [
    {
      id: 'ev-1',
      case_id: 'demo-1',
      evidence_type: 'story',
      reference_id: 'story-123',
      reference_url: 'https://example.com/news/border-activity',
      title: 'Breaking: Unusual activity reported at border checkpoint',
      summary: 'Officials report increased movement of unmarked vehicles during night hours.',
      relevance_notes: null,
      is_key_evidence: true,
      confidence: 'confirmed',
      added_by: { id: 'demo-user-1', email: 'sarah.k@narada.io', full_name: 'Sarah K.' },
      created_at: '2026-01-28T10:30:00Z',
      extra_data: null,
    },
    {
      id: 'ev-2',
      case_id: 'demo-1',
      evidence_type: 'story',
      reference_id: 'story-456',
      reference_url: 'https://example.com/news/officials-deny',
      title: 'Officials deny allegations of smuggling operation',
      summary: 'Government spokesperson dismisses reports as "unfounded speculation."',
      relevance_notes: 'Contradicts earlier witness statements',
      is_key_evidence: false,
      confidence: 'likely',
      added_by: { id: 'demo-user-2', email: 'john.m@narada.io', full_name: 'John M.' },
      created_at: '2026-01-30T14:15:00Z',
      extra_data: null,
    },
    {
      id: 'ev-3',
      case_id: 'demo-1',
      evidence_type: 'note',
      reference_id: null,
      reference_url: null,
      title: 'Cross-referenced with customs data - found discrepancies',
      summary: 'Shipment records show 47% increase in "miscellaneous goods" category since Q3.',
      relevance_notes: null,
      is_key_evidence: true,
      confidence: 'confirmed',
      added_by: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
      created_at: '2026-02-01T09:00:00Z',
      extra_data: null,
    },
  ],
  'demo-2': [
    {
      id: 'ev-4',
      case_id: 'demo-2',
      evidence_type: 'story',
      reference_id: 'story-789',
      reference_url: 'https://example.com/social-media-analysis',
      title: 'Social media analysis reveals coordinated posting patterns',
      summary: '23 accounts created within 48 hours, all sharing similar content.',
      relevance_notes: null,
      is_key_evidence: true,
      confidence: 'confirmed',
      added_by: { id: 'demo-user-2', email: 'senior@narada.io', full_name: 'Senior Analyst' },
      created_at: '2026-01-31T08:00:00Z',
      extra_data: null,
    },
  ],
  'demo-3': [
    {
      id: 'ev-5',
      case_id: 'demo-3',
      evidence_type: 'story',
      reference_id: 'story-flood-1',
      reference_url: null,
      title: 'BIPAD Alert: Flood warning for Koshi basin',
      summary: 'Water levels rising above danger mark at multiple monitoring stations.',
      relevance_notes: null,
      is_key_evidence: true,
      confidence: 'confirmed',
      added_by: { id: 'demo-user', email: 'analyst@narada.io', full_name: 'Demo Analyst' },
      created_at: '2026-01-30T06:00:00Z',
      extra_data: null,
    },
  ],
}

// Demo comments for demo cases
const DEMO_COMMENTS: Record<string, CaseComment[]> = {
  'demo-1': [
    {
      id: 'comment-1',
      case_id: 'demo-1',
      content: '@john check the customs data from last month. I found some interesting patterns.',
      author: { id: 'demo-user-1', email: 'sarah.k@narada.io', full_name: 'Sarah K.' },
      parent_comment_id: null,
      mentions: ['john'],
      is_edited: false,
      edited_at: null,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'comment-2',
      case_id: 'demo-1',
      content: 'Found 3 more sources corroborating the initial report. Adding them now.',
      author: { id: 'demo-user-2', email: 'john.m@narada.io', full_name: 'John M.' },
      parent_comment_id: null,
      mentions: [],
      is_edited: false,
      edited_at: null,
      created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    },
  ],
  'demo-2': [
    {
      id: 'comment-3',
      case_id: 'demo-2',
      content: 'Pattern matches known disinformation tactics from 2020 election cycle.',
      author: { id: 'demo-user-2', email: 'senior@narada.io', full_name: 'Senior Analyst' },
      parent_comment_id: null,
      mentions: [],
      is_edited: false,
      edited_at: null,
      created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
  ],
  'demo-3': [],
}

const PRIORITY_STYLES: Record<CasePriority, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/20' },
  high: { icon: AlertCircle, color: 'text-orange-400', bg: 'bg-orange-500/20' },
  medium: { icon: Minus, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  low: { icon: Minus, color: 'text-green-400', bg: 'bg-green-500/20' },
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  active: 'bg-blue-500/20 text-blue-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  closed: 'bg-green-500/20 text-green-400',
}

interface EvidenceTimelineProps {
  caseId: string
  isDemoCase: boolean
  onAddEvidence?: () => void
}

function EvidenceTimeline({ caseId, isDemoCase, onAddEvidence }: EvidenceTimelineProps) {
  // Fetch real evidence from API (skipped for demo cases)
  const { data: apiEvidence, isLoading, error } = useCaseEvidence(caseId)

  // Use demo data or real API data
  const evidence = useMemo(() => {
    if (isDemoCase && DEMO_EVIDENCE[caseId]) {
      return DEMO_EVIDENCE[caseId]
    }
    if (apiEvidence && apiEvidence.length > 0) {
      return apiEvidence
    }
    // Fallback to demo evidence if API fails
    if ((error || !apiEvidence) && DEMO_EVIDENCE[caseId]) {
      return DEMO_EVIDENCE[caseId]
    }
    return []
  }, [isDemoCase, caseId, apiEvidence, error])

  const getSourceLabel = (item: CaseEvidence) => {
    if (item.evidence_type === 'note') return 'Analyst Note'
    if (item.evidence_type === 'document') return 'Document'
    if (item.evidence_type === 'link') return 'External Link'
    return item.summary?.split(' ').slice(0, 4).join(' ') + '...' || 'Story'
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
            Evidence Timeline
          </h3>
          <button
            onClick={onAddEvidence}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-[var(--pro-accent)] text-white rounded hover:bg-[var(--pro-accent-hover)] transition-colors"
          >
            <Plus size={10} />
            Add Evidence
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && !isDemoCase ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--pro-text-muted)]" />
          </div>
        ) : evidence.length === 0 ? (
          <div className="text-center py-8">
            <FileText size={24} className="mx-auto text-[var(--pro-text-disabled)] mb-2" />
            <p className="text-xs text-[var(--pro-text-muted)]">No evidence yet</p>
            <p className="text-[10px] text-[var(--pro-text-disabled)]">
              Add stories or notes to build your case
            </p>
          </div>
        ) : (
          <div className="relative pl-6 border-l-2 border-[var(--pro-border-subtle)] space-y-4">
            {evidence.map((item) => (
              <div key={item.id} className="relative">
                {/* Timeline dot */}
                <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${
                  item.evidence_type === 'story'
                    ? 'bg-blue-500 border-blue-400'
                    : item.evidence_type === 'note'
                      ? 'bg-purple-500 border-purple-400'
                      : 'bg-green-500 border-green-400'
                }`} />

                {/* Key evidence indicator */}
                {item.is_key_evidence && (
                  <div className="absolute -left-[32px] -top-1">
                    <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full" title="Key Evidence" />
                  </div>
                )}

                {/* Content card */}
                <div className="bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg p-3 hover:border-[var(--pro-border-default)] transition-colors">
                  <div className="flex items-start gap-2 mb-2">
                    {item.evidence_type === 'story' ? (
                      <Newspaper size={12} className="text-blue-400 mt-0.5" />
                    ) : item.evidence_type === 'note' ? (
                      <FileText size={12} className="text-purple-400 mt-0.5" />
                    ) : (
                      <ExternalLink size={12} className="text-green-400 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--pro-text-primary)] line-clamp-2">
                        {item.title}
                      </p>
                      {item.summary && (
                        <p className="text-[10px] text-[var(--pro-text-muted)] mt-0.5 line-clamp-1">
                          {item.summary}
                        </p>
                      )}
                    </div>
                    {item.reference_url && (
                      <a
                        href={item.reference_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-[var(--pro-text-muted)] hover:text-[var(--pro-accent)] transition-colors"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>

                  {/* Confidence badge */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[8px] px-1 py-0.5 rounded uppercase font-medium ${
                      item.confidence === 'confirmed' ? 'bg-green-500/20 text-green-400' :
                      item.confidence === 'likely' ? 'bg-blue-500/20 text-blue-400' :
                      item.confidence === 'possible' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {item.confidence}
                    </span>
                    <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--pro-bg-hover)] text-[var(--pro-text-muted)]">
                      {item.evidence_type}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-[var(--pro-text-disabled)]">
                    <span>Added by {item.added_by.full_name || item.added_by.email.split('@')[0]}</span>
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface DiscussionSectionProps {
  caseId: string
  isDemoCase: boolean
  commentCount: number
}

function DiscussionSection({ caseId, isDemoCase, commentCount }: DiscussionSectionProps) {
  const [newComment, setNewComment] = useState('')
  const { isAuthenticated } = useAuthStore()

  // Fetch real comments from API (skipped for demo cases)
  const { data: apiComments, isLoading, error } = useCaseComments(caseId)
  const addComment = useAddComment()

  // Use demo data or real API data
  const comments = useMemo(() => {
    if (isDemoCase && DEMO_COMMENTS[caseId]) {
      return DEMO_COMMENTS[caseId]
    }
    if (apiComments && apiComments.length > 0) {
      return apiComments
    }
    // Fallback to demo comments if API fails
    if ((error || !apiComments) && DEMO_COMMENTS[caseId]) {
      return DEMO_COMMENTS[caseId]
    }
    return []
  }, [isDemoCase, caseId, apiComments, error])

  const handleSubmitComment = async () => {
    if (!newComment.trim() || isDemoCase) return
    if (!isAuthenticated) {
      alert('Please log in to add comments')
      return
    }

    try {
      await addComment.mutateAsync({
        caseId,
        comment: { content: newComment.trim() },
      })
      setNewComment('')
    } catch (err) {
      console.error('Failed to add comment:', err)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmitComment()
    }
  }

  // Format time ago
  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Highlight @mentions in comment content
  const formatCommentContent = (content: string) => {
    const mentionRegex = /@(\w+)/g
    const parts = content.split(mentionRegex)
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return (
          <span key={i} className="text-[var(--pro-accent)] font-medium">
            @{part}
          </span>
        )
      }
      return part
    })
  }

  // Generate a color for avatar based on username
  const getAvatarColor = (name: string) => {
    const colors = ['blue', 'green', 'purple', 'orange', 'pink', 'cyan']
    const index = name.charCodeAt(0) % colors.length
    return colors[index]
  }

  const AVATAR_STYLES: Record<string, { bg: string; text: string }> = {
    blue: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    green: { bg: 'bg-green-500/20', text: 'text-green-400' },
    purple: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
    orange: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
    pink: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
    cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--pro-border-subtle)]">
        <h3 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Discussion ({commentCount || comments.length})
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && !isDemoCase ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--pro-text-muted)]" />
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare size={24} className="mx-auto text-[var(--pro-text-disabled)] mb-2" />
            <p className="text-xs text-[var(--pro-text-muted)]">No comments yet</p>
            <p className="text-[10px] text-[var(--pro-text-disabled)]">
              Start the discussion by adding a comment
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => {
              const authorName = comment.author.full_name || comment.author.email.split('@')[0]
              const avatarColor = getAvatarColor(authorName)
              const avatarStyle = AVATAR_STYLES[avatarColor] || AVATAR_STYLES.blue

              return (
                <div key={comment.id} className="flex gap-2">
                  <div className={`w-6 h-6 rounded-full ${avatarStyle.bg} flex items-center justify-center flex-shrink-0`}>
                    <User size={12} className={avatarStyle.text} />
                  </div>
                  <div className="flex-1 bg-[var(--pro-bg-elevated)] rounded-lg p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-medium text-[var(--pro-text-primary)]">
                        {authorName}
                      </span>
                      <span className="text-[9px] text-[var(--pro-text-disabled)]">
                        {formatTimeAgo(comment.created_at)}
                      </span>
                      {comment.is_edited && (
                        <span className="text-[9px] text-[var(--pro-text-disabled)]">(edited)</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--pro-text-secondary)]">
                      {formatCommentContent(comment.content)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Comment input */}
      <div className="px-4 py-3 border-t border-[var(--pro-border-subtle)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={isDemoCase ? 'Log in to comment...' : 'Add a comment... (use @mentions)'}
            disabled={isDemoCase || addComment.isPending}
            className="flex-1 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)] disabled:opacity-50"
          />
          <button
            onClick={handleSubmitComment}
            disabled={!newComment.trim() || isDemoCase || addComment.isPending}
            className="px-3 py-2 bg-[var(--pro-accent)] text-white rounded-lg hover:bg-[var(--pro-accent-hover)] disabled:opacity-50 transition-colors"
          >
            {addComment.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function EntityList() {
  // Mock entities - would come from case detail API
  const mockEntities = [
    { id: '1', type: 'organization', name: 'Nepal Customs' },
    { id: '2', type: 'person', name: 'Unknown Official' },
    { id: '3', type: 'location', name: 'Birgunj Border' },
  ]

  const EntityIcon = ({ type }: { type: string }) => {
    switch (type) {
      case 'organization':
        return <Building2 size={12} className="text-blue-400" />
      case 'person':
        return <User size={12} className="text-green-400" />
      case 'location':
        return <MapPin size={12} className="text-orange-400" />
      default:
        return <Tag size={12} className="text-purple-400" />
    }
  }

  return (
    <div className="px-4 py-3 border-t border-[var(--pro-border-subtle)]">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Linked Entities
        </h4>
        <button className="text-[10px] text-[var(--pro-accent)] hover:underline">
          + Add
        </button>
      </div>

      <div className="space-y-1">
        {mockEntities.map((entity) => (
          <div
            key={entity.id}
            className="flex items-center gap-2 px-2 py-1.5 bg-[var(--pro-bg-elevated)] rounded hover:bg-[var(--pro-bg-hover)] cursor-pointer transition-colors"
          >
            <EntityIcon type={entity.type} />
            <span className="text-[11px] text-[var(--pro-text-secondary)]">{entity.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface CaseInvestigationPanelProps {
  caseId: string | null
  onCloseCase?: () => void
  onRequestSelectCase?: () => void
}

export function CaseInvestigationPanel({
  caseId,
  onCloseCase,
  onRequestSelectCase,
}: CaseInvestigationPanelProps) {
  const { isAuthenticated } = useAuthStore()
  const [isEditingHypothesis, setIsEditingHypothesis] = useState(false)
  const [hypothesisDraft, setHypothesisDraft] = useState('')
  const [isAddEvidenceOpen, setIsAddEvidenceOpen] = useState(false)
  const [isPublishOpen, setIsPublishOpen] = useState(false)

  // Check if this is a demo case
  const isDemoCase = caseId?.startsWith('demo-') || false

  // Only fetch from API if not a demo case
  const { data: apiCaseDetail, isLoading, error } = useCase(
    isDemoCase ? '' : (caseId || '')
  )
  const updateCase = useUpdateCase()

  // Use demo data when appropriate
  const caseDetail = useMemo(() => {
    if (isDemoCase && caseId && DEMO_CASES[caseId]) {
      return DEMO_CASES[caseId]
    }
    if (apiCaseDetail) {
      return apiCaseDetail
    }
    // Fallback to demo if API fails and not authenticated
    if ((error || !isAuthenticated) && caseId && DEMO_CASES[caseId]) {
      return DEMO_CASES[caseId]
    }
    return null
  }, [isDemoCase, caseId, apiCaseDetail, error, isAuthenticated])

  const isUsingDemo = isDemoCase || (!apiCaseDetail && caseDetail !== null)

  const handleBack = () => {
    onCloseCase?.()
  }

  const handleSaveHypothesis = async () => {
    if (!caseId) return
    try {
      await updateCase.mutateAsync({
        id: caseId,
        hypothesis: hypothesisDraft,
      })
      setIsEditingHypothesis(false)
    } catch (err) {
      console.error('Failed to update hypothesis:', err)
    }
  }

  if (!caseId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <FileText size={32} className="mx-auto text-[var(--pro-text-disabled)] mb-3" />
          <p className="text-sm text-[var(--pro-text-muted)]">No case selected</p>
          <button
            onClick={() => onRequestSelectCase?.()}
            className="mt-2 text-xs text-[var(--pro-accent)] hover:underline"
          >
            Select a case
          </button>
        </div>
      </div>
    )
  }

  if (isLoading && !isDemoCase) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-[var(--pro-text-muted)]">Loading case...</div>
      </div>
    )
  }

  if (!caseDetail) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={32} className="mx-auto text-red-400 mb-3" />
          <p className="text-sm text-red-400">Failed to load case</p>
          <button
            onClick={handleBack}
            className="mt-2 text-xs text-[var(--pro-accent)] hover:underline"
          >
            Go back to cases
          </button>
        </div>
      </div>
    )
  }

  const priority = PRIORITY_STYLES[caseDetail.priority]
  const PriorityIcon = priority.icon

  return (
    <div className="flex flex-1 h-full min-h-0">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={handleBack}
              className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            >
              <ArrowLeft size={16} />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-[var(--pro-text-primary)] truncate">
                  {caseDetail.title}
                </h1>
                {isUsingDemo && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded flex-shrink-0">
                    Demo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${STATUS_COLORS[caseDetail.status]}`}>
                  {caseDetail.status}
                </span>
                <span className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded ${priority.bg} ${priority.color}`}>
                  <PriorityIcon size={10} />
                  {caseDetail.priority}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                if (isDemoCase) {
                  alert('Log in as analyst to publish cases')
                  return
                }
                setIsPublishOpen(true)
              }}
              className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
            >
              <Newspaper size={12} className="inline mr-1" />
              Publish as Story
            </button>
          </div>
        </div>

        {/* Hypothesis */}
        <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
              Hypothesis
            </h3>
            {!isEditingHypothesis && (
              <button
                onClick={() => {
                  setHypothesisDraft(caseDetail.hypothesis || '')
                  setIsEditingHypothesis(true)
                }}
                className="text-[10px] text-[var(--pro-accent)] hover:underline"
              >
                Edit
              </button>
            )}
          </div>

          {isEditingHypothesis ? (
            <div className="space-y-2">
              <textarea
                value={hypothesisDraft}
                onChange={(e) => setHypothesisDraft(e.target.value)}
                rows={3}
                className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
                placeholder="Describe your hypothesis..."
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsEditingHypothesis(false)}
                  className="px-2 py-1 text-[10px] text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveHypothesis}
                  disabled={updateCase.isPending}
                  className="px-2 py-1 text-[10px] font-medium bg-[var(--pro-accent)] text-white rounded hover:bg-[var(--pro-accent-hover)] disabled:opacity-50"
                >
                  {updateCase.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg p-3">
              <p className="text-xs text-[var(--pro-text-secondary)] whitespace-pre-wrap">
                {caseDetail.hypothesis || 'No hypothesis yet. Click Edit to add one.'}
              </p>
            </div>
          )}
        </div>

        {/* Discussion */}
        <DiscussionSection
          caseId={caseId}
          isDemoCase={isDemoCase}
          commentCount={caseDetail.comment_count}
        />
      </div>

      {/* Right Panel - Evidence Timeline + Entities */}
      <div className="w-80 flex-shrink-0 border-l border-[var(--pro-border-subtle)] flex flex-col">
        <div className="flex-1 overflow-hidden">
          <EvidenceTimeline
            caseId={caseId}
            isDemoCase={isDemoCase}
            onAddEvidence={() => {
              if (isDemoCase) {
                alert('Log in as analyst to add evidence')
                return
              }
              setIsAddEvidenceOpen(true)
            }}
          />
        </div>
        <EntityList />
      </div>

      {/* Add Evidence Modal */}
      {caseId && !isDemoCase && (
        <AddEvidenceModal
          caseId={caseId}
          isOpen={isAddEvidenceOpen}
          onClose={() => setIsAddEvidenceOpen(false)}
        />
      )}

      {/* Publish Case Modal */}
      {caseDetail && !isDemoCase && (
        <PublishCaseModal
          caseData={caseDetail}
          isOpen={isPublishOpen}
          onClose={() => setIsPublishOpen(false)}
          onSuccess={() => {
            onCloseCase?.()
          }}
        />
      )}
    </div>
  )
}
