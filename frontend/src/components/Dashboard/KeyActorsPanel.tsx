/**
 * Key Actors Panel - Palantir-grade dashboard component
 * Shows top mentioned political actors (politicians, parties, orgs) with trend indicators
 * Enhanced with real-time WebSocket updates and entity stories modal
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { User, Building2, TrendingUp, TrendingDown, Minus, ExternalLink, Zap, Users, Landmark, ChevronRight } from 'lucide-react'
import { getKeyActors, type KeyActor } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { useRealtimeStore, type EntityMention } from '../../store/realtimeSlice'
import { EntityStoriesModal } from '../entities/EntityStoriesModal'

// Map API entity types to display values and icons
type EntityTypeFilter = 'all' | 'person' | 'party' | 'organization'

interface KeyActorsPanelProps {
  hours?: number
  limit?: number
  districts?: string[]
  compact?: boolean
  onActorClick?: (actor: KeyActor) => void
}

export function KeyActorsPanel({ hours = 24, limit = 10, districts, compact = false, onActorClick }: KeyActorsPanelProps) {
  const [actors, setActors] = useState<KeyActor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<EntityTypeFilter>('all')
  const [selectedActor, setSelectedActor] = useState<KeyActor | null>(null)
  const [showModal, setShowModal] = useState(false)

  // Real-time entity mentions from WebSocket
  const { recentEntityMentions, keyActorsVersion, isConnected } = useRealtimeStore()

  // Handle actor click - open modal or call external handler
  const handleActorClick = useCallback((actor: KeyActor) => {
    if (onActorClick) {
      onActorClick(actor)
    } else {
      setSelectedActor(actor)
      setShowModal(true)
    }
  }, [onActorClick])

  useEffect(() => {
    const fetchActors = async () => {
      setLoading(true)
      setError(null)
      try {
        // Map filter to API value (new API uses lowercase types: person, party, organization, institution)
        const apiFilter = filter === 'all' ? undefined : filter
        const data = await getKeyActors(hours, apiFilter, limit, true) // includeStories=true
        setActors(data)
      } catch (err) {
        console.error('Failed to fetch key actors:', err)
        setError('Failed to load key actors')
      } finally {
        setLoading(false)
      }
    }
    fetchActors()
  }, [hours, filter, limit, districts])

  // Merge API actors with real-time mentions
  const mergedActors = useMemo(() => {
    if (actors.length === 0) return actors

    // Create a map of real-time mention counts by name (lowercase)
    const realtimeCounts = new Map<string, EntityMention>()
    for (const mention of recentEntityMentions) {
      realtimeCounts.set(mention.name.toLowerCase(), mention)
    }

    // Update actors with real-time deltas
    const updatedActors = actors.map((actor) => {
      const realtimeMention = realtimeCounts.get(actor.name.toLowerCase())
      if (realtimeMention) {
        return {
          ...actor,
          mention_count_24h: actor.mention_count_24h + realtimeMention.count,
          hasRealtimeUpdates: true,
          realtimeDelta: realtimeMention.count,
          lastSeenRealtime: realtimeMention.lastSeen,
        }
      }
      return actor
    })

    // Find new entities from real-time that aren't in API data
    const existingNames = new Set(actors.map((a) => a.name.toLowerCase()))
    const newRealtimeEntities: KeyActor[] = []

    for (const mention of recentEntityMentions) {
      if (!existingNames.has(mention.name.toLowerCase()) && mention.count >= 2) {
        // Map legacy uppercase types to new lowercase types
        const entityType = mention.type === 'PERSON' || mention.type === 'person'
          ? 'person'
          : (mention.type === 'ORG' || mention.type === 'ORGANIZATION' || mention.type === 'organization')
            ? 'organization'
            : 'person' as const
        newRealtimeEntities.push({
          entity_id: `realtime_${mention.name}`,
          canonical_id: `realtime_${mention.name.toLowerCase().replace(/\s+/g, '_')}`,
          name: mention.name,
          name_ne: undefined,
          entity_type: entityType,
          mention_count: mention.count,
          mention_count_24h: mention.count,
          trend: 'rising',
          top_stories: [],
          hasRealtimeUpdates: true,
          isNewFromRealtime: true,
        } as KeyActor & { hasRealtimeUpdates?: boolean; isNewFromRealtime?: boolean })
      }
    }

    // Combine and sort by 24h mention count
    return [...updatedActors, ...newRealtimeEntities]
      .sort((a, b) => b.mention_count_24h - a.mention_count_24h)
      .slice(0, limit)
  }, [actors, recentEntityMentions, keyActorsVersion, limit])

  // Filter merged actors by entity type
  const filteredActors = useMemo(() => {
    if (filter === 'all') return mergedActors
    if (filter === 'party') {
      return mergedActors.filter((a) => a.entity_type === 'party')
    }
    if (filter === 'organization') {
      // Include both organization and institution
      return mergedActors.filter((a) =>
        a.entity_type === 'organization' || a.entity_type === 'institution'
      )
    }
    // person filter
    return mergedActors.filter((a) => a.entity_type === 'person')
  }, [mergedActors, filter])

  // Get icon for entity type
  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'person':
        return <User className="w-3 h-3 text-blue-400 flex-shrink-0" />
      case 'party':
        return <Users className="w-3 h-3 text-amber-400 flex-shrink-0" />
      case 'organization':
      case 'institution':
        return <Building2 className="w-3 h-3 text-purple-400 flex-shrink-0" />
      default:
        return <User className="w-3 h-3 text-blue-400 flex-shrink-0" />
    }
  }

  // Match ThreatMatrix card styling
  const cardClass = compact
    ? "bg-osint-card border border-osint-border rounded-lg p-3"
    : "bg-osint-card border border-osint-border rounded-xl p-5"

  if (loading) {
    return (
      <div className={cardClass}>
        <h2 className="text-xs font-medium text-osint-muted uppercase mb-1.5">Key Actors</h2>
        <div className="flex items-center justify-center h-20">
          <LoadingSpinner />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cardClass}>
        <h2 className="text-xs font-medium text-osint-muted uppercase mb-1.5">Key Actors</h2>
        <p className="text-red-500 text-xs">{error}</p>
      </div>
    )
  }

  const totalRealtimeUpdates = recentEntityMentions.reduce((sum, m) => sum + m.count, 0)

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-xs font-medium text-osint-muted uppercase flex items-center gap-1.5">
          Key Actors
          {isConnected && (
            <Zap className="w-2.5 h-2.5 text-green-500" />
          )}
          {totalRealtimeUpdates > 0 && (
            <span className="px-1 py-0.5 text-[9px] bg-osint-accent/20 text-osint-accent rounded-full">
              +{totalRealtimeUpdates}
            </span>
          )}
        </h2>
        <div className="flex gap-0.5">
          {(['all', 'person', 'party', 'organization'] as EntityTypeFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                filter === f
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-bg text-osint-muted hover:text-osint-text'
              }`}
            >
              {f === 'all' ? 'All' : f === 'person' ? 'People' : f === 'party' ? 'Parties' : 'Orgs'}
            </button>
          ))}
        </div>
      </div>

      {filteredActors.length === 0 ? (
        <p className="text-osint-muted text-xs text-center py-2">
          No key actors found
        </p>
      ) : (
        <div className="space-y-0.5">
          {filteredActors.map((actor, index) => {
            const actorWithRealtime = actor as KeyActor & {
              hasRealtimeUpdates?: boolean
              realtimeDelta?: number
              isNewFromRealtime?: boolean
            }
            const isClickable = !actorWithRealtime.isNewFromRealtime

            return (
              <div
                key={actor.entity_id}
                onClick={() => isClickable && handleActorClick(actor)}
                className={`flex items-center gap-1.5 h-6 px-1 -mx-1 rounded transition-colors ${
                  actorWithRealtime.isNewFromRealtime ? 'border-l-2 border-osint-accent pl-1' : ''
                } ${isClickable ? 'cursor-pointer hover:bg-osint-bg/50' : ''}`}
              >
                {/* Rank */}
                <span className="text-[10px] font-medium text-osint-accent w-3 flex-shrink-0">{index + 1}</span>

                {/* Type Icon */}
                {getEntityIcon(actor.entity_type)}

                {/* Name + Party */}
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <span className="text-[11px] text-osint-text truncate">
                    {actor.name}
                  </span>
                  {actor.party && actor.entity_type === 'person' && (
                    <span className="text-[9px] text-osint-muted truncate">
                      ({actor.party})
                    </span>
                  )}
                </div>

                {/* NEW badge */}
                {actorWithRealtime.isNewFromRealtime && (
                  <span className="px-1 py-0.5 text-[8px] bg-osint-accent text-white rounded font-medium flex-shrink-0">
                    NEW
                  </span>
                )}

                {/* Mentions */}
                <span className="text-[10px] text-osint-muted flex-shrink-0">
                  <span className="font-medium text-osint-text">{actor.mention_count_24h}</span>
                </span>

                {/* Trend */}
                {actor.trend === 'rising' ? (
                  <TrendingUp size={10} className="text-severity-critical flex-shrink-0" />
                ) : actor.trend === 'falling' ? (
                  <TrendingDown size={10} className="text-severity-low flex-shrink-0" />
                ) : (
                  <Minus size={10} className="text-osint-muted flex-shrink-0" />
                )}

                {/* Click indicator */}
                {isClickable && (
                  <ChevronRight size={10} className="text-osint-muted flex-shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Entity Stories Modal */}
      {showModal && selectedActor && (
        <EntityStoriesModal
          entityId={selectedActor.entity_id}
          entityName={selectedActor.name}
          entityNameNe={selectedActor.name_ne}
          entityType={selectedActor.entity_type}
          onClose={() => {
            setShowModal(false)
            setSelectedActor(null)
          }}
        />
      )}
    </div>
  )
}
