/**
 * EventDetailSidebar - Event details panel for LiveUAMap
 * ========================================================
 *
 * Production-grade sidebar showing:
 * - Event title, category, severity
 * - Timestamp and relative time
 * - District and province location
 * - Event summary and details
 * - Source count and confidence
 * - Related events in same district
 * - Link to full story view
 * - Smooth slide-in animation
 */

import { useState, useEffect, useCallback, memo } from 'react'
import {
  X,
  Clock,
  MapPin,
  ChevronRight,
  Shield,
  Landmark,
  TrendingUp,
  Building2,
  AlertTriangle,
  Heart,
  Users,
  Leaf,
  Circle,
  FileText,
  Share2,
  Bookmark,
  Eye,
  ExternalLink,
} from 'lucide-react'
import type { MapEvent } from './EventMarkersLayer'
import type { IntelligenceCategory, EventSeverity } from './EventMarkerIcons'

// =============================================================================
// TYPES
// =============================================================================

export interface EventDetailSidebarProps {
  /** The selected event to display */
  event: MapEvent | null
  /** Related events in the same district */
  relatedEvents?: MapEvent[]
  /** Whether the sidebar is open */
  isOpen: boolean
  /** Close handler */
  onClose: () => void
  /** Navigate to related event */
  onEventClick?: (event: MapEvent) => void
  /** View full story */
  onViewFull?: (eventId: string) => void
  /** Share event */
  onShare?: (event: MapEvent) => void
  /** Bookmark event */
  onBookmark?: (event: MapEvent) => void
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Category icons */
const CATEGORY_ICONS: Record<IntelligenceCategory, React.ElementType> = {
  SECURITY: Shield,
  POLITICAL: Landmark,
  ECONOMIC: TrendingUp,
  INFRASTRUCTURE: Building2,
  DISASTER: AlertTriangle,
  HEALTH: Heart,
  SOCIAL: Users,
  ENVIRONMENT: Leaf,
  GENERAL: Circle,
}

/** Category colors */
const CATEGORY_COLORS: Record<IntelligenceCategory, { bg: string; text: string; border: string }> = {
  SECURITY: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  POLITICAL: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  ECONOMIC: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  INFRASTRUCTURE: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  DISASTER: { bg: 'bg-red-600/20', text: 'text-red-300', border: 'border-red-600/30' },
  HEALTH: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
  SOCIAL: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  ENVIRONMENT: { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30' },
  GENERAL: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
}

/** Severity colors */
const SEVERITY_COLORS: Record<EventSeverity, { bg: string; text: string; label: string }> = {
  CRITICAL: { bg: 'bg-red-500', text: 'text-white', label: 'Critical' },
  HIGH: { bg: 'bg-orange-500', text: 'text-white', label: 'High' },
  MEDIUM: { bg: 'bg-yellow-500', text: 'text-gray-900', label: 'Medium' },
  LOW: { bg: 'bg-green-500', text: 'text-white', label: 'Low' },
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format timestamp to relative time
 */
function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Format confidence score
 */
function formatConfidence(confidence: number): string {
  if (confidence >= 0.9) return 'Very High'
  if (confidence >= 0.7) return 'High'
  if (confidence >= 0.5) return 'Medium'
  if (confidence >= 0.3) return 'Low'
  return 'Very Low'
}

// =============================================================================
// RELATED EVENT CARD
// =============================================================================

interface RelatedEventCardProps {
  event: MapEvent
  onClick: () => void
}

const RelatedEventCard = memo(function RelatedEventCard({
  event,
  onClick,
}: RelatedEventCardProps) {
  const Icon = CATEGORY_ICONS[event.category]
  const categoryColors = CATEGORY_COLORS[event.category]
  const timestamp = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp)

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2 rounded-lg hover:bg-osint-card/50 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded ${categoryColors.bg}`}>
          <Icon className={`w-3 h-3 ${categoryColors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-osint-text line-clamp-2">
            {event.title}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-osint-muted">
            <span>{getRelativeTime(timestamp)}</span>
            {event.source_count > 1 && (
              <>
                <span>•</span>
                <span>{event.source_count} sources</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-osint-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  )
})

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const EventDetailSidebar = memo(function EventDetailSidebar({
  event,
  relatedEvents = [],
  isOpen,
  onClose,
  onEventClick,
  onViewFull,
  onShare,
  onBookmark,
}: EventDetailSidebarProps) {
  const [isAnimating, setIsAnimating] = useState(false)

  // Handle animation - ensure sidebar is visible when open or when event changes
  useEffect(() => {
    if (isOpen && event) {
      setIsAnimating(true)
    }
  }, [isOpen, event?.id])

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsAnimating(false)
    // Wait for animation to complete
    setTimeout(onClose, 300)
  }, [onClose])

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose])

  // Don't render if closed and not animating
  if (!isOpen && !isAnimating) return null

  // Don't render if no event
  if (!event) return null

  const Icon = CATEGORY_ICONS[event.category]
  const categoryColors = CATEGORY_COLORS[event.category]
  const severityColors = SEVERITY_COLORS[event.severity]
  const timestamp = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp)

  return (
    <>
      {/* Backdrop */}
      <div
        className={`
          fixed inset-0 bg-black/40 backdrop-blur-sm z-[1001]
          transition-opacity duration-300
          ${isAnimating ? 'opacity-100' : 'opacity-0'}
          sm:hidden
        `}
        onClick={handleClose}
      />

      {/* Sidebar */}
      <div
        className={`
          fixed sm:absolute top-0 right-0 bottom-0 z-[1002]
          w-full sm:w-96 max-w-full
          bg-osint-bg border-l border-osint-border
          shadow-2xl
          transform transition-transform duration-300 ease-out
          ${isAnimating ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col
          overflow-hidden
        `}
        role="dialog"
        aria-label="Event details"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-osint-border">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`p-2 rounded-lg ${categoryColors.bg} ${categoryColors.border} border`}>
              <Icon className={`w-5 h-5 ${categoryColors.text}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${severityColors.bg} ${severityColors.text}`}>
                  {severityColors.label}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${categoryColors.bg} ${categoryColors.text}`}>
                  {event.category}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-osint-text leading-tight">
                {event.title}
              </h2>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-osint-card rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Meta info */}
          <div className="p-4 space-y-3 border-b border-osint-border/50">
            {/* Time */}
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-osint-muted" />
              <span className="text-osint-text">{getRelativeTime(timestamp)}</span>
              <span className="text-osint-muted">•</span>
              <span className="text-osint-muted">
                {timestamp.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            {/* Location */}
            {event.district && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-osint-muted" />
                <span className="text-osint-text">{event.district}</span>
                {event.province && (
                  <>
                    <span className="text-osint-muted">•</span>
                    <span className="text-osint-muted">{event.province} Province</span>
                  </>
                )}
              </div>
            )}

            {/* Sources */}
            {event.source_count > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-osint-muted" />
                <span className="text-osint-text">
                  {event.source_count} {event.source_count === 1 ? 'source' : 'sources'} reporting
                </span>
                <span className="text-osint-muted">•</span>
                <span className="text-osint-muted">
                  {formatConfidence(event.confidence)} confidence
                </span>
              </div>
            )}
          </div>

          {/* Summary */}
          {event.summary && (
            <div className="p-4 border-b border-osint-border/50">
              <h3 className="text-xs font-semibold text-osint-muted uppercase mb-2">Summary</h3>
              <p className="text-sm text-osint-text leading-relaxed">
                {event.summary}
              </p>
            </div>
          )}

          {/* Story type */}
          {event.story_type && (
            <div className="p-4 border-b border-osint-border/50">
              <h3 className="text-xs font-semibold text-osint-muted uppercase mb-2">Event Type</h3>
              <span className="inline-block px-2 py-1 text-sm bg-osint-card rounded capitalize">
                {event.story_type.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Related events */}
          {relatedEvents.length > 0 && (
            <div className="p-4">
              <h3 className="text-xs font-semibold text-osint-muted uppercase mb-3">
                Related Events in {event.district}
              </h3>
              <div className="space-y-1">
                {relatedEvents.slice(0, 5).map(related => (
                  <RelatedEventCard
                    key={related.id}
                    event={related}
                    onClick={() => onEventClick?.(related)}
                  />
                ))}
                {relatedEvents.length > 5 && (
                  <div className="text-xs text-osint-muted text-center py-2">
                    +{relatedEvents.length - 5} more events
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-osint-border bg-osint-card/30">
          <div className="flex items-center gap-2">
            {event.source_url ? (
              <a
                href={event.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-osint-accent text-white rounded-lg hover:bg-osint-accent/90 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-sm font-medium">View Source</span>
              </a>
            ) : (
              <button
                onClick={() => onViewFull?.(event.id)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-osint-accent text-white rounded-lg hover:bg-osint-accent/90 transition-colors"
              >
                <Eye className="w-4 h-4" />
                <span className="text-sm font-medium">View Full Story</span>
              </button>
            )}

            {onShare && (
              <button
                onClick={() => onShare(event)}
                className="p-2 bg-osint-card rounded-lg hover:bg-osint-border transition-colors"
                title="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}

            {onBookmark && (
              <button
                onClick={() => onBookmark(event)}
                className="p-2 bg-osint-card rounded-lg hover:bg-osint-border transition-colors"
                title="Bookmark"
              >
                <Bookmark className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
})

export default EventDetailSidebar
