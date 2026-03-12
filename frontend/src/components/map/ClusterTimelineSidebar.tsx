/**
 * ClusterTimelineSidebar - Timeline view of clustered events
 * ===========================================================
 *
 * Shows a scrollable timeline of events when clicking a cluster bubble.
 * Events sorted from newest to oldest with category icons and source links.
 */

import { memo, useEffect, useState, useCallback } from 'react'
import {
  X,
  Clock,
  MapPin,
  ExternalLink,
  Shield,
  Landmark,
  TrendingUp,
  Building2,
  AlertTriangle,
  Heart,
  Users,
  Leaf,
  Circle,
  ChevronRight,
} from 'lucide-react'
import type { MapEvent } from './EventMarkersLayer'
import type { IntelligenceCategory, EventSeverity } from './EventMarkerIcons'

// =============================================================================
// TYPES
// =============================================================================

export interface ClusterTimelineSidebarProps {
  /** All events in the clicked cluster */
  events: MapEvent[]
  /** Whether the sidebar is open */
  isOpen: boolean
  /** Close handler */
  onClose: () => void
  /** Click on event to see full details */
  onEventClick: (event: MapEvent) => void
  /** Optional location name for header */
  clusterLocation?: string
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

/** Severity dot colors */
const SEVERITY_DOT: Record<EventSeverity, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-yellow-500',
  LOW: 'bg-green-500',
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format relative time
 */
function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const eventDate = date instanceof Date ? date : new Date(date)
  const diffMs = now.getTime() - eventDate.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Format full timestamp
 */
function formatTimestamp(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Sort events by timestamp (newest first)
 */
function sortEventsByTime(events: MapEvent[]): MapEvent[] {
  return [...events].sort((a, b) => {
    const dateA = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp)
    const dateB = b.timestamp instanceof Date ? b.timestamp : new Date(b.timestamp)
    return dateB.getTime() - dateA.getTime()
  })
}

/**
 * Get most common district in events
 */
function getMostCommonDistrict(events: MapEvent[]): string | undefined {
  const counts: Record<string, number> = {}
  for (const event of events) {
    if (event.district) {
      counts[event.district] = (counts[event.district] || 0) + 1
    }
  }
  let maxCount = 0
  let maxDistrict: string | undefined
  for (const [district, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count
      maxDistrict = district
    }
  }
  return maxDistrict
}

// =============================================================================
// COMPONENT
// =============================================================================

export const ClusterTimelineSidebar = memo(function ClusterTimelineSidebar({
  events,
  isOpen,
  onClose,
  onEventClick,
  clusterLocation,
}: ClusterTimelineSidebarProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // Handle open/close animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsAnimating(true))
      })
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Sort events by time (newest first)
  const sortedEvents = sortEventsByTime(events)

  // Get location for header
  const location = clusterLocation || getMostCommonDistrict(events) || 'Area'

  if (!isVisible) return null

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className={`
          fixed inset-0 bg-black/50 backdrop-blur-sm z-40
          transition-opacity duration-300 md:hidden
          ${isAnimating ? 'opacity-100' : 'opacity-0'}
        `}
        onClick={onClose}
      />

      {/* Sidebar */}
      <div
        className={`
          fixed top-0 right-0 h-full w-full max-w-md
          bg-osint-bg border-l border-osint-border
          shadow-2xl z-50
          transition-transform duration-300 ease-out
          ${isAnimating ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-osint-border bg-osint-surface/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-osint-accent/20">
              <Clock className="w-5 h-5 text-osint-accent" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-osint-text">
                {events.length} Events
              </h2>
              <div className="flex items-center gap-1 text-xs text-osint-muted">
                <MapPin className="w-3 h-3" />
                <span>{location}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-osint-surface transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-osint-muted" />
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto h-[calc(100%-64px)]">
          <div className="p-2">
            {sortedEvents.map((event, index) => {
              const category = event.category || 'GENERAL'
              const CategoryIcon = CATEGORY_ICONS[category] || Circle
              const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.GENERAL
              const severity = event.severity || 'MEDIUM'
              const severityDot = SEVERITY_DOT[severity]

              return (
                <div
                  key={event.id}
                  className="relative group"
                >
                  {/* Timeline connector line */}
                  {index < sortedEvents.length - 1 && (
                    <div className="absolute left-5 top-12 bottom-0 w-0.5 bg-osint-border" />
                  )}

                  {/* Event card */}
                  <div
                    className={`
                      relative flex items-start gap-3 p-3 rounded-lg
                      hover:bg-osint-surface/50 cursor-pointer
                      transition-colors duration-150
                    `}
                    onClick={() => onEventClick(event)}
                  >
                    {/* Category icon with severity dot */}
                    <div className="relative flex-shrink-0">
                      <div className={`
                        w-10 h-10 rounded-lg flex items-center justify-center
                        ${colors.bg} ${colors.border} border
                      `}>
                        <CategoryIcon className={`w-5 h-5 ${colors.text}`} />
                      </div>
                      {/* Severity indicator */}
                      <div className={`
                        absolute -top-1 -right-1 w-3 h-3 rounded-full
                        ${severityDot} border-2 border-osint-bg
                      `} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Title */}
                      <h3 className="text-sm font-medium text-osint-text line-clamp-2 group-hover:text-osint-accent transition-colors">
                        {event.title}
                      </h3>

                      {/* Meta row */}
                      <div className="flex items-center gap-3 mt-1.5">
                        {/* Time */}
                        <span className="text-xs text-osint-muted" title={formatTimestamp(event.timestamp)}>
                          {formatRelativeTime(event.timestamp)}
                        </span>

                        {/* District if different from header */}
                        {event.district && event.district !== location && (
                          <span className="text-xs text-osint-muted">
                            {event.district}
                          </span>
                        )}

                        {/* Source count */}
                        {event.source_count > 1 && (
                          <span className="text-xs text-osint-muted">
                            {event.source_count} sources
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Source link */}
                      {event.source_url && (
                        <a
                          href={event.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 rounded-lg hover:bg-osint-surface text-osint-muted hover:text-osint-accent transition-colors"
                          title="View source"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}

                      {/* Arrow to details */}
                      <ChevronRight className="w-4 h-4 text-osint-muted group-hover:text-osint-accent transition-colors" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Empty state */}
          {events.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-osint-muted">
              <Clock className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No events in this cluster</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
})

export default ClusterTimelineSidebar
