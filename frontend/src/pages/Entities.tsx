import { useEffect, useState, useCallback } from 'react'
import {
  Search,
  ChevronUp,
  ChevronDown,
  GitMerge,
  Check,
  X,
  Ban,
  RefreshCw,
  Sparkles,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import {
  getEntities,
  verifyEntity,
  markEntityIrrelevant,
  bulkEntityAction,
  getAllMergeSuggestions,
} from '../api/entities'
import type { Entity, EntityType, MergeSuggestion } from '../types/api'
import { Pagination } from '../components/common/Pagination'
import { Badge } from '../components/common/Badge'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { EmptyState } from '../components/common/EmptyState'
import { EntityDetailModal } from '../components/entities/EntityDetailModal'
import { EntityMergeModal } from '../components/entities/EntityMergeModal'
import { useDebounce } from '../hooks/useDebounce'
import { usePagination } from '../hooks/usePagination'

type SortField = 'name' | 'mention_count' | 'entity_type'
type SortDirection = 'asc' | 'desc'
type ViewMode = 'table' | 'suggestions'

const typeBadgeVariant: Record<EntityType, 'person' | 'organization' | 'location' | 'district'> = {
  PERSON: 'person',
  ORGANIZATION: 'organization',
  LOCATION: 'location',
  DISTRICT: 'district',
}

export default function Entities() {
  const [entities, setEntities] = useState<Entity[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<EntityType | ''>('')
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('mention_count')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Human-in-the-loop state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [mergeEntity, setMergeEntity] = useState<Entity | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const debouncedSearch = useDebounce(search, 300)
  const { page, pageSize, setPage, setPageSize } = usePagination({ initialPageSize: 20 })

  const fetchEntities = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getEntities({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        entityType: typeFilter || undefined,
      })
      setEntities(data.items)
      setTotal(data.total)
    } catch (error) {
      console.error('Failed to fetch entities:', error)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debouncedSearch, typeFilter])

  useEffect(() => {
    fetchEntities()
  }, [fetchEntities])

  const fetchSuggestions = async () => {
    setLoadingSuggestions(true)
    try {
      const data = await getAllMergeSuggestions(0.5, 5, typeFilter || undefined)
      setSuggestions(data)
    } catch (error) {
      console.error('Failed to fetch suggestions:', error)
    } finally {
      setLoadingSuggestions(false)
    }
  }

  useEffect(() => {
    if (viewMode === 'suggestions') {
      fetchSuggestions()
    }
  }, [viewMode, typeFilter])

  // Client-side sorting
  const sortedEntities = [...entities].sort((a, b) => {
    let comparison = 0
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'mention_count':
        comparison = a.mention_count - b.mention_count
        break
      case 'entity_type':
        comparison = a.entity_type.localeCompare(b.entity_type)
        break
    }
    return sortDirection === 'asc' ? comparison : -comparison
  })

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    )
  }

  // Selection handlers
  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedIds.size === sortedEntities.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedEntities.map((e) => e.id)))
    }
  }

  // Quick action handlers
  const handleVerify = async (entity: Entity, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    console.log('Verify clicked for entity:', entity.id, entity.name)
    setActionLoading(entity.id)
    try {
      const result = await verifyEntity(entity.id)
      console.log('Verify result:', result)
      await fetchEntities()
    } catch (error: any) {
      console.error('Failed to verify entity:', error)
      alert(`Failed to verify: ${error?.response?.data?.detail || error?.message || 'Unknown error'}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleMarkIrrelevant = async (entity: Entity, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    console.log('Mark irrelevant clicked for entity:', entity.id, entity.name)
    setActionLoading(entity.id)
    try {
      const result = await markEntityIrrelevant(entity.id)
      console.log('Mark irrelevant result:', result)
      await fetchEntities()
    } catch (error: any) {
      console.error('Failed to mark entity irrelevant:', error)
      alert(`Failed to mark irrelevant: ${error?.response?.data?.detail || error?.message || 'Unknown error'}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleOpenMerge = (entity: Entity, e: React.MouseEvent) => {
    e.stopPropagation()
    setMergeEntity(entity)
  }

  // Bulk action handlers
  const handleBulkVerify = async () => {
    if (selectedIds.size === 0) return
    setActionLoading('bulk')
    try {
      await bulkEntityAction({
        entity_ids: Array.from(selectedIds),
        action: 'verify',
      })
      setSelectedIds(new Set())
      await fetchEntities()
    } catch (error) {
      console.error('Failed to bulk verify:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleBulkIrrelevant = async () => {
    if (selectedIds.size === 0) return
    setActionLoading('bulk')
    try {
      await bulkEntityAction({
        entity_ids: Array.from(selectedIds),
        action: 'mark_irrelevant',
      })
      setSelectedIds(new Set())
      await fetchEntities()
    } catch (error) {
      console.error('Failed to bulk mark irrelevant:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleMergeComplete = () => {
    setMergeEntity(null)
    fetchEntities()
    if (viewMode === 'suggestions') {
      fetchSuggestions()
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 space-y-3 pb-3 sm:pb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Entities</h1>
              <p className="text-osint-muted text-xs sm:text-sm mt-1 hidden sm:block">
                Human-in-the-loop entity resolution and verification
              </p>
            </div>
          </div>

          {/* Controls - Stack on mobile */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            {/* View Mode Toggle */}
            <div className="flex bg-osint-surface rounded-lg p-1">
              <button
                onClick={() => setViewMode('table')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm transition-colors ${
                  viewMode === 'table'
                    ? 'bg-osint-accent text-white'
                    : 'text-osint-muted hover:text-osint-text'
                }`}
              >
                All Entities
              </button>
              <button
                onClick={() => setViewMode('suggestions')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-center gap-1.5 ${
                  viewMode === 'suggestions'
                    ? 'bg-osint-accent text-white'
                    : 'text-osint-muted hover:text-osint-text'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">Merge Suggestions</span>
                <span className="sm:hidden">Merge</span>
              </button>
            </div>

            <div className="flex gap-2">
              {/* Search */}
              <div className="relative flex-1 sm:flex-none">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-muted"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Search..."
                  className="w-full sm:w-48 lg:w-56 bg-osint-card border border-osint-border rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-osint-accent"
                />
              </div>

              {/* Type filter */}
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as EntityType | '')
                  setPage(1)
                }}
                className="bg-osint-card border border-osint-border rounded-lg px-3 sm:px-4 py-2 text-sm cursor-pointer hover:border-osint-accent transition-colors"
              >
                <option value="">All Types</option>
                <option value="PERSON">Person</option>
                <option value="ORGANIZATION">Organization</option>
                <option value="LOCATION">Location</option>
                <option value="DISTRICT">District</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex-shrink-0 mb-3 bg-osint-accent/10 border border-osint-accent/30 rounded-lg p-2 sm:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 animate-in slide-in-from-top-2">
          <span className="text-xs sm:text-sm font-medium">
            {selectedIds.size} {selectedIds.size === 1 ? 'entity' : 'entities'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkVerify}
              disabled={actionLoading === 'bulk'}
              className="flex-1 sm:flex-none px-2 sm:px-3 py-1.5 bg-severity-low/20 hover:bg-severity-low/30 text-severity-low rounded-lg text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-1.5 transition-colors"
            >
              <Check className="w-3 sm:w-4 h-3 sm:h-4" />
              <span className="hidden sm:inline">Verify All</span>
              <span className="sm:hidden">Verify</span>
            </button>
            <button
              onClick={handleBulkIrrelevant}
              disabled={actionLoading === 'bulk'}
              className="flex-1 sm:flex-none px-2 sm:px-3 py-1.5 bg-severity-critical/20 hover:bg-severity-critical/30 text-severity-critical rounded-lg text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-1.5 transition-colors"
            >
              <Ban className="w-3 sm:w-4 h-3 sm:h-4" />
              <span className="hidden sm:inline">Mark Irrelevant</span>
              <span className="sm:hidden">Remove</span>
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-2 sm:px-3 py-1.5 bg-osint-surface hover:bg-osint-border rounded-lg text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-1.5 transition-colors"
            >
              <X className="w-3 sm:w-4 h-3 sm:h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {viewMode === 'table' ? (
          loading ? (
            <LoadingSpinner message="Loading entities..." />
          ) : sortedEntities.length === 0 ? (
            <EmptyState
              title="No entities found"
              description="Try adjusting your search or filter criteria"
            />
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="sm:hidden space-y-3 pb-4">
                {sortedEntities.map((entity) => {
                  const isSelected = selectedIds.has(entity.id)
                  const isLoading = actionLoading === entity.id

                  return (
                    <div
                      key={entity.id}
                      onClick={() => setSelectedEntityId(entity.id)}
                      className={`bg-osint-card border border-osint-border rounded-xl p-3 cursor-pointer transition-colors ${
                        entity.is_irrelevant ? 'opacity-50' : ''
                      } ${isSelected ? 'border-osint-accent bg-osint-accent/5' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => handleToggleSelect(entity.id, e)}
                          onChange={() => {}}
                          className="w-4 h-4 mt-1 rounded border-osint-muted accent-osint-accent cursor-pointer flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={typeBadgeVariant[entity.entity_type]}>
                              {entity.entity_type}
                            </Badge>
                            {entity.is_verified && (
                              <CheckCircle className="w-3.5 h-3.5 text-severity-low" />
                            )}
                            {entity.is_irrelevant && (
                              <XCircle className="w-3.5 h-3.5 text-severity-critical" />
                            )}
                          </div>
                          <h3 className="font-medium text-sm break-words">{entity.name}</h3>
                          {entity.name_ne && (
                            <p className="text-xs text-osint-muted break-words">{entity.name_ne}</p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-osint-accent font-medium">
                              {entity.mention_count.toLocaleString()} mentions
                            </span>
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isLoading ? (
                                <div className="w-5 h-5 border-2 border-osint-accent/30 border-t-osint-accent rounded-full animate-spin" />
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => handleOpenMerge(entity, e)}
                                    className="p-1.5 hover:bg-osint-accent/20 rounded-lg transition-colors"
                                  >
                                    <GitMerge className="w-4 h-4 text-osint-muted" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleVerify(entity, e)}
                                    disabled={entity.is_verified}
                                    className="p-1.5 hover:bg-severity-low/20 rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    <Check className="w-4 h-4 text-osint-muted" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleMarkIrrelevant(entity, e)}
                                    disabled={entity.is_irrelevant}
                                    className="p-1.5 hover:bg-severity-critical/20 rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    <X className="w-4 h-4 text-osint-muted" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop Table View */}
              <div className="hidden sm:block bg-osint-card border border-osint-border rounded-xl overflow-hidden">
                <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-osint-border/50 sticky top-0 z-10">
                      <tr>
                        <th className="w-12 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === sortedEntities.length && sortedEntities.length > 0}
                            onChange={handleSelectAll}
                            className="w-4 h-4 rounded border-osint-muted accent-osint-accent cursor-pointer"
                          />
                        </th>
                        <th
                          onClick={() => handleSort('entity_type')}
                          className="text-left px-4 py-3 text-sm font-medium text-osint-muted cursor-pointer hover:text-osint-text"
                        >
                          <div className="flex items-center gap-1">
                            Type
                            <SortIcon field="entity_type" />
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort('name')}
                          className="text-left px-4 py-3 text-sm font-medium text-osint-muted cursor-pointer hover:text-osint-text"
                        >
                          <div className="flex items-center gap-1">
                            Name
                            <SortIcon field="name" />
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort('mention_count')}
                          className="text-left px-4 py-3 text-sm font-medium text-osint-muted cursor-pointer hover:text-osint-text"
                        >
                          <div className="flex items-center gap-1">
                            Mentions
                            <SortIcon field="mention_count" />
                          </div>
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-osint-muted">
                          Status
                        </th>
                        <th className="text-right px-4 py-3 text-sm font-medium text-osint-muted">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-osint-border">
                      {sortedEntities.map((entity) => {
                        const isSelected = selectedIds.has(entity.id)
                        const isLoading = actionLoading === entity.id

                        return (
                          <tr
                            key={entity.id}
                            onClick={() => setSelectedEntityId(entity.id)}
                            className={`hover:bg-osint-border/30 cursor-pointer transition-colors ${
                              entity.is_irrelevant ? 'opacity-50' : ''
                            } ${isSelected ? 'bg-osint-accent/5' : ''}`}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={(e) => handleToggleSelect(entity.id, e)}
                                onChange={() => {}}
                                className="w-4 h-4 rounded border-osint-muted accent-osint-accent cursor-pointer"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant={typeBadgeVariant[entity.entity_type]}>
                                {entity.entity_type}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium">{entity.name}</div>
                              {entity.name_ne && (
                                <div className="text-xs text-osint-muted">{entity.name_ne}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-osint-accent font-medium">
                                {entity.mention_count.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {entity.is_verified && (
                                <span className="flex items-center gap-1 text-xs text-severity-low bg-severity-low/10 px-2 py-0.5 rounded-full w-fit">
                                  <CheckCircle className="w-3 h-3" />
                                  Verified
                                </span>
                              )}
                              {entity.is_irrelevant && (
                                <span className="flex items-center gap-1 text-xs text-severity-critical bg-severity-critical/10 px-2 py-0.5 rounded-full w-fit">
                                  <XCircle className="w-3 h-3" />
                                  Irrelevant
                                </span>
                              )}
                              {!entity.is_verified && !entity.is_irrelevant && (
                                <span className="flex items-center gap-1 text-xs text-osint-muted bg-osint-surface px-2 py-0.5 rounded-full w-fit">
                                  <AlertCircle className="w-3 h-3" />
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div
                                className="flex items-center justify-end gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {isLoading ? (
                                  <div className="w-6 h-6 border-2 border-osint-accent/30 border-t-osint-accent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => handleOpenMerge(entity, e)}
                                      title="Find similar entities to merge"
                                      className="p-1.5 hover:bg-osint-accent/20 rounded-lg transition-colors group"
                                    >
                                      <GitMerge className="w-4 h-4 text-osint-muted group-hover:text-osint-accent" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleVerify(entity, e)}
                                      title={entity.is_verified ? "Already verified" : "Mark as verified"}
                                      disabled={entity.is_verified}
                                      className={`p-1.5 rounded-lg transition-colors group ${
                                        entity.is_verified
                                          ? 'opacity-50 cursor-not-allowed'
                                          : 'hover:bg-severity-low/20'
                                      }`}
                                    >
                                      <Check className={`w-4 h-4 ${
                                        entity.is_verified
                                          ? 'text-severity-low'
                                          : 'text-osint-muted group-hover:text-severity-low'
                                      }`} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleMarkIrrelevant(entity, e)}
                                      title={entity.is_irrelevant ? "Already marked irrelevant" : "Mark as irrelevant"}
                                      disabled={entity.is_irrelevant}
                                      className={`p-1.5 rounded-lg transition-colors group ${
                                        entity.is_irrelevant
                                          ? 'opacity-50 cursor-not-allowed'
                                          : 'hover:bg-severity-critical/20'
                                      }`}
                                    >
                                      <X className={`w-4 h-4 ${
                                        entity.is_irrelevant
                                          ? 'text-severity-critical'
                                          : 'text-osint-muted group-hover:text-severity-critical'
                                      }`} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )
        ) : (
          /* Merge Suggestions View */
          <div className="space-y-3 sm:space-y-4 pb-4">
            {loadingSuggestions ? (
              <div className="bg-osint-card border border-osint-border rounded-xl p-6 sm:p-8">
                <LoadingSpinner message="Finding entities with potential duplicates..." />
              </div>
            ) : suggestions.length === 0 ? (
              <div className="bg-osint-card border border-osint-border rounded-xl p-6 sm:p-8">
                <EmptyState
                  title="No merge suggestions"
                  description="All entities appear to be unique. Great job!"
                />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs sm:text-sm text-osint-muted">
                    Found {suggestions.length} entities with potential duplicates
                  </p>
                  <button
                    onClick={fetchSuggestions}
                    className="flex items-center gap-1.5 text-xs sm:text-sm text-osint-accent hover:text-osint-accent-hover"
                  >
                    <RefreshCw className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                    Refresh
                  </button>
                </div>

                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.entity.id}
                    className="bg-osint-card border border-osint-border rounded-xl overflow-hidden"
                  >
                    {/* Main Entity Header */}
                    <div className="p-3 sm:p-4 border-b border-osint-border bg-osint-surface/50">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={typeBadgeVariant[suggestion.entity.entity_type]}>
                            {suggestion.entity.entity_type}
                          </Badge>
                          <span className="font-semibold text-sm sm:text-lg">{suggestion.entity.name}</span>
                          <span className="text-osint-muted text-xs sm:text-sm">
                            {suggestion.entity.mention_count.toLocaleString()} mentions
                          </span>
                        </div>
                        <button
                          onClick={() => setMergeEntity(suggestion.entity)}
                          className="px-3 py-1.5 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <GitMerge className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                          Review
                        </button>
                      </div>
                    </div>

                    {/* Similar Entities */}
                    <div className="divide-y divide-osint-border/50">
                      {suggestion.suggestions.map((similar) => (
                        <div
                          key={similar.id}
                          className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between hover:bg-osint-border/20 transition-colors gap-3"
                        >
                          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                            <div className="w-12 sm:w-16 text-center flex-shrink-0">
                              <div
                                className={`text-sm sm:text-lg font-bold ${
                                  similar.similarity_score >= 0.8
                                    ? 'text-severity-low'
                                    : similar.similarity_score >= 0.6
                                    ? 'text-severity-medium'
                                    : 'text-osint-muted'
                                }`}
                              >
                                {(similar.similarity_score * 100).toFixed(0)}%
                              </div>
                              <div className="text-[10px] sm:text-xs text-osint-muted truncate">
                                {similar.match_reason.replace('_', ' ')}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{similar.name}</div>
                              {similar.name_ne && (
                                <div className="text-osint-muted text-xs truncate">{similar.name_ne}</div>
                              )}
                            </div>
                          </div>
                          <span className="text-osint-muted text-xs sm:text-sm flex-shrink-0">
                            {similar.mention_count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Pagination - Fixed at bottom */}
      {viewMode === 'table' && !loading && total > 0 && (
        <div className="flex-shrink-0 pt-3 sm:pt-4">
          <div className="bg-osint-card border border-osint-border rounded-xl overflow-hidden">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <EntityDetailModal
        entityId={selectedEntityId}
        onClose={() => setSelectedEntityId(null)}
      />

      {/* Merge Modal */}
      <EntityMergeModal
        entity={mergeEntity}
        onClose={() => setMergeEntity(null)}
        onMergeComplete={handleMergeComplete}
      />
    </div>
  )
}
