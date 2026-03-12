/**
 * Geospatial API client - Drawing, Temporal, Reports, Layers
 */
import axios from 'axios';
import apiClient from './client';
import { useAuthStore } from '../store/slices/authSlice';

// ============================================================================
// Types
// ============================================================================

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Coordinate[][];
}

// Layer Types
export interface LayerConfig {
  id: string;
  name: string;
  type?: string;
  url?: string;
  attribution?: string;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  source?: string;
  style?: Record<string, unknown>;
  category?: string;
}

export interface LayerConfigResponse {
  baseLayers: LayerConfig[];
  overlayLayers: LayerConfig[];
  dataLayers: LayerConfig[];
}

// Drawing Types
export interface AnalyzeRegionRequest {
  geometry: PolygonGeometry;
  analysis_types: string[];
  before_date?: string;
  after_date?: string;
}

export interface AnalysisResult {
  analysis_type: string;
  status: string;
  result_id: string;
}

export interface RegionAnalysisResponse {
  region_id: string;
  area_km2: number;
  centroid: Coordinate;
  analyses: AnalysisResult[];
}

export interface RegionAnalysisResult {
  region_id: string;
  analysis_type: string;
  status: string;
  stats?: Record<string, unknown>;
  tile_url?: string;
  generated_at?: string;
  error?: string;
}

export interface SaveRegionRequest {
  name: string;
  description?: string;
  geometry: PolygonGeometry;
  tags: string[];
  is_public: boolean;
}

export interface SavedRegion {
  id: string;
  name: string;
  description?: string;
  geometry: PolygonGeometry;
  tags: string[];
  area_km2: number;
  centroid: Coordinate;
  created_at: string;
  created_by?: string;
  is_public: boolean;
}

export interface MeasurementRequest {
  measurement_type: 'distance' | 'area' | 'elevation';
  coordinates: Coordinate[];
}

export interface MeasurementResult {
  measurement_type: string;
  value: number;
  unit: string;
  points: Coordinate[];
  metadata?: {
    segments?: number;
    perimeter_km?: number;
    vertices?: number;
    min_elevation?: number;
    max_elevation?: number;
    elevation_profile?: number[];
    total_distance_km?: number;
  };
}

// Temporal Types
export interface TemporalFrameRequest {
  bbox: BoundingBox;
  layer_type: string;
  start_date: string;
  end_date: string;
  interval: 'hour' | 'day' | 'week' | 'month';
  max_frames?: number;
}

export interface TemporalFrame {
  frame_index: number;
  timestamp: string;
  tile_url: string;
  thumbnail_url?: string;
  stats?: Record<string, unknown>;
}

export interface TemporalSequence {
  sequence_id: string;
  layer_type: string;
  bbox: BoundingBox;
  start_date: string;
  end_date: string;
  interval: string;
  frames: TemporalFrame[];
  total_frames: number;
}

export interface ComparisonRequest {
  bbox: BoundingBox;
  layer_type: string;
  before_date: string;
  after_date: string;
  comparison_type: 'swipe' | 'difference' | 'overlay';
}

export interface ComparisonResult {
  comparison_id: string;
  layer_type: string;
  before_date: string;
  after_date: string;
  comparison_type: string;
  before_tile_url: string;
  after_tile_url: string;
  difference_tile_url?: string;
  stats?: {
    before_mean?: number;
    after_mean?: number;
    change_percent?: number;
    affected_area_km2?: number;
    days_between?: number;
  };
}

export interface AvailableDate {
  date: string;
  cloud_cover: number;
  quality: 'good' | 'moderate';
}

export interface EventBucket {
  bucket_start: string;
  bucket_end: string;
  event_count: number;
  severity_breakdown: Record<string, number>;
  category_breakdown: Record<string, number>;
  sample_events: unknown[];
}

export interface TemporalEventsResponse {
  start_date: string;
  end_date: string;
  interval: string;
  total_events: number;
  buckets: EventBucket[];
}

// Report Types
export type ReportFormat = 'pdf' | 'png' | 'csv' | 'json';
export type ReportType =
  | 'situational'
  | 'entity_dossier'
  | 'damage_assessment'
  | 'threat_matrix'
  | 'case_summary'
  | 'network_analysis';
export type ReportStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ReportRequest {
  report_type: ReportType;
  format?: ReportFormat;
  title?: string;
  description?: string;
  hours?: number;
  categories?: string[];
  severities?: string[];
  districts?: string[];
  entity_id?: string;
  case_id?: string;
  include_map?: boolean;
  map_bbox?: BoundingBox;
  map_layers?: string[];
  include_stories?: boolean;
  include_entities?: boolean;
  include_charts?: boolean;
  include_summary?: boolean;
  max_stories?: number;
}

export interface ReportMetadata {
  id: string;
  report_type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  title: string;
  created_at: string;
  completed_at?: string;
  file_path?: string;
  file_size?: number;
  download_url?: string;
  error?: string;
  request_params: Record<string, unknown>;
}

export interface ReportListResponse {
  reports: ReportMetadata[];
  total: number;
}

// ============================================================================
// Layer API
// ============================================================================

export const layerApi = {
  getConfig: async (): Promise<LayerConfigResponse> => {
    const response = await apiClient.get(`/layers/config`);
    return response.data;
  },
};

// ============================================================================
// Drawing API
// ============================================================================

export const drawingApi = {
  analyzeRegion: async (request: AnalyzeRegionRequest): Promise<RegionAnalysisResponse> => {
    const response = await apiClient.post(`/drawing/analyze-region`, request);
    return response.data;
  },

  getAnalysisResult: async (resultId: string): Promise<RegionAnalysisResult> => {
    const response = await apiClient.get(`/drawing/analyze-region/${resultId}`);
    return response.data;
  },

  saveRegion: async (request: SaveRegionRequest): Promise<SavedRegion> => {
    const response = await apiClient.post(`/drawing/save-region`, request);
    return response.data;
  },

  listSavedRegions: async (tags?: string, limit = 50): Promise<SavedRegion[]> => {
    const params = new URLSearchParams();
    if (tags) params.append('tags', tags);
    params.append('limit', limit.toString());
    const response = await apiClient.get(`/drawing/saved-regions?${params}`);
    return response.data;
  },

  getSavedRegion: async (regionId: string): Promise<SavedRegion> => {
    const response = await apiClient.get(`/drawing/saved-regions/${regionId}`);
    return response.data;
  },

  deleteSavedRegion: async (regionId: string): Promise<void> => {
    await apiClient.delete(`/drawing/saved-regions/${regionId}`);
  },

  calculateMeasurement: async (request: MeasurementRequest): Promise<MeasurementResult> => {
    const response = await apiClient.post(`/drawing/measurements/calculate`, request);
    return response.data;
  },
};

// ============================================================================
// Temporal API
// ============================================================================

export const temporalApi = {
  generateFrames: async (request: TemporalFrameRequest): Promise<TemporalSequence> => {
    const response = await apiClient.post(`/temporal/generate-frames`, request);
    return response.data;
  },

  getEvents: async (
    startDate: string,
    endDate: string,
    interval = 'day',
    category?: string,
    severity?: string,
    district?: string
  ): Promise<TemporalEventsResponse> => {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      interval,
    });
    if (category) params.append('category', category);
    if (severity) params.append('severity', severity);
    if (district) params.append('district', district);
    const response = await apiClient.get(`/temporal/events?${params}`);
    return response.data;
  },

  generateComparison: async (request: ComparisonRequest): Promise<ComparisonResult> => {
    const response = await apiClient.post(`/temporal/comparison/generate`, request);
    return response.data;
  },

  getAvailableDates: async (
    layerType: string,
    bbox?: string,
    startDate?: string,
    endDate?: string
  ): Promise<{ layer_type: string; available_dates: AvailableDate[]; total: number }> => {
    const params = new URLSearchParams({ layer_type: layerType });
    if (bbox) params.append('bbox', bbox);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const response = await apiClient.get(`/temporal/available-dates?${params}`);
    return response.data;
  },
};

// ============================================================================
// Reports API
// ============================================================================

export const reportsApi = {
  generate: async (request: ReportRequest): Promise<ReportMetadata> => {
    const response = await apiClient.post(`/reports/generate`, request);
    return response.data;
  },

  getStatus: async (reportId: string): Promise<ReportMetadata> => {
    const response = await apiClient.get(`/reports/${reportId}/status`);
    return response.data;
  },

  download: async (reportId: string): Promise<unknown> => {
    const response = await apiClient.get(`/reports/${reportId}/download`);
    return response.data;
  },

  list: async (
    status?: ReportStatus,
    reportType?: ReportType,
    limit = 50
  ): Promise<ReportListResponse> => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (reportType) params.append('report_type', reportType);
    params.append('limit', limit.toString());
    const response = await apiClient.get(`/reports?${params}`);
    return response.data;
  },

  delete: async (reportId: string): Promise<void> => {
    await apiClient.delete(`/reports/${reportId}`);
  },

  // Quick exports
  quickThreatMatrix: async (
    hours = 24,
    format: 'json' | 'csv' = 'json'
  ): Promise<unknown> => {
    const response = await apiClient.get(`/reports/quick/threat-matrix?hours=${hours}&format=${format}`);
    return response.data;
  },

  quickEntityList: async (
    hours = 24,
    limit = 50,
    format: 'json' | 'csv' = 'json'
  ): Promise<unknown> => {
    const response = await apiClient.get(`/reports/quick/entity-list?hours=${hours}&limit=${limit}&format=${format}`);
    return response.data;
  },
};

// ============================================================================
// WebSocket Stats API
// ============================================================================

export const wsStatsApi = {
  getMapStats: async (): Promise<{
    active_connections: number;
    clients: {
      client_id: string;
      connected_at: string;
      subscriptions: string[];
    }[];
  }> => {
    const token = useAuthStore.getState().token
    const apiBase = import.meta.env.VITE_API_URL || ''
    const response = await axios.get(`${apiBase}/ws/map/stats`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  },
};
