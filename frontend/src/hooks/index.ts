export { useDebounce } from './useDebounce'
export { usePagination } from './usePagination'
export { useRealtime, useChannel, useEntityUpdates, useDistrictUpdates, useAlerts, useFeed } from './useRealtime'
export { useNewsFeed } from './useNewsFeed'
export type { NewsItem } from './useNewsFeed'
export { useHotspots, useProximity, useTemporalSpatial, spatialKeys } from './useSpatialAnalysis'

// Earth Engine (Satellite Imagery)
export {
  useGEEStatus,
  useNDVI,
  usePrecipitation,
  useTemperature,
  useFloodAnalysis,
  useLandslideDetection,
  useBeforeAfter,
  useChangeAlerts,
  useSubscribeChangeDetection,
  useUnsubscribeChangeDetection,
  useTriggerChangeDetection,
  useEnvironmentalAnalysis,
  earthEngineKeys,
} from './useEarthEngine'

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
