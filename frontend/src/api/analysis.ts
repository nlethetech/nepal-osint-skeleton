/**
 * Nepal OSINT Platform - ML Analysis API Client
 * Provides NER, event extraction, scoring, clustering, anomaly detection
 */
import apiClient from './client'

// Types
export interface TextAnalysisRequest {
  text: string
  language?: 'en' | 'ne' | 'auto'
}

export interface ExtractedEntity {
  text: string
  entity_type: string
  start: number
  end: number
  confidence: number
}

export interface NERResponse {
  entities: ExtractedEntity[]
  language_detected: string
  processing_time_ms: number
}

export interface EventFrame {
  event_type: string
  what_happened: string
  who_involved: string[]
  where_location: string | null
  when_time: string | null
  why_cause: string | null
  severity: string
  confidence: number
}

export interface EventExtractionResponse {
  events: EventFrame[]
  processing_time_ms: number
}

export interface ImpactScore {
  overall_score: number
  priority: string
  dimensions: {
    economic: number
    security: number
    social: number
    diplomatic: number
    disaster: number
    political: number
  }
  scoring_factors: string[]
}

export interface ImpactScoringResponse {
  score: ImpactScore
  processing_time_ms: number
}

export interface PipelineRequest {
  text: string
  run_ner?: boolean
  run_events?: boolean
  run_scoring?: boolean
}

export interface PipelineResponse {
  entities: ExtractedEntity[] | null
  events: EventFrame[] | null
  impact_score: ImpactScore | null
  processing_time_ms: number
}

export interface ClusterInfo {
  cluster_id: string
  document_count: number
  keywords: string[]
  trend: string
  first_seen: string
  last_seen: string
}

export interface ClusteringResponse {
  clusters: ClusterInfo[]
  total_documents: number
}

export interface AnomalyAlert {
  metric: string
  severity: string
  value: number
  baseline: number
  deviation: number
  timestamp: string
}

export interface AnomalyResponse {
  anomalies: AnomalyAlert[]
  metrics_analyzed: number
}

export interface MLStatus {
  core_available: boolean
  components: {
    entity_extractor: boolean
    event_extractor: boolean
    story_clusterer: boolean
    impact_scorer: boolean
    anomaly_detector: boolean
  }
  supported_languages: string[]
  supported_entity_types: string[]
  supported_event_types: string[]
}

// LLM-Powered Analysis Types (Palantir-grade)
export interface LLMAnalyzeRequest {
  text: string
  title?: string
  include_threats?: boolean
  include_brief?: boolean
}

export interface LLMEntity {
  name: string
  type: string
  role: string
  context: string
}

export interface LLMEvent {
  type: string
  description: string
  who: string[]
  what: string
  when: string
  where: string
  severity: string
  confidence: number
  // ENHANCED: Admiralty and corroboration
  admiralty_rating?: string  // e.g., "B2"
  corroboration_status?: string  // confirmed, probable, etc.
  supporting_sources?: number
}

export interface ThreatDimension {
  level: string
  indicators: string[]
  trend: string
  monitoring?: string[]
}

export interface ThreatAssessment {
  overall_threat_level: string
  assessment_date: string
  dimensions: {
    disaster: ThreatDimension
    political: ThreatDimension
    security: ThreatDimension
    economic: ThreatDimension
    social: ThreatDimension
  }
  priority_alerts: Array<{
    dimension: string
    description: string
    urgency: string
  }>
  recommended_actions: Array<{
    action: string
    dimension: string
    urgency: string
  }>
}

// ENHANCED: Admiralty rating details
export interface AdmiraltyRatingDetails {
  combined_rating: string  // e.g., "B2"
  source_reliability: string  // A-F
  source_reliability_desc: string
  information_accuracy: string  // 1-6
  information_accuracy_desc: string
  confidence_score: number
  confidence_level: string
  is_actionable: boolean
  requires_verification: boolean
  rationale: string
}

export interface LLMAnalyzeResponse {
  success: boolean
  story_type: string | null
  confidence: number
  entities: LLMEntity[]
  events: LLMEvent[]
  keywords: string[]
  themes: string[]
  threat_assessment: ThreatAssessment | null
  intelligence_brief: string | null
  summary: string | null

  // ENHANCED: Ensemble voting metadata
  ensemble_used?: boolean
  models_participated?: string[]
  agreement_score?: number
  voting_strategy?: string

  // ENHANCED: NATO Admiralty confidence rating
  admiralty_rating?: string  // e.g., "B2"
  admiralty_details?: AdmiraltyRatingDetails

  // ENHANCED: Deception detection (social media)
  deception_score?: number
  credibility_level?: string
  deception_red_flags?: string[]

  // ENHANCED: Corroboration status
  corroboration_status?: string
  supporting_sources?: number
  contradicting_sources?: number
}

export interface LLMStatus {
  available: boolean
  model: string
  ollama_running: boolean
  message: string
}

// API Functions
export const analysisApi = {
  /**
   * Extract named entities from text
   */
  extractEntities: async (request: TextAnalysisRequest): Promise<NERResponse> => {
    const response = await apiClient.post<NERResponse>('/analysis/ner', request)
    return response.data
  },

  /**
   * Extract structured events from text
   */
  extractEvents: async (request: TextAnalysisRequest): Promise<EventExtractionResponse> => {
    const response = await apiClient.post<EventExtractionResponse>('/analysis/events', request)
    return response.data
  },

  /**
   * Score impact/importance of content
   */
  scoreImpact: async (request: TextAnalysisRequest): Promise<ImpactScoringResponse> => {
    const response = await apiClient.post<ImpactScoringResponse>('/analysis/score', request)
    return response.data
  },

  /**
   * Run full ML pipeline on text
   */
  runPipeline: async (request: PipelineRequest): Promise<PipelineResponse> => {
    const response = await apiClient.post<PipelineResponse>('/analysis/pipeline', request)
    return response.data
  },

  /**
   * Get story clusters
   */
  getClusters: async (windowHours: number = 72): Promise<ClusteringResponse> => {
    const response = await apiClient.get<ClusteringResponse>('/analysis/clusters', {
      params: { window_hours: windowHours }
    })
    return response.data
  },

  /**
   * Get detected anomalies
   */
  getAnomalies: async (windowHours: number = 24): Promise<AnomalyResponse> => {
    const response = await apiClient.get<AnomalyResponse>('/analysis/anomalies', {
      params: { window_hours: windowHours }
    })
    return response.data
  },

  /**
   * Get ML pipeline status
   */
  getStatus: async (): Promise<MLStatus> => {
    const response = await apiClient.get<MLStatus>('/analysis/status')
    return response.data
  },

  // ==========================================================================
  // LLM-Powered Analysis (Palantir-grade with Ollama)
  // ==========================================================================

  /**
   * Get LLM status (Ollama availability)
   */
  getLLMStatus: async (): Promise<LLMStatus> => {
    const response = await apiClient.get<LLMStatus>('/intel-stories/llm/status')
    return response.data
  },

  /**
   * Run LLM-powered intelligence analysis
   * This provides Palantir-grade analysis with:
   * - Smart entity extraction (people, orgs, locations)
   * - Event extraction with 5W1H framework
   * - Story classification
   * - Threat assessment
   * - Optional intelligence brief
   */
  runLLMAnalysis: async (request: LLMAnalyzeRequest): Promise<LLMAnalyzeResponse> => {
    const response = await apiClient.post<LLMAnalyzeResponse>('/intel-stories/llm/analyze', request)
    return response.data
  }
}

export default analysisApi
