import { useState } from 'react'
import { Calendar, Filter, ChevronDown, Eye, EyeOff } from 'lucide-react'
import type { EventType, Severity } from '../../types/api'

interface TimelineControlsProps {
  fromDate: string
  toDate: string
  availableEventTypes: EventType[]
  selectedEventTypes: Set<string>
  severityFilter: Severity | ''
  onDateChange: (from: string, to: string) => void
  onToggleEventType: (type: string) => void
  onSeverityChange: (severity: Severity | '') => void
}

const EVENT_COLORS: Record<string, string> = {
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
}

const QUICK_RANGES = [
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
]

export function TimelineControls({
  fromDate,
  toDate,
  availableEventTypes,
  selectedEventTypes,
  severityFilter,
  onDateChange,
  onToggleEventType,
  onSeverityChange,
}: TimelineControlsProps) {
  const [showEventTypes, setShowEventTypes] = useState(false)

  const handleQuickRange = (days: number) => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    onDateChange(
      from.toISOString().split('T')[0],
      to.toISOString().split('T')[0]
    )
  }

  const allSelected = selectedEventTypes.size === 0 ||
    selectedEventTypes.size === availableEventTypes.length

  return (
    <div className="space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-3 sm:flex-wrap">
      {/* Row 1 on mobile: Date Range */}
      <div className="flex items-center gap-2 bg-osint-card border border-osint-border rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 w-full sm:w-auto">
        <Calendar className="w-4 h-4 text-osint-muted flex-shrink-0" />
        <input
          type="date"
          value={fromDate}
          onChange={(e) => onDateChange(e.target.value, toDate)}
          className="bg-transparent border-none text-xs sm:text-sm focus:outline-none min-w-0 flex-1 sm:flex-none"
        />
        <span className="text-osint-muted text-xs sm:text-sm">to</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => onDateChange(fromDate, e.target.value)}
          className="bg-transparent border-none text-xs sm:text-sm focus:outline-none min-w-0 flex-1 sm:flex-none"
        />
      </div>

      {/* Row 2 on mobile: Quick ranges + Filters */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-0">
        {/* Quick Range Buttons */}
        <div className="flex rounded-lg border border-osint-border overflow-hidden flex-shrink-0">
          {QUICK_RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => handleQuickRange(range.days)}
              className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm bg-osint-card hover:bg-osint-border transition-colors border-r border-osint-border last:border-r-0 whitespace-nowrap"
            >
              {range.label}
            </button>
          ))}
        </div>

        {/* Event Type Filter */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowEventTypes(!showEventTypes)}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-osint-card border border-osint-border rounded-lg hover:bg-osint-border transition-colors"
          >
            <Filter className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
            <span className="text-xs sm:text-sm whitespace-nowrap">
              {allSelected
                ? 'All Types'
                : `${selectedEventTypes.size} Types`}
            </span>
            <ChevronDown className={`w-3.5 sm:w-4 h-3.5 sm:h-4 transition-transform ${showEventTypes ? 'rotate-180' : ''}`} />
          </button>

          {showEventTypes && (
            <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-2 w-56 sm:w-64 bg-osint-bg border border-osint-border rounded-xl shadow-xl z-50 max-h-64 sm:max-h-80 overflow-y-auto">
              <div className="p-2 border-b border-osint-border">
                <button
                  onClick={() => availableEventTypes.forEach(t => {
                    if (selectedEventTypes.size > 0) onToggleEventType(t)
                  })}
                  className="w-full text-left text-xs text-osint-muted hover:text-osint-text px-2 py-1"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="p-2 space-y-1">
                {availableEventTypes.map((type) => {
                  const isSelected = selectedEventTypes.size === 0 || selectedEventTypes.has(type)
                  return (
                    <button
                      key={type}
                      onClick={() => onToggleEventType(type)}
                      className={`w-full flex items-center justify-between p-1.5 sm:p-2 rounded-lg transition-colors ${
                        isSelected ? 'bg-osint-card' : 'opacity-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full"
                          style={{ backgroundColor: EVENT_COLORS[type] || '#71717a' }}
                        />
                        <span className="text-xs sm:text-sm capitalize">{type.replace('_', ' ')}</span>
                      </div>
                      {isSelected ? (
                        <Eye className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-accent" />
                      ) : (
                        <EyeOff className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-osint-muted" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Severity Filter */}
        <select
          value={severityFilter}
          onChange={(e) => onSeverityChange(e.target.value as Severity | '')}
          className="bg-osint-card border border-osint-border rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm cursor-pointer hover:border-osint-accent transition-colors flex-shrink-0"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
    </div>
  )
}
