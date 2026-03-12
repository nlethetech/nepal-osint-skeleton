/**
 * React Hook for Real-Time News Feed via WebSocket
 *
 * Connects to /ws/news endpoint and receives live story updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '../store/slices/authSlice'

export interface NewsItem {
  id: string
  title: string
  url: string
  summary?: string
  source_id: string
  source_name?: string
  category?: string
  severity?: string
  nepal_relevance?: string
  published_at?: string
  created_at?: string
  cluster_id?: string
}

interface WebSocketMessage {
  type: 'new_story' | 'initial_stories' | 'heartbeat' | 'pong'
  timestamp: string
  data?: NewsItem | NewsItem[]
}

interface UseNewsFeedOptions {
  autoConnect?: boolean
}

export function useNewsFeed(options: UseNewsFeedOptions = {}) {
  const { autoConnect = true } = options

  const [items, setItems] = useState<NewsItem[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const connectRef = useRef<(() => void) | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const intentionallyClosedRef = useRef(false)
  const refreshingTokenRef = useRef(false)
  const restPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const MAX_RECONNECT_DELAY_MS = 30000
  const REST_FALLBACK_INTERVAL_MS = 45000

  const getWebSocketUrl = useCallback(() => {
    const token = useAuthStore.getState().token
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : ''
    // Use environment variable or construct from current location
    if (import.meta.env.VITE_WS_URL) {
      return `${import.meta.env.VITE_WS_URL}/news${tokenParam}`
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws/news${tokenParam}`
  }, [])

  const sortByTimeDesc = useCallback((a: NewsItem, b: NewsItem) => {
    const timeA = new Date(a.published_at || a.created_at || 0).getTime()
    const timeB = new Date(b.published_at || b.created_at || 0).getTime()
    return timeB - timeA
  }, [])

  const mergeItems = useCallback((prev: NewsItem[], incoming: NewsItem[]) => {
    const byId = new Map<string, NewsItem>()
    // Prefer newer/incoming payloads
    incoming.forEach(item => byId.set(item.id, item))
    prev.forEach(item => {
      if (!byId.has(item.id)) byId.set(item.id, item)
    })
    return Array.from(byId.values()).sort(sortByTimeDesc)
  }, [sortByTimeDesc])

  const fetchRecentStories = useCallback(async () => {
    try {
      const token = useAuthStore.getState().token
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch('/api/v1/stories/recent?hours=6&limit=200', { headers })
      if (!res.ok) return null
      const data = (await res.json()) as NewsItem[]
      if (!Array.isArray(data)) return null
      return data
    } catch {
      return null
    }
  }, [])

  const tryRefreshAccessToken = useCallback(async () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (!refreshToken) return null

    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { access_token?: string }
      if (!data?.access_token) return null
      useAuthStore.getState().updateToken(data.access_token)
      return data.access_token
    } catch {
      return null
    }
  }, [])

  const scheduleReconnect = useCallback((reason?: string) => {
    if (intentionallyClosedRef.current) return

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    const attempt = reconnectAttemptsRef.current
    const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS)
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++
      connectRef.current?.()
    }, delay)
  }, [])

  const connect = useCallback(() => {
    if (intentionallyClosedRef.current) return

    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    const url = getWebSocketUrl()

    try {
      wsRef.current = new WebSocket(url)

      wsRef.current.onopen = () => {
        setIsConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
        void fetchRecentStories().then((stories) => {
          if (stories?.length) setItems((prev) => mergeItems(prev, stories))
        })
      }

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          setLastUpdate(new Date())

          if (message.type === 'initial_stories') {
            // Initial batch - all stories from today (Nepal time)
            const stories = message.data as NewsItem[]
            if (Array.isArray(stories)) {
              setItems(prev => mergeItems(prev, stories))
            }
          } else if (message.type === 'new_story') {
            // New story - add to top of list
            const story = message.data as NewsItem
            if (story?.id) {
              setItems(prev => mergeItems(prev, [story]))
            }
          } else if (message.type === 'heartbeat') {
            // Heartbeat - connection is alive
            console.debug('[NewsFeed] Heartbeat received')
          }
        } catch (e) {
          console.error('[NewsFeed] Failed to parse message:', e)
        }
      }

      wsRef.current.onclose = (event) => {
        setIsConnected(false)

        if (intentionallyClosedRef.current) return

        // Immediately fetch via REST so items stay populated while reconnecting
        void fetchRecentStories().then((stories) => {
          if (stories?.length) setItems((prev) => mergeItems(prev, stories))
        })

        // 1008 = policy violation (usually missing/expired token). Try refresh token and reconnect.
        if (event.code === 1008 && !refreshingTokenRef.current) {
          refreshingTokenRef.current = true
          void (async () => {
            const newToken = await tryRefreshAccessToken()
            refreshingTokenRef.current = false
            if (newToken) {
              connect()
              return
            }
            setError('Session expired. Please log in again.')
            useAuthStore.getState().logout()
          })()
          return
        }

        scheduleReconnect(`code=${event.code}`)
      }

      wsRef.current.onerror = (event) => {
        console.error('[NewsFeed] WebSocket error:', event)
        setError('Connection error')
      }
    } catch (e) {
      console.error('[NewsFeed] Failed to create WebSocket:', e)
      setError('Failed to connect')
    }
  }, [fetchRecentStories, getWebSocketUrl, mergeItems, scheduleReconnect, tryRefreshAccessToken])

  // Keep a stable ref so reconnect scheduling doesn't depend on hook ordering
  connectRef.current = connect

  const disconnect = useCallback(() => {
    intentionallyClosedRef.current = true
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    intentionallyClosedRef.current = false

    if (autoConnect) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  // REST fallback: keep the feed fresh even if WS is temporarily down (e.g. backend restart)
  useEffect(() => {
    if (restPollTimerRef.current) clearInterval(restPollTimerRef.current)
    restPollTimerRef.current = setInterval(() => {
      if (isConnected) return
      void fetchRecentStories().then((stories) => {
        if (stories?.length) setItems((prev) => mergeItems(prev, stories))
      })
    }, REST_FALLBACK_INTERVAL_MS)

    return () => {
      if (restPollTimerRef.current) {
        clearInterval(restPollTimerRef.current)
        restPollTimerRef.current = null
      }
    }
  }, [fetchRecentStories, isConnected, mergeItems])

  // Reconnect immediately when the browser comes back online / tab becomes visible
  useEffect(() => {
    const handleOnline = () => connect()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') connect()
    }
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [connect])

  // Send ping to keep connection alive
  useEffect(() => {
    if (!isConnected) return

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 25000)

    return () => clearInterval(pingInterval)
  }, [isConnected])

  return {
    items,
    isConnected,
    error,
    lastUpdate,
    connect,
    disconnect,
  }
}
