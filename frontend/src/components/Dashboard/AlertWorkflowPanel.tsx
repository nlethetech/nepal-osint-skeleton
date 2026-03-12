import { useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Clock,
  User,
  ChevronRight,
  Filter,
  RefreshCw,
  XCircle,
  Play,
  Pause
} from 'lucide-react'

type AlertState = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'
type AlertPriority = 'critical' | 'high' | 'medium' | 'low'

interface Alert {
  id: string
  title: string
  description: string
  state: AlertState
  priority: AlertPriority
  source: string
  created_at: string
  updated_at: string
  assignee?: string
  sla_deadline?: string
  escalation_level: number
}

interface AlertWorkflowPanelProps {
  alerts?: Alert[]
  onStateChange?: (alertId: string, newState: AlertState) => void
  onAssign?: (alertId: string, assignee: string) => void
}

const mockAlerts: Alert[] = [
  {
    id: 'ALT-001',
    title: 'Violence Escalation Pattern Detected',
    description: 'Multiple violence events detected in Kathmandu district within 2-hour window',
    state: 'new',
    priority: 'critical',
    source: 'CEP Engine',
    created_at: new Date(Date.now() - 1800000).toISOString(),
    updated_at: new Date(Date.now() - 1800000).toISOString(),
    escalation_level: 0
  },
  {
    id: 'ALT-002',
    title: 'Trade Anomaly - Unusual Import Volume',
    description: 'Petroleum import volume 40% above monthly average at Birgunj customs',
    state: 'acknowledged',
    priority: 'high',
    source: 'Trade Analyzer',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    assignee: 'analyst-1',
    sla_deadline: new Date(Date.now() + 3600000).toISOString(),
    escalation_level: 1
  },
  {
    id: 'ALT-003',
    title: 'Political Assembly Alert',
    description: 'Large political gathering scheduled in Pokhara - heightened monitoring recommended',
    state: 'in_progress',
    priority: 'medium',
    source: 'Event Predictor',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 1800000).toISOString(),
    assignee: 'analyst-2',
    escalation_level: 0
  },
  {
    id: 'ALT-004',
    title: 'Network Influence Shift',
    description: 'Significant centrality change detected for entity GOV-2451',
    state: 'resolved',
    priority: 'low',
    source: 'Network Analyzer',
    created_at: new Date(Date.now() - 172800000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    assignee: 'analyst-1',
    escalation_level: 0
  }
]

export function AlertWorkflowPanel({
  alerts = mockAlerts,
  onStateChange,
  onAssign
}: AlertWorkflowPanelProps) {
  const [filter, setFilter] = useState<AlertState | 'all'>('all')
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null)

  const filteredAlerts = filter === 'all'
    ? alerts
    : alerts.filter(a => a.state === filter)

  const getStateColor = (state: AlertState): string => {
    switch (state) {
      case 'new':
        return 'bg-severity-critical text-white'
      case 'acknowledged':
        return 'bg-severity-high text-white'
      case 'in_progress':
        return 'bg-entity-organization text-white'
      case 'resolved':
        return 'bg-severity-low text-white'
      case 'closed':
        return 'bg-osint-muted text-osint-bg'
      default:
        return 'bg-osint-border text-osint-text'
    }
  }

  const getPriorityColor = (priority: AlertPriority): string => {
    switch (priority) {
      case 'critical':
        return 'text-severity-critical'
      case 'high':
        return 'text-severity-high'
      case 'medium':
        return 'text-severity-medium'
      case 'low':
        return 'text-severity-low'
      default:
        return 'text-osint-muted'
    }
  }

  const getStateIcon = (state: AlertState) => {
    switch (state) {
      case 'new':
        return <Bell size={14} />
      case 'acknowledged':
        return <User size={14} />
      case 'in_progress':
        return <Play size={14} />
      case 'resolved':
        return <CheckCircle size={14} />
      case 'closed':
        return <XCircle size={14} />
      default:
        return <Clock size={14} />
    }
  }

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const handleTransition = (alertId: string, newState: AlertState) => {
    if (onStateChange) {
      onStateChange(alertId, newState)
    }
  }

  // Count by state
  const stateCounts = {
    new: alerts.filter(a => a.state === 'new').length,
    acknowledged: alerts.filter(a => a.state === 'acknowledged').length,
    in_progress: alerts.filter(a => a.state === 'in_progress').length,
    resolved: alerts.filter(a => a.state === 'resolved').length,
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-severity-high" size={20} />
            <h3 className="font-semibold text-osint-text">Alert Workflow</h3>
          </div>
          <button className="p-1.5 hover:bg-osint-border rounded transition-colors">
            <RefreshCw size={16} className="text-osint-muted" />
          </button>
        </div>

        {/* State Summary */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'all' ? 'bg-primary-600 text-white' : 'bg-osint-border text-osint-muted hover:text-osint-text'
            }`}
          >
            All ({alerts.length})
          </button>
          <button
            onClick={() => setFilter('new')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'new' ? 'bg-severity-critical text-white' : 'bg-osint-border text-osint-muted hover:text-osint-text'
            }`}
          >
            New ({stateCounts.new})
          </button>
          <button
            onClick={() => setFilter('in_progress')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'in_progress' ? 'bg-entity-organization text-white' : 'bg-osint-border text-osint-muted hover:text-osint-text'
            }`}
          >
            In Progress ({stateCounts.in_progress})
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'resolved' ? 'bg-severity-low text-white' : 'bg-osint-border text-osint-muted hover:text-osint-text'
            }`}
          >
            Resolved ({stateCounts.resolved})
          </button>
        </div>
      </div>

      {/* Alert List */}
      <div className="max-h-96 overflow-y-auto">
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-osint-muted">
            <Bell size={32} className="mx-auto mb-2 opacity-50" />
            <p>No alerts in this category</p>
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <div
              key={alert.id}
              className={`p-3 border-b border-osint-border hover:bg-osint-bg cursor-pointer transition-colors ${
                selectedAlert === alert.id ? 'bg-osint-bg' : ''
              }`}
              onClick={() => setSelectedAlert(selectedAlert === alert.id ? null : alert.id)}
            >
              <div className="flex items-start gap-3">
                {/* Priority Indicator */}
                <div className={`mt-1 ${getPriorityColor(alert.priority)}`}>
                  <AlertTriangle size={16} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-osint-muted text-xs">{alert.id}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded flex items-center gap-1 ${getStateColor(alert.state)}`}>
                      {getStateIcon(alert.state)}
                      {alert.state.replace('_', ' ')}
                    </span>
                    {alert.escalation_level > 0 && (
                      <span className="px-1.5 py-0.5 text-xs rounded bg-severity-high/20 text-severity-high">
                        L{alert.escalation_level}
                      </span>
                    )}
                  </div>
                  <p className="text-osint-text text-sm font-medium truncate">{alert.title}</p>
                  <p className="text-osint-muted text-xs mt-0.5 line-clamp-1">{alert.description}</p>

                  {/* Meta */}
                  <div className="flex items-center gap-3 mt-2 text-xs text-osint-muted">
                    <span>{alert.source}</span>
                    <span>{formatTimeAgo(alert.created_at)}</span>
                    {alert.assignee && (
                      <span className="flex items-center gap-1">
                        <User size={10} />
                        {alert.assignee}
                      </span>
                    )}
                  </div>

                  {/* Expanded Actions */}
                  {selectedAlert === alert.id && (
                    <div className="mt-3 pt-3 border-t border-osint-border">
                      <p className="text-osint-muted text-xs mb-2">Workflow Actions:</p>
                      <div className="flex flex-wrap gap-2">
                        {alert.state === 'new' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleTransition(alert.id, 'acknowledged')
                            }}
                            className="px-2 py-1 text-xs bg-severity-high text-white rounded hover:bg-severity-high/80 transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                        {(alert.state === 'new' || alert.state === 'acknowledged') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleTransition(alert.id, 'in_progress')
                            }}
                            className="px-2 py-1 text-xs bg-entity-organization text-white rounded hover:bg-entity-organization/80 transition-colors"
                          >
                            Start Working
                          </button>
                        )}
                        {alert.state === 'in_progress' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleTransition(alert.id, 'resolved')
                            }}
                            className="px-2 py-1 text-xs bg-severity-low text-white rounded hover:bg-severity-low/80 transition-colors"
                          >
                            Mark Resolved
                          </button>
                        )}
                        {alert.state === 'resolved' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleTransition(alert.id, 'closed')
                            }}
                            className="px-2 py-1 text-xs bg-osint-muted text-osint-bg rounded hover:bg-osint-muted/80 transition-colors"
                          >
                            Close
                          </button>
                        )}
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-1 text-xs bg-osint-border text-osint-text rounded hover:bg-osint-border/80 transition-colors"
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Expand Indicator */}
                <ChevronRight
                  size={16}
                  className={`text-osint-muted transition-transform ${
                    selectedAlert === alert.id ? 'rotate-90' : ''
                  }`}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Stats */}
      <div className="p-3 bg-osint-bg border-t border-osint-border">
        <div className="flex items-center justify-between text-xs">
          <span className="text-osint-muted">
            SLA at risk: <span className="text-severity-high font-medium">2</span>
          </span>
          <span className="text-osint-muted">
            Avg resolution: <span className="text-osint-text font-medium">4.2h</span>
          </span>
        </div>
      </div>
    </div>
  )
}
