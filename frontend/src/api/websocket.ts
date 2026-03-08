/**
 * WebSocket Client for Real-Time Updates
 *
 * Provides real-time communication with the backend for:
 * - Live story feed
 * - Intelligence alerts
 * - Entity updates
 * - District-specific events
 */

import { useAuthStore } from '../store/slices/authSlice'

export type WebSocketChannel = 'alerts' | 'feed' | 'entities' | 'districts' | 'system'

export interface WebSocketMessage {
  channel: WebSocketChannel
  event_type: string
  data: Record<string, unknown>
  timestamp: string
  priority?: 'critical' | 'high' | 'normal' | 'low'
}

export type MessageHandler = (message: WebSocketMessage) => void
export type ConnectionHandler = (connected: boolean) => void

interface SubscribeMessage {
  type: 'subscribe' | 'unsubscribe'
  channel: string
  target_id?: string
}

// Dynamically determine WebSocket URL based on current location
// In production (HTTPS), use wss:// - in development, use ws://
function getWebSocketUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    // Remove trailing /ws if present (we'll add the full path in connect())
    const url = import.meta.env.VITE_WS_URL as string
    return url.replace(/\/ws\/?$/, '')
  }
  // Auto-detect based on current page location
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}`
}

const WS_BASE_URL = getWebSocketUrl()

export class OSINTWebSocket {
  private ws: WebSocket | null = null
  private clientId: string
  private messageHandlers: Map<WebSocketChannel, Set<MessageHandler>> = new Map()
  private connectionHandlers: Set<ConnectionHandler> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private isIntentionallyClosed = false

  constructor(clientId?: string) {
    this.clientId = clientId || this.generateClientId()

    // Initialize handler maps for each channel
    const channels: WebSocketChannel[] = ['alerts', 'feed', 'entities', 'districts', 'system']
    channels.forEach(channel => {
      this.messageHandlers.set(channel, new Set())
    })
  }

  private generateClientId(): string {
    return `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.isIntentionallyClosed = false
    const token = useAuthStore.getState().token
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : ''
    // Connect to /ws/news endpoint (the backend's actual news WebSocket)
    const url = `${WS_BASE_URL}/ws/news${tokenParam}`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.notifyConnectionHandlers(true)
        this.startHeartbeat()
        // No need to subscribe - /ws/news sends all news automatically
      }

      this.ws.onclose = (event) => {
        this.stopHeartbeat()
        this.notifyConnectionHandlers(false)

        // Policy violation (e.g., missing/invalid token) -> stop reconnect loops
        if (event.code === 1008) {
          useAuthStore.getState().logout()
          return
        }

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error)
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }
    } catch (error) {
      console.error('[WebSocket] Failed to connect:', error)
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.isIntentionallyClosed = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.stopHeartbeat()

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: WebSocketChannel, targetId?: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return
    }

    const message: SubscribeMessage = {
      type: 'subscribe',
      channel,
      target_id: targetId,
    }

    this.ws.send(JSON.stringify(message))
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: WebSocketChannel, targetId?: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return
    }

    const message: SubscribeMessage = {
      type: 'unsubscribe',
      channel,
      target_id: targetId,
    }

    this.ws.send(JSON.stringify(message))
  }

  /**
   * Add a message handler for a specific channel
   */
  onMessage(channel: WebSocketChannel, handler: MessageHandler): () => void {
    const handlers = this.messageHandlers.get(channel)
    if (handlers) {
      handlers.add(handler)
    }

    // Return unsubscribe function
    return () => {
      handlers?.delete(handler)
    }
  }

  /**
   * Add a connection state handler
   */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler)

    // Return unsubscribe function
    return () => {
      this.connectionHandlers.delete(handler)
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Get client ID
   */
  getClientId(): string {
    return this.clientId
  }

  private handleMessage(data: string): void {
    try {
      const rawMessage = JSON.parse(data)

      // Convert backend /ws/news message format to our internal format
      // Backend sends: { type: "new_story" | "initial_stories" | "heartbeat", timestamp, data }
      // We expect: { channel, event_type, data, timestamp, priority }
      let message: WebSocketMessage

      if (rawMessage.type === 'heartbeat' || rawMessage.type === 'pong') {
        // Extract viewer count from heartbeat if present
        if (typeof rawMessage.viewers === 'number') {
          _setViewerCount(rawMessage.viewers)
        }
        return
      }

      if (rawMessage.type === 'viewer_count') {
        if (typeof rawMessage.viewers === 'number') {
          _setViewerCount(rawMessage.viewers)
        }
        return
      }

      if (rawMessage.type === 'new_story') {
        message = {
          channel: 'feed',
          event_type: 'new_story',
          data: rawMessage.data || rawMessage,
          timestamp: rawMessage.timestamp || new Date().toISOString(),
          priority: rawMessage.data?.severity === 'critical' ? 'critical' :
                   rawMessage.data?.severity === 'high' ? 'high' : 'normal',
        }
      } else if (rawMessage.type === 'cluster_update') {
        message = {
          channel: 'feed',
          event_type: 'cluster_update',
          data: rawMessage.data || rawMessage,
          timestamp: rawMessage.timestamp || new Date().toISOString(),
        }
      } else if (rawMessage.type === 'kpi_update') {
        message = {
          channel: 'system',
          event_type: 'kpi_update',
          data: rawMessage.data || rawMessage,
          timestamp: rawMessage.timestamp || new Date().toISOString(),
        }
      } else if (rawMessage.type === 'initial_stories') {
        message = {
          channel: 'feed',
          event_type: 'initial_stories',
          data: rawMessage.data || rawMessage,
          timestamp: rawMessage.timestamp || new Date().toISOString(),
        }
      } else if (rawMessage.channel) {
        // Already in expected format
        message = rawMessage as WebSocketMessage
      } else {
        // Unknown format, try to use as-is on feed channel
        message = {
          channel: 'feed',
          event_type: rawMessage.type || 'unknown',
          data: rawMessage.data || rawMessage,
          timestamp: rawMessage.timestamp || new Date().toISOString(),
        }
      }

      // Get handlers for this channel
      const channel = message.channel as WebSocketChannel
      const handlers = this.messageHandlers.get(channel)

      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(message)
          } catch (error) {
            console.error('[WebSocket] Handler error:', error)
          }
        })
      }

      // Also notify system handlers for all messages if they exist
      if (channel !== 'system') {
        const systemHandlers = this.messageHandlers.get('system')
        systemHandlers?.forEach(handler => {
          try {
            handler(message)
          } catch (error) {
            console.error('[WebSocket] System handler error:', error)
          }
        })
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error)
    }
  }

  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach(handler => {
      try {
        handler(connected)
      } catch (error) {
        console.error('[WebSocket] Connection handler error:', error)
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached')
      return
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Backend /ws/news expects plain-text "ping"
        this.ws.send('ping')
      }
    }, 25000) // Send ping every 25 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}

// ── Live viewer count (external store for useSyncExternalStore) ──
let _viewerCount = 0
const _viewerListeners = new Set<() => void>()

export function _setViewerCount(count: number) {
  if (count === _viewerCount) return
  _viewerCount = count
  _viewerListeners.forEach(l => l())
}

export function subscribeViewerCount(cb: () => void) {
  _viewerListeners.add(cb)
  return () => { _viewerListeners.delete(cb) }
}

export function getViewerCountSnapshot() { return _viewerCount }
export function getViewerCountServerSnapshot() { return 0 }

// Singleton instance
let wsInstance: OSINTWebSocket | null = null

export function getWebSocket(): OSINTWebSocket {
  if (!wsInstance) {
    wsInstance = new OSINTWebSocket()
  }
  return wsInstance
}

export function connectWebSocket(): OSINTWebSocket {
  const ws = getWebSocket()
  ws.connect()
  return ws
}

export function disconnectWebSocket(): void {
  if (wsInstance) {
    wsInstance.disconnect()
    wsInstance = null
  }
}
