/**
 * WebSocket hook for real-time map overlay updates
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/slices/authSlice';

interface Coordinate {
  lat: number;
  lng: number;
}

interface RiverAlertData {
  id: string;
  station_id: string;
  station_name: string;
  district: string;
  coordinates: Coordinate;
  water_level: number;
  alert_level: 'normal' | 'warning' | 'danger' | 'extreme';
  trend: 'rising' | 'stable' | 'falling';
  message: string;
}

interface CurfewUpdateData {
  id: string;
  district: string;
  status: 'active' | 'ended' | 'extended';
  polygon: [number, number][];
  start_time: string;
  end_time: string;
  reason: string;
}

interface IncidentMarkerData {
  id: string;
  title: string;
  category: string;
  severity: string;
  coordinates: Coordinate;
  district: string;
  source: string;
  story_id?: string;
  animate: boolean;
}

interface SeismicEventData {
  id: string;
  magnitude: number;
  depth_km: number;
  coordinates: Coordinate;
  location: string;
  event_time: string;
  animate: boolean;
}

type EventType = 'river_alert' | 'curfew_update' | 'incident_marker' | 'seismic_event';

interface WebSocketMessage {
  type: EventType | 'connected' | 'subscribed' | 'unsubscribed' | 'pong' | 'error';
  timestamp: string;
  data?: RiverAlertData | CurfewUpdateData | IncidentMarkerData | SeismicEventData | {
    client_id?: string;
    message?: string;
    event_types?: string[];
    available_subscriptions?: string[];
  };
}

interface UseMapWebSocketOptions {
  autoConnect?: boolean;
  subscriptions?: EventType[];
  onRiverAlert?: (data: RiverAlertData) => void;
  onCurfewUpdate?: (data: CurfewUpdateData) => void;
  onIncidentMarker?: (data: IncidentMarkerData) => void;
  onSeismicEvent?: (data: SeismicEventData) => void;
  onConnected?: (clientId: string) => void;
  onError?: (message: string) => void;
}

interface UseMapWebSocketReturn {
  isConnected: boolean;
  clientId: string | null;
  connect: () => void;
  disconnect: () => void;
  subscribe: (eventTypes: EventType[]) => void;
  unsubscribe: (eventTypes: EventType[]) => void;
  ping: () => void;
  recentEvents: WebSocketMessage[];
}

function getMapWebSocketUrl(): string {
  const token = useAuthStore.getState().token
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : ''
  const base = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/map`
  return `${base}${tokenParam}`
}

export function useMapWebSocket(options: UseMapWebSocketOptions = {}): UseMapWebSocketReturn {
  const {
    autoConnect = false,
    subscriptions = [],
    onRiverAlert,
    onCurfewUpdate,
    onIncidentMarker,
    onSeismicEvent,
    onConnected,
    onError,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<WebSocketMessage[]>([]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      wsRef.current = new WebSocket(getMapWebSocketUrl());

      wsRef.current.onopen = () => {
        setIsConnected(true);

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          // Add to recent events (keep last 50)
          setRecentEvents((prev) => [message, ...prev].slice(0, 50));

          switch (message.type) {
            case 'connected':
              const connData = message.data as { client_id?: string };
              if (connData?.client_id) {
                setClientId(connData.client_id);
                onConnected?.(connData.client_id);
              }
              // Auto-subscribe if subscriptions provided
              if (subscriptions.length > 0 && wsRef.current) {
                wsRef.current.send(
                  JSON.stringify({ type: 'subscribe', event_types: subscriptions })
                );
              }
              break;

            case 'river_alert':
              onRiverAlert?.(message.data as RiverAlertData);
              break;

            case 'curfew_update':
              onCurfewUpdate?.(message.data as CurfewUpdateData);
              break;

            case 'incident_marker':
              onIncidentMarker?.(message.data as IncidentMarkerData);
              break;

            case 'seismic_event':
              onSeismicEvent?.(message.data as SeismicEventData);
              break;

            case 'error':
              const errData = message.data as { message?: string };
              onError?.(errData?.message || 'Unknown WebSocket error');
              break;

            default:
              // subscribed, unsubscribed, pong - no special handling needed
              break;
          }
        } catch (error) {
          console.error('[MapWS] Failed to parse message:', error);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        setClientId(null);

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Auto-reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (autoConnect) {
            connect();
          }
        }, 5000);
      };

      wsRef.current.onerror = (error) => {
        console.error('[MapWS] Error:', error);
        onError?.('WebSocket connection error');
      };
    } catch (error) {
      console.error('[MapWS] Failed to connect:', error);
      onError?.('Failed to establish WebSocket connection');
    }
  }, [autoConnect, subscriptions, onConnected, onRiverAlert, onCurfewUpdate, onIncidentMarker, onSeismicEvent, onError]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setClientId(null);
  }, []);

  // Subscribe to event types
  const subscribe = useCallback((eventTypes: EventType[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', event_types: eventTypes }));
    }
  }, []);

  // Unsubscribe from event types
  const unsubscribe = useCallback((eventTypes: EventType[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', event_types: eventTypes }));
    }
  }, []);

  // Send ping
  const ping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    }
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected,
    clientId,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    ping,
    recentEvents,
  };
}

// Export types for consumers
export type {
  RiverAlertData,
  CurfewUpdateData,
  IncidentMarkerData,
  SeismicEventData,
  EventType,
  WebSocketMessage,
};
