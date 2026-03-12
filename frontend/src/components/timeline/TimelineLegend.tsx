import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Severity } from '../../types/api'

interface TimelineLegendProps {
  eventTypes: string[]
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

const SEVERITY_SIZES: { severity: Severity; size: number }[] = [
  { severity: 'critical', size: 12 },
  { severity: 'high', size: 10 },
  { severity: 'medium', size: 8 },
  { severity: 'low', size: 6 },
]

export function TimelineLegend({ eventTypes }: TimelineLegendProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="absolute bottom-4 left-4 z-10">
      {/* Collapsed state - just a small button */}
      {!isExpanded ? (
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 px-3 py-2 bg-osint-bg/95 backdrop-blur-sm border border-osint-border rounded-lg hover:bg-osint-border/50 transition-colors"
        >
          <div className="flex -space-x-1">
            {eventTypes.slice(0, 4).map((type) => (
              <div
                key={type}
                className="w-3 h-3 rounded-full border border-osint-bg"
                style={{ backgroundColor: EVENT_COLORS[type] || '#71717a' }}
              />
            ))}
          </div>
          <span className="text-xs text-osint-muted">Legend</span>
          <ChevronUp className="w-3 h-3 text-osint-muted" />
        </button>
      ) : (
        /* Expanded state - full legend */
        <div className="bg-osint-bg/95 backdrop-blur-sm border border-osint-border rounded-xl p-3 max-w-[280px]">
          {/* Header with collapse button */}
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-osint-accent" />
              Event Types
            </h4>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 hover:bg-osint-border rounded transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5 text-osint-muted" />
            </button>
          </div>

          {/* Event Types Grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {eventTypes.slice(0, 8).map((type) => (
              <div key={type} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: EVENT_COLORS[type] || '#71717a' }}
                />
                <span className="text-[11px] text-osint-text capitalize truncate">
                  {type.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
          {eventTypes.length > 8 && (
            <p className="text-[10px] text-osint-muted mt-1.5">+{eventTypes.length - 8} more</p>
          )}

          {/* Severity (Size) */}
          <div className="pt-2 mt-2 border-t border-osint-border">
            <h4 className="text-[10px] font-medium text-osint-muted uppercase tracking-wide mb-2">
              Severity (Size)
            </h4>
            <div className="flex items-end gap-2">
              {SEVERITY_SIZES.map(({ severity, size }) => (
                <div key={severity} className="flex flex-col items-center gap-0.5">
                  <div
                    className="rounded-full bg-osint-muted"
                    style={{ width: size * 1.5, height: size * 1.5 }}
                  />
                  <span className="text-[9px] text-osint-muted capitalize">{severity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hint */}
          <p className="text-[9px] text-osint-muted mt-2 pt-2 border-t border-osint-border">
            💡 Click events for details. Drag to select time range.
          </p>
        </div>
      )}
    </div>
  )
}
