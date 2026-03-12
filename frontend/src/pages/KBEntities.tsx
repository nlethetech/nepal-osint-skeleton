import { useEffect, useState, useCallback } from 'react'
import {
  Search,
  ChevronUp,
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  XCircle,
  GitMerge,
  Plus,
  History,
  Database,
  Users,
  RefreshCw,
  X,
  Edit3,
  Save,
  Tag,
} from 'lucide-react'
import {
  listKBEntities,
  listSubmissions,
  voteOnSubmission,
  getKBEntityStats,
  getKBEntity,
  updateKBEntity,
  addEntityAlias,
  removeEntityAlias,
  getEntityHistory,
  createKBEntity,
  submitEntity,
  approveSubmission,
  rejectSubmission,
  mergeSubmission,
  searchKBEntities,
  type KBEntity,
  type EntitySubmission,
  type KBEntityStats,
  type EditHistory,
  type CreateEntityData,
  type SubmitEntityData,
} from '../api/kbEntities'
import { Lightbulb, ExternalLink } from 'lucide-react'
import { Pagination } from '../components/common/Pagination'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { EmptyState } from '../components/common/EmptyState'
import { useDebounce } from '../hooks/useDebounce'
import { usePagination } from '../hooks/usePagination'
import { useAuthStore } from '../store/slices/authSlice'

type TabType = 'browse' | 'submissions' | 'mine'
type EntityType = 'PARTY' | 'PERSON' | 'LOCATION' | 'CONSTITUENCY' | 'ORG' | ''

const entityTypeColors: Record<string, string> = {
  PARTY: 'bg-purple-500/20 text-purple-400',
  PERSON: 'bg-blue-500/20 text-blue-400',
  LOCATION: 'bg-green-500/20 text-green-400',
  CONSTITUENCY: 'bg-orange-500/20 text-orange-400',
  ORG: 'bg-cyan-500/20 text-cyan-400',
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  merged: 'bg-blue-500/20 text-blue-400',
}

export default function KBEntities() {
  const { user } = useAuthStore()
  const isDev = user?.role === 'dev'

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('browse')

  // Entity browser state
  const [entities, setEntities] = useState<KBEntity[]>([])
  const [totalEntities, setTotalEntities] = useState(0)
  const [loadingEntities, setLoadingEntities] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<EntityType>('')
  const [sortField, setSortField] = useState<'canonical_name' | 'total_links'>('canonical_name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Submissions state
  const [submissions, setSubmissions] = useState<EntitySubmission[]>([])
  const [, setTotalSubmissions] = useState(0) // Used to track total, may add pagination later
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('pending')

  // Stats
  const [stats, setStats] = useState<KBEntityStats | null>(null)

  // Voting state
  const [votingId, setVotingId] = useState<string | null>(null)

  // Entity detail modal state
  const [selectedEntity, setSelectedEntity] = useState<KBEntity | null>(null)
  const [entityHistory, setEntityHistory] = useState<EditHistory[]>([])
  const [loadingEntity, setLoadingEntity] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ canonical_name: '', canonical_name_ne: '' })
  const [newAlias, setNewAlias] = useState({ text: '', lang: 'en', type: 'exact' })
  const [savingEntity, setSavingEntity] = useState(false)

  // Create entity modal state (dev only)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState<CreateEntityData>({
    canonical_name: '',
    canonical_name_ne: '',
    entity_type: 'PERSON',
    attributes: {},
    aliases: [],
  })
  const [creatingEntity, setCreatingEntity] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Suggest entity modal state (all users)
  const [showSuggestModal, setShowSuggestModal] = useState(false)
  const [suggestForm, setSuggestForm] = useState<SubmitEntityData>({
    proposed_name_en: '',
    proposed_name_ne: '',
    proposed_type: 'PERSON',
    submission_reason: '',
    evidence_urls: [],
  })
  const [submittingEntity, setSubmittingEntity] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [evidenceUrl, setEvidenceUrl] = useState('')

  // Approval modal state (dev only)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | 'merge'>('approve')
  const [selectedSubmission, setSelectedSubmission] = useState<EntitySubmission | null>(null)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [processingApproval, setProcessingApproval] = useState(false)
  const [mergeTargetSearch, setMergeTargetSearch] = useState('')
  const [mergeTargetResults, setMergeTargetResults] = useState<KBEntity[]>([])
  const [selectedMergeTarget, setSelectedMergeTarget] = useState<KBEntity | null>(null)

  const debouncedSearch = useDebounce(search, 300)
  const { page, pageSize, setPage } = usePagination({ initialPageSize: 20 })

  // Fetch stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await getKBEntityStats()
        setStats(data)
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    }
    fetchStats()
  }, [])

  // Fetch entities
  const fetchEntities = useCallback(async () => {
    setLoadingEntities(true)
    try {
      const data = await listKBEntities({
        entity_type: typeFilter || undefined,
        search: debouncedSearch || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sort_by: sortField,
        sort_order: sortOrder,
      })
      setEntities(data.entities)
      setTotalEntities(data.total)
    } catch (error) {
      console.error('Failed to fetch entities:', error)
    } finally {
      setLoadingEntities(false)
    }
  }, [page, pageSize, debouncedSearch, typeFilter, sortField, sortOrder])

  useEffect(() => {
    if (activeTab === 'browse') {
      fetchEntities()
    }
  }, [fetchEntities, activeTab])

  // Fetch submissions
  const fetchSubmissions = useCallback(async () => {
    setLoadingSubmissions(true)
    try {
      const data = await listSubmissions({
        status: statusFilter === 'all' ? undefined : statusFilter,
        sort_by: 'vote_score',
        sort_order: 'desc',
        limit: 50,
      })
      setSubmissions(data.submissions)
      setTotalSubmissions(data.total)
    } catch (error) {
      console.error('Failed to fetch submissions:', error)
    } finally {
      setLoadingSubmissions(false)
    }
  }, [statusFilter])

  useEffect(() => {
    if (activeTab === 'submissions') {
      fetchSubmissions()
    }
  }, [fetchSubmissions, activeTab])

  // Handle voting
  const handleVote = async (submissionId: string, voteType: 'up' | 'down') => {
    setVotingId(submissionId)
    try {
      const updated = await voteOnSubmission(submissionId, voteType)
      setSubmissions((prev) =>
        prev.map((s) => (s.id === submissionId ? updated : s))
      )
    } catch (error) {
      console.error('Failed to vote:', error)
    } finally {
      setVotingId(null)
    }
  }

  // Handle sort
  const handleSort = (field: 'canonical_name' | 'total_links') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortOrder === 'asc' ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    )
  }

  // Open entity detail modal
  const openEntityDetail = async (entityId: string) => {
    setLoadingEntity(true)
    setSelectedEntity(null)
    setEntityHistory([])
    setIsEditing(false)
    try {
      const entity = await getKBEntity(entityId)
      setSelectedEntity(entity)
      setEditForm({
        canonical_name: entity.canonical_name,
        canonical_name_ne: entity.canonical_name_ne || '',
      })
      // Fetch history if dev
      if (isDev) {
        try {
          const history = await getEntityHistory(entityId)
          setEntityHistory(history)
        } catch {
          // History might fail if not authenticated
        }
      }
    } catch (error) {
      console.error('Failed to fetch entity:', error)
    } finally {
      setLoadingEntity(false)
    }
  }

  // Close entity modal
  const closeEntityModal = () => {
    setSelectedEntity(null)
    setIsEditing(false)
    setEntityHistory([])
  }

  // Save entity edits
  const handleSaveEntity = async () => {
    if (!selectedEntity) return
    setSavingEntity(true)
    try {
      const updated = await updateKBEntity(
        selectedEntity.id,
        {
          canonical_name: editForm.canonical_name,
          canonical_name_ne: editForm.canonical_name_ne || undefined,
        },
        'Updated via KB Entities UI'
      )
      setSelectedEntity(updated)
      setIsEditing(false)
      // Refresh list
      fetchEntities()
    } catch (error) {
      console.error('Failed to update entity:', error)
      alert('Failed to update entity')
    } finally {
      setSavingEntity(false)
    }
  }

  // Create new entity
  const handleCreateEntity = async () => {
    if (!createForm.canonical_name.trim()) {
      setCreateError('English name is required')
      return
    }
    if (!createForm.entity_type) {
      setCreateError('Entity type is required')
      return
    }

    setCreatingEntity(true)
    setCreateError(null)

    try {
      await createKBEntity({
        canonical_name: createForm.canonical_name.trim(),
        canonical_name_ne: createForm.canonical_name_ne?.trim() || undefined,
        entity_type: createForm.entity_type,
        attributes: createForm.attributes,
        aliases: [],
      })

      // Reset form and close modal
      setCreateForm({
        canonical_name: '',
        canonical_name_ne: '',
        entity_type: 'PERSON',
        attributes: {},
        aliases: [],
      })
      setShowCreateModal(false)

      // Refresh list and stats
      fetchEntities()
      const newStats = await getKBEntityStats()
      setStats(newStats)
    } catch (error: unknown) {
      console.error('Failed to create entity:', error)
      const err = error as { response?: { data?: { message?: string } } }
      setCreateError(err.response?.data?.message || 'Failed to create entity')
    } finally {
      setCreatingEntity(false)
    }
  }

  // Submit entity suggestion (all users)
  const handleSuggestEntity = async () => {
    if (!suggestForm.proposed_name_en.trim()) {
      setSuggestError('English name is required')
      return
    }
    if (!suggestForm.submission_reason.trim() || suggestForm.submission_reason.length < 10) {
      setSuggestError('Please provide a reason (at least 10 characters) for why this entity should be added')
      return
    }

    setSubmittingEntity(true)
    setSuggestError(null)

    try {
      await submitEntity({
        proposed_name_en: suggestForm.proposed_name_en.trim(),
        proposed_name_ne: suggestForm.proposed_name_ne?.trim() || undefined,
        proposed_type: suggestForm.proposed_type,
        submission_reason: suggestForm.submission_reason.trim(),
        evidence_urls: suggestForm.evidence_urls?.filter(u => u.trim()) || [],
      })

      // Reset form and close modal
      setSuggestForm({
        proposed_name_en: '',
        proposed_name_ne: '',
        proposed_type: 'PERSON',
        submission_reason: '',
        evidence_urls: [],
      })
      setEvidenceUrl('')
      setShowSuggestModal(false)

      // Refresh submissions and stats
      fetchSubmissions()
      const newStats = await getKBEntityStats()
      setStats(newStats)

      // Switch to submissions tab to see the new suggestion
      setActiveTab('submissions')
    } catch (error: unknown) {
      console.error('Failed to submit entity suggestion:', error)
      const err = error as { response?: { data?: { message?: string } } }
      setSuggestError(err.response?.data?.message || 'Failed to submit suggestion')
    } finally {
      setSubmittingEntity(false)
    }
  }

  // Add evidence URL
  const handleAddEvidenceUrl = () => {
    if (evidenceUrl.trim() && !suggestForm.evidence_urls?.includes(evidenceUrl.trim())) {
      setSuggestForm({
        ...suggestForm,
        evidence_urls: [...(suggestForm.evidence_urls || []), evidenceUrl.trim()],
      })
      setEvidenceUrl('')
    }
  }

  // Remove evidence URL
  const handleRemoveEvidenceUrl = (url: string) => {
    setSuggestForm({
      ...suggestForm,
      evidence_urls: suggestForm.evidence_urls?.filter(u => u !== url) || [],
    })
  }

  // Open approval modal
  const openApprovalModal = (submission: EntitySubmission, action: 'approve' | 'reject' | 'merge') => {
    setSelectedSubmission(submission)
    setApprovalAction(action)
    setApprovalNotes('')
    setMergeTargetSearch('')
    setMergeTargetResults([])
    setSelectedMergeTarget(null)
    setShowApprovalModal(true)
  }

  // Search for merge target
  const handleMergeTargetSearch = async (query: string) => {
    setMergeTargetSearch(query)
    if (query.length < 2) {
      setMergeTargetResults([])
      return
    }
    try {
      const results = await searchKBEntities(query, selectedSubmission?.proposed_type, 10)
      setMergeTargetResults(results)
    } catch (error) {
      console.error('Failed to search entities:', error)
    }
  }

  // Handle approval action
  const handleApprovalAction = async () => {
    if (!selectedSubmission) return

    if (approvalAction === 'reject' && !approvalNotes.trim()) {
      alert('Please provide a reason for rejection')
      return
    }

    if (approvalAction === 'merge' && !selectedMergeTarget) {
      alert('Please select an entity to merge into')
      return
    }

    setProcessingApproval(true)
    try {
      if (approvalAction === 'approve') {
        await approveSubmission(selectedSubmission.id, approvalNotes || undefined)
      } else if (approvalAction === 'reject') {
        await rejectSubmission(selectedSubmission.id, approvalNotes)
      } else if (approvalAction === 'merge' && selectedMergeTarget) {
        await mergeSubmission(selectedSubmission.id, selectedMergeTarget.id, approvalNotes || undefined)
      }

      // Refresh data
      fetchSubmissions()
      fetchEntities()
      const newStats = await getKBEntityStats()
      setStats(newStats)

      setShowApprovalModal(false)
    } catch (error: unknown) {
      console.error('Failed to process approval:', error)
      const err = error as { response?: { data?: { message?: string } } }
      alert(err.response?.data?.message || 'Failed to process approval')
    } finally {
      setProcessingApproval(false)
    }
  }

  // Add alias
  const handleAddAlias = async () => {
    if (!selectedEntity || !newAlias.text.trim()) return
    setSavingEntity(true)
    try {
      await addEntityAlias(selectedEntity.id, {
        alias_text: newAlias.text.trim(),
        lang: newAlias.lang,
        alias_type: newAlias.type,
      })
      // Refresh entity
      const updated = await getKBEntity(selectedEntity.id)
      setSelectedEntity(updated)
      setNewAlias({ text: '', lang: 'en', type: 'exact' })
    } catch (error) {
      console.error('Failed to add alias:', error)
      alert('Failed to add alias')
    } finally {
      setSavingEntity(false)
    }
  }

  // Remove alias
  const handleRemoveAlias = async (aliasId: string) => {
    if (!selectedEntity) return
    if (!confirm('Remove this alias?')) return
    setSavingEntity(true)
    try {
      await removeEntityAlias(selectedEntity.id, aliasId)
      // Refresh entity
      const updated = await getKBEntity(selectedEntity.id)
      setSelectedEntity(updated)
    } catch (error) {
      console.error('Failed to remove alias:', error)
      alert('Failed to remove alias')
    } finally {
      setSavingEntity(false)
    }
  }

  // Format time ago
  const timeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  return (
    <div className="h-full flex flex-col overflow-hidden px-2 sm:px-4 lg:px-6 py-3 sm:py-4">
      {/* Header - Compact on mobile */}
      <div className="flex-shrink-0 mb-3 sm:mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 mb-3 sm:mb-4">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-100 flex items-center gap-2 truncate">
              <Database className="w-5 sm:w-6 h-5 sm:h-6 text-purple-400 flex-shrink-0" />
              <span className="truncate">Knowledge Base Entities</span>
            </h1>
            <p className="text-gray-400 text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">
              Collaborative entity management with community voting
            </p>
          </div>

          {/* Stats and Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm flex-shrink-0">
            {stats && (
              <>
                <div className="bg-slate-800/50 px-2 sm:px-3 py-1 sm:py-2 rounded-lg hidden sm:block">
                  <span className="text-gray-400">Total:</span>
                  <span className="text-white ml-1 sm:ml-2 font-semibold">{stats.total_entities}</span>
                </div>
                <div className="bg-yellow-500/10 px-2 sm:px-3 py-1 sm:py-2 rounded-lg">
                  <span className="text-yellow-400">Pending:</span>
                  <span className="text-yellow-300 ml-1 sm:ml-2 font-semibold">{stats.pending_submissions}</span>
                </div>
              </>
            )}
            {/* Suggest Entity - Available to ALL logged in users */}
            {user && (
              <button
                onClick={() => setShowSuggestModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded-lg transition-colors font-medium"
              >
                <Lightbulb className="w-4 h-4" />
                <span className="hidden sm:inline">Suggest Entity</span>
              </button>
            )}
            {/* Create Entity - Dev only */}
            {isDev && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded-lg transition-colors font-medium"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Create</span>
              </button>
            )}
          </div>
        </div>

        {/* Tabs - horizontally scrollable on mobile */}
        <div className="flex gap-1 sm:gap-2 border-b border-slate-700 overflow-x-auto pb-0.5">
          <button
            onClick={() => setActiveTab('browse')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === 'browse'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <Database className="w-3.5 sm:w-4 h-3.5 sm:h-4 inline mr-1 sm:mr-2" />
            Browse
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === 'submissions'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <Users className="w-3.5 sm:w-4 h-3.5 sm:h-4 inline mr-1 sm:mr-2" />
            Submissions
            {stats && stats.pending_submissions > 0 && (
              <span className="ml-1 sm:ml-2 bg-yellow-500/20 text-yellow-400 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs">
                {stats.pending_submissions}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Browse Tab */}
      {activeTab === 'browse' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Search and filters - stacked on mobile */}
          <div className="flex-shrink-0 flex flex-col sm:flex-row gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-3.5 sm:w-4 h-3.5 sm:h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search entities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-sm bg-slate-800/50 border border-slate-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as EntityType)}
                className="flex-1 sm:flex-none px-2 sm:px-4 py-1.5 sm:py-2 text-sm bg-slate-800/50 border border-slate-700 rounded-lg text-gray-100 focus:outline-none focus:border-purple-500"
              >
                <option value="">All Types</option>
                <option value="PARTY">Party</option>
                <option value="PERSON">Person</option>
                <option value="LOCATION">Location</option>
                <option value="CONSTITUENCY">Constituency</option>
                <option value="ORG">Organization</option>
              </select>
              <button
                onClick={fetchEntities}
                className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 transition-colors"
              >
                <RefreshCw className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
              </button>
            </div>
          </div>

          {/* Entities table - scrollable container */}
          {loadingEntities ? (
            <div className="flex justify-center py-8 sm:py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : entities.length === 0 ? (
            <EmptyState
              title="No entities found"
              description="Try adjusting your search or filters"
              icon={Database}
            />
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Scrollable table container */}
              <div className="flex-1 overflow-auto">
                {/* Mobile card view */}
                <div className="sm:hidden space-y-2 pb-2">
                  {entities.map((entity) => (
                    <div
                      key={entity.id}
                      onClick={() => openEntityDetail(entity.id)}
                      className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 active:bg-slate-800/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-100 text-sm truncate">{entity.canonical_name}</div>
                          {entity.canonical_name_ne && (
                            <div className="text-xs text-gray-400 truncate">{entity.canonical_name_ne}</div>
                          )}
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                            entityTypeColors[entity.entity_type] || 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {entity.entity_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-purple-400">
                          <span className="text-gray-500">Links:</span> {entity.total_links}
                        </span>
                        <span className="text-gray-500">
                          {entity.aliases?.length || 0} aliases
                        </span>
                        <span className={entity.is_curated ? 'text-green-400' : 'text-gray-500'}>
                          {entity.source}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table view */}
                <table className="hidden sm:table w-full">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-10">
                    <tr className="text-left text-gray-400 text-xs sm:text-sm border-b border-slate-700">
                      <th
                        className="pb-2 sm:pb-3 pr-4 cursor-pointer hover:text-gray-300"
                        onClick={() => handleSort('canonical_name')}
                      >
                        <span className="flex items-center gap-1">
                          Name <SortIcon field="canonical_name" />
                        </span>
                      </th>
                      <th className="pb-2 sm:pb-3 pr-4">Type</th>
                      <th className="pb-2 sm:pb-3 pr-4 hidden md:table-cell">Nepali</th>
                      <th
                        className="pb-2 sm:pb-3 pr-4 cursor-pointer hover:text-gray-300"
                        onClick={() => handleSort('total_links')}
                      >
                        <span className="flex items-center gap-1">
                          Links <SortIcon field="total_links" />
                        </span>
                      </th>
                      <th className="pb-2 sm:pb-3 pr-4 hidden lg:table-cell">Aliases</th>
                      <th className="pb-2 sm:pb-3 hidden lg:table-cell">Source</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-100 text-sm">
                    {entities.map((entity) => (
                      <tr
                        key={entity.id}
                        onClick={() => openEntityDetail(entity.id)}
                        className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors cursor-pointer"
                      >
                        <td className="py-2 sm:py-3 pr-4">
                          <div className="font-medium truncate max-w-[200px] sm:max-w-none">{entity.canonical_name}</div>
                          <div className="text-[10px] sm:text-xs text-gray-500 font-mono">
                            {entity.id.slice(0, 8)}...
                          </div>
                        </td>
                        <td className="py-2 sm:py-3 pr-4">
                          <span
                            className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                              entityTypeColors[entity.entity_type] || 'bg-gray-500/20 text-gray-400'
                            }`}
                          >
                            {entity.entity_type}
                          </span>
                        </td>
                        <td className="py-2 sm:py-3 pr-4 text-gray-400 hidden md:table-cell">
                          <span className="truncate max-w-[150px] block">{entity.canonical_name_ne || '-'}</span>
                        </td>
                        <td className="py-2 sm:py-3 pr-4">
                          <span className="text-purple-400 font-medium">
                            {entity.total_links}
                          </span>
                        </td>
                        <td className="py-2 sm:py-3 pr-4 hidden lg:table-cell">
                          {entity.aliases && entity.aliases.length > 0 ? (
                            <span className="text-gray-400 text-xs sm:text-sm">
                              {entity.aliases.length} aliases
                            </span>
                          ) : (
                            <span className="text-gray-500 text-xs sm:text-sm">-</span>
                          )}
                        </td>
                        <td className="py-2 sm:py-3 hidden lg:table-cell">
                          <span
                            className={`text-xs ${
                              entity.is_curated ? 'text-green-400' : 'text-gray-500'
                            }`}
                          >
                            {entity.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination - fixed at bottom */}
              <div className="flex-shrink-0 pt-3 sm:pt-4 border-t border-slate-800">
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={totalEntities}
                  onPageChange={setPage}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submissions Tab */}
      {activeTab === 'submissions' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Status filter - horizontally scrollable on mobile */}
          <div className="flex-shrink-0 flex gap-1.5 sm:gap-2 mb-3 sm:mb-4 overflow-x-auto pb-1">
            {['pending', 'approved', 'rejected', 'merged', 'all'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  statusFilter === status
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                    : 'bg-slate-800/50 text-gray-400 border border-slate-700 hover:border-slate-600'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          {/* Submissions list - scrollable */}
          {loadingSubmissions ? (
            <div className="flex justify-center py-8 sm:py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : submissions.length === 0 ? (
            <EmptyState
              title="No submissions found"
              description={statusFilter === 'pending' ? 'No pending entity submissions' : 'Try adjusting your filter'}
              icon={Users}
            />
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-3 pb-2">
              {submissions.map((submission) => (
                <div
                  key={submission.id}
                  className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 sm:p-4 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-start gap-2 sm:gap-4">
                    {/* Vote buttons - compact on mobile */}
                    <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                      <button
                        onClick={() => handleVote(submission.id, 'up')}
                        disabled={votingId === submission.id || submission.status !== 'pending'}
                        className={`p-1 sm:p-1.5 rounded transition-colors ${
                          submission.user_vote === 'up'
                            ? 'bg-green-500/20 text-green-400'
                            : 'text-gray-500 hover:text-green-400 hover:bg-green-500/10'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <ThumbsUp className="w-4 sm:w-5 h-4 sm:h-5" />
                      </button>
                      <span
                        className={`text-xs sm:text-sm font-bold ${
                          submission.vote_score > 0
                            ? 'text-green-400'
                            : submission.vote_score < 0
                            ? 'text-red-400'
                            : 'text-gray-400'
                        }`}
                      >
                        {submission.vote_score}
                      </span>
                      <button
                        onClick={() => handleVote(submission.id, 'down')}
                        disabled={votingId === submission.id || submission.status !== 'pending'}
                        className={`p-1 sm:p-1.5 rounded transition-colors ${
                          submission.user_vote === 'down'
                            ? 'bg-red-500/20 text-red-400'
                            : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <ThumbsDown className="w-4 sm:w-5 h-4 sm:h-5" />
                      </button>
                    </div>

                    {/* Submission content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                        <h3 className="text-sm sm:text-lg font-medium text-gray-100 truncate max-w-[200px] sm:max-w-none">
                          {submission.proposed_name_en}
                        </h3>
                        <span
                          className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${
                            entityTypeColors[submission.proposed_type] || 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {submission.proposed_type}
                        </span>
                        <span
                          className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${
                            statusColors[submission.status] || 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {submission.status}
                        </span>
                      </div>

                      {submission.proposed_name_ne && (
                        <p className="text-gray-400 text-xs sm:text-sm mb-1.5 sm:mb-2 truncate">{submission.proposed_name_ne}</p>
                      )}

                      <p className="text-gray-300 text-xs sm:text-sm mb-2 sm:mb-3 line-clamp-2">{submission.submission_reason}</p>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-gray-500">
                        <span>{timeAgo(submission.created_at)}</span>
                        <span>+{submission.upvotes}/-{submission.downvotes}</span>
                        {submission.evidence_urls && submission.evidence_urls.length > 0 && (
                          <span className="hidden sm:inline">{submission.evidence_urls.length} source(s)</span>
                        )}
                      </div>

                      {/* Review notes */}
                      {submission.review_notes && (
                        <div className="mt-2 sm:mt-3 p-1.5 sm:p-2 bg-slate-900/50 rounded text-xs sm:text-sm">
                          <span className="text-gray-500">Review: </span>
                          <span className="text-gray-300">{submission.review_notes}</span>
                        </div>
                      )}

                      {/* Dev actions - inline on mobile */}
                      {isDev && submission.status === 'pending' && (
                        <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2 sm:hidden">
                          <button
                            onClick={() => openApprovalModal(submission, 'approve')}
                            className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-medium hover:bg-green-500/30 transition-colors flex items-center gap-1"
                          >
                            <CheckCircle className="w-3 h-3" />
                            Approve
                          </button>
                          <button
                            onClick={() => openApprovalModal(submission, 'reject')}
                            className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-medium hover:bg-red-500/30 transition-colors flex items-center gap-1"
                          >
                            <XCircle className="w-3 h-3" />
                            Reject
                          </button>
                          <button
                            onClick={() => openApprovalModal(submission, 'merge')}
                            className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-medium hover:bg-blue-500/30 transition-colors flex items-center gap-1"
                          >
                            <GitMerge className="w-3 h-3" />
                            Merge
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Dev actions - sidebar on desktop */}
                    {isDev && submission.status === 'pending' && (
                      <div className="hidden sm:flex flex-col gap-2 flex-shrink-0">
                        <button
                          onClick={() => openApprovalModal(submission, 'approve')}
                          className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 transition-colors flex items-center gap-1"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Approve
                        </button>
                        <button
                          onClick={() => openApprovalModal(submission, 'reject')}
                          className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors flex items-center gap-1"
                        >
                          <XCircle className="w-4 h-4" />
                          Reject
                        </button>
                        <button
                          onClick={() => openApprovalModal(submission, 'merge')}
                          className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition-colors flex items-center gap-1"
                        >
                          <GitMerge className="w-4 h-4" />
                          Merge
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Entity Detail Modal - Full screen on mobile */}
      {(selectedEntity || loadingEntity) && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-slate-900 border-0 sm:border border-slate-700 rounded-t-xl sm:rounded-xl w-full sm:max-w-2xl h-[90vh] sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-700">
              <h2 className="text-base sm:text-lg font-semibold text-gray-100 truncate pr-2">
                {loadingEntity ? 'Loading...' : selectedEntity?.canonical_name}
              </h2>
              <button
                onClick={closeEntityModal}
                className="p-1.5 sm:p-1 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              {loadingEntity ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner size="lg" />
                </div>
              ) : selectedEntity && (
                <div className="space-y-4 sm:space-y-6">
                  {/* Basic Info */}
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                          entityTypeColors[selectedEntity.entity_type] || 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {selectedEntity.entity_type}
                      </span>
                      <span className="text-[10px] sm:text-xs text-gray-500 font-mono truncate">
                        ID: {selectedEntity.id.slice(0, 12)}...
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs sm:text-sm text-gray-400 mb-1">English Name</label>
                          <input
                            type="text"
                            value={editForm.canonical_name}
                            onChange={(e) => setEditForm({ ...editForm, canonical_name: e.target.value })}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-gray-100 focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs sm:text-sm text-gray-400 mb-1">Nepali Name</label>
                          <input
                            type="text"
                            value={editForm.canonical_name_ne}
                            onChange={(e) => setEditForm({ ...editForm, canonical_name_ne: e.target.value })}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-gray-100 focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5 sm:space-y-2">
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">English:</span>
                          <span className="ml-2 text-sm sm:text-base text-gray-100 font-medium">{selectedEntity.canonical_name}</span>
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm text-gray-500">Nepali:</span>
                          <span className="ml-2 text-sm sm:text-base text-gray-100">{selectedEntity.canonical_name_ne || '-'}</span>
                        </div>
                      </div>
                    )}

                    {/* Stats - grid on mobile */}
                    <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-4 text-xs sm:text-sm">
                      <div className="bg-slate-800/50 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-center sm:text-left">
                        <span className="text-gray-400 block sm:inline">Links:</span>
                        <span className="text-purple-400 sm:ml-2 font-semibold">{selectedEntity.total_links}</span>
                      </div>
                      <div className="bg-slate-800/50 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-center sm:text-left">
                        <span className="text-gray-400 block sm:inline">Mentions:</span>
                        <span className="text-blue-400 sm:ml-2 font-semibold">{selectedEntity.total_mentions}</span>
                      </div>
                      <div className="bg-slate-800/50 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-center sm:text-left">
                        <span className="text-gray-400 block sm:inline">Source:</span>
                        <span className={`sm:ml-2 font-semibold ${selectedEntity.is_curated ? 'text-green-400' : 'text-gray-400'}`}>
                          {selectedEntity.source}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Aliases Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2 sm:mb-3">
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-300 flex items-center gap-1.5 sm:gap-2">
                        <Tag className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                        Aliases ({selectedEntity.aliases?.length || 0})
                      </h3>
                    </div>

                    <div className="space-y-2">
                      {selectedEntity.aliases && selectedEntity.aliases.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-32 sm:max-h-none overflow-y-auto">
                          {selectedEntity.aliases.map((alias) => (
                            <div
                              key={alias.id}
                              className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-slate-800 rounded-lg text-xs sm:text-sm group"
                            >
                              <span className="text-gray-200 truncate max-w-[100px] sm:max-w-none">{alias.alias_text}</span>
                              <span className="text-[10px] sm:text-xs text-gray-500">({alias.lang})</span>
                              {isDev && (
                                <button
                                  onClick={() => handleRemoveAlias(alias.id)}
                                  disabled={savingEntity}
                                  className="ml-0.5 sm:ml-1 p-0.5 text-gray-500 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs sm:text-sm text-gray-500">No aliases defined</p>
                      )}

                      {/* Add alias form (dev only) - stacked on mobile */}
                      {isDev && (
                        <div className="mt-2 sm:mt-3 flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            placeholder="New alias..."
                            value={newAlias.text}
                            onChange={(e) => setNewAlias({ ...newAlias, text: e.target.value })}
                            className="flex-1 px-2.5 sm:px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-purple-500"
                          />
                          <div className="flex gap-2">
                            <select
                              value={newAlias.lang}
                              onChange={(e) => setNewAlias({ ...newAlias, lang: e.target.value })}
                              className="flex-1 sm:flex-none px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 focus:outline-none"
                            >
                              <option value="en">EN</option>
                              <option value="ne">NE</option>
                            </select>
                            <button
                              onClick={handleAddAlias}
                              disabled={savingEntity || !newAlias.text.trim()}
                              className="px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Attributes Section */}
                  {selectedEntity.attributes && Object.keys(selectedEntity.attributes).length > 0 && (
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-300 mb-2 sm:mb-3">Attributes</h3>
                      <div className="bg-slate-800/50 rounded-lg p-2 sm:p-3">
                        <pre className="text-[10px] sm:text-xs text-gray-300 overflow-x-auto">
                          {JSON.stringify(selectedEntity.attributes, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Edit History (dev only) */}
                  {isDev && entityHistory.length > 0 && (
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-300 mb-2 sm:mb-3 flex items-center gap-1.5 sm:gap-2">
                        <History className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                        Edit History
                      </h3>
                      <div className="space-y-1.5 sm:space-y-2 max-h-32 sm:max-h-48 overflow-y-auto">
                        {entityHistory.map((entry) => (
                          <div key={entry.id} className="bg-slate-800/50 rounded-lg p-1.5 sm:p-2 text-xs sm:text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-gray-300 truncate flex-1">{entry.summary}</span>
                              <span className="text-[10px] sm:text-xs text-gray-500 flex-shrink-0">{timeAgo(entry.edited_at)}</span>
                            </div>
                            {entry.edit_reason && (
                              <p className="text-[10px] sm:text-xs text-gray-500 mt-1 truncate">Reason: {entry.edit_reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer (dev actions) - sticky on mobile */}
            {isDev && selectedEntity && (
              <div className="flex-shrink-0 flex items-center justify-end gap-2 p-3 sm:p-4 border-t border-slate-700 bg-slate-900">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEntity}
                      disabled={savingEntity}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium hover:bg-green-500/30 disabled:opacity-50 transition-colors flex items-center gap-1.5 sm:gap-2"
                    >
                      <Save className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                      Save
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-500/20 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-500/30 transition-colors flex items-center gap-1.5 sm:gap-2"
                  >
                    <Edit3 className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suggest Entity Modal (All Users) */}
      {showSuggestModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-slate-900 border-0 sm:border border-slate-700 rounded-t-xl sm:rounded-xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-700">
              <h2 className="text-base sm:text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-yellow-400" />
                Suggest New Entity
              </h2>
              <button
                onClick={() => {
                  setShowSuggestModal(false)
                  setSuggestError(null)
                }}
                className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
              <p className="text-xs sm:text-sm text-gray-400">
                Suggest a new entity to be added to the knowledge base. Your suggestion will be reviewed by the community and moderators.
              </p>

              {suggestError && (
                <div className="p-2 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs sm:text-sm">
                  {suggestError}
                </div>
              )}

              {/* Entity Type */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  Entity Type <span className="text-red-400">*</span>
                </label>
                <select
                  value={suggestForm.proposed_type}
                  onChange={(e) => setSuggestForm({ ...suggestForm, proposed_type: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-yellow-500"
                >
                  <option value="PERSON">Person</option>
                  <option value="PARTY">Political Party</option>
                  <option value="LOCATION">Location</option>
                  <option value="CONSTITUENCY">Constituency</option>
                  <option value="ORG">Organization</option>
                </select>
              </div>

              {/* English Name */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  English Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={suggestForm.proposed_name_en}
                  onChange={(e) => setSuggestForm({ ...suggestForm, proposed_name_en: e.target.value })}
                  placeholder="e.g., KP Sharma Oli"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-yellow-500"
                />
              </div>

              {/* Nepali Name */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  Nepali Name (Optional)
                </label>
                <input
                  type="text"
                  value={suggestForm.proposed_name_ne || ''}
                  onChange={(e) => setSuggestForm({ ...suggestForm, proposed_name_ne: e.target.value })}
                  placeholder="e.g., केपी शर्मा ओली"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-yellow-500"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  Why should this entity be added? <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={suggestForm.submission_reason}
                  onChange={(e) => setSuggestForm({ ...suggestForm, submission_reason: e.target.value })}
                  placeholder="Explain why this entity is important and relevant to Nepal OSINT..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-yellow-500 resize-none"
                />
                <p className="text-[10px] sm:text-xs text-gray-500 mt-1">
                  {suggestForm.submission_reason.length}/200 characters (min 10)
                </p>
              </div>

              {/* Evidence URLs */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  Evidence Links (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                    placeholder="https://example.com/news-article"
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-yellow-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddEvidenceUrl()
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddEvidenceUrl}
                    disabled={!evidenceUrl.trim()}
                    className="px-3 py-2 bg-slate-700 text-gray-300 rounded-lg hover:bg-slate-600 disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {suggestForm.evidence_urls && suggestForm.evidence_urls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {suggestForm.evidence_urls.map((url, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-slate-800/50 rounded px-2 py-1">
                        <ExternalLink className="w-3 h-3 text-gray-500 flex-shrink-0" />
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline truncate flex-1"
                        >
                          {url}
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRemoveEvidenceUrl(url)}
                          className="text-gray-500 hover:text-red-400 flex-shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 p-3 sm:p-4 border-t border-slate-700">
              <button
                onClick={() => {
                  setShowSuggestModal(false)
                  setSuggestError(null)
                }}
                disabled={submittingEntity}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSuggestEntity}
                disabled={submittingEntity || !suggestForm.proposed_name_en.trim() || suggestForm.submission_reason.length < 10}
                className="px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium hover:bg-yellow-500/30 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {submittingEntity ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Lightbulb className="w-4 h-4" />
                    Submit Suggestion
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval Modal (Dev Only) */}
      {showApprovalModal && selectedSubmission && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-slate-900 border-0 sm:border border-slate-700 rounded-t-xl sm:rounded-xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-700">
              <h2 className="text-base sm:text-lg font-semibold text-gray-100 flex items-center gap-2">
                {approvalAction === 'approve' && <CheckCircle className="w-5 h-5 text-green-400" />}
                {approvalAction === 'reject' && <XCircle className="w-5 h-5 text-red-400" />}
                {approvalAction === 'merge' && <GitMerge className="w-5 h-5 text-blue-400" />}
                {approvalAction === 'approve' && 'Approve Submission'}
                {approvalAction === 'reject' && 'Reject Submission'}
                {approvalAction === 'merge' && 'Merge into Existing'}
              </h2>
              <button
                onClick={() => setShowApprovalModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
              {/* Submission Summary */}
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${entityTypeColors[selectedSubmission.proposed_type] || 'bg-gray-500/20 text-gray-400'}`}>
                    {selectedSubmission.proposed_type}
                  </span>
                  <span className="text-xs text-gray-500">
                    +{selectedSubmission.upvotes}/-{selectedSubmission.downvotes} votes
                  </span>
                </div>
                <h3 className="font-medium text-gray-100">{selectedSubmission.proposed_name_en}</h3>
                {selectedSubmission.proposed_name_ne && (
                  <p className="text-sm text-gray-400">{selectedSubmission.proposed_name_ne}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">{selectedSubmission.submission_reason}</p>
              </div>

              {/* Merge Target Search (only for merge action) */}
              {approvalAction === 'merge' && (
                <div>
                  <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                    Search for entity to merge into <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={mergeTargetSearch}
                    onChange={(e) => handleMergeTargetSearch(e.target.value)}
                    placeholder="Search existing entities..."
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  {mergeTargetResults.length > 0 && (
                    <div className="mt-2 border border-slate-700 rounded-lg overflow-hidden">
                      {mergeTargetResults.map((entity) => (
                        <button
                          key={entity.id}
                          onClick={() => setSelectedMergeTarget(entity)}
                          className={`w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors ${
                            selectedMergeTarget?.id === entity.id ? 'bg-blue-500/20 border-l-2 border-blue-500' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${entityTypeColors[entity.entity_type] || 'bg-gray-500/20 text-gray-400'}`}>
                              {entity.entity_type}
                            </span>
                            <span className="text-sm text-gray-100">{entity.canonical_name}</span>
                          </div>
                          {entity.canonical_name_ne && (
                            <p className="text-xs text-gray-500 ml-14">{entity.canonical_name_ne}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedMergeTarget && (
                    <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm">
                      <span className="text-blue-400">Will merge into:</span>
                      <span className="text-gray-100 ml-2">{selectedMergeTarget.canonical_name}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  {approvalAction === 'reject' ? 'Rejection Reason' : 'Notes'} {approvalAction === 'reject' && <span className="text-red-400">*</span>}
                </label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder={
                    approvalAction === 'approve' ? 'Optional notes about this approval...' :
                    approvalAction === 'reject' ? 'Explain why this submission is being rejected...' :
                    'Optional notes about this merge...'
                  }
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 p-3 sm:p-4 border-t border-slate-700">
              <button
                onClick={() => setShowApprovalModal(false)}
                disabled={processingApproval}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApprovalAction}
                disabled={
                  processingApproval ||
                  (approvalAction === 'reject' && !approvalNotes.trim()) ||
                  (approvalAction === 'merge' && !selectedMergeTarget)
                }
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  approvalAction === 'approve' ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' :
                  approvalAction === 'reject' ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' :
                  'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                }`}
              >
                {processingApproval ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {approvalAction === 'approve' && <CheckCircle className="w-4 h-4" />}
                    {approvalAction === 'reject' && <XCircle className="w-4 h-4" />}
                    {approvalAction === 'merge' && <GitMerge className="w-4 h-4" />}
                    {approvalAction === 'approve' && 'Approve & Create'}
                    {approvalAction === 'reject' && 'Reject'}
                    {approvalAction === 'merge' && 'Merge'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Entity Modal (Dev Only) */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-slate-900 border-0 sm:border border-slate-700 rounded-t-xl sm:rounded-xl w-full sm:max-w-lg overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-700">
              <h2 className="text-base sm:text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Plus className="w-5 h-5 text-purple-400" />
                Create New Entity
              </h2>
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setCreateError(null)
                }}
                className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-3 sm:p-4 space-y-4">
              {createError && (
                <div className="p-2 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs sm:text-sm">
                  {createError}
                </div>
              )}

              {/* Entity Type */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  Entity Type <span className="text-red-400">*</span>
                </label>
                <select
                  value={createForm.entity_type}
                  onChange={(e) => setCreateForm({ ...createForm, entity_type: e.target.value as 'PARTY' | 'PERSON' | 'LOCATION' | 'CONSTITUENCY' | 'ORG' })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="PERSON">Person</option>
                  <option value="PARTY">Political Party</option>
                  <option value="LOCATION">Location</option>
                  <option value="CONSTITUENCY">Constituency</option>
                  <option value="ORG">Organization</option>
                </select>
              </div>

              {/* English Name */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  English Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={createForm.canonical_name}
                  onChange={(e) => setCreateForm({ ...createForm, canonical_name: e.target.value })}
                  placeholder="e.g., KP Sharma Oli"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Nepali Name */}
              <div>
                <label className="block text-xs sm:text-sm text-gray-400 mb-1.5">
                  Nepali Name (Optional)
                </label>
                <input
                  type="text"
                  value={createForm.canonical_name_ne || ''}
                  onChange={(e) => setCreateForm({ ...createForm, canonical_name_ne: e.target.value })}
                  placeholder="e.g., केपी शर्मा ओली"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 p-3 sm:p-4 border-t border-slate-700">
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setCreateError(null)
                  setCreateForm({
                    canonical_name: '',
                    canonical_name_ne: '',
                    entity_type: 'PERSON',
                    attributes: {},
                    aliases: [],
                  })
                }}
                disabled={creatingEntity}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateEntity}
                disabled={creatingEntity || !createForm.canonical_name.trim()}
                className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {creatingEntity ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create Entity
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
