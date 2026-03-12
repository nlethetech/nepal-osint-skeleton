import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Network, FileText, Users, Hash } from 'lucide-react'
import { format } from 'date-fns'

import { getSubgraph } from '../api/graph'
import {
  getKBEntity,
  getKBEntityProvenance,
  type KBEntity,
  type EntityProvenanceResponse,
  type ProvenanceStory,
} from '../api/kbEntities'
import {
  getStory,
  getStoryKBEntities,
  type StoryKBEntitiesResponse,
  type StoryKBEntityItem,
} from '../api/stories'
import type { Story, SubgraphResponse, GraphNode } from '../types/api'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { EmptyState } from '../components/common/EmptyState'

type DossierKind = 'kb-entity' | 'story'

function isSupportedKind(kind: string | undefined): kind is DossierKind {
  return kind === 'kb-entity' || kind === 'story'
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return format(new Date(iso), 'MMM d, yyyy HH:mm')
  } catch {
    return iso
  }
}

function getNodeDossierPath(node: GraphNode): string | null {
  const t = (node.type || '').toLowerCase()
  if (t === 'document') return `/dossier/story/${node.id}`
  return `/dossier/kb-entity/${node.id}`
}

function EvidenceSnippet({ item }: { item: ProvenanceStory }) {
  const snippet = item.evidence_excerpt || item.context_window || null
  if (!snippet) return null
  return (
    <p className="text-xs text-osint-muted leading-relaxed line-clamp-3">
      {snippet}
    </p>
  )
}

function StoryEntityEvidenceSnippet({ item }: { item: StoryKBEntityItem }) {
  const snippet = item.evidence_excerpt || item.context_window || null
  if (!snippet) return null
  return (
    <p className="text-xs text-osint-muted leading-relaxed line-clamp-3">
      {snippet}
    </p>
  )
}

export default function Dossier() {
  const navigate = useNavigate()
  const { kind, id } = useParams<{ kind: string; id: string }>()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [kbEntity, setKbEntity] = useState<KBEntity | null>(null)
  const [entityProv, setEntityProv] = useState<EntityProvenanceResponse | null>(null)
  const [entitySubgraph, setEntitySubgraph] = useState<SubgraphResponse | null>(null)
  const [graphUnavailable, setGraphUnavailable] = useState(false)

  const [story, setStory] = useState<Story | null>(null)
  const [storyEntities, setStoryEntities] = useState<StoryKBEntitiesResponse | null>(null)

  const safeKind: DossierKind | null = useMemo(() => (isSupportedKind(kind) ? kind : null), [kind])

  useEffect(() => {
    if (!safeKind || !id) {
      setError('Unsupported dossier type')
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setKbEntity(null)
      setEntityProv(null)
      setEntitySubgraph(null)
      setGraphUnavailable(false)
      setStory(null)
      setStoryEntities(null)

      try {
        if (safeKind === 'kb-entity') {
          const [entity, prov] = await Promise.all([
            getKBEntity(id),
            getKBEntityProvenance(id, 25),
          ])
          if (cancelled) return
          setKbEntity(entity)
          setEntityProv(prov)

          try {
            const sg = await getSubgraph(id, { depth: 1, maxNeighbors: 25 })
            if (!cancelled) setEntitySubgraph(sg)
          } catch (e) {
            console.warn('Graph unavailable for dossier', e)
            if (!cancelled) setGraphUnavailable(true)
          }
          return
        }

        if (safeKind === 'story') {
          const [s, ents] = await Promise.all([
            getStory(id),
            getStoryKBEntities(id, 200),
          ])
          if (cancelled) return
          setStory(s)
          setStoryEntities(ents)
          return
        }
      } catch (e) {
        console.error('Failed to load dossier', e)
        if (!cancelled) setError('Failed to load dossier')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [safeKind, id])

  if (loading) {
    return <LoadingSpinner message="Loading dossier..." />
  }

  if (error || !safeKind || !id) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-osint-border transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-lg font-semibold">Dossier</h1>
          </div>
          <EmptyState
            title="Unable to open dossier"
            description={error || 'This dossier type is not supported.'}
          />
        </div>
      </div>
    )
  }

  // =============================================================================
  // KB ENTITY DOSSIER
  // =============================================================================
  if (safeKind === 'kb-entity' && kbEntity) {
    const connections = (entitySubgraph?.nodes || [])
      .filter((n) => n.id !== kbEntity.id)
      .slice(0, 12)

    return (
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-osint-border transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="px-2 py-0.5 rounded bg-osint-border text-xs text-osint-muted">
                {kbEntity.entity_type}
              </span>
              {kbEntity.is_curated && (
                <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-xs border border-green-500/30">
                  Curated
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold break-words">{kbEntity.canonical_name}</h1>
            {kbEntity.canonical_name_ne ? (
              <p className="text-osint-muted mt-1 break-words">{kbEntity.canonical_name_ne}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => navigate(`/graph?focus=${kbEntity.id}`)}
              className="btn btn-secondary btn-sm"
              title="Open in Graph"
            >
              <Network size={14} />
              Graph
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Summary */}
          <div className="lg:col-span-1 space-y-4">
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Summary</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-osint-card border border-osint-border rounded-lg p-3">
                  <div className="text-xs text-osint-muted mb-1">Mentions</div>
                  <div className="text-lg font-bold">{kbEntity.total_mentions.toLocaleString()}</div>
                </div>
                <div className="bg-osint-card border border-osint-border rounded-lg p-3">
                  <div className="text-xs text-osint-muted mb-1">Links</div>
                  <div className="text-lg font-bold">{kbEntity.total_links.toLocaleString()}</div>
                </div>
                <div className="bg-osint-card border border-osint-border rounded-lg p-3 col-span-2">
                  <div className="text-xs text-osint-muted mb-1">Avg Confidence</div>
                  <div className="text-lg font-bold">{kbEntity.avg_confidence.toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Aliases</h2>
              {kbEntity.aliases && kbEntity.aliases.length > 0 ? (
                <div className="space-y-2">
                  {kbEntity.aliases.slice(0, 20).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{a.alias_text}</div>
                        <div className="text-xs text-osint-muted">{a.lang} • {a.alias_type}</div>
                      </div>
                      <span className="text-xs text-osint-muted flex-shrink-0">{a.weight.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-osint-muted">No aliases recorded.</div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Attributes</h2>
              {kbEntity.attributes ? (
                <pre className="text-xs bg-osint-card border border-osint-border rounded p-3 overflow-auto">
                  {JSON.stringify(kbEntity.attributes, null, 2)}
                </pre>
              ) : (
                <div className="text-sm text-osint-muted">No attributes recorded.</div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Entity ID</h2>
              <code className="text-xs bg-osint-card border border-osint-border rounded px-2 py-1 break-all block">
                {kbEntity.id}
              </code>
            </div>
          </div>

          {/* Right: Evidence + Connections */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Evidence / Provenance</h2>
                  {entityProv ? (
                    <p className="text-xs text-osint-muted mt-1">
                      {entityProv.total_source_stories.toLocaleString()} sources • {entityProv.total_mentions.toLocaleString()} linked mentions
                    </p>
                  ) : null}
                </div>
              </div>

              {!entityProv || entityProv.stories.length === 0 ? (
                <div className="text-sm text-osint-muted">No linked sources found for this entity yet.</div>
              ) : (
                <div className="space-y-3">
                  {entityProv.stories.map((s) => (
                    <div
                      key={s.story_id}
                      onClick={() => navigate(`/dossier/story/${s.story_id}`)}
                      className="bg-osint-card border border-osint-border rounded-xl p-4 hover:border-osint-accent/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 bg-osint-accent/20 text-osint-accent text-xs rounded">
                              {s.source_id}
                            </span>
                            {s.published_at ? (
                              <span className="text-xs text-osint-muted">{formatDateTime(s.published_at)}</span>
                            ) : null}
                            <span className="text-xs text-osint-muted">
                              <Hash className="inline w-3 h-3 mr-1" />
                              {s.mention_count} mentions • {s.max_link_confidence.toFixed(2)} max
                            </span>
                          </div>
                          <div className="font-medium text-sm break-words">{s.title}</div>
                          {s.title_ne ? (
                            <div className="text-xs text-osint-muted mt-1 break-words">{s.title_ne}</div>
                          ) : null}
                          <div className="mt-2">
                            <EvidenceSnippet item={s} />
                          </div>
                        </div>

                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 hover:bg-osint-border rounded-lg transition-colors flex-shrink-0"
                          title="Open original article"
                        >
                          <ExternalLink size={16} className="text-osint-muted" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold">Connections</h2>
                {graphUnavailable ? (
                  <span className="text-xs text-osint-muted">Graph unavailable</span>
                ) : null}
              </div>

              {!entitySubgraph || connections.length === 0 ? (
                <div className="text-sm text-osint-muted">
                  {graphUnavailable ? 'Neo4j is not available, so connections cannot be shown.' : 'No graph connections found yet.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {connections.map((n) => {
                    const path = getNodeDossierPath(n)
                    return (
                      <button
                        key={n.id}
                        onClick={() => (path ? navigate(path) : null)}
                        className="text-left flex items-center gap-3 p-3 bg-osint-card border border-osint-border rounded-lg hover:border-osint-accent/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-osint-muted">{n.type}</div>
                          <div className="text-sm font-medium truncate">{n.label}</div>
                        </div>
                        <span className="text-osint-muted">
                          <ArrowLeft className="w-4 h-4 rotate-180" />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // =============================================================================
  // STORY DOSSIER
  // =============================================================================
  if (safeKind === 'story' && story) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-osint-border transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="px-2 py-0.5 rounded bg-osint-accent/20 text-osint-accent text-xs">
                {story.source_id}
              </span>
              <span className="px-2 py-0.5 rounded bg-osint-border text-xs text-osint-muted">
                {story.language.toUpperCase()}
              </span>
              {story.published_at ? (
                <span className="text-xs text-osint-muted">{formatDateTime(story.published_at)}</span>
              ) : null}
            </div>
            <h1 className="text-2xl font-bold leading-relaxed break-words">{story.title}</h1>
            {story.title_ne ? (
              <p className="text-osint-muted mt-1 break-words">{story.title_ne}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              title="Open original article"
            >
              <ExternalLink size={14} />
              Read
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Summary</h2>
              {story.summary ? (
                <p className="text-sm text-osint-text leading-relaxed">{story.summary}</p>
              ) : (
                <div className="text-sm text-osint-muted">No summary available.</div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Entities Mentioned (Evidence-Based)</h2>
              {!storyEntities || storyEntities.entities.length === 0 ? (
                <div className="text-sm text-osint-muted">No linked KB entities found for this story yet.</div>
              ) : (
                <div className="space-y-2">
                  {storyEntities.entities.map((e) => (
                    <div
                      key={e.entity_id}
                      onClick={() => navigate(`/dossier/kb-entity/${e.entity_id}`)}
                      className="bg-osint-card border border-osint-border rounded-xl p-4 hover:border-osint-accent/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-osint-muted">
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded bg-osint-border text-xs text-osint-muted">
                              {e.entity_type}
                            </span>
                            <span className="text-xs text-osint-muted">
                              <Hash className="inline w-3 h-3 mr-1" />
                              {e.mention_count} mentions • {e.max_link_confidence.toFixed(2)} max
                            </span>
                          </div>
                          <div className="font-medium text-sm truncate">{e.canonical_name}</div>
                          {e.canonical_name_ne ? (
                            <div className="text-xs text-osint-muted mt-1 truncate">{e.canonical_name_ne}</div>
                          ) : null}
                          <div className="mt-2">
                            <StoryEntityEvidenceSnippet item={e} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3">Provenance</h2>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-osint-muted">
                  <FileText className="w-4 h-4" />
                  <span>Story ID</span>
                </div>
                <code className="text-xs bg-osint-card border border-osint-border rounded px-2 py-1 break-all block">
                  {story.id}
                </code>
                <div className="pt-2">
                  <a
                    href={story.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-osint-accent hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Source URL
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <EmptyState
      title="No dossier data"
      description="The requested dossier could not be loaded."
    />
  )
}

