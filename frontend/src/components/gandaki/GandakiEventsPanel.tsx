/**
 * GandakiEventsPanel Component
 *
 * Simple events list showing recent events from the province.
 * Category labels (Weather, Traffic, etc.) with clean, easy to scan design.
 */

import { AlertCircle, CloudRain, Car, Mountain, Flame, Users, RefreshCw } from 'lucide-react'
import { useDisasterAlerts } from '../../api/hooks/useDisasters'
import { useGandakiDashboardStore, getTimeRangeHours } from '../../stores/gandakiDashboardStore'
import { GANDAKI_DISTRICTS } from '../../data/gandaki'
import './GandakiEventsPanel.css'

const EVENT_ICONS: Record<string, React.ReactNode> = {
  flood: <CloudRain size={14} />,
  landslide: <Mountain size={14} />,
  fire: <Flame size={14} />,
  accident: <Car size={14} />,
  protest: <Users size={14} />,
  default: <AlertCircle size={14} />,
}

const EVENT_COLORS: Record<string, string> = {
  flood: '#3b82f6',
  landslide: '#f59e0b',
  fire: '#ef4444',
  accident: '#8b5cf6',
  protest: '#ec4899',
  default: '#64748b',
}

function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return ''

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Check if an event is related to Gandaki
function isGandakiRelated(event: any): boolean {
  const location = (event.location || event.district || '').toLowerCase()
  const description = (event.description || event.title || '').toLowerCase()

  for (const district of GANDAKI_DISTRICTS) {
    const districtLower = district.toLowerCase()
    if (location.includes(districtLower) || description.includes(districtLower)) {
      return true
    }
  }

  // Check for province name
  if (location.includes('gandaki') || description.includes('gandaki')) {
    return true
  }

  return false
}

function getEventType(event: any): string {
  const type = (event.type || event.category || '').toLowerCase()
  if (type.includes('flood')) return 'flood'
  if (type.includes('landslide') || type.includes('land')) return 'landslide'
  if (type.includes('fire')) return 'fire'
  if (type.includes('accident') || type.includes('traffic')) return 'accident'
  if (type.includes('protest') || type.includes('strike')) return 'protest'
  return 'default'
}

interface GandakiEventsPanelProps {
  onEventsCountChange?: (count: number) => void
}

export function GandakiEventsPanel({ onEventsCountChange }: GandakiEventsPanelProps) {
  const { viewScope, selectedDistrict, timeRange } = useGandakiDashboardStore()
  const hours = getTimeRangeHours(timeRange)
  const { data: events, isLoading, isError, refetch } = useDisasterAlerts(20, hours)

  // Filter events based on scope and district
  const filteredEvents = (events || []).filter((event: any) => {
    if (viewScope === 'all-nepal') {
      return true
    }

    if (!isGandakiRelated(event)) {
      return false
    }

    if (selectedDistrict) {
      const location = (event.location || event.district || '').toLowerCase()
      const description = (event.description || event.title || '').toLowerCase()
      const districtLower = selectedDistrict.toLowerCase()
      return location.includes(districtLower) || description.includes(districtLower)
    }

    return true
  })

  // Notify parent of count change
  if (onEventsCountChange) {
    onEventsCountChange(filteredEvents.length)
  }

  if (isError) {
    return (
      <div className="gandaki-events-panel">
        <div className="gandaki-events-header">
          <h3><AlertCircle size={16} /> Events & Alerts</h3>
        </div>
        <div className="gandaki-events-error">
          <p>Unable to load events</p>
          <button onClick={() => refetch()}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="gandaki-events-panel">
      <div className="gandaki-events-header">
        <div className="gandaki-events-title">
          <h3><AlertCircle size={16} /> Events & Alerts</h3>
          <span className="gandaki-events-count">{filteredEvents.length} events</span>
        </div>
      </div>

      <div className="gandaki-events-content">
        {isLoading ? (
          <div className="gandaki-events-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="gandaki-event-skeleton" />
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="gandaki-events-empty">
            <AlertCircle size={24} />
            <p>No events reported</p>
            {viewScope === 'gandaki' && (
              <span>No recent events in Gandaki Province</span>
            )}
          </div>
        ) : (
          filteredEvents.slice(0, 15).map((event: any, index: number) => {
            const eventType = getEventType(event)
            const icon = EVENT_ICONS[eventType] || EVENT_ICONS.default
            const color = EVENT_COLORS[eventType] || EVENT_COLORS.default

            return (
              <div key={event.id || index} className="gandaki-event-item">
                <div
                  className="gandaki-event-icon"
                  style={{ backgroundColor: `${color}15`, color }}
                >
                  {icon}
                </div>
                <div className="gandaki-event-content">
                  <div className="gandaki-event-meta">
                    <span
                      className="gandaki-event-type"
                      style={{ backgroundColor: `${color}15`, color }}
                    >
                      {eventType.charAt(0).toUpperCase() + eventType.slice(1)}
                    </span>
                    <span className="gandaki-event-time">
                      {formatTimeAgo(event.created_at || event.reported_at)}
                    </span>
                  </div>
                  <p className="gandaki-event-description">
                    {event.title || event.description}
                  </p>
                  {(event.location || event.district) && (
                    <span className="gandaki-event-location">
                      {event.location || event.district}
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
