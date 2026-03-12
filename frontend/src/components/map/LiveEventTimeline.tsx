/**
 * LiveEventTimeline - News-style live feed sidebar (Dark Palantir theme)
 * Matches MapWidget PALANTIR_COLORS exactly
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type { IntelligenceCategory } from './EventMarkerIcons'

export interface LiveMapEvent {
  id: string
  type: string
  title: string
  district?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  timestamp: Date
  source?: string
  source_url?: string
  category?: IntelligenceCategory
  isNew?: boolean
}

interface LiveEventTimelineProps {
  events: LiveMapEvent[]
  onEventClick?: (event: LiveMapEvent) => void
  maxVisible?: number
}

// EXACT same colors as MapWidget PALANTIR_COLORS
const PALANTIR_COLORS = {
  bg: {
    base: '#0a0e14',
    surface: '#111720',
    elevated: '#1a2230',
    hover: '#1e2836',
  },
  border: {
    subtle: '#1e2936',
    default: '#2a3544',
  },
  text: {
    primary: '#e5e7eb',
    secondary: '#9ca3af',
    muted: '#6b7280',
  },
  accent: '#3b82f6',
}

// Severity styling - bright dots for dark theme
const severityStyles: Record<string, { dot: string }> = {
  critical: { dot: 'bg-red-500' },
  high: { dot: 'bg-orange-500' },
  medium: { dot: 'bg-yellow-400' },
  low: { dot: 'bg-gray-500' },
}

// Format timestamp - Live UA Map style
function formatTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} minutes ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Single event item - Dark theme style
const EventItem = memo(function EventItem({
  event,
  isNew,
  onClick,
}: {
  event: LiveMapEvent
  isNew: boolean
  onClick: () => void
}) {
  const severity = severityStyles[event.severity] || severityStyles.low

  return (
    <article
      style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${PALANTIR_COLORS.border.subtle}`,
        backgroundColor: isNew ? `${PALANTIR_COLORS.accent}15` : 'transparent',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!isNew) e.currentTarget.style.backgroundColor = PALANTIR_COLORS.bg.hover
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = isNew ? `${PALANTIR_COLORS.accent}15` : 'transparent'
      }}
      onClick={onClick}
    >
      {/* Time and source row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span className={`w-2 h-2 rounded-full ${severity.dot} flex-shrink-0`} />
        <span style={{ fontSize: '11px', color: PALANTIR_COLORS.text.muted }}>{formatTime(event.timestamp)}</span>
        {event.source_url && (
          <a
            href={event.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: PALANTIR_COLORS.accent,
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            <ExternalLink style={{ width: '12px', height: '12px' }} />
            <span>source</span>
          </a>
        )}
      </div>

      {/* Headline */}
      <h3 style={{ fontSize: '13px', color: PALANTIR_COLORS.text.primary, lineHeight: 1.4, margin: 0 }}>
        {event.title}
      </h3>

      {/* Location */}
      {event.district && (
        <p style={{ fontSize: '11px', color: PALANTIR_COLORS.text.muted, marginTop: '4px', margin: '4px 0 0 0' }}>
          {event.district}
        </p>
      )}
    </article>
  )
})

export function LiveEventTimeline({ events, onEventClick, maxVisible = 8 }: LiveEventTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set())

  // Track new events for animation
  useEffect(() => {
    const newEvents = events.filter(e => e.isNew)
    if (newEvents.length > 0) {
      const ids = new Set(newEvents.map(e => e.id))
      setNewEventIds(prev => new Set([...prev, ...ids]))

      // Clear after 3 seconds
      const timer = setTimeout(() => {
        setNewEventIds(prev => {
          const next = new Set(prev)
          ids.forEach(id => next.delete(id))
          return next
        })
      }, 3000)

      return () => clearTimeout(timer)
    }
  }, [events])

  const handleEventClick = useCallback((event: LiveMapEvent) => {
    onEventClick?.(event)
  }, [onEventClick])

  const visibleEvents = isExpanded ? events : events.slice(0, maxVisible)
  const hasMore = events.length > maxVisible

  // Empty state
  if (events.length === 0) {
    return (
      <div className="absolute bottom-16 right-4 z-[40] sm:bottom-4">
        <div style={{
          background: PALANTIR_COLORS.bg.surface,
          border: `1px solid ${PALANTIR_COLORS.border.subtle}`,
          borderRadius: '8px',
          padding: '12px 16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          <p style={{ fontSize: '13px', color: PALANTIR_COLORS.text.muted, margin: 0 }}>No events in selected time range</p>
        </div>
      </div>
    )
  }

  // Current date for header
  const currentDate = new Date().toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })

  return (
    <div
      className="absolute top-16 right-4 bottom-16 z-[40] w-80 flex flex-col"
      style={{
        background: PALANTIR_COLORS.bg.surface,
        borderLeft: `1px solid ${PALANTIR_COLORS.border.default}`,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header - Dark Palantir style */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${PALANTIR_COLORS.border.default}`,
        background: PALANTIR_COLORS.bg.elevated,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 600, color: PALANTIR_COLORS.text.primary, margin: 0 }}>LIVE FEED</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px' }}>
            <span style={{ color: PALANTIR_COLORS.accent, cursor: 'pointer' }}>Api</span>
            <span style={{ color: PALANTIR_COLORS.accent, cursor: 'pointer' }}>About</span>
          </div>
        </div>
        <p style={{ fontSize: '11px', color: PALANTIR_COLORS.text.muted, marginTop: '4px', margin: '4px 0 0 0' }}>Updated: {currentDate}</p>
      </div>

      {/* Event list - scrollable */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visibleEvents.map((event) => (
          <EventItem
            key={event.id}
            event={event}
            isNew={newEventIds.has(event.id)}
            onClick={() => handleEventClick(event)}
          />
        ))}
      </div>

      {/* Show more button */}
      {hasMore && (
        <div style={{
          padding: '8px 16px',
          borderTop: `1px solid ${PALANTIR_COLORS.border.default}`,
          background: PALANTIR_COLORS.bg.elevated,
        }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              fontSize: '13px',
              color: PALANTIR_COLORS.accent,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            {isExpanded ? (
              <>
                <ChevronUp style={{ width: '16px', height: '16px' }} />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown style={{ width: '16px', height: '16px' }} />
                <span>Show {events.length - maxVisible} more</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default LiveEventTimeline
