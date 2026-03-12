import { create } from 'zustand'
import { getEvents, getEventTypes } from '../../api/events'
import type { Event, EventType, Severity } from '../../types/api'
import { subDays, format } from 'date-fns'

interface TimelineState {
  events: Event[]
  selectedEvent: Event | null
  hoveredEvent: Event | null
  loading: boolean
  error: string | null

  // Filters
  eventTypes: EventType[]
  availableEventTypes: EventType[]
  selectedEventTypes: Set<string>
  fromDate: string
  toDate: string
  severityFilter: Severity | ''

  // Brush selection
  brushRange: [Date, Date] | null

  // Actions
  setSelectedEvent: (event: Event | null) => void
  setHoveredEvent: (event: Event | null) => void
  setDateRange: (from: string, to: string) => void
  toggleEventType: (type: string) => void
  setSeverityFilter: (severity: Severity | '') => void
  setBrushRange: (range: [Date, Date] | null) => void
  fetchEvents: () => Promise<void>
  fetchEventTypes: () => Promise<void>
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  events: [],
  selectedEvent: null,
  hoveredEvent: null,
  loading: false,
  error: null,
  eventTypes: [],
  availableEventTypes: [],
  selectedEventTypes: new Set(),
  fromDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
  toDate: format(new Date(), 'yyyy-MM-dd'),
  severityFilter: '',
  brushRange: null,

  setSelectedEvent: (event) => set({ selectedEvent: event }),
  setHoveredEvent: (event) => set({ hoveredEvent: event }),

  setDateRange: (from, to) => {
    set({ fromDate: from, toDate: to })
    get().fetchEvents()
  },

  toggleEventType: (type) => {
    const { selectedEventTypes } = get()
    const newTypes = new Set(selectedEventTypes)
    if (newTypes.has(type)) {
      newTypes.delete(type)
    } else {
      newTypes.add(type)
    }
    set({ selectedEventTypes: newTypes })
  },

  setSeverityFilter: (severity) => set({ severityFilter: severity }),

  setBrushRange: (range) => set({ brushRange: range }),

  fetchEvents: async () => {
    set({ loading: true, error: null })
    try {
      const { fromDate, toDate, severityFilter } = get()
      const response = await getEvents({
        fromDate,
        toDate,
        severity: severityFilter || undefined,
        pageSize: 500, // Get more events for timeline
      })
      set({ events: response.items, loading: false, error: null })
    } catch (err) {
      console.error('Failed to fetch events:', err)
      set({
        events: [],
        loading: false,
        error: 'Failed to load events. Please try again.',
      })
    }
  },

  fetchEventTypes: async () => {
    try {
      const data = await getEventTypes()
      set({ availableEventTypes: data.event_types })
    } catch (err) {
      console.error('Failed to fetch event types:', err)
      // Keep existing types or set empty - no mock data
      set({ availableEventTypes: [] })
    }
  },
}))
