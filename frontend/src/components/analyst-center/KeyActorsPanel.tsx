import { TrendingUp, TrendingDown, Minus, User, Building2, Landmark } from 'lucide-react'
import type { KeyActor } from '../../api/analytics'

interface KeyActorsPanelProps {
  actors: KeyActor[]
  onActorClick: (id: string) => void
}

const ENTITY_TYPE_ICONS: Record<string, typeof User> = {
  person: User,
  organization: Building2,
  party: Landmark,
  institution: Landmark,
}

function TrendIndicator({ trend }: { trend?: string }) {
  switch (trend?.toLowerCase()) {
    case 'rising':
      return <TrendingUp size={12} className="text-green-400" />
    case 'falling':
      return <TrendingDown size={12} className="text-red-400" />
    default:
      return <Minus size={12} className="text-[var(--pro-text-disabled)]" />
  }
}

function ActorCard({ actor, onClick }: { actor: KeyActor; onClick: () => void }) {
  const Icon = ENTITY_TYPE_ICONS[actor.entity_type?.toLowerCase() || 'person'] || User

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 border-b border-[var(--pro-border-subtle)] hover:bg-[var(--pro-bg-hover)] transition-colors"
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-[var(--pro-bg-elevated)] flex items-center justify-center flex-shrink-0">
          {actor.image_url ? (
            <img
              src={actor.image_url}
              alt={actor.name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <Icon size={14} className="text-[var(--pro-text-muted)]" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-[var(--pro-text-primary)] truncate">
              {actor.name}
            </span>
            <TrendIndicator trend={actor.trend} />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--pro-text-muted)]">
            {actor.role && <span className="truncate">{actor.role}</span>}
            {actor.party && (
              <>
                <span className="text-[var(--pro-border-emphasis)]">|</span>
                <span>{actor.party}</span>
              </>
            )}
          </div>
        </div>

        {/* Mention Count */}
        <div className="text-right flex-shrink-0">
          <span className="text-xs font-mono text-[var(--pro-text-primary)]">
            {actor.mention_count_24h || actor.mention_count || 0}
          </span>
          <span className="block text-[9px] text-[var(--pro-text-disabled)]">24h</span>
        </div>
      </div>
    </button>
  )
}

export function KeyActorsPanel({ actors, onActorClick }: KeyActorsPanelProps) {
  // Separate into people and organizations
  const people = actors.filter(
    (a) => a.entity_type?.toLowerCase() === 'person'
  )
  const orgs = actors.filter(
    (a) => a.entity_type?.toLowerCase() !== 'person'
  )

  return (
    <div className="flex flex-col">
      {/* People Section */}
      <div className="px-3 py-2 border-b border-[var(--pro-border-subtle)]">
        <h2 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Key People ({people.length})
        </h2>
      </div>

      {people.length === 0 ? (
        <div className="p-3 text-center text-xs text-[var(--pro-text-muted)]">
          No trending people
        </div>
      ) : (
        people.slice(0, 8).map((actor) => (
          <ActorCard
            key={actor.entity_id}
            actor={actor}
            onClick={() => onActorClick(actor.entity_id)}
          />
        ))
      )}

      {/* Organizations Section */}
      <div className="px-3 py-2 border-b border-[var(--pro-border-subtle)] mt-2">
        <h2 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Organizations ({orgs.length})
        </h2>
      </div>

      {orgs.length === 0 ? (
        <div className="p-3 text-center text-xs text-[var(--pro-text-muted)]">
          No trending organizations
        </div>
      ) : (
        orgs.slice(0, 5).map((actor) => (
          <ActorCard
            key={actor.entity_id}
            actor={actor}
            onClick={() => onActorClick(actor.entity_id)}
          />
        ))
      )}
    </div>
  )
}
