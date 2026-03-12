import type { Severity } from '../../types/api'

interface AlertFiltersProps {
  severityFilter: Severity | ''
  readFilter: 'all' | 'read' | 'unread'
  onSeverityChange: (severity: Severity | '') => void
  onReadFilterChange: (filter: 'all' | 'read' | 'unread') => void
}

export function AlertFilters({
  severityFilter,
  readFilter,
  onSeverityChange,
  onReadFilterChange,
}: AlertFiltersProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Severity filter */}
      <select
        value={severityFilter}
        onChange={(e) => onSeverityChange(e.target.value as Severity | '')}
        className="bg-osint-card border border-osint-border rounded-lg px-3 py-2 text-sm cursor-pointer hover:border-osint-accent transition-colors"
      >
        <option value="">All Severities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      {/* Read status filter */}
      <div className="flex rounded-lg border border-osint-border overflow-hidden">
        <button
          onClick={() => onReadFilterChange('all')}
          className={`px-3 py-2 text-sm transition-colors ${
            readFilter === 'all'
              ? 'bg-osint-accent text-white'
              : 'bg-osint-card hover:bg-osint-border'
          }`}
        >
          All
        </button>
        <button
          onClick={() => onReadFilterChange('unread')}
          className={`px-3 py-2 text-sm transition-colors border-l border-osint-border ${
            readFilter === 'unread'
              ? 'bg-osint-accent text-white'
              : 'bg-osint-card hover:bg-osint-border'
          }`}
        >
          Unread
        </button>
        <button
          onClick={() => onReadFilterChange('read')}
          className={`px-3 py-2 text-sm transition-colors border-l border-osint-border ${
            readFilter === 'read'
              ? 'bg-osint-accent text-white'
              : 'bg-osint-card hover:bg-osint-border'
          }`}
        >
          Read
        </button>
      </div>
    </div>
  )
}
