import { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Tag, Intent, Spinner } from '@blueprintjs/core'
import {
  Search,
  Plus,
  User,
  Users,
  Building,
  Landmark,
  TrendingUp,
  X,
  Trash2,
} from 'lucide-react'
import {
  fuzzySearchEntities,
  getTrendingEntities,
  type SearchResult,
} from '../../api/entityIntelligence'
import {
  searchGraph,
  expandNode as expandGraphNode,
  getNodeDetail,
  resolveGraphNode,
  type GraphNode,
} from '../../api/unifiedGraph'
import { searchCompanies, type CompanyRecord } from '../../api/corporate'
import { useInvestigationStore } from '../../stores/investigationStore'
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore'

// ============================================================================
// Constants
// ============================================================================

const ENTITY_TYPE_ICONS: Record<string, typeof User> = {
  person: User,
  party: Users,
  organization: Building,
  institution: Landmark,
  government: Landmark,
  company: Building,
}

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'person', label: 'Person' },
  { key: 'company', label: 'Company' },
  { key: 'organization', label: 'Org' },
  { key: 'party', label: 'Party' },
  { key: 'institution', label: 'Institution' },
] as const

// ============================================================================
// Unified search result type
// ============================================================================

interface UnifiedResult {
  id: string
  name: string
  name_secondary?: string
  entity_type: string
  subtype?: string
  party?: string
  subtitle?: string
  source: 'entity' | 'graph' | 'corporate'
  image_url?: string
}

function sourceToResolverInput(entity: UnifiedResult): { source_table: string; source_id: string } | null {
  if (entity.source === 'entity') {
    return { source_table: 'political_entities', source_id: entity.id }
  }
  if (entity.source === 'corporate') {
    return { source_table: 'company_registrations', source_id: entity.id }
  }
  return null
}

/** Merge results from three sources, deduplicate by id */
function mergeResults(
  entities: SearchResult[],
  graphNodes: GraphNode[],
  companies: CompanyRecord[],
): UnifiedResult[] {
  const seen = new Set<string>()
  const results: UnifiedResult[] = []

  // Political entities first (highest quality matches)
  for (const e of entities) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    results.push({
      id: e.id,
      name: e.name_en,
      name_secondary: e.name_ne,
      entity_type: e.entity_type,
      party: e.party,
      subtitle: e.role ?? (e.mentions_24h > 0 ? `${e.mentions_24h} mentions/24h` : undefined),
      source: 'entity',
      image_url: e.image_url,
    })
  }

  // Graph nodes (covers all types in the knowledge graph)
  for (const n of graphNodes) {
    const id = n.data.id
    if (seen.has(id)) continue
    seen.add(id)
    results.push({
      id,
      name: n.data.label || id.slice(0, 12),
      entity_type: n.data.node_type || 'unknown',
      subtype: typeof n.data.subtype === 'string' ? n.data.subtype : undefined,
      subtitle: n.data.district ?? undefined,
      source: 'graph',
    })
  }

  // Corporate companies
  for (const c of companies) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    results.push({
      id: c.id,
      name: c.name_english || c.ird_taxpayer_name || `Reg #${c.registration_number}`,
      name_secondary: c.name_nepali ?? undefined,
      entity_type: 'company',
      subtitle: [c.district, c.company_type_category].filter(Boolean).join(' \u00b7 '),
      source: 'corporate',
    })
  }

  return results
}

// ============================================================================
// Component
// ============================================================================

interface EntityBrowserPanelProps {
  className?: string
}

export function EntityBrowserPanel({ className = '' }: EntityBrowserPanelProps) {
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState<string | null>(null)
  const [results, setResults] = useState<UnifiedResult[]>([])
  const [trending, setTrending] = useState<
    Array<{
      id: string
      canonical_id: string
      name_en: string
      entity_type: string
      party?: string
      mentions_24h: number
      trend: string
      image_url?: string
    }>
  >([])
  const [isSearching, setIsSearching] = useState(false)
  const [loadingEntityId, setLoadingEntityId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { selectEntity } = useConnectedAnalystStore()
  const {
    pinnedNodeIds,
    elements,
    addEntity,
    addSyntheticNode,
    clearInvestigation,
  } = useInvestigationStore()

  // --------------------------------------------------------------------------
  // Load trending entities on mount
  // --------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    async function loadTrending() {
      try {
        const data = await getTrendingEntities({ limit: 8 })
        if (!cancelled) setTrending(data)
      } catch {
        // Silently fail - trending is optional
      }
    }
    void loadTrending()
    return () => { cancelled = true }
  }, [])

  // --------------------------------------------------------------------------
  // Debounced search
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        // Determine which entity type to pass to the political search
        const typeForEntity = activeType && activeType !== 'all' && activeType !== 'company'
          ? activeType
          : undefined
        const graphTypeFilter = activeType === 'company'
          ? 'organization'
          : typeForEntity

        // Fire all three searches in parallel — gracefully handle individual failures
        const [entities, graphRes, corporateRes] = await Promise.all([
          fuzzySearchEntities(query, { entityType: typeForEntity, limit: 15 }).catch(() => [] as SearchResult[]),
          searchGraph(query, { node_types: graphTypeFilter ?? undefined, limit: 15 }).catch(() => null),
          searchCompanies({ q: query, limit: 15 }).catch(() => null),
        ])

        const graphNodes = graphRes?.data?.nodes ?? []
        const companies = corporateRes?.items ?? []

        // If a specific type filter is active, filter accordingly
        let merged = mergeResults(entities, graphNodes, companies)
        if (activeType && activeType !== 'all') {
          merged = merged.filter((r) => {
            if (activeType === 'company') {
              return r.entity_type === 'company' || (r.entity_type === 'organization' && r.subtype === 'company')
            }
            return r.entity_type === activeType
          })
        }

        setResults(merged)
      } catch {
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [query, activeType])

  // --------------------------------------------------------------------------
  // Resolve source row to unified graph node ID
  // --------------------------------------------------------------------------

  const resolveToGraphNodeId = useCallback(async (entity: UnifiedResult): Promise<string | null> => {
    if (entity.source === 'graph') return entity.id
    const resolverInput = sourceToResolverInput(entity)
    if (!resolverInput) return null
    const resolved = await resolveGraphNode(resolverInput).then((r) => r.data).catch(() => null)
    return resolved?.found && resolved.node?.data?.id ? resolved.node.data.id : null
  }, [])

  // --------------------------------------------------------------------------
  // Add entity to investigation graph
  // --------------------------------------------------------------------------

  const handleAddEntity = useCallback(
    async (entity: UnifiedResult) => {
      if (pinnedNodeIds.includes(entity.id)) return
      setLoadingEntityId(entity.id)

      try {
        const resolvedNodeId = await resolveToGraphNodeId(entity)

        // Always prefer canonical graph node expansion when resolvable.
        const [nodeDetail, expansion] = await Promise.all([
          resolvedNodeId ? getNodeDetail(resolvedNodeId).then((r) => r.data).catch(() => null) : Promise.resolve(null),
          resolvedNodeId ? expandGraphNode(resolvedNodeId, { limit: 20 }).then((r) => r.data).catch(() => null) : Promise.resolve(null),
        ])

        if (nodeDetail) {
          // Node exists in unified graph — use full detail
          const primaryNode = {
            data: {
              id: nodeDetail.id,
              label: nodeDetail.title,
              node_type: nodeDetail.node_type,
              canonical_key: nodeDetail.canonical_key ?? '',
              district: nodeDetail.district,
              province: nodeDetail.province,
              confidence: nodeDetail.confidence,
              properties: nodeDetail.properties,
              degree: nodeDetail.total_outgoing + nodeDetail.total_incoming,
              pagerank: (nodeDetail.metrics?.[0] as Record<string, unknown>)?.pagerank as number ?? 0,
              is_hub: false,
              is_bridge: false,
            },
          }
          addEntity(primaryNode, expansion?.nodes ?? [], expansion?.edges ?? [])
        } else {
          // Explicit fallback: synthetic node with warning badge.
          addSyntheticNode({
            id: entity.id,
            label: entity.name,
            node_type: entity.entity_type,
            district: entity.subtitle?.split(' \u00b7 ')[0] ?? '',
            source_type: entity.source,
            warning: 'Unresolved source record (synthetic fallback)',
            is_synthetic: true,
          })
        }
      } catch (err) {
        console.error('Failed to add entity:', err)
      } finally {
        setLoadingEntityId(null)
      }
    },
    [pinnedNodeIds, addEntity, addSyntheticNode, resolveToGraphNodeId],
  )

  const handleOpenProfile = useCallback(async (entity: UnifiedResult) => {
    const resolvedNodeId = await resolveToGraphNodeId(entity)
    selectEntity(resolvedNodeId ?? entity.id)
  }, [resolveToGraphNodeId, selectEntity])

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  const nodeCount = elements.filter((el) => el.group === 'nodes').length
  const edgeCount = elements.filter((el) => el.group === 'edges').length

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const showSearch = query.length >= 2
  const displayItems = showSearch ? results : []

  return (
    <div
      className={`flex flex-col h-full investigation-panel-chrome rounded-lg overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-bp-border">
        <h3 className="investigation-rail-title">
          Entity Browser
        </h3>
      </div>

      {/* Search Input */}
      <div className="px-3 pt-2 bg-bp-card">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bp-text-secondary"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entities..."
            className="w-full rounded-md pl-8 pr-8 py-1.5 text-xs bg-bp-surface border border-bp-border text-bp-text placeholder:text-bp-text-secondary focus:outline-none focus:border-bp-primary"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                setResults([])
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-bp-text-secondary hover:text-bp-text"
            >
              <X size={12} />
            </button>
          )}
          {isSearching && (
            <div className="absolute right-7 top-1/2 -translate-y-1/2">
              <Spinner size={12} />
            </div>
          )}
        </div>
      </div>

      {/* Type Filters */}
      <div className="flex items-center gap-1 px-3 py-2 flex-wrap border-b border-bp-border/40 bg-bp-card">
        {TYPE_FILTERS.map((f) => (
          <Tag
            key={f.key}
            minimal
            interactive
            round
            intent={activeType === f.key ? Intent.PRIMARY : Intent.NONE}
            onClick={() => setActiveType(activeType === f.key ? null : f.key)}
            className="text-[10px] cursor-pointer border border-transparent"
          >
            {f.label}
          </Tag>
        ))}
      </div>

      {/* Results / Trending */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">
        {showSearch ? (
          displayItems.length > 0 ? (
            <div className="space-y-0.5">
              {displayItems.map((entity) => {
                const Icon = ENTITY_TYPE_ICONS[entity.entity_type] || User
                const isPinned = pinnedNodeIds.includes(entity.id)
                const isLoading = loadingEntityId === entity.id

                return (
                  <div
                    key={entity.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bp-hover transition-colors group"
                  >
                    {/* Icon */}
                    <div className="w-7 h-7 rounded-full bg-bp-surface flex items-center justify-center flex-shrink-0">
                      {entity.image_url ? (
                        <img
                          src={entity.image_url}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      ) : (
                        <Icon size={13} className="text-bp-text-secondary" />
                      )}
                    </div>

                    {/* Info */}
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => void handleOpenProfile(entity)}
                    >
                      <div className="text-xs text-bp-text font-medium truncate">
                        {entity.name}
                      </div>
                      {entity.name_secondary && (
                        <div className="text-[10px] text-bp-text-secondary truncate">
                          {entity.name_secondary}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-[10px] text-bp-text-secondary">
                        <span className="capitalize">{entity.entity_type}</span>
                        {entity.party && (
                          <>
                            <span>&middot;</span>
                            <span className="truncate">{entity.party}</span>
                          </>
                        )}
                        {entity.subtitle && (
                          <>
                            <span>&middot;</span>
                            <span className="truncate">{entity.subtitle}</span>
                          </>
                        )}
                        <Tag
                          minimal
                          round
                          className="text-[8px] ml-auto"
                          intent={entity.source === 'corporate' ? Intent.SUCCESS : entity.source === 'entity' ? Intent.PRIMARY : Intent.NONE}
                        >
                          {entity.source === 'corporate' ? 'Corp' : entity.source === 'entity' ? 'Intel' : 'Graph'}
                        </Tag>
                      </div>
                    </button>

                    {/* Add button */}
                    <Button
                      minimal
                      small
                      disabled={isPinned}
                      loading={isLoading}
                      icon={
                        isPinned ? undefined : (
                          <Plus size={12} className="text-bp-primary" />
                        )
                      }
                      onClick={() => void handleAddEntity(entity)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      title={isPinned ? 'Already in graph' : 'Add to investigation'}
                    >
                      {isPinned ? (
                        <span className="text-[10px] text-bp-text-secondary">
                          Added
                        </span>
                      ) : null}
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : !isSearching ? (
            <div className="flex items-center justify-center h-20">
              <p className="text-xs text-bp-text-secondary">No entities found</p>
            </div>
          ) : null
        ) : (
          /* Trending Entities */
          <div>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <TrendingUp size={12} className="text-bp-text-secondary" />
              <span className="text-[10px] uppercase font-semibold tracking-wide text-bp-text-secondary">
                Trending
              </span>
            </div>
            <div className="space-y-0.5">
              {trending.map((entity) => {
                const Icon = ENTITY_TYPE_ICONS[entity.entity_type] || User
                const isPinned = pinnedNodeIds.includes(entity.id)
                const isLoading = loadingEntityId === entity.id

                return (
                  <div
                    key={entity.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bp-hover transition-colors group"
                  >
                    <div className="w-6 h-6 rounded-full bg-bp-surface flex items-center justify-center flex-shrink-0">
                      {entity.image_url ? (
                        <img
                          src={entity.image_url}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <Icon size={12} className="text-bp-text-secondary" />
                      )}
                    </div>

                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => void handleOpenProfile({
                        id: entity.id,
                        name: entity.name_en,
                        entity_type: entity.entity_type,
                        party: entity.party,
                        source: 'entity',
                        image_url: entity.image_url,
                      })}
                    >
                      <div className="text-xs text-bp-text font-medium truncate">
                        {entity.name_en}
                      </div>
                      <div className="text-[10px] text-bp-text-secondary capitalize">
                        {entity.entity_type}
                        {entity.mentions_24h > 0 && ` \u00b7 ${entity.mentions_24h} mentions`}
                      </div>
                    </button>

                    <Button
                      minimal
                      small
                      disabled={isPinned}
                      loading={isLoading}
                      icon={
                        isPinned ? undefined : (
                          <Plus size={12} className="text-bp-primary" />
                        )
                      }
                      onClick={() => void handleAddEntity({
                        id: entity.id,
                        name: entity.name_en,
                        entity_type: entity.entity_type,
                        party: entity.party,
                        source: 'entity',
                        image_url: entity.image_url,
                      })}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                )
              })}
              {trending.length === 0 && (
                <p className="text-xs text-bp-text-secondary px-2 py-4 text-center">
                  No trending entities
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Investigation Summary Footer */}
      <div className="px-3 py-2 border-t border-bp-border flex items-center justify-between">
        <span className="text-[10px] text-bp-text-secondary">
          {pinnedNodeIds.length} pinned &middot; {nodeCount} nodes &middot; {edgeCount} edges
        </span>
        {elements.length > 0 && (
          <Button
            minimal
            small
            icon={<Trash2 size={11} className="text-bp-text-secondary" />}
            onClick={clearInvestigation}
            title="Clear investigation"
            className="text-bp-text-secondary"
          />
        )}
      </div>
    </div>
  )
}
