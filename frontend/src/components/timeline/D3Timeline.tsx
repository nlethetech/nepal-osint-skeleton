import { useEffect, useRef, useMemo } from 'react'
import * as d3 from 'd3'
import type { Event, Severity } from '../../types/api'

interface D3TimelineProps {
  events: Event[]
  selectedEvent: Event | null
  selectedEventTypes: Set<string>
  onEventClick: (event: Event) => void
  onEventHover: (event: Event | null) => void
  onBrushChange: (range: [Date, Date] | null) => void
}

const EVENT_COLORS: Record<string, string> = {
  // Original types
  protest: '#ef4444',
  election: '#3b82f6',
  flood: '#06b6d4',
  earthquake: '#f97316',
  price_shock: '#eab308',
  power_outage: '#6b7280',
  border: '#8b5cf6',
  terrorism: '#dc2626',
  corruption: '#f59e0b',
  diplomacy: '#10b981',
  health_crisis: '#ec4899',
  crime: '#6366f1',
  military: '#14b8a6',
  remittance: '#84cc16',
  // Real event types from database
  economic: '#22c55e',
  violence: '#dc2626',
  disaster: '#f97316',
  political: '#8b5cf6',
  health: '#ec4899',
  accident: '#f59e0b',
  social: '#06b6d4',
  infrastructure: '#6b7280',
}

const SEVERITY_SIZE: Record<Severity, number> = {
  critical: 12,
  high: 10,
  medium: 8,
  low: 6,
}

export function D3Timeline({
  events,
  selectedEvent,
  selectedEventTypes,
  onEventClick,
  onEventHover,
  onBrushChange,
}: D3TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Filter events by selected types
  const filteredEvents = useMemo(() => {
    if (selectedEventTypes.size === 0) return events
    return events.filter(e => selectedEventTypes.has(e.event_type))
  }, [events, selectedEventTypes])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight
    const margin = { top: 40, right: 30, bottom: 60, left: 50 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Clear previous content
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // Set up SVG
    svg.attr('width', width).attr('height', height)

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Parse dates
    const parseDate = (d: Event) => new Date(d.occurred_at || d.created_at)

    // Time scale
    const timeExtent = d3.extent(filteredEvents, parseDate) as [Date, Date]
    if (!timeExtent[0] || !timeExtent[1]) return

    const xScale = d3.scaleTime()
      .domain([
        d3.timeDay.offset(timeExtent[0], -1),
        d3.timeDay.offset(timeExtent[1], 1),
      ])
      .range([0, innerWidth])

    // Y scale for event distribution (by type)
    const eventTypeList = Array.from(new Set(filteredEvents.map(e => e.event_type)))
    const yScale = d3.scaleBand()
      .domain(eventTypeList)
      .range([0, innerHeight])
      .padding(0.3)

    // Add grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(xScale.ticks(10))
      .enter()
      .append('line')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#2a2a3a')
      .attr('stroke-dasharray', '3,3')

    // X axis
    const xAxis = d3.axisBottom(xScale)
      .ticks(10)
      .tickFormat(d3.timeFormat('%b %d') as any)

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', '#a1a1aa')
      .attr('font-size', '11px')

    g.selectAll('.x-axis path, .x-axis line')
      .attr('stroke', '#3f3f46')

    // Y axis (event types)
    const yAxis = d3.axisLeft(yScale)
      .tickFormat(d => (d as string).charAt(0).toUpperCase() + (d as string).slice(1))

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', '#a1a1aa')
      .attr('font-size', '11px')

    g.selectAll('.y-axis path, .y-axis line')
      .attr('stroke', '#3f3f46')

    // Add event type color bars
    eventTypeList.forEach(type => {
      g.append('rect')
        .attr('x', -8)
        .attr('y', (yScale(type) || 0) - 2)
        .attr('width', 4)
        .attr('height', yScale.bandwidth() + 4)
        .attr('fill', EVENT_COLORS[type] || '#71717a')
        .attr('rx', 2)
    })

    // Create tooltip
    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'timeline-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background', 'rgba(13, 13, 18, 0.95)')
      .style('border', '1px solid #3f3f46')
      .style('border-radius', '8px')
      .style('padding', '12px')
      .style('font-size', '12px')
      .style('z-index', '100')
      .style('pointer-events', 'none')
      .style('min-width', '200px')

    // Draw events
    const eventGroups = g.selectAll('.event')
      .data(filteredEvents)
      .enter()
      .append('g')
      .attr('class', 'event')
      .attr('transform', d => {
        const x = xScale(parseDate(d))
        const y = (yScale(d.event_type) || 0) + yScale.bandwidth() / 2
        return `translate(${x},${y})`
      })

    // Event circles
    eventGroups
      .append('circle')
      .attr('r', d => SEVERITY_SIZE[d.severity])
      .attr('fill', d => EVENT_COLORS[d.event_type] || '#71717a')
      .attr('fill-opacity', d => selectedEvent?.id === d.id ? 1 : 0.7)
      .attr('stroke', d => selectedEvent?.id === d.id ? '#ffffff' : 'none')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s')
      .on('mouseenter', function(event, d) {
        d3.select(this)
          .attr('fill-opacity', 1)
          .attr('r', SEVERITY_SIZE[d.severity] * 1.3)

        onEventHover(d)

        const formatDate = d3.timeFormat('%B %d, %Y %H:%M')
        tooltip
          .html(`
            <div style="color: ${EVENT_COLORS[d.event_type]}; font-weight: 600; margin-bottom: 8px; text-transform: capitalize;">
              ${d.event_type.replace('_', ' ')}
            </div>
            <div style="color: #a1a1aa; margin-bottom: 4px;">
              ${formatDate(parseDate(d))}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <span style="background: ${getSeverityColor(d.severity)}20; color: ${getSeverityColor(d.severity)}; padding: 2px 8px; border-radius: 4px; font-size: 10px; text-transform: uppercase;">
                ${d.severity}
              </span>
              <span style="color: #71717a; font-size: 11px;">
                ${(d.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>
            ${d.districts?.length ? `
              <div style="color: #71717a; margin-top: 8px; font-size: 11px;">
                📍 ${d.districts.join(', ')}
              </div>
            ` : ''}
          `)
          .style('visibility', 'visible')
          .style('left', `${event.pageX - container.getBoundingClientRect().left + 10}px`)
          .style('top', `${event.pageY - container.getBoundingClientRect().top - 10}px`)
      })
      .on('mouseleave', function(_, d) {
        if (selectedEvent?.id !== d.id) {
          d3.select(this)
            .attr('fill-opacity', 0.7)
            .attr('r', SEVERITY_SIZE[d.severity])
        }
        onEventHover(null)
        tooltip.style('visibility', 'hidden')
      })
      .on('click', (_, d) => {
        onEventClick(d)
      })

    // Add brush for time range selection
    const brush = d3.brushX()
      .extent([[0, 0], [innerWidth, innerHeight]])
      .on('end', (event) => {
        if (!event.selection) {
          onBrushChange(null)
          return
        }
        const [x0, x1] = event.selection as [number, number]
        onBrushChange([xScale.invert(x0), xScale.invert(x1)])
      })

    g.append('g')
      .attr('class', 'brush')
      .call(brush)
      .selectAll('rect')
      .attr('fill', '#3b82f6')
      .attr('fill-opacity', 0.1)

    // Cleanup
    return () => {
      tooltip.remove()
    }
  }, [filteredEvents, selectedEvent, onEventClick, onEventHover, onBrushChange])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  )
}

function getSeverityColor(severity: Severity): string {
  switch (severity) {
    case 'critical': return '#ef4444'
    case 'high': return '#f97316'
    case 'medium': return '#eab308'
    case 'low': return '#22c55e'
    default: return '#71717a'
  }
}
