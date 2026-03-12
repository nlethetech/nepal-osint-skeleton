import { Loader2, FileText, ChevronLeft, ChevronRight, AlertTriangle, X, ExternalLink, MapPin, Clock, Users, Info } from 'lucide-react'
import { StoryCard } from './StoryCard'
import type { ConsolidatedStory } from '../../api/analytics'

function StoryDetailPanel({
  story,
  onClose,
  onCreateCaseFromCluster,
}: {
  story: ConsolidatedStory
  onClose: () => void
  onCreateCaseFromCluster?: (clusterId: string) => void
}) {
  const severity = (story.severity || 'medium').toLowerCase()
  const category = (story.story_type || 'social').toLowerCase()

  const severityColors: Record<string, string> = {
    critical: 'text-red-400 bg-red-500/10',
    high: 'text-orange-400 bg-orange-500/10',
    medium: 'text-yellow-400 bg-yellow-500/10',
    low: 'text-green-400 bg-green-500/10',
  }

  return (
    <div className="border-t border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--pro-bg-elevated)] border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded ${severityColors[severity]}`}>
            {severity}
          </span>
          <span className="text-[10px] text-[var(--pro-text-muted)] uppercase">{category}</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-[var(--pro-bg-hover)] rounded">
          <X size={14} className="text-[var(--pro-text-muted)]" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {/* Headline */}
        <h3 className="text-sm font-semibold text-[var(--pro-text-primary)] leading-tight">
          {story.canonical_headline || story.canonical_headline_ne || 'Untitled'}
        </h3>

        {/* Summary/BLUF */}
        {(story.bluf || story.summary) && (
          <p className="text-xs text-[var(--pro-text-secondary)] leading-relaxed">
            {story.bluf || story.summary}
          </p>
        )}

        {/* Key Judgment */}
        {story.key_judgment && (
          <div className="p-2 bg-[var(--pro-bg-base)] rounded border-l-2 border-[var(--pro-accent)]">
            <div className="text-[10px] text-[var(--pro-text-muted)] uppercase mb-1 font-medium">Key Judgment</div>
            <p className="text-xs text-[var(--pro-text-primary)]">{story.key_judgment}</p>
          </div>
        )}

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Source */}
          <div className="flex items-center gap-2 text-[var(--pro-text-muted)]">
            <Users size={12} />
            <span>{story.source_name || 'Unknown source'}</span>
          </div>

          {/* Time */}
          <div className="flex items-center gap-2 text-[var(--pro-text-muted)]">
            <Clock size={12} />
            <span>{story.first_reported_at ? new Date(story.first_reported_at).toLocaleString() : 'Unknown'}</span>
          </div>

          {/* Districts */}
          {story.districts_affected && story.districts_affected.length > 0 && (
            <div className="flex items-center gap-2 text-[var(--pro-text-muted)] col-span-2">
              <MapPin size={12} />
              <span>{story.districts_affected.join(', ')}</span>
            </div>
          )}
        </div>

        {/* Key Entities */}
        {story.key_entities && story.key_entities.length > 0 && (
          <div>
            <div className="text-[10px] text-[var(--pro-text-muted)] uppercase mb-1 font-medium">Key Entities</div>
            <div className="flex flex-wrap gap-1">
              {story.key_entities.slice(0, 6).map((entity, i) => (
                <span key={i} className="px-2 py-0.5 text-[10px] bg-[var(--pro-bg-base)] rounded text-[var(--pro-text-secondary)]">
                  {entity.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Not Clustered Notice */}
        {!story.cluster_id && (
          <div className="flex items-start gap-2 p-2 bg-yellow-500/10 rounded text-xs text-yellow-300">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <span>This story hasn't been clustered yet. It will become available for full analysis once processed.</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--pro-border-subtle)]">
          {story.url && (
            <a
              href={story.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--pro-bg-base)] hover:bg-[var(--pro-bg-hover)] rounded text-[var(--pro-text-primary)] transition-colors"
            >
              <ExternalLink size={12} />
              View Source
            </a>
          )}
          {story.cluster_id && onCreateCaseFromCluster && (
            <button
              onClick={() => onCreateCaseFromCluster(story.cluster_id!)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/15 hover:bg-blue-500/20 border border-blue-500/30 rounded text-blue-300 transition-colors"
            >
              Create Case
            </button>
          )}
          {story.cluster_id && (
            <a
              href={`/workspace?cluster=${story.cluster_id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--pro-accent)] hover:bg-[var(--pro-accent-hover)] rounded text-white transition-colors"
            >
              Open in Workspace
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

interface StoryFeedProps {
  stories: ConsolidatedStory[]
  selectedStoryId: string | null
  onSelectStory: (id: string | null) => void
  onCreateCaseFromCluster?: (clusterId: string) => void
  isLoading: boolean
  currentPage: number
  pageSize: number
  totalStories: number
  onPageChange: (page: number) => void
}

export function StoryFeed({
  stories,
  selectedStoryId,
  onSelectStory,
  onCreateCaseFromCluster,
  isLoading,
  currentPage,
  pageSize,
  totalStories,
  onPageChange,
}: StoryFeedProps) {
  // Calculate pagination
  const totalPages = Math.ceil(totalStories / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalStories)
  const paginatedStories = stories.slice(startIndex, endIndex)

  // Count by severity for summary
  const severityCounts = stories.reduce(
    (acc, s) => {
      const sev = (s.severity || 'medium').toLowerCase()
      acc[sev] = (acc[sev] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const handleStoryClick = (story: ConsolidatedStory) => {
    onSelectStory(story.id)
  }

  if (isLoading && stories.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto mb-4 text-[var(--pro-accent)] animate-spin" />
          <p className="text-sm text-[var(--pro-text-muted)]">Loading stories...</p>
        </div>
      </div>
    )
  }

  if (stories.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4 text-[var(--pro-text-disabled)]" />
          <p className="text-sm text-[var(--pro-text-muted)]">No stories match your filters</p>
          <p className="text-xs text-[var(--pro-text-disabled)] mt-1">
            Try adjusting the time window or clearing filters
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with Summary Stats */}
      <div className="px-4 py-3 bg-[var(--pro-bg-surface)] border-b border-[var(--pro-border-subtle)] sticky top-0 z-10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
            Stories
          </h2>
          {isLoading && <Loader2 size={12} className="text-[var(--pro-accent)] animate-spin" />}
        </div>

        {/* Severity Summary Bar */}
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-[var(--pro-text-muted)]">{totalStories} total</span>
          {severityCounts.critical > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <AlertTriangle size={10} />
              {severityCounts.critical} critical
            </span>
          )}
          {severityCounts.high > 0 && (
            <span className="text-orange-400">{severityCounts.high} high</span>
          )}
          {severityCounts.medium > 0 && (
            <span className="text-yellow-400">{severityCounts.medium} medium</span>
          )}
        </div>
      </div>

      {/* Story List - Scrollable */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--pro-border-subtle)]">
        {paginatedStories.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            isSelected={selectedStoryId === story.id}
            onClick={() => handleStoryClick(story)}
          />
        ))}
      </div>

      {/* Selected Story Detail Panel */}
      {selectedStoryId && (() => {
        const selectedStory = stories.find(s => s.id === selectedStoryId)
        if (selectedStory) {
          return (
            <StoryDetailPanel
              story={selectedStory}
              onClose={() => onSelectStory(null)}
              onCreateCaseFromCluster={onCreateCaseFromCluster}
            />
          )
        }
        return null
      })()}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="px-4 py-2 bg-[var(--pro-bg-surface)] border-t border-[var(--pro-border-subtle)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--pro-text-muted)]">
            Showing {startIndex + 1}-{endIndex} of {totalStories}
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-1 rounded hover:bg-[var(--pro-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} className="text-[var(--pro-text-muted)]" />
            </button>

            {/* Page Numbers */}
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange(pageNum)}
                    className={`min-w-[24px] h-6 text-[10px] rounded ${
                      currentPage === pageNum
                        ? 'bg-[var(--pro-accent)] text-white'
                        : 'text-[var(--pro-text-muted)] hover:bg-[var(--pro-bg-hover)]'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>

            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-1 rounded hover:bg-[var(--pro-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} className="text-[var(--pro-text-muted)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
