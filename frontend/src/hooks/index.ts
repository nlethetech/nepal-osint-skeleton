// Public hooks — Nepal OSINT Skeleton
export { useDebounce } from './useDebounce'
export { usePagination } from './usePagination'
export { useRealtime, useChannel, useEntityUpdates, useDistrictUpdates, useAlerts, useFeed } from './useRealtime'
export { useNewsFeed } from './useNewsFeed'
export type { NewsItem } from './useNewsFeed'

// Map WebSocket (Real-time map overlays)
export {
  useMapWebSocket,
  type RiverAlertData,
  type CurfewUpdateData,
  type IncidentMarkerData,
  type SeismicEventData,
  type EventType as MapEventType,
  type WebSocketMessage as MapWebSocketMessage,
} from './useMapWebSocket'
