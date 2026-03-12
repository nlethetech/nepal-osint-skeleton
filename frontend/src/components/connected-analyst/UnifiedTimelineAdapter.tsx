import { useEffect, useMemo, useState } from 'react'
import { D3Timeline } from '../timeline/D3Timeline'
import { TimelineLegend } from '../timeline/TimelineLegend'
import type { Event, EventType, Severity } from '../../types/api'
import {
  getGraphTimeline,
  getPwttFindings,
  getTradeAnomalies,
  type GraphTimelineEvent,
  type PwttFinding,
  type TradeAnomaly,
} from '../../api/connectedAnalyst'
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map confidence bands to severity */
function confidenceToSeverity(confidence: number): Severity {
  if (confidence >= 0.8) return 'critical'
  if (confidence >= 0.6) return 'high'
  if (confidence >= 0.4) return 'medium'
  return 'low'
}

/** Map a free-form severity string to the typed Severity union */
function parseSeverity(s: string): Severity {
  const lower = s.toLowerCase()
  if (lower === 'critical') return 'critical'
  if (lower === 'high') return 'high'
  if (lower === 'medium' || lower === 'moderate') return 'medium'
  return 'low'
}

/**
 * Synthesize an ISO-8601 date from a Nepali fiscal-year string and month
 * ordinal. The fiscal_year_bs format is "2081-82" where the first number is
 * the BS start year. Nepali fiscal years start in Shrawan (~July), so
 * month_ordinal 1 corresponds roughly to July in AD.
 */
function synthesizeTradeDate(fiscalYearBs: string, monthOrdinal: number): string {
  const match = fiscalYearBs.match(/^(\d{4})/)
  const bsYear = match ? parseInt(match[1]) : 2081
  const adYear = bsYear - 57 // rough BS -> AD conversion
  // Offset month_ordinal (1 = Shrawan ~ July) to calendar month
  const month = ((monthOrdinal - 1 + 6) % 12) + 1
  return `${adYear}-${String(month).padStart(2, '0')}-15T00:00:00Z`
}

// ---------------------------------------------------------------------------
// Transformers: source-specific data -> Event[]
// ---------------------------------------------------------------------------

function graphEventsToEvents(items: GraphTimelineEvent[]): Event[] {
  return items.map((item, i) => ({
    id: item.object_id || item.link_id || `graph-${i}`,
    story_id: item.object_id || `graph-story-${i}`,
    event_type: (item.event_type || 'political') as EventType,
    confidence: item.confidence ?? 0.5,
    severity: confidenceToSeverity(item.confidence ?? 0.5),
    triggers: [item.title],
    metadata: {
      source: 'graph',
      object_id: item.object_id,
      link_id: item.link_id,
    },
    occurred_at: item.timestamp || undefined,
    created_at: item.timestamp || new Date().toISOString(),
  }))
}

function pwttFindingsToEvents(items: PwttFinding[]): Event[] {
  return items.map((item) => ({
    id: `pwtt-${item.id}`,
    story_id: `pwtt-${item.id}`,
    event_type: 'earthquake' as EventType, // disaster-type findings map to earthquake
    confidence: item.confidence,
    severity: parseSeverity(item.severity),
    triggers: [item.title || item.finding_type],
    metadata: { source: 'pwtt', finding_id: item.id },
    occurred_at: item.provenance_refs?.[0]?.captured_at || undefined,
    created_at: item.provenance_refs?.[0]?.captured_at || new Date().toISOString(),
    districts: item.district ? [item.district] : undefined,
  }))
}

function tradeAnomaliesToEvents(items: TradeAnomaly[]): Event[] {
  return items.map((item) => ({
    id: `trade-${item.id}`,
    story_id: `trade-${item.id}`,
    event_type: 'price_shock' as EventType, // trade anomalies map to price_shock
    confidence: item.confidence,
    severity: parseSeverity(item.severity),
    triggers: [`${item.dimension}: ${item.dimension_key}`],
    metadata: {
      source: 'trade',
      anomaly_id: item.id,
      dimension: item.dimension,
    },
    occurred_at: synthesizeTradeDate(item.fiscal_year_bs, item.month_ordinal),
    created_at: synthesizeTradeDate(item.fiscal_year_bs, item.month_ordinal),
  }))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnifiedTimelineAdapter({ className = '' }: { className?: string }) {
  const {
    selectedObjectId,
    selectedRunId,
    selectObject,
    selectRun,
    setRightPanelMode,
    setTimeRange,
  } = useConnectedAnalystStore()

  const [graphEvents, setGraphEvents] = useState<GraphTimelineEvent[]>([])
  const [pwttFindings, setPwttFindings] = useState<PwttFinding[]>([])
  const [tradeAnomalies, setTradeAnomalies] = useState<TradeAnomaly[]>([])
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Fetch data from all three sources in parallel
  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const results = await Promise.allSettled([
          selectedObjectId
            ? getGraphTimeline(selectedObjectId, 100).then((r) => r.events)
            : Promise.resolve([]),
          selectedRunId
            ? getPwttFindings(selectedRunId).then((r) => r.items)
            : Promise.resolve([]),
          getTradeAnomalies({ limit: 50 }).then((r) => r.items),
        ])

        if (!cancelled) {
          setGraphEvents(
            results[0].status === 'fulfilled' ? results[0].value : [],
          )
          setPwttFindings(
            results[1].status === 'fulfilled' ? results[1].value : [],
          )
          setTradeAnomalies(
            results[2].status === 'fulfilled' ? results[2].value : [],
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [selectedObjectId, selectedRunId])

  // Merge all sources into a single Event[]
  const allEvents = useMemo(
    () => [
      ...graphEventsToEvents(graphEvents),
      ...pwttFindingsToEvents(pwttFindings),
      ...tradeAnomaliesToEvents(tradeAnomalies),
    ],
    [graphEvents, pwttFindings, tradeAnomalies],
  )

  const eventTypes = useMemo(
    () => [...new Set(allEvents.map((e) => e.event_type))],
    [allEvents],
  )

  const selectedEventTypes = useMemo(
    () => new Set(eventTypes),
    [eventTypes],
  )

  function handleEventClick(event: Event) {
    setSelectedEvent(event)

    const source = (event.metadata as Record<string, unknown> | undefined)
      ?.source

    if (source === 'graph') {
      const objectId = (event.metadata as Record<string, unknown> | undefined)
        ?.object_id as string | undefined
      if (objectId) selectObject(objectId)
    } else if (source === 'pwtt') {
      // PWTT findings are linked to runs; re-select the active run
      if (selectedRunId) selectRun(selectedRunId)
    } else if (source === 'trade') {
      setRightPanelMode('trade')
    }
  }

  function handleBrushChange(range: [Date, Date] | null) {
    setTimeRange(range)
  }

  return (
    <div
      className={`flex flex-col h-full bg-bp-bg border border-bp-border rounded-lg ${className}`}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-bp-border">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-bp-text">
          Unified Timeline
        </h3>
        <span className="text-[10px] text-bp-text-secondary">
          {allEvents.length} events
          {isLoading && ' \u00b7 loading\u2026'}
        </span>
      </div>

      {/* Timeline body */}
      <div className="flex-1 min-h-0 relative">
        {allEvents.length === 0 && !isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-bp-text-secondary">
              No timeline events. Select an object or run to populate.
            </p>
          </div>
        ) : (
          <>
            <D3Timeline
              events={allEvents}
              selectedEvent={selectedEvent}
              selectedEventTypes={selectedEventTypes}
              onEventClick={handleEventClick}
              onEventHover={() => {}}
              onBrushChange={handleBrushChange}
            />
            <TimelineLegend eventTypes={eventTypes} />
          </>
        )}
      </div>
    </div>
  )
}
