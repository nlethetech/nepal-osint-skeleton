import { useEffect, useCallback, useMemo } from 'react'
import { Clock, RefreshCw, BarChart3 } from 'lucide-react'
import { useTimelineStore } from '../store/slices/timelineSlice'
import { D3Timeline } from '../components/timeline/D3Timeline'
import { TimelineControls } from '../components/timeline/TimelineControls'
import { EventDetailPanel } from '../components/timeline/EventDetailPanel'
import { TimelineLegend } from '../components/timeline/TimelineLegend'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { EmptyState } from '../components/common/EmptyState'
import type { Event } from '../types/api'

export default function Timeline() {
  const {
    events,
    selectedEvent,
    loading,
    availableEventTypes,
    selectedEventTypes,
    fromDate,
    toDate,
    severityFilter,
    brushRange,
    setSelectedEvent,
    setHoveredEvent,
    setDateRange,
    toggleEventType,
    setSeverityFilter,
    setBrushRange,
    fetchEvents,
    fetchEventTypes,
  } = useTimelineStore()

  // Fetch data on mount
  useEffect(() => {
    fetchEvents()
    fetchEventTypes()
  }, [fetchEvents, fetchEventTypes])

  // Calculate stats
  const stats = useMemo(() => {
    const criticalCount = events.filter(e => e.severity === 'critical').length
    const highCount = events.filter(e => e.severity === 'high').length

    const typeCounts = events.reduce((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const topType = Object.entries(typeCounts)
      .sort(([, a], [, b]) => b - a)[0]

    return { criticalCount, highCount, topType, typeCounts }
  }, [events])

  // Visible event types for legend
  const visibleEventTypes = useMemo(() => {
    return Array.from(new Set(events.map(e => e.event_type)))
  }, [events])

  // Events in brush range
  const eventsInRange = useMemo(() => {
    if (!brushRange) return events
    return events.filter(e => {
      const date = new Date(e.occurred_at || e.created_at)
      return date >= brushRange[0] && date <= brushRange[1]
    })
  }, [events, brushRange])

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEvent(event)
  }, [setSelectedEvent])

  const handleEventHover = useCallback((event: Event | null) => {
    setHoveredEvent(event)
  }, [setHoveredEvent])

  const handleBrushChange = useCallback((range: [Date, Date] | null) => {
    setBrushRange(range)
  }, [setBrushRange])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header - Compact on mobile */}
      <div className="flex-shrink-0 mb-3 sm:mb-4">
        <div className="flex items-center justify-between mb-2 sm:mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 sm:w-6 h-5 sm:h-6 text-osint-accent" />
            <h1 className="text-lg sm:text-2xl font-bold">Event Timeline</h1>
          </div>
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="p-1.5 sm:p-2 bg-osint-card border border-osint-border rounded-lg hover:bg-osint-border transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Quick Stats - Scrollable on mobile */}
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-osint-card border border-osint-border rounded-lg text-xs sm:text-sm whitespace-nowrap flex-shrink-0">
            <span className="text-osint-muted">Events:</span>
            <span className="font-medium text-osint-text">{events.length}</span>
          </div>
          {brushRange && (
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-osint-accent/10 border border-osint-accent/20 rounded-lg text-xs sm:text-sm whitespace-nowrap flex-shrink-0">
              <span className="text-osint-accent font-medium">{eventsInRange.length} in selection</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-severity-critical/10 border border-severity-critical/20 rounded-lg text-xs sm:text-sm whitespace-nowrap flex-shrink-0">
            <span className="font-medium text-severity-critical">{stats.criticalCount} Critical</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-severity-high/10 border border-severity-high/20 rounded-lg text-xs sm:text-sm whitespace-nowrap flex-shrink-0">
            <span className="font-medium text-severity-high">{stats.highCount} High</span>
          </div>
          {stats.topType && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-osint-card border border-osint-border rounded-lg text-xs sm:text-sm whitespace-nowrap flex-shrink-0">
              <BarChart3 className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
              <span className="text-osint-muted">Top:</span>
              <span className="font-medium text-osint-text capitalize">
                {stats.topType[0].replace('_', ' ')} ({stats.topType[1]})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 mb-3 sm:mb-4">
        <TimelineControls
          fromDate={fromDate}
          toDate={toDate}
          availableEventTypes={availableEventTypes}
          selectedEventTypes={selectedEventTypes}
          severityFilter={severityFilter}
          onDateChange={setDateRange}
          onToggleEventType={toggleEventType}
          onSeverityChange={setSeverityFilter}
        />
      </div>

      {/* Timeline Canvas */}
      <div className="flex-1 relative rounded-xl overflow-hidden border border-osint-border bg-osint-card">
        {loading && events.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner message="Loading events..." />
          </div>
        ) : events.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              title="No Events Found"
              description="Try adjusting your date range or filters"
            />
          </div>
        ) : (
          <>
            <D3Timeline
              events={events}
              selectedEvent={selectedEvent}
              selectedEventTypes={selectedEventTypes}
              onEventClick={handleEventClick}
              onEventHover={handleEventHover}
              onBrushChange={handleBrushChange}
            />

            {/* Legend */}
            <TimelineLegend eventTypes={visibleEventTypes} />

            {/* Event Detail Panel */}
            <EventDetailPanel
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </>
        )}
      </div>
    </div>
  )
}
