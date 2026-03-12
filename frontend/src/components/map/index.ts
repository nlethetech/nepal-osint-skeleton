/**
 * Map Components Index
 * Phase 3: Advanced Geospatial Features
 */

// Layer management
export { LayerControlPanel } from './LayerControlPanel'

// Drawing and analysis tools
export { DrawingToolsPanel } from './DrawingToolsPanel'

// Temporal analysis
export { TemporalPlaybackPanel } from './TemporalPlaybackPanel'

// Report generation
export { ReportGenerationPanel } from './ReportGenerationPanel'

// Core map components
export { NepalDistrictMap } from './NepalDistrictMap'
export { HeatmapLayer } from './HeatmapLayer'
export { ClusteredMapLayer } from './ClusteredMapLayer'
export { EventMarkersLayer } from './EventMarkersLayer'
export { DistrictPolygonsLayer } from './DistrictPolygonsLayer'
export { ProvinceBorderLayer } from './ProvinceBorderLayer'
export { CapitalMarkersLayer } from './CapitalMarkersLayer'
export { SatelliteLayer } from './SatelliteLayer'
export { SatelliteImageryPanel } from './SatelliteImageryPanel'
export { HotspotLayer } from './HotspotLayer'
export { ProximityCircle } from './ProximityCircle'
export { CurfewOverlay } from './CurfewOverlay'
export { AnnouncementMarkersLayer } from './AnnouncementMarkersLayer'

// UI overlays
export { MapLegend } from './MapLegend'
export { MapFilterPanel } from './MapFilterPanel'
export { ScaleBar } from './ScaleBar'
export { TimelineSlider } from './TimelineSlider'
export { LiveAlertBanner } from './LiveAlertBanner'
export { LiveEventTimeline } from './LiveEventTimeline'

// Sidebars
export { EventDetailSidebar } from './EventDetailSidebar'
export { DistrictInfoPanel } from './DistrictInfoPanel'
export { ClusterTimelineSidebar } from './ClusterTimelineSidebar'

// Live maps
export { LiveUAMap } from './LiveUAMap'

// Icons and marker utilities
export {
  createEventMarkerIcon,
  createClusterIcon,
  createClusterIconFunction,
  injectMarkerStyles,
  CATEGORY_CONFIG,
  type IntelligenceCategory,
  type EventSeverity,
  type MarkerSize,
  type EventMarkerIconOptions,
  type ClusterIconOptions,
} from './EventMarkerIcons'
