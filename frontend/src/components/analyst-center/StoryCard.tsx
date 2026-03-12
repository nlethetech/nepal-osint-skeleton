import { ExternalLink, MapPin, Users, Clock } from 'lucide-react'
import type { ConsolidatedStory } from '../../api/analytics'

interface StoryCardProps {
  story: ConsolidatedStory
  isSelected: boolean
  onClick: () => void
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-500/5',
  high: 'border-l-orange-500 bg-orange-500/5',
  medium: 'border-l-yellow-500 bg-yellow-500/5',
  low: 'border-l-green-500 bg-green-500/5',
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-300 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  low: 'bg-green-500/20 text-green-300 border-green-500/30',
}

const CATEGORY_COLORS: Record<string, string> = {
  security: 'text-red-400',
  political: 'text-indigo-400',
  disaster: 'text-orange-400',
  economic: 'text-green-400',
  social: 'text-purple-400',
}

function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function ConfidenceBadge({ rating }: { rating?: string }) {
  if (!rating) return null
  // Convert A1, B2, etc. to just the letter for display
  const letter = rating.charAt(0)
  const colors: Record<string, string> = {
    A: 'bg-green-500/20 text-green-300',
    B: 'bg-blue-500/20 text-blue-300',
    C: 'bg-yellow-500/20 text-yellow-300',
    D: 'bg-orange-500/20 text-orange-300',
    E: 'bg-red-500/20 text-red-300',
    F: 'bg-red-500/20 text-red-300',
  }
  return (
    <span className={`px-1 py-0.5 text-[9px] font-mono rounded ${colors[letter] || colors.C}`}>
      {rating}
    </span>
  )
}

export function StoryCard({ story, isSelected, onClick }: StoryCardProps) {
  const severity = (story.severity || 'medium').toLowerCase()
  // Use story_type for category (API field name)
  const category = (story.story_type || 'social').toLowerCase()
  // Use canonical_headline for title (API field name)
  const headline = story.canonical_headline || story.canonical_headline_ne || 'Untitled Story'
  // Use summary or bluf for description
  const description = story.summary || story.bluf || ''

  return (
    <article
      onClick={onClick}
      className={`
        p-3 border-l-4 cursor-pointer transition-all
        ${SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium}
        ${isSelected ? 'ring-1 ring-[var(--pro-accent)] bg-[var(--pro-accent-muted)]' : 'hover:bg-[var(--pro-bg-hover)]'}
      `}
    >
      {/* Header Row */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        {/* Severity Badge */}
        <span className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase border rounded ${SEVERITY_BADGE[severity]}`}>
          {severity}
        </span>

        {/* Category */}
        <span className={`text-[10px] font-medium uppercase ${CATEGORY_COLORS[category]}`}>
          {category}
        </span>

        {/* Time */}
        <span className="text-[10px] text-[var(--pro-text-disabled)] font-mono ml-auto flex items-center gap-1">
          <Clock size={10} />
          {formatTimeAgo(story.first_reported_at)}
        </span>
      </div>

      {/* Headline */}
      <h3 className="text-sm font-medium text-[var(--pro-text-primary)] leading-tight line-clamp-2 mb-1.5">
        {headline}
      </h3>

      {/* Summary */}
      {description && (
        <p className="text-xs text-[var(--pro-text-secondary)] line-clamp-2 mb-2">
          {description}
        </p>
      )}

      {/* Footer Row */}
      <div className="flex items-center gap-3 text-[10px] text-[var(--pro-text-muted)]">
        {/* Sources */}
        <span className="flex items-center gap-1">
          <Users size={10} />
          {story.source_count || 1} source{(story.source_count || 1) > 1 ? 's' : ''}
        </span>

        {/* Confidence/Admiralty */}
        {story.admiralty_rating && (
          <ConfidenceBadge rating={story.admiralty_rating} />
        )}

        {/* Districts */}
        {story.districts_affected && story.districts_affected.length > 0 && (
          <span className="flex items-center gap-1">
            <MapPin size={10} />
            {story.districts_affected.slice(0, 2).join(', ')}
            {story.districts_affected.length > 2 && ` +${story.districts_affected.length - 2}`}
          </span>
        )}

        {/* External Link */}
        {story.url && (
          <a
            href={story.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto hover:text-[var(--pro-accent)]"
            title="Open source"
          >
            <ExternalLink size={10} />
          </a>
        )}
      </div>
    </article>
  )
}
