/**
 * Intelligence Alerts Triage Interface
 *
 * Palantir-grade analyst workflow for triaging trade intelligence alerts:
 * - Pre-event indicators
 * - Trade anomalies
 * - Concentration risks
 * - Network alerts
 *
 * Supports bulk actions, filtering, and analyst feedback.
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Flag,
  Archive,
  RefreshCw,
  MoreHorizontal,
  MapPin,
  Package,
  Globe,
  Calendar,
  User,
  Briefcase,
} from 'lucide-react'

// Alert types
type AlertType = 'pre_event' | 'anomaly' | 'concentration' | 'network' | 'shell_company'
type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'
type AlertStatus = 'new' | 'acknowledged' | 'investigating' | 'confirmed' | 'dismissed' | 'escalated'

interface IntelligenceAlert {
  id: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  title: string
  description: string
  entityId: string
  entityName: string
  entityType: 'commodity' | 'country' | 'company'
  fiscalYear: string
  month?: number
  confidence: number
  detectedAt: string
  acknowledgedAt?: string
  acknowledgedBy?: string
  metadata: Record<string, any>
  relatedAlerts?: string[]
  evidence?: {
    type: string
    description: string
    value: any
  }[]
}

interface AlertFilters {
  types: AlertType[]
  severities: AlertSeverity[]
  statuses: AlertStatus[]
  searchQuery: string
  dateRange?: { from: string; to: string }
  minConfidence: number
}

interface IntelligenceAlertsProps {
  initialAlerts?: IntelligenceAlert[]
  onAlertAction?: (alertId: string, action: string, data?: any) => Promise<void>
  onRefresh?: () => Promise<IntelligenceAlert[]>
  className?: string
}

// Alert type configurations
const ALERT_TYPE_CONFIG: Record<AlertType, { label: string; icon: React.ElementType; color: string }> = {
  pre_event: { label: 'Pre-Event Indicator', icon: AlertTriangle, color: 'text-amber-500' },
  anomaly: { label: 'Trade Anomaly', icon: TrendingUp, color: 'text-blue-500' },
  concentration: { label: 'Concentration Risk', icon: AlertCircle, color: 'text-orange-500' },
  network: { label: 'Network Alert', icon: Globe, color: 'text-purple-500' },
  shell_company: { label: 'Shell Company', icon: Briefcase, color: 'text-red-500' },
}

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; bgColor: string; textColor: string }> = {
  critical: { label: 'Critical', bgColor: 'bg-red-900/50', textColor: 'text-red-400' },
  high: { label: 'High', bgColor: 'bg-orange-900/50', textColor: 'text-orange-400' },
  medium: { label: 'Medium', bgColor: 'bg-yellow-900/50', textColor: 'text-yellow-400' },
  low: { label: 'Low', bgColor: 'bg-blue-900/50', textColor: 'text-blue-400' },
}

const STATUS_CONFIG: Record<AlertStatus, { label: string; icon: React.ElementType; color: string }> = {
  new: { label: 'New', icon: AlertCircle, color: 'text-blue-400' },
  acknowledged: { label: 'Acknowledged', icon: Eye, color: 'text-yellow-400' },
  investigating: { label: 'Investigating', icon: Search, color: 'text-purple-400' },
  confirmed: { label: 'Confirmed', icon: CheckCircle, color: 'text-green-400' },
  dismissed: { label: 'Dismissed', icon: XCircle, color: 'text-gray-400' },
  escalated: { label: 'Escalated', icon: Flag, color: 'text-red-400' },
}

// Sample alerts for demonstration
const SAMPLE_ALERTS: IntelligenceAlert[] = [
  {
    id: 'alert-001',
    type: 'pre_event',
    severity: 'high',
    status: 'new',
    title: 'Construction Material Surge Pattern',
    description: 'Unusual accumulation of cement and steel imports detected. Pattern matches historical pre-earthquake stockpiling behavior.',
    entityId: '2523',
    entityName: 'Portland Cement (HS 2523)',
    entityType: 'commodity',
    fiscalYear: '2081-82',
    month: 8,
    confidence: 0.82,
    detectedAt: '2024-01-15T08:30:00Z',
    metadata: {
      patternType: 'stockpiling',
      deviationPct: 145,
      historicalMatch: '2015 pre-earthquake pattern',
    },
    evidence: [
      { type: 'statistical', description: 'Z-score of 3.2 (>3.0 threshold)', value: 3.2 },
      { type: 'historical', description: 'Similar pattern before 2015 earthquake', value: '85% match' },
    ],
  },
  {
    id: 'alert-002',
    type: 'anomaly',
    severity: 'critical',
    status: 'investigating',
    title: 'Petroleum Import Collapse',
    description: 'Sudden 65% drop in petroleum imports from India. Requires immediate investigation for potential supply disruption.',
    entityId: '2710',
    entityName: 'Petroleum (HS 2710)',
    entityType: 'commodity',
    fiscalYear: '2081-82',
    month: 8,
    confidence: 0.95,
    detectedAt: '2024-01-14T14:22:00Z',
    acknowledgedAt: '2024-01-14T14:45:00Z',
    acknowledgedBy: 'analyst_01',
    metadata: {
      direction: 'drop',
      magnitude: -65,
      algorithmsAgreed: 7,
      algorithmsTotal: 8,
    },
    evidence: [
      { type: 'ensemble', description: '7 of 8 algorithms detected anomaly', value: '87.5% agreement' },
      { type: 'magnitude', description: '65% below expected value', value: -65 },
    ],
  },
  {
    id: 'alert-003',
    type: 'concentration',
    severity: 'medium',
    status: 'acknowledged',
    title: 'Single-Country Dependency: Electronics',
    description: '92% of electronics imports from China. High concentration risk for supply chain disruption.',
    entityId: '8542',
    entityName: 'Integrated Circuits (HS 8542)',
    entityType: 'commodity',
    fiscalYear: '2081-82',
    confidence: 0.88,
    detectedAt: '2024-01-13T10:00:00Z',
    acknowledgedAt: '2024-01-13T11:30:00Z',
    acknowledgedBy: 'analyst_02',
    metadata: {
      concentrationPartner: 'China',
      concentrationShare: 0.92,
      riskLevel: 'high',
    },
  },
  {
    id: 'alert-004',
    type: 'shell_company',
    severity: 'high',
    status: 'new',
    title: 'Potential Shell Company Network',
    description: 'Detected cluster of 5 companies with shared registered address and unusual trade patterns.',
    entityId: 'cluster_123',
    entityName: 'Kathmandu Business District Cluster',
    entityType: 'company',
    fiscalYear: '2081-82',
    confidence: 0.76,
    detectedAt: '2024-01-15T06:00:00Z',
    metadata: {
      companiesInvolved: 5,
      sharedAddress: true,
      circularTradeDetected: true,
      totalTradeValue: 500000000,
    },
    evidence: [
      { type: 'address', description: 'All 5 companies share same registered address', value: true },
      { type: 'directors', description: '3 of 5 companies share directors', value: 3 },
      { type: 'trade', description: 'Circular trade pattern detected', value: true },
    ],
  },
]

export default function IntelligenceAlerts({
  initialAlerts = SAMPLE_ALERTS,
  onAlertAction,
  onRefresh,
  className = '',
}: IntelligenceAlertsProps) {
  const [alerts, setAlerts] = useState<IntelligenceAlert[]>(initialAlerts)
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set())
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null)
  const [filters, setFilters] = useState<AlertFilters>({
    types: [],
    severities: [],
    statuses: [],
    searchQuery: '',
    minConfidence: 0,
  })
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [sortBy, setSortBy] = useState<'severity' | 'date' | 'confidence'>('severity')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Filter and sort alerts
  const filteredAlerts = React.useMemo(() => {
    let result = [...alerts]

    // Apply filters
    if (filters.types.length > 0) {
      result = result.filter(a => filters.types.includes(a.type))
    }
    if (filters.severities.length > 0) {
      result = result.filter(a => filters.severities.includes(a.severity))
    }
    if (filters.statuses.length > 0) {
      result = result.filter(a => filters.statuses.includes(a.status))
    }
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      result = result.filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        a.entityName.toLowerCase().includes(query)
      )
    }
    if (filters.minConfidence > 0) {
      result = result.filter(a => a.confidence >= filters.minConfidence)
    }

    // Sort
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
    result.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'severity':
          comparison = severityOrder[a.severity] - severityOrder[b.severity]
          break
        case 'date':
          comparison = new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime()
          break
        case 'confidence':
          comparison = a.confidence - b.confidence
          break
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })

    return result
  }, [alerts, filters, sortBy, sortOrder])

  // Stats
  const stats = React.useMemo(() => {
    const newAlerts = alerts.filter(a => a.status === 'new').length
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length
    const highConfidence = alerts.filter(a => a.confidence >= 0.8).length
    return { total: alerts.length, new: newAlerts, critical: criticalAlerts, highConfidence }
  }, [alerts])

  // Handle alert action
  const handleAction = useCallback(async (alertId: string, action: string, data?: any) => {
    if (onAlertAction) {
      setIsLoading(true)
      try {
        await onAlertAction(alertId, action, data)
        // Update local state based on action
        if (action === 'acknowledge') {
          setAlerts(prev => prev.map(a =>
            a.id === alertId ? { ...a, status: 'acknowledged' as AlertStatus, acknowledgedAt: new Date().toISOString() } : a
          ))
        } else if (action === 'investigate') {
          setAlerts(prev => prev.map(a =>
            a.id === alertId ? { ...a, status: 'investigating' as AlertStatus } : a
          ))
        } else if (action === 'confirm') {
          setAlerts(prev => prev.map(a =>
            a.id === alertId ? { ...a, status: 'confirmed' as AlertStatus } : a
          ))
        } else if (action === 'dismiss') {
          setAlerts(prev => prev.map(a =>
            a.id === alertId ? { ...a, status: 'dismissed' as AlertStatus } : a
          ))
        } else if (action === 'escalate') {
          setAlerts(prev => prev.map(a =>
            a.id === alertId ? { ...a, status: 'escalated' as AlertStatus } : a
          ))
        }
      } finally {
        setIsLoading(false)
      }
    }
  }, [onAlertAction])

  // Handle bulk actions
  const handleBulkAction = useCallback(async (action: string) => {
    const selectedIds = Array.from(selectedAlerts)
    for (const id of selectedIds) {
      await handleAction(id, action)
    }
    setSelectedAlerts(new Set())
  }, [selectedAlerts, handleAction])

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    if (onRefresh) {
      setIsLoading(true)
      try {
        const newAlerts = await onRefresh()
        setAlerts(newAlerts)
      } finally {
        setIsLoading(false)
      }
    }
  }, [onRefresh])

  // Toggle selection
  const toggleSelection = useCallback((alertId: string) => {
    setSelectedAlerts(prev => {
      const next = new Set(prev)
      if (next.has(alertId)) {
        next.delete(alertId)
      } else {
        next.add(alertId)
      }
      return next
    })
  }, [])

  // Select all visible
  const selectAllVisible = useCallback(() => {
    const visibleIds = filteredAlerts.map(a => a.id)
    setSelectedAlerts(prev => {
      const allSelected = visibleIds.every(id => prev.has(id))
      if (allSelected) {
        return new Set()
      } else {
        return new Set(visibleIds)
      }
    })
  }, [filteredAlerts])

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60))
      return `${diffMins}m ago`
    } else if (diffHours < 24) {
      return `${diffHours}h ago`
    } else {
      const diffDays = Math.floor(diffHours / 24)
      return `${diffDays}d ago`
    }
  }

  // Render alert card
  const renderAlertCard = (alert: IntelligenceAlert) => {
    const typeConfig = ALERT_TYPE_CONFIG[alert.type]
    const severityConfig = SEVERITY_CONFIG[alert.severity]
    const statusConfig = STATUS_CONFIG[alert.status]
    const isExpanded = expandedAlert === alert.id
    const isSelected = selectedAlerts.has(alert.id)
    const TypeIcon = typeConfig.icon
    const StatusIcon = statusConfig.icon

    return (
      <div
        key={alert.id}
        className={`bg-osint-dark border ${isSelected ? 'border-osint-accent' : 'border-osint-border'} rounded-lg overflow-hidden transition-all duration-200`}
      >
        {/* Header */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Selection checkbox */}
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelection(alert.id)}
              className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-osint-accent focus:ring-osint-accent"
            />

            {/* Type icon */}
            <div className={`p-2 rounded-lg ${severityConfig.bgColor}`}>
              <TypeIcon className={`w-5 h-5 ${typeConfig.color}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium text-white truncate">{alert.title}</h3>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${severityConfig.bgColor} ${severityConfig.textColor}`}>
                  {severityConfig.label}
                </span>
                <span className={`flex items-center gap-1 text-xs ${statusConfig.color}`}>
                  <StatusIcon className="w-3 h-3" />
                  {statusConfig.label}
                </span>
              </div>

              <p className="mt-1 text-sm text-gray-400 line-clamp-2">{alert.description}</p>

              {/* Meta row */}
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  {alert.entityName}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {alert.fiscalYear}{alert.month ? ` - Month ${alert.month}` : ''}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(alert.detectedAt)}
                </span>
                <span className="flex items-center gap-1">
                  Confidence: {Math.round(alert.confidence * 100)}%
                </span>
              </div>
            </div>

            {/* Expand button */}
            <button
              onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
              className="p-1 hover:bg-osint-dark-lighter rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-400" />
              )}
            </button>
          </div>

          {/* Quick actions */}
          {!isExpanded && alert.status !== 'dismissed' && alert.status !== 'confirmed' && (
            <div className="mt-3 flex items-center gap-2 pl-9">
              {alert.status === 'new' && (
                <button
                  onClick={() => handleAction(alert.id, 'acknowledge')}
                  className="px-3 py-1 text-xs bg-osint-dark-lighter hover:bg-osint-dark-lighter/80 text-gray-300 rounded flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  Acknowledge
                </button>
              )}
              {(alert.status === 'new' || alert.status === 'acknowledged') && (
                <button
                  onClick={() => handleAction(alert.id, 'investigate')}
                  className="px-3 py-1 text-xs bg-purple-900/30 hover:bg-purple-900/50 text-purple-400 rounded flex items-center gap-1"
                >
                  <Search className="w-3 h-3" />
                  Investigate
                </button>
              )}
              <button
                onClick={() => handleAction(alert.id, 'dismiss')}
                className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded flex items-center gap-1"
              >
                <XCircle className="w-3 h-3" />
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="border-t border-osint-border p-4 space-y-4 bg-osint-dark/50">
            {/* Evidence */}
            {alert.evidence && alert.evidence.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Evidence</h4>
                <div className="space-y-2">
                  {alert.evidence.map((ev, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-osint-dark rounded text-sm">
                      <span className="text-gray-400">{ev.description}</span>
                      <span className="text-white font-mono">{String(ev.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-2">Details</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(alert.metadata).map(([key, value]) => (
                  <div key={key} className="p-2 bg-osint-dark rounded">
                    <div className="text-xs text-gray-500">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div className="text-sm text-white font-medium">
                      {typeof value === 'number' && value < 1 && value > 0
                        ? `${Math.round(value * 100)}%`
                        : typeof value === 'number'
                        ? value.toLocaleString()
                        : String(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-osint-border">
              {alert.status === 'investigating' && (
                <>
                  <button
                    onClick={() => handleAction(alert.id, 'confirm')}
                    className="px-4 py-2 text-sm bg-green-900/30 hover:bg-green-900/50 text-green-400 rounded flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Confirm Alert
                  </button>
                  <button
                    onClick={() => handleAction(alert.id, 'dismiss')}
                    className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-400 rounded flex items-center gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    Dismiss
                  </button>
                  <button
                    onClick={() => handleAction(alert.id, 'escalate')}
                    className="px-4 py-2 text-sm bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded flex items-center gap-2"
                  >
                    <Flag className="w-4 h-4" />
                    Escalate
                  </button>
                </>
              )}
              <button className="ml-auto px-4 py-2 text-sm bg-osint-dark-lighter hover:bg-osint-dark-lighter/80 text-gray-300 rounded flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                View in Explorer
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Intelligence Alerts</h2>
          <p className="text-sm text-gray-400">
            {stats.new} new alerts · {stats.critical} critical · {stats.highConfidence} high confidence
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-3 py-2 bg-osint-dark hover:bg-osint-dark-lighter border border-osint-border rounded text-gray-300 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setIsFiltersOpen(!isFiltersOpen)}
            className={`px-3 py-2 ${isFiltersOpen ? 'bg-osint-accent text-white' : 'bg-osint-dark text-gray-300'} hover:bg-osint-dark-lighter border border-osint-border rounded flex items-center gap-2`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {isFiltersOpen && (
        <div className="p-4 bg-osint-dark border border-osint-border rounded-lg space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={filters.searchQuery}
                  onChange={e => setFilters(f => ({ ...f, searchQuery: e.target.value }))}
                  placeholder="Search alerts..."
                  className="w-full pl-9 pr-3 py-2 bg-osint-dark-lighter border border-osint-border rounded text-white text-sm"
                />
              </div>
            </div>

            {/* Type filter */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <div className="flex flex-wrap gap-1">
                {Object.entries(ALERT_TYPE_CONFIG).map(([type, config]) => (
                  <button
                    key={type}
                    onClick={() => setFilters(f => ({
                      ...f,
                      types: f.types.includes(type as AlertType)
                        ? f.types.filter(t => t !== type)
                        : [...f.types, type as AlertType]
                    }))}
                    className={`px-2 py-1 text-xs rounded ${
                      filters.types.includes(type as AlertType)
                        ? 'bg-osint-accent text-white'
                        : 'bg-osint-dark-lighter text-gray-400'
                    }`}
                  >
                    {config.label.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Severity filter */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Severity</label>
              <div className="flex flex-wrap gap-1">
                {Object.entries(SEVERITY_CONFIG).map(([sev, config]) => (
                  <button
                    key={sev}
                    onClick={() => setFilters(f => ({
                      ...f,
                      severities: f.severities.includes(sev as AlertSeverity)
                        ? f.severities.filter(s => s !== sev)
                        : [...f.severities, sev as AlertSeverity]
                    }))}
                    className={`px-2 py-1 text-xs rounded ${
                      filters.severities.includes(sev as AlertSeverity)
                        ? `${config.bgColor} ${config.textColor}`
                        : 'bg-osint-dark-lighter text-gray-400'
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confidence slider */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Min Confidence: {Math.round(filters.minConfidence * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={filters.minConfidence * 100}
                onChange={e => setFilters(f => ({ ...f, minConfidence: parseInt(e.target.value) / 100 }))}
                className="w-full h-2 bg-osint-dark-lighter rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Status filter */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <div className="flex flex-wrap gap-1">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <button
                  key={status}
                  onClick={() => setFilters(f => ({
                    ...f,
                    statuses: f.statuses.includes(status as AlertStatus)
                      ? f.statuses.filter(s => s !== status)
                      : [...f.statuses, status as AlertStatus]
                  }))}
                  className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                    filters.statuses.includes(status as AlertStatus)
                      ? 'bg-osint-accent text-white'
                      : 'bg-osint-dark-lighter text-gray-400'
                  }`}
                >
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filters */}
          <button
            onClick={() => setFilters({ types: [], severities: [], statuses: [], searchQuery: '', minConfidence: 0 })}
            className="text-xs text-osint-accent hover:text-osint-accent-light"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Bulk actions bar */}
      {selectedAlerts.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-osint-accent/10 border border-osint-accent/30 rounded-lg">
          <span className="text-sm text-osint-accent">
            {selectedAlerts.size} alert{selectedAlerts.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkAction('acknowledge')}
              className="px-3 py-1 text-xs bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 rounded flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              Acknowledge All
            </button>
            <button
              onClick={() => handleBulkAction('dismiss')}
              className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded flex items-center gap-1"
            >
              <XCircle className="w-3 h-3" />
              Dismiss All
            </button>
            <button
              onClick={() => setSelectedAlerts(new Set())}
              className="px-3 py-1 text-xs text-gray-400 hover:text-gray-300"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Sort controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filteredAlerts.length > 0 && filteredAlerts.every(a => selectedAlerts.has(a.id))}
            onChange={selectAllVisible}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-osint-accent focus:ring-osint-accent"
          />
          <span className="text-sm text-gray-400">Select all ({filteredAlerts.length})</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Sort by:</span>
          {['severity', 'date', 'confidence'].map(option => (
            <button
              key={option}
              onClick={() => {
                if (sortBy === option) {
                  setSortOrder(o => o === 'desc' ? 'asc' : 'desc')
                } else {
                  setSortBy(option as any)
                  setSortOrder('desc')
                }
              }}
              className={`px-2 py-1 rounded ${sortBy === option ? 'bg-osint-dark-lighter text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
              {sortBy === option && (sortOrder === 'desc' ? ' ↓' : ' ↑')}
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      <div className="space-y-3">
        {filteredAlerts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No alerts match your filters</p>
          </div>
        ) : (
          filteredAlerts.map(renderAlertCard)
        )}
      </div>
    </div>
  )
}
