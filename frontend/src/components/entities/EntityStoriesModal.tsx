/**
 * EntityStoriesModal - Shows all stories mentioning a specific political entity
 * Palantir-grade modal for entity intelligence drill-down
 */
import { useState } from 'react'
import { Modal } from '../common/Modal'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { useEntityStories, useEntityTimeline } from '../../api/hooks/useEntities'
import {
  User,
  Users,
  Building2,
  Landmark,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Calendar,
  Clock,
  Newspaper,
  Star,
  AlertTriangle,
  Shield,
  ChevronRight,
} from 'lucide-react'

interface EntityStoriesModalProps {
  entityId: string
  entityName: string
  entityNameNe?: string
  entityType: string
  party?: string
  onClose: () => void
}

// Map entity types to icons
const entityIcons: Record<string, typeof User> = {
  person: User,
  party: Users,
  organization: Building2,
  institution: Landmark,
}

// Map entity types to colors
const entityColors: Record<string, string> = {
  person: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
  party: 'text-amber-400 bg-amber-500/20 border-amber-500/30',
  organization: 'text-purple-400 bg-purple-500/20 border-purple-500/30',
  institution: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
}

// Severity config for stories
const severityConfig: Record<string, { color: string; icon: typeof AlertTriangle }> = {
  critical: { color: 'text-red-400', icon: AlertTriangle },
  high: { color: 'text-orange-400', icon: AlertTriangle },
  medium: { color: 'text-yellow-400', icon: Shield },
  low: { color: 'text-green-400', icon: Shield },
}

// Category filter options
type CategoryFilter = 'all' | 'political' | 'economic' | 'security' | 'disaster' | 'social'

export function EntityStoriesModal({
  entityId,
  entityName,
  entityNameNe,
  entityType,
  party,
  onClose,
}: EntityStoriesModalProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [hoursFilter, setHoursFilter] = useState(168) // Default: 7 days

  // Fetch stories for this entity
  const { data: storiesData, isLoading, error } = useEntityStories(
    entityId,
    hoursFilter,
    50, // limit
    0,  // offset
    categoryFilter === 'all' ? undefined : categoryFilter
  )

  // Fetch timeline for sparkline (optional, for future enhancement)
  const { data: timelineData } = useEntityTimeline(entityId, 30)

  const Icon = entityIcons[entityType] || User
  const colorClass = entityColors[entityType] || entityColors.person

  // Filter stories by category (already done server-side, but keep for future client-side filtering)
  const stories = storiesData?.stories || []

  // Time period options
  const timeOptions = [
    { value: 24, label: '24h' },
    { value: 72, label: '3d' },
    { value: 168, label: '7d' },
    { value: 720, label: '30d' },
  ]

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Entity Intelligence"
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <div className="text-xs text-osint-muted flex items-center gap-2">
            <Newspaper size={12} />
            {storiesData?.total || 0} stories in last {hoursFilter}h
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm flex items-center gap-1.5"
              onClick={() => {/* TODO: Add to watchlist */}}
            >
              <Star size={14} />
              Add to Watchlist
            </button>
          </div>
        </div>
      }
    >
      {/* Entity Header */}
      <div className="mb-6">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-lg border ${colorClass}`}>
            <Icon className="w-8 h-8" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-osint-text">{entityName}</h3>
            {entityNameNe && (
              <p className="text-osint-muted mt-0.5">{entityNameNe}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 text-xs rounded border ${colorClass} capitalize`}>
                {entityType}
              </span>
              {party && (
                <span className="px-2 py-0.5 text-xs rounded bg-osint-surface border border-osint-border text-osint-muted">
                  {party}
                </span>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="text-right">
            <div className="text-2xl font-bold text-osint-accent">
              {storiesData?.total || 0}
            </div>
            <div className="text-xs text-osint-muted">mentions</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-osint-border/50">
        {/* Time Filter */}
        <div className="flex items-center gap-1">
          <Clock size={14} className="text-osint-muted mr-1" />
          {timeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setHoursFilter(opt.value)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                hoursFilter === opt.value
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-1">
          {(['all', 'political', 'economic', 'security'] as CategoryFilter[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                categoryFilter === cat
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
            >
              {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <AlertTriangle className="w-8 h-8 text-red-400" />
          <p className="text-red-400 text-sm">Failed to load stories</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && stories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-osint-muted">
          <Newspaper className="w-8 h-8" />
          <p className="text-sm">No stories found for this entity</p>
          <p className="text-xs">Try expanding the time range</p>
        </div>
      )}

      {/* Stories List */}
      {!isLoading && !error && stories.length > 0 && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {stories.map((story) => {
            const SeverityIcon = severityConfig[story.severity || 'low']?.icon || Shield
            const severityColor = severityConfig[story.severity || 'low']?.color || 'text-osint-muted'

            return (
              <a
                key={story.id}
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg bg-osint-surface/50 border border-osint-border/30 hover:border-osint-accent/50 hover:bg-osint-surface transition-colors group"
              >
                <div className="flex items-start gap-3">
                  {/* Severity indicator */}
                  <div className={`mt-0.5 ${severityColor}`}>
                    <SeverityIcon size={16} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-osint-text group-hover:text-osint-accent line-clamp-2 transition-colors">
                      {story.title}
                    </h4>
                    {story.summary && (
                      <p className="text-xs text-osint-muted mt-1 line-clamp-2">
                        {story.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-osint-muted">
                      {/* Source */}
                      <span className="flex items-center gap-1">
                        <Newspaper size={10} />
                        {story.source_name || story.source_id}
                      </span>

                      {/* Time */}
                      {story.published_at && (
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {formatRelativeTime(story.published_at)}
                        </span>
                      )}

                      {/* Category */}
                      {story.category && (
                        <span className="px-1.5 py-0.5 rounded bg-osint-bg text-osint-muted capitalize">
                          {story.category}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* External link indicator */}
                  <ExternalLink
                    size={14}
                    className="text-osint-muted group-hover:text-osint-accent transition-colors flex-shrink-0 mt-0.5"
                  />
                </div>
              </a>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// Helper function to format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
