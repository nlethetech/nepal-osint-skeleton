import { X, MapPin, AlertTriangle, Clock, FileText, ExternalLink, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import type { Event, Severity } from '../../types/api'

interface EventDetailPanelProps {
  event: Event | null
  onClose: () => void
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

const SEVERITY_STYLES: Record<Severity, { bg: string; text: string }> = {
  critical: { bg: 'bg-severity-critical/20', text: 'text-severity-critical' },
  high: { bg: 'bg-severity-high/20', text: 'text-severity-high' },
  medium: { bg: 'bg-severity-medium/20', text: 'text-severity-medium' },
  low: { bg: 'bg-severity-low/20', text: 'text-severity-low' },
}

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  if (!event) return null

  const eventColor = EVENT_COLORS[event.event_type] || '#71717a'
  const severityStyle = SEVERITY_STYLES[event.severity]
  const eventDate = new Date(event.occurred_at || event.created_at)

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-osint-bg/95 backdrop-blur-sm border-l border-osint-border shadow-2xl overflow-hidden flex flex-col z-10">
      {/* Header */}
      <div
        className="p-4 border-b border-osint-border"
        style={{ background: `linear-gradient(135deg, ${eventColor}20, transparent)` }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium uppercase tracking-wide"
              style={{ backgroundColor: `${eventColor}20`, color: eventColor }}
            >
              {event.event_type.replace('_', ' ')}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Clock className="w-4 h-4 text-osint-muted" />
              <span className="text-sm text-osint-muted">
                {format(eventDate, 'MMMM d, yyyy')}
              </span>
            </div>
            <span className="text-xs text-osint-muted">
              {format(eventDate, 'HH:mm')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-osint-border rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Severity & Confidence */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-osint-card border border-osint-border rounded-lg p-3">
            <div className="flex items-center gap-2 text-osint-muted mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs">Severity</span>
            </div>
            <span className={`px-2 py-1 text-xs font-medium rounded uppercase ${severityStyle.bg} ${severityStyle.text}`}>
              {event.severity}
            </span>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-3">
            <div className="flex items-center gap-2 text-osint-muted mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs">Confidence</span>
            </div>
            <p className="text-xl font-bold text-osint-accent">
              {Math.round(event.confidence * 100)}%
            </p>
          </div>
        </div>

        {/* Districts */}
        {event.districts && event.districts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Affected Districts
            </h4>
            <div className="flex flex-wrap gap-2">
              {event.districts.map((district) => (
                <span
                  key={district}
                  className="px-2 py-1 bg-osint-card border border-osint-border rounded-lg text-sm"
                >
                  {district}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Triggers */}
        {event.triggers && event.triggers.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Trigger Keywords
            </h4>
            <div className="flex flex-wrap gap-2">
              {event.triggers.map((trigger, idx) => (
                <span
                  key={idx}
                  className="px-2 py-1 bg-osint-accent/10 border border-osint-accent/20 text-osint-accent rounded-lg text-sm"
                >
                  {trigger}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2">
              Additional Data
            </h4>
            <div className="bg-osint-card border border-osint-border rounded-lg p-3 space-y-2">
              {Object.entries(event.metadata).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-osint-muted capitalize">{key.replace('_', ' ')}</span>
                  <span className="text-osint-text">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Event ID */}
        <div>
          <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2">
            Event ID
          </h4>
          <code className="text-xs bg-osint-card border border-osint-border rounded px-2 py-1 break-all block">
            {event.id}
          </code>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-osint-border space-y-2">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors font-medium">
          <ExternalLink className="w-4 h-4" />
          View Source Story
        </button>
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-osint-card border border-osint-border hover:bg-osint-border rounded-lg transition-colors">
          <MapPin className="w-4 h-4" />
          Show on Map
        </button>
      </div>
    </div>
  )
}
