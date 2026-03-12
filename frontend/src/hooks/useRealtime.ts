/**
 * React Hook for Real-Time WebSocket Updates
 *
 * Manages WebSocket connection lifecycle and provides
 * easy access to real-time data streams.
 */

import { useEffect, useCallback, useRef } from 'react'
import {
  getWebSocket,
  WebSocketChannel,
  MessageHandler,
} from '../api/websocket'
import {
  useRealtimeStore,
  type ConsolidatedIntel,
  type ThreatMatrixUpdate,
  type EntityUpdate,
} from '../store/realtimeSlice'

/**
 * Hook to manage WebSocket connection and subscriptions
 */
export function useRealtime() {
  const {
    isConnected,
    setConnected,
    addAlert,
    upsertConsolidatedIntel,
    updateThreatMatrix,
    updateEntityMentions,
  } = useRealtimeStore()

  const wsRef = useRef(getWebSocket())

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    const ws = wsRef.current

    // Handle connection state changes
    const unsubConnection = ws.onConnectionChange((connected) => {
      setConnected(connected)
    })

    // Handle feed messages (new stories and consolidated intelligence)
    const unsubFeed = ws.onMessage('feed', (message) => {
      if (message.event_type === 'consolidated_intelligence') {
        // Consolidated intelligence - single source of truth for feed rendering
        const intel = message.data as unknown as ConsolidatedIntel
        upsertConsolidatedIntel(intel)
      } else if (message.event_type === 'new_story' || message.event_type === 'new_item') {
        // Raw story messages are intentionally ignored; feed renders consolidated items only.
      }
    })

    // Handle alert messages (including threat matrix updates)
    const unsubAlerts = ws.onMessage('alerts', (message) => {
      if (message.event_type === 'alert') {
        addAlert(message.data as Record<string, unknown>)
      } else if (message.event_type === 'threat_matrix_update') {
        // Update threat matrix with new story classification
        const update = message.data as unknown as ThreatMatrixUpdate
        updateThreatMatrix(update)
      }
    })

    // Handle entity messages (for Key Actors panel)
    const unsubEntities = ws.onMessage('entities', (message) => {
      if (message.event_type === 'entities_extracted') {
        // Update entity mention counts
        const update = message.data as unknown as EntityUpdate
        updateEntityMentions(update)
      }
    })

    // Connect if not already connected
    if (!ws.isConnected()) {
      ws.connect()
    }

    return () => {
      unsubConnection()
      unsubFeed()
      unsubAlerts()
      unsubEntities()
    }
  }, [setConnected, addAlert, upsertConsolidatedIntel, updateThreatMatrix, updateEntityMentions])

  // Subscribe to a channel
  const subscribe = useCallback((channel: WebSocketChannel, targetId?: string) => {
    wsRef.current.subscribe(channel, targetId)
  }, [])

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channel: WebSocketChannel, targetId?: string) => {
    wsRef.current.unsubscribe(channel, targetId)
  }, [])

  return {
    isConnected,
    subscribe,
    unsubscribe,
  }
}

/**
 * Hook to subscribe to a specific channel with a custom handler
 */
export function useChannel(
  channel: WebSocketChannel,
  handler: MessageHandler,
  targetId?: string
) {
  const wsRef = useRef(getWebSocket())

  useEffect(() => {
    const ws = wsRef.current

    // Subscribe to the channel
    if (ws.isConnected()) {
      ws.subscribe(channel, targetId)
    }

    // Add message handler
    const unsubMessage = ws.onMessage(channel, handler)

    // Re-subscribe when connection is restored
    const unsubConnection = ws.onConnectionChange((connected) => {
      if (connected) {
        ws.subscribe(channel, targetId)
      }
    })

    return () => {
      unsubMessage()
      unsubConnection()
      if (ws.isConnected()) {
        ws.unsubscribe(channel, targetId)
      }
    }
  }, [channel, handler, targetId])
}

/**
 * Hook for entity-specific updates
 */
export function useEntityUpdates(entityId: string, handler: MessageHandler) {
  useChannel('entities', handler, entityId)
}

/**
 * Hook for district-specific updates
 */
export function useDistrictUpdates(districtName: string, handler: MessageHandler) {
  useChannel('districts', handler, districtName)
}

/**
 * Hook for alert updates
 */
export function useAlerts(handler: MessageHandler) {
  useChannel('alerts', handler)
}

/**
 * Hook for feed updates (new stories)
 */
export function useFeed(handler: MessageHandler) {
  useChannel('feed', handler)
}
