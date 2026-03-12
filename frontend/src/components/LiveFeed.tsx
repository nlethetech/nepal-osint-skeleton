/**
 * LiveFeed Component
 *
 * Real-time feed showing incoming stories and alerts.
 * Features:
 * - Initial REST fetch with WebSocket updates
 * - Connection status indicator
 * - Auto-scroll with pause on hover
 * - Unread count badge
 * - Story/alert cards with timestamps
 * - Manual refresh capability
 * - Professional Palantir-style design
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  WifiOff,
  Pause,
  Play,
  Trash2,
  ExternalLink,
  Bell,
  Newspaper,
  Circle,
  Zap,
  Clock,
  User,
  Building2,
  MapPin,
  RefreshCw,
  Loader2,
  LogIn,
  AlertCircle
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useRealtime } from '../hooks/useRealtime'
import { useRealtimeStore, type LiveStory, type LiveAlert } from '../store/realtimeSlice'
import { useSettingsStore, getDistrictsForProvinces, type Province } from '../store/slices/settingsSlice'
import { useAuthStore } from '../store/slices/authSlice'
import apiClient from '../api/client'

// Safe date formatter - handles invalid/null dates gracefully
function safeFormatTimeAgo(timestamp: string | null | undefined): string {
  if (!timestamp) return 'recently'
  try {
    const date = new Date(timestamp)
    // Check if date is valid
    if (isNaN(date.getTime())) return 'recently'
    return formatDistanceToNow(date, { addSuffix: true })
  } catch {
    return 'recently'
  }
}

interface LiveFeedProps {
  className?: string
  showAlerts?: boolean
  maxHeight?: string
  compact?: boolean
  fillHeight?: boolean
  hours?: number  // Time range filter (24, 72, 168, 720)
}

export function LiveFeed({
  className = '',
  showAlerts = true,
  maxHeight = '500px',
  compact = false,
  fillHeight = false,
  hours = 72,  // Default to 3 days
}: LiveFeedProps) {
  const { isConnected } = useRealtime()
  const {
    liveStories,
    liveAlerts,
    unreadStories,
    unreadAlerts,
    isPaused,
    clearStories,
    clearAlerts,
    markStoriesRead,
    markAlertsRead,
    setPaused,
    addConsolidatedStories,
  } = useRealtimeStore()

  // Province filter from settings
  const { selectedProvinces, isProvinceFilterEnabled } = useSettingsStore()
  // Proper-case districts for API calls
  const selectedDistrictsApi = useMemo(() => {
    if (!isProvinceFilterEnabled || selectedProvinces.length === 7) return null
    return getDistrictsForProvinces(selectedProvinces as Province[])
  }, [selectedProvinces, isProvinceFilterEnabled])
  // Lowercase districts for client-side title matching
  const selectedDistricts = useMemo(() => {
    if (!selectedDistrictsApi) return null
    return selectedDistrictsApi.map(d => d.toLowerCase())
  }, [selectedDistrictsApi])

  const [activeTab, setActiveTab] = useState<'stories' | 'alerts'>('stories')
  const feedRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [hasInitialLoad, setHasInitialLoad] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<'auth' | 'network' | 'server' | null>(null)
  const { isAuthenticated } = useAuthStore()

  // Fetch initial stories from REST API (consolidated intelligence feed)
  const fetchInitialStories = useCallback(async () => {
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    setErrorType(null)
    try {
      // Fetch consolidated stories (deduplicated) for the selected time window
      const response = await apiClient.get('/analytics/consolidated-stories', {
        params: {
          hours,
          limit: 100,
          ...(selectedDistrictsApi && selectedDistrictsApi.length > 0 && {
            districts: selectedDistrictsApi.join(',')
          })
        },
        timeout: 15000,
      })
      if (response.status === 200) {
        const storiesData = response.data
        console.log('[LiveFeed] Fetched', storiesData.length, 'consolidated stories')

        // Helper to get valid timestamp
        const getValidTimestamp = (val: unknown): string => {
          if (!val) return new Date().toISOString()
          const str = String(val)
          const date = new Date(str)
          return isNaN(date.getTime()) ? new Date().toISOString() : str
        }

        // Map API response to LiveStory format
        const formattedStories: LiveStory[] = storiesData.map((story: Record<string, unknown>) => {
          const sourceLinks = (story.source_links as Array<{ source_id: string; url: string; title?: string }> | undefined) || []
          const firstSource = sourceLinks[0]
          const severity = (story.severity as string | undefined) || undefined
          const priorityFromSeverity =
            severity === 'critical'
              ? 'critical'
              : severity === 'high'
              ? 'high'
              : severity === 'medium'
              ? 'medium'
              : 'low'

          const keyEntities = (story.key_entities as Array<{ name?: string; type?: string }> | undefined) || []

          return {
            id: (story.id as string) || `consolidated_${Date.now()}_${Math.random()}`,
            consolidated_id: story.id as string,
            title: (story.canonical_headline || story.canonical_headline_ne || 'Untitled') as string,
            source_id: firstSource?.source_id || 'multiple',
            url: firstSource?.url || '',
            timestamp: getValidTimestamp(story.last_updated_at || story.first_reported_at || story.created_at),
            source_count: (story.source_count as number) || 1,
            nepal_relevance: story.nepal_relevance as string,
            is_consolidated: true,
            severity,
            story_type: story.story_type as string,
            entities: keyEntities
              .filter((e) => Boolean(e?.name))
              .slice(0, 10)
              .map((e) => ({
                name: String(e.name),
                type: String(e.type || 'UNKNOWN'),
              })),
            // Surface backend priority scoring in the existing UI badges
            relevance_score: typeof story.intel_priority_score === 'number' ? story.intel_priority_score : undefined,
            relevance_priority: priorityFromSeverity,
            relevance_reasons: Array.isArray(story.intel_priority_reasons) ? (story.intel_priority_reasons as string[]) : undefined,
          }
        })

        // Add all stories at once (these are already deduplicated/filtered on the backend)
        addConsolidatedStories(formattedStories)
        setHasInitialLoad(true)
        setError(null)
        setErrorType(null)
      } else {
        console.error('[LiveFeed] Failed to fetch stories:', response.status, response.statusText)
        setError('Failed to load stories')
        setErrorType('server')
      }
    } catch (err: unknown) {
      console.error('[LiveFeed] Failed to fetch initial stories:', err)
      const axiosError = err as { response?: { status: number }; code?: string; message?: string }

      if (axiosError.response?.status === 401) {
        setError('Login required to view live feed')
        setErrorType('auth')
      } else if (axiosError.response?.status === 403) {
        setError('Access denied - insufficient permissions')
        setErrorType('auth')
      } else if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ERR_NETWORK') {
        setError('Cannot connect to server')
        setErrorType('network')
      } else if (axiosError.response?.status && axiosError.response.status >= 500) {
        setError('Server error - please try again')
        setErrorType('server')
      } else {
        setError(axiosError.message || 'Failed to load stories')
        setErrorType('network')
      }
    } finally {
      setIsLoading(false)
    }
  }, [addConsolidatedStories, hours, isLoading, selectedDistrictsApi])

  // Fetch initial alerts from REST API
  const [hasAlertsLoad, setHasAlertsLoad] = useState(false)
  const [alertsLoading, setAlertsLoading] = useState(false)

  // Clear any old cached alerts on mount (ensures fresh dynamic alerts)
  useEffect(() => {
    clearAlerts()
  }, [clearAlerts])

  const fetchInitialAlerts = useCallback(async () => {
    if (alertsLoading) return
    setAlertsLoading(true)
    try {
      // Fetch dynamic intelligence alerts (high-severity stories)
      const response = await apiClient.get('/alerts/dynamic', {
        params: {
          hours,
          limit: 50,
          ...(selectedDistrictsApi && selectedDistrictsApi.length > 0 && {
            districts: selectedDistrictsApi.join(',')
          })
        },
        timeout: 15000,
      })
      if (response.status === 200) {
        const data = response.data
        const alertsData = data.items || []
        console.log('[LiveFeed] Fetched', alertsData.length, 'dynamic intelligence alerts')

        // Clear existing alerts first
        clearAlerts()

        // Helper to get valid timestamp
        const getValidTimestamp = (val: unknown): string => {
          if (!val) return new Date().toISOString()
          const str = String(val)
          const date = new Date(str)
          return isNaN(date.getTime()) ? new Date().toISOString() : str
        }

        // Map dynamic alert response to LiveAlert format and add
        alertsData.forEach((alert: Record<string, unknown>) => {
          const districts = (alert.districts as string[]) || []
          const formattedAlert = {
            id: (alert.id as string) || `alert_${Date.now()}`,
            title: (alert.title as string) || 'Unknown Alert',
            severity: (alert.severity as string) || 'medium',
            description: alert.description as string,
            timestamp: getValidTimestamp(alert.first_reported_at),
            hazard_type: alert.story_type as string,
            district: districts[0] || undefined,
            is_active: true,
            source_count: (alert.source_count as number) || 1,
          }
          useRealtimeStore.getState().addAlert(formattedAlert)
        })
        setHasAlertsLoad(true)
        // Clear errors on success
        if (activeTab === 'alerts') {
          setError(null)
          setErrorType(null)
        }
      } else {
        console.error('[LiveFeed] Failed to fetch dynamic alerts:', response.status, response.statusText)
        setHasAlertsLoad(true)
      }
    } catch (err: unknown) {
      console.error('[LiveFeed] Failed to fetch dynamic alerts:', err)
      const axiosError = err as { response?: { status: number }; code?: string; message?: string }

      // Only set error if on alerts tab
      if (activeTab === 'alerts') {
        if (axiosError.response?.status === 401) {
          setError('Login required to view alerts')
          setErrorType('auth')
        } else if (axiosError.response?.status === 403) {
          setError('Access denied - insufficient permissions')
          setErrorType('auth')
        } else if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ERR_NETWORK') {
          setError('Cannot connect to server')
          setErrorType('network')
        } else {
          setError(axiosError.message || 'Failed to load alerts')
          setErrorType('network')
        }
      }
      setHasAlertsLoad(true)
    } finally {
      setAlertsLoading(false)
    }
  }, [activeTab, alertsLoading, clearAlerts, hours, selectedDistrictsApi])

  // Fetch initial data on mount if no stories exist
  useEffect(() => {
    if (!hasInitialLoad && liveStories.length === 0) {
      fetchInitialStories()
    }
  }, [hasInitialLoad, liveStories.length, fetchInitialStories])

  // Fetch dynamic alerts on mount and when filters change
  useEffect(() => {
    if (!hasAlertsLoad) {
      fetchInitialAlerts()
    }
  }, [hasAlertsLoad, fetchInitialAlerts])

  // Re-fetch alerts when hours or district filter changes
  useEffect(() => {
    if (hasAlertsLoad) {
      setHasAlertsLoad(false)
    }
  }, [hours, selectedDistrictsApi])

  // FAST LIVE FEED: Show stories immediately, ingest RSS in background
  useEffect(() => {
    let isMounted = true

    // Helper: Fetch and display consolidated stories (fast)
    const refreshStories = async () => {
      try {
        const params = new URLSearchParams({ hours: String(hours), limit: '100' })
        if (selectedDistrictsApi && selectedDistrictsApi.length > 0) {
          params.set('districts', selectedDistrictsApi.join(','))
        }

        const response = await apiClient.get(`/analytics/consolidated-stories?${params}`)
        if (response.status === 200 && isMounted) {
          const storiesData = response.data

          // Helper to get valid timestamp
          const getValidTimestamp = (val: unknown): string => {
            if (!val) return new Date().toISOString()
            const str = String(val)
            const date = new Date(str)
            return isNaN(date.getTime()) ? new Date().toISOString() : str
          }

          const formattedStories: LiveStory[] = storiesData.map((story: Record<string, unknown>) => {
            const sourceLinks = (story.source_links as Array<{ source_id: string; url: string; title?: string }> | undefined) || []
            const firstSource = sourceLinks[0]
            const severity = (story.severity as string | undefined) || undefined
            const priorityFromSeverity =
              severity === 'critical'
                ? 'critical'
                : severity === 'high'
                ? 'high'
                : severity === 'medium'
                ? 'medium'
                : 'low'

            const keyEntities = (story.key_entities as Array<{ name?: string; type?: string }> | undefined) || []

            return {
              id: (story.id as string) || `consolidated_${Date.now()}_${Math.random()}`,
              consolidated_id: story.id as string,
              title: (story.canonical_headline || story.canonical_headline_ne || 'Untitled') as string,
              source_id: firstSource?.source_id || 'multiple',
              url: firstSource?.url || '',
              timestamp: getValidTimestamp(story.last_updated_at || story.first_reported_at || story.created_at),
              source_count: (story.source_count as number) || 1,
              nepal_relevance: story.nepal_relevance as string,
              is_consolidated: true,
              severity,
              story_type: story.story_type as string,
              entities: keyEntities
                .filter((e) => Boolean(e?.name))
                .slice(0, 10)
                .map((e) => ({
                  name: String(e.name),
                  type: String(e.type || 'UNKNOWN'),
                })),
              relevance_score: typeof story.intel_priority_score === 'number' ? story.intel_priority_score : undefined,
              relevance_priority: priorityFromSeverity,
              relevance_reasons: Array.isArray(story.intel_priority_reasons) ? (story.intel_priority_reasons as string[]) : undefined,
            }
          })

          addConsolidatedStories(formattedStories)
          console.log('[LiveFeed] Refreshed', formattedStories.length, 'consolidated stories')
        }
      } catch (error) {
        console.error('[LiveFeed] Story refresh failed:', error)
      }
    }

    // Helper: Fast RSS ingestion (only top 5 sources)
    const triggerFastRSS = () => {
      apiClient.post('/stories/ingest/rss?fast=true')
        .then(() => console.log('[LiveFeed] Fast RSS (5 sources) triggered'))
        .catch((e) => console.error('[LiveFeed] Fast RSS error:', e))
    }

    // Helper: Full RSS ingestion (all priority sources)
    const triggerFullRSS = () => {
      apiClient.post('/stories/ingest/rss?priority_only=true')
        .then(() => console.log('[LiveFeed] Full RSS (33 sources) triggered'))
        .catch((e) => console.error('[LiveFeed] Full RSS error:', e))
    }

    // IMMEDIATE: Fetch existing stories right away
    refreshStories()

    // IMMEDIATE: Fast RSS ingestion (doesn't block UI)
    triggerFastRSS()

    // FAST REFRESH: Poll for new stories every 30 seconds
    const storyInterval = setInterval(refreshStories, 30 * 1000)

    // FAST INGESTION: Trigger fast RSS every 60 seconds
    const fastIngestInterval = setInterval(triggerFastRSS, 60 * 1000)

    // FULL INGESTION: Trigger full RSS every 5 minutes
    const fullIngestInterval = setInterval(triggerFullRSS, 5 * 60 * 1000)

    return () => {
      isMounted = false
      clearInterval(storyInterval)
      clearInterval(fastIngestInterval)
      clearInterval(fullIngestInterval)
    }
  }, [addConsolidatedStories, hours, selectedDistrictsApi])

  // Auto-scroll to top when new items arrive (unless paused or hovered)
  useEffect(() => {
    if (!isPaused && !isHovered && feedRef.current) {
      feedRef.current.scrollTop = 0
    }
  }, [liveStories, liveAlerts, isPaused, isHovered])

  // Mark items as read when tab is active, clear errors on tab switch
  useEffect(() => {
    setError(null)
    setErrorType(null)
    if (activeTab === 'stories') {
      markStoriesRead()
    } else {
      markAlertsRead()
    }
  }, [activeTab, markStoriesRead, markAlertsRead])

  const handleClear = () => {
    if (activeTab === 'stories') {
      clearStories()
      setHasInitialLoad(false) // Allow re-fetch
    } else {
      clearAlerts()
    }
  }

  const handleRefresh = async () => {
    if (activeTab === 'stories') {
      // FAST: Trigger fast RSS (5 sources) in background
      apiClient.post('/stories/ingest/rss?fast=true')
        .then(() => console.log('[LiveFeed] Fast RSS refresh triggered'))
        .catch((e) => console.error('[LiveFeed] RSS refresh error:', e))

      // IMMEDIATE: Fetch existing stories right away
      setHasInitialLoad(false)
      fetchInitialStories()
    } else {
      setHasAlertsLoad(false)
      fetchInitialAlerts()
    }
  }

  // Filter stories by province if filter is active
  const filteredStories = useMemo(() => {
    if (!selectedDistricts || selectedDistricts.length === 0) return liveStories
    return liveStories.filter(story => {
      const text = story.title.toLowerCase()
      return selectedDistricts.some(d => text.includes(d))
    })
  }, [liveStories, selectedDistricts])

  // Filter alerts by province if filter is active (alerts have district field)
  const filteredAlerts = useMemo(() => {
    if (!selectedDistricts || selectedDistricts.length === 0) return liveAlerts
    return liveAlerts.filter(alert => {
      // Check district field if available
      if (alert.district) {
        return selectedDistricts.includes(alert.district.toLowerCase())
      }
      // Fallback to title search
      const text = alert.title.toLowerCase()
      return selectedDistricts.some(d => text.includes(d))
    })
  }, [liveAlerts, selectedDistricts])

  const currentItems = activeTab === 'stories' ? filteredStories : filteredAlerts
  const currentLoading = activeTab === 'stories' ? isLoading : alertsLoading
  const containerClass = fillHeight
    ? 'flex flex-col h-full'
    : ''

  return (
    <div className={`bg-osint-card rounded-lg border border-osint-border ${containerClass} ${className}`}>
      {/* Header */}
      <div className={`flex items-center justify-between ${compact ? 'px-2 sm:px-3 py-2' : 'px-3 sm:px-4 py-2.5 sm:py-3'} border-b border-osint-border flex-shrink-0`}>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <Zap className={`${compact ? 'w-3.5 sm:w-4 h-3.5 sm:h-4' : 'w-4 sm:w-5 h-4 sm:h-5'} text-osint-accent`} />
            <h3 className={`${compact ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'} font-semibold text-osint-text`}>Live Feed</h3>
          </div>

          {/* Connection indicator */}
          <div className={`flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 rounded-full ${
            isConnected
              ? 'bg-green-500/10 border border-green-500/20'
              : 'bg-yellow-500/10 border border-yellow-500/20'
          }`}>
            {isConnected ? (
              <>
                <Circle className="w-1.5 h-1.5 fill-green-500 text-green-500 animate-pulse" />
                <span className="text-[10px] sm:text-xs text-green-500 font-medium">Live</span>
              </>
            ) : (
              <>
                <Circle className="w-1.5 h-1.5 fill-yellow-500 text-yellow-500" />
                <span className="text-[10px] sm:text-xs text-yellow-500 font-medium hidden sm:inline">Syncing</span>
              </>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleRefresh}
            disabled={currentLoading}
            className="p-1.5 rounded-md hover:bg-osint-border transition-colors text-osint-muted hover:text-osint-accent disabled:opacity-50"
            title="Refresh feed"
          >
            {currentLoading ? (
              <Loader2 className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} animate-spin`} />
            ) : (
              <RefreshCw className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
            )}
          </button>
          <button
            onClick={() => setPaused(!isPaused)}
            className={`p-1.5 rounded-md transition-colors ${
              isPaused
                ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
                : 'hover:bg-osint-border text-osint-muted'
            }`}
            title={isPaused ? 'Resume feed' : 'Pause feed'}
          >
            {isPaused ? (
              <Play className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
            ) : (
              <Pause className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
            )}
          </button>
          <button
            onClick={handleClear}
            className="p-1.5 rounded-md hover:bg-osint-border transition-colors text-osint-muted hover:text-red-400"
            title="Clear feed"
          >
            <Trash2 className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-osint-border flex-shrink-0">
        <button
          onClick={() => setActiveTab('stories')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all ${
            activeTab === 'stories'
              ? 'text-osint-accent border-b-2 border-osint-accent bg-osint-accent/5'
              : 'text-osint-muted hover:text-osint-text hover:bg-osint-border/30'
          }`}
        >
          <Newspaper className="w-3.5 h-3.5" />
          <span>Stories</span>
          {unreadStories > 0 && activeTab !== 'stories' && (
            <span className="px-1.5 py-0.5 bg-osint-accent text-white text-xs rounded-full min-w-[18px] text-center">
              {unreadStories > 99 ? '99+' : unreadStories}
            </span>
          )}
          {activeTab === 'stories' && filteredStories.length > 0 && (
            <span className="text-osint-muted">({filteredStories.length})</span>
          )}
        </button>
        {showAlerts && (
          <button
            onClick={() => setActiveTab('alerts')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all ${
              activeTab === 'alerts'
                ? 'text-osint-accent border-b-2 border-osint-accent bg-osint-accent/5'
                : 'text-osint-muted hover:text-osint-text hover:bg-osint-border/30'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Alerts</span>
            {unreadAlerts > 0 && activeTab !== 'alerts' && (
              <span className="px-1.5 py-0.5 bg-severity-critical text-white text-xs rounded-full min-w-[18px] text-center animate-pulse">
                {unreadAlerts > 99 ? '99+' : unreadAlerts}
              </span>
            )}
            {activeTab === 'alerts' && filteredAlerts.length > 0 && (
              <span className="text-osint-muted">({filteredAlerts.length})</span>
            )}
          </button>
        )}
      </div>

      {/* Feed content */}
      <div
        ref={feedRef}
        className={`overflow-y-auto ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={fillHeight ? undefined : { maxHeight }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Auth error state */}
        {error && errorType === 'auth' && currentItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-osint-muted">
            <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center mb-3">
              <LogIn className="w-6 h-6 text-yellow-500" />
            </div>
            <p className="text-sm font-medium text-yellow-500">{error}</p>
            <p className="text-xs mt-1 text-center px-4">
              Please log in to access the intelligence feed
            </p>
            <a
              href="/login"
              className="mt-4 px-4 py-2 bg-osint-accent text-white text-xs font-medium rounded-md hover:bg-osint-accent-hover transition-colors flex items-center gap-2"
            >
              <LogIn className="w-3.5 h-3.5" />
              Go to Login
            </a>
          </div>
        ) : error && currentItems.length === 0 ? (
          /* Network/Server error state */
          <div className="flex flex-col items-center justify-center py-12 text-osint-muted">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-sm font-medium text-red-400">{error}</p>
            <p className="text-xs mt-1 text-center px-4">
              {errorType === 'network'
                ? 'Check if the backend server is running'
                : 'Please try again later'}
            </p>
            <button
              onClick={handleRefresh}
              disabled={currentLoading}
              className="mt-4 px-4 py-2 bg-osint-accent/20 text-osint-accent text-xs font-medium rounded-md hover:bg-osint-accent/30 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${currentLoading ? 'animate-spin' : ''}`} />
              Retry
            </button>
          </div>
        ) : currentLoading && currentItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-osint-muted">
            <Loader2 className="w-8 h-8 animate-spin text-osint-accent mb-3" />
            <p className="text-sm font-medium">
              {activeTab === 'stories' ? 'Loading stories...' : 'Loading alerts...'}
            </p>
          </div>
        ) : currentItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-osint-muted">
            <div className="w-12 h-12 rounded-full bg-osint-border/50 flex items-center justify-center mb-3">
              {activeTab === 'stories' ? (
                <Newspaper className="w-6 h-6 opacity-50" />
              ) : (
                <Bell className="w-6 h-6 opacity-50" />
              )}
            </div>
            <p className="text-sm font-medium">
              {activeTab === 'stories' ? 'No stories found' : 'No active alerts'}
            </p>
            <p className="text-xs mt-1 text-center px-4">
              {activeTab === 'stories'
                ? 'Click refresh to load recent stories'
                : 'No high-severity intelligence alerts in this time range'}
            </p>
            <button
              onClick={handleRefresh}
              className="mt-4 px-4 py-2 bg-osint-accent/20 text-osint-accent text-xs font-medium rounded-md hover:bg-osint-accent/30 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {activeTab === 'stories' ? 'Load Stories' : 'Refresh Alerts'}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-osint-border/50">
            {activeTab === 'stories'
              ? (currentItems as LiveStory[]).map((story, index) => (
                  <StoryCard key={story.id} story={story} isNew={index === 0} />
                ))
              : (currentItems as LiveAlert[]).map((alert, index) => (
                  <AlertCard key={alert.id} alert={alert} isNew={index === 0} />
                ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      {isPaused && (
        <div className="px-3 py-2 bg-yellow-500/10 border-t border-yellow-500/20 flex-shrink-0">
          <div className="flex items-center justify-center gap-2">
            <Pause className="w-3 h-3 text-yellow-500" />
            <span className="text-xs text-yellow-500 font-medium">Feed paused</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Entity type icons
const ENTITY_ICONS = {
  PERSON: User,
  ORGANIZATION: Building2,
  LOCATION: MapPin,
} as const

// Priority badge colors (for relevance scoring)
const PRIORITY_STYLES = {
  critical: {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/40',
    label: 'CRITICAL',
  },
  high: {
    bg: 'bg-orange-500/20',
    text: 'text-orange-400',
    border: 'border-orange-500/40',
    label: 'HIGH',
  },
  medium: {
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-400',
    border: 'border-yellow-500/40',
    label: 'MED',
  },
  low: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-400',
    border: 'border-slate-500/40',
    label: 'LOW',
  },
} as const

// Neighbor country badge config
const NEIGHBOR_STYLES = {
  india: {
    bg: 'bg-orange-500/15',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    flag: '🇮🇳',
    label: 'India',
  },
  china: {
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/30',
    flag: '🇨🇳',
    label: 'China',
  },
} as const

// Story card component with consolidated intelligence display
function StoryCard({ story, isNew }: { story: LiveStory; isNew?: boolean }) {
  const hasConsolidatedData = story.is_consolidated || (story.source_count && story.source_count > 1)
  const neighborStyle = story.neighbor_country ? NEIGHBOR_STYLES[story.neighbor_country] : null
  const priorityStyle = story.relevance_priority ? PRIORITY_STYLES[story.relevance_priority] : null

  // Determine border color based on priority
  const borderClass = story.relevance_priority === 'critical'
    ? 'border-l-2 border-red-500'
    : story.relevance_priority === 'high'
    ? 'border-l-2 border-orange-500'
    : hasConsolidatedData
    ? 'border-l-2 border-osint-accent'
    : ''

  return (
    <div className={`px-3 py-2.5 hover:bg-osint-border/20 transition-colors ${borderClass} ${isNew ? 'bg-osint-accent/5' : ''}`}>
      {/* Title with relevance score */}
      <div className="flex items-start gap-2">
        <h4 className="text-sm font-medium text-osint-text line-clamp-2 leading-snug flex-1">
          {story.title}
        </h4>
        {/* Relevance score badge */}
        {story.relevance_score !== undefined && story.relevance_score > 0 && (
          <div
            className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
              story.relevance_score >= 80
                ? 'bg-red-500/30 text-red-300'
                : story.relevance_score >= 60
                ? 'bg-orange-500/30 text-orange-300'
                : story.relevance_score >= 40
                ? 'bg-yellow-500/30 text-yellow-300'
                : 'bg-slate-500/30 text-slate-400'
            }`}
            title="Relevance score"
          >
            {story.relevance_score}
          </div>
        )}
      </div>

      {/* Metadata row */}
      <div className="flex items-center flex-wrap gap-1.5 mt-2">
        {/* Story type badge */}
        {story.story_type && (
          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded bg-osint-border/50 text-osint-text capitalize">
            {story.story_type.replace(/_/g, ' ')}
          </span>
        )}

        {/* Priority badge */}
        {priorityStyle && story.relevance_priority !== 'low' && (
          <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}>
            {priorityStyle.label}
          </span>
        )}

        {/* Neighbor country badge (India/China) */}
        {neighborStyle && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border ${neighborStyle.bg} ${neighborStyle.text} ${neighborStyle.border}`}>
            <span className="text-[10px]">{neighborStyle.flag}</span>
            {neighborStyle.label}
          </span>
        )}

        {/* Source badge */}
        {story.source_count && story.source_count > 1 ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-osint-accent/20 text-osint-accent text-xs rounded font-medium">
            <Zap className="w-3 h-3" />
            {story.source_count} sources
          </span>
        ) : (
          <span className="px-1.5 py-0.5 bg-osint-border/70 text-osint-muted text-xs rounded truncate max-w-[100px]">
            {story.source_id}
          </span>
        )}

        {/* Timestamp */}
        <span className="flex items-center gap-1 text-xs text-osint-muted ml-auto">
          <Clock className="w-3 h-3" />
          {safeFormatTimeAgo(story.timestamp)}
        </span>
      </div>

      {/* Entities row */}
      {story.entities && story.entities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {story.entities.slice(0, 3).map((entity, idx) => {
            const IconComponent = ENTITY_ICONS[entity.type as keyof typeof ENTITY_ICONS] || User
            return (
              <span
                key={idx}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded ${
                  entity.type === 'PERSON'
                    ? 'bg-purple-500/15 text-purple-400'
                    : entity.type === 'ORGANIZATION'
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'bg-emerald-500/15 text-emerald-400'
                }`}
              >
                <IconComponent className="w-3 h-3" />
                <span className="truncate max-w-[100px]">{entity.name}</span>
              </span>
            )
          })}
          {story.entities.length > 3 && (
            <span className="px-1.5 py-0.5 text-xs text-osint-muted bg-osint-border/50 rounded">
              +{story.entities.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Relevance reasons (expandable on hover) */}
      {story.relevance_reasons && story.relevance_reasons.length > 0 && story.relevance_priority !== 'low' && (
        <div className="mt-1.5 text-[10px] text-osint-muted opacity-70 truncate" title={story.relevance_reasons.join(' | ')}>
          {story.relevance_reasons.slice(0, 2).join(' • ')}
          {story.relevance_reasons.length > 2 && ` +${story.relevance_reasons.length - 2}`}
        </div>
      )}

      {/* Link */}
      {story.url && (
        <a
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-osint-accent hover:text-osint-accent-hover mt-2 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          View source
        </a>
      )}
    </div>
  )
}

// Story type / alert category icons mapping
const ALERT_TYPE_ICONS: Record<string, string> = {
  // Intelligence story types
  political: '🏛️',
  security: '🔒',
  disaster: '⚠️',
  crime: '🚨',
  economic: '📊',
  social: '👥',
  infrastructure: '🏗️',
  health: '🏥',
  environment: '🌿',
  // Legacy hazard types (BIPAD)
  flood: '🌊',
  landslide: '⛰️',
  earthquake: '🔔',
  fire: '🔥',
  forest_fire: '🌲',
  lightning: '⚡',
  drought: '☀️',
  cold_wave: '❄️',
  epidemic: '🦠',
  avalanche: '🏔️',
  wind_storm: '💨',
  heavy_rainfall: '🌧️',
}

// Alert card component for dynamic intelligence alerts
function AlertCard({ alert, isNew }: { alert: LiveAlert; isNew?: boolean }) {
  const severityConfig = {
    danger: {
      bg: 'bg-red-500/10',
      border: 'border-red-500',
      text: 'text-red-400',
      badge: 'bg-red-500/20 text-red-400 border-red-500/30'
    },
    critical: {
      bg: 'bg-red-500/10',
      border: 'border-red-500',
      text: 'text-red-400',
      badge: 'bg-red-500/20 text-red-400 border-red-500/30'
    },
    warning: {
      bg: 'bg-orange-500/10',
      border: 'border-orange-500',
      text: 'text-orange-400',
      badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    },
    high: {
      bg: 'bg-orange-500/10',
      border: 'border-orange-500',
      text: 'text-orange-400',
      badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    },
    watch: {
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500',
      text: 'text-yellow-400',
      badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    },
    medium: {
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500',
      text: 'text-yellow-400',
      badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    },
    normal: {
      bg: 'bg-blue-500/10',
      border: 'border-blue-500',
      text: 'text-blue-400',
      badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    },
    low: {
      bg: 'bg-blue-500/10',
      border: 'border-blue-500',
      text: 'text-blue-400',
      badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    },
  }

  const config = severityConfig[alert.severity as keyof typeof severityConfig] || severityConfig.normal
  const typeIcon = alert.hazard_type ? ALERT_TYPE_ICONS[alert.hazard_type] || '⚠️' : '⚠️'

  return (
    <div className={`px-3 py-2.5 border-l-2 ${config.border} ${config.bg} ${isNew ? 'animate-pulse-once' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg mt-0.5 flex-shrink-0">{typeIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 text-xs rounded border uppercase font-semibold ${config.badge}`}>
              {alert.severity}
            </span>
            {alert.hazard_type && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-osint-border/70 text-osint-muted capitalize">
                {alert.hazard_type.replace('_', ' ')}
              </span>
            )}
            {alert.district && (
              <span className="flex items-center gap-1 text-xs text-osint-muted">
                <MapPin className="w-3 h-3" />
                {alert.district}
              </span>
            )}
            {alert.source_count && alert.source_count > 1 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-osint-accent/20 text-osint-accent text-[10px] rounded font-medium">
                <Zap className="w-2.5 h-2.5" />
                {alert.source_count} sources
              </span>
            )}
          </div>
          <h4 className="text-sm font-medium text-osint-text mt-1.5 line-clamp-2">
            {alert.title}
          </h4>
          {alert.description && (
            <p className="text-xs text-osint-muted mt-1 line-clamp-2">
              {alert.description}
            </p>
          )}
          <span className="flex items-center gap-1 text-xs text-osint-muted mt-1.5">
            <Clock className="w-3 h-3" />
            {safeFormatTimeAgo(alert.timestamp)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default LiveFeed
