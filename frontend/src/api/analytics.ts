import apiClient from './client'
import type { AnalyticsSummary, DistrictStress, EventTrend } from '../types/api'

export interface AnalyticsParams {
  fromDate?: string
  toDate?: string
}

// District Metrics Types
export interface DistrictMetrics {
  district: string
  province: string
  communal_tension_score: number
  economic_health_score: number
  violent_crime_score: number
  political_stability_score: number
  overall_stability_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  communal_trend: string
  economic_trend: string
  crime_trend: string
  overall_trend: string
  total_events_7d: number
  last_computed_at?: string
}

export interface CrimeStats {
  district: string
  total_incidents: number
  murders: number
  assaults: number
  robberies: number
  other_crimes: number
  fatalities: number
  injuries: number
  trend: string
}

export interface CommunalStats {
  district: string
  total_incidents: number
  religious_conflicts: number
  ethnic_conflicts: number
  caste_discrimination: number
  riots: number
  fatalities: number
  property_damage_count: number
  tension_level: string
}

export interface EconomicStats {
  district: string
  total_indicators: number
  positive_count: number
  negative_count: number
  neutral_count: number
  sentiment_score: number
  top_sectors: string[]
  health_level: string
}

export interface NationalSummary {
  avg_communal_tension: number
  avg_economic_health: number
  avg_violent_crime: number
  avg_stability: number
  total_stories_24h: number
  total_events_24h: number
  murders_24h: number
  violent_crimes_24h: number
  high_risk_districts: string[]
  critical_districts: string[]
  province_scores: Record<string, {
    stability: number
    crime: number
    communal: number
  }>
}

export interface ProvinceMetrics {
  province: string
  avg_communal_tension: number
  avg_economic_health: number
  avg_violent_crime: number
  avg_stability: number
  district_count: number
  high_risk_count: number
}

// Existing endpoints
export const getAnalyticsSummary = async (hours: number = 72, districts?: string[]): Promise<AnalyticsSummary> => {
  const response = await apiClient.get('/analytics/summary', {
    params: { hours, districts: districts?.join(',') || undefined },
  })
  return response.data
}

export const getYouthStress = async (params?: AnalyticsParams): Promise<DistrictStress[]> => {
  const response = await apiClient.get('/analytics/youth-stress', {
    params: {
      from_date: params?.fromDate,
      to_date: params?.toDate,
    },
  })
  return response.data
}

export const getTrends = async (days: number = 30, eventType?: string): Promise<EventTrend[]> => {
  const response = await apiClient.get('/analytics/trends', {
    params: {
      days,
      event_type: eventType,
    },
  })
  return response.data
}

// New metrics endpoints
export const getNationalMetrics = async (): Promise<NationalSummary> => {
  const response = await apiClient.get('/analytics/national')
  return response.data
}

export const getDistrictMetrics = async (
  province?: string,
  riskLevel?: string
): Promise<DistrictMetrics[]> => {
  const response = await apiClient.get('/analytics/districts', {
    params: { province, risk_level: riskLevel },
  })
  return response.data
}

export const getDistrictDetail = async (districtName: string): Promise<DistrictMetrics> => {
  const response = await apiClient.get(`/analytics/districts/${districtName}`)
  return response.data
}

export const getCrimeStats = async (days: number = 7, district?: string): Promise<CrimeStats[]> => {
  const response = await apiClient.get('/analytics/crime/stats', {
    params: { days, district },
  })
  return response.data
}

export const getDailyCrimeData = async (
  days: number = 30,
  crimeType?: string
): Promise<Array<{ date: string; crime_type: string; count: number; fatalities: number }>> => {
  const response = await apiClient.get('/analytics/crime/daily', {
    params: { days, crime_type: crimeType },
  })
  return response.data
}

export interface CrimeIncidentWithStory {
  id: string
  crime_type: string
  district: string
  fatalities: number
  injuries: number
  confidence: number
  occurred_at?: string
  extracted_text?: string
  story_id: string
  story_title: string
  story_url?: string
  story_source?: string
  story_published_at?: string
}

export const getCrimeIncidents = async (
  days: number = 7,
  crimeType?: string,
  district?: string,
  limit: number = 50
): Promise<CrimeIncidentWithStory[]> => {
  const response = await apiClient.get('/analytics/crime/incidents', {
    params: { days, crime_type: crimeType, district, limit },
  })
  return response.data
}

export const getCommunalStats = async (
  days: number = 7,
  district?: string
): Promise<CommunalStats[]> => {
  const response = await apiClient.get('/analytics/communal/stats', {
    params: { days, district },
  })
  return response.data
}

export const getEconomicStats = async (
  days: number = 7,
  district?: string
): Promise<EconomicStats[]> => {
  const response = await apiClient.get('/analytics/economic/stats', {
    params: { days, district },
  })
  return response.data
}

export const getProvinceMetrics = async (): Promise<ProvinceMetrics[]> => {
  const response = await apiClient.get('/analytics/provinces')
  return response.data
}


// ============================================================================
// KEY ACTORS (Palantir-grade Political Entity Intelligence)
// ============================================================================

export interface StoryBrief {
  id: string
  title: string
  source_name?: string
  published_at?: string
  url: string
}

export interface KeyActor {
  entity_id: string
  canonical_id: string
  name: string
  name_ne?: string
  entity_type: 'person' | 'party' | 'organization' | 'institution'
  party?: string
  role?: string
  image_url?: string
  mention_count: number
  mention_count_24h: number
  mention_count_7d?: number
  trend: 'rising' | 'stable' | 'falling'
  last_mentioned_at?: string
  top_stories: StoryBrief[]
  // Legacy fields for backward compatibility
  is_key_actor?: boolean
  last_activity?: string
  co_occurring_entities?: Array<{
    name: string
    type: string
    count: number
  }>
}

export const getKeyActors = async (
  hours: number = 24,
  entityType?: string,
  limit: number = 10,
  includeStories: boolean = true
): Promise<KeyActor[]> => {
  const response = await apiClient.get('/analytics/key-actors', {
    params: {
      hours,
      entity_type: entityType,
      limit,
      include_stories: includeStories,
    },
  })
  return response.data
}

export const getKeyActorDetail = async (entityId: string): Promise<KeyActor> => {
  const response = await apiClient.get(`/analytics/key-actors/${entityId}`)
  return response.data
}


// ============================================================================
// POLITICAL ENTITIES API (Full Entity CRUD)
// ============================================================================

export interface PoliticalEntity {
  id: string
  canonical_id: string
  name_en: string
  name_ne?: string
  entity_type: 'person' | 'party' | 'organization' | 'institution'
  party?: string
  role?: string
  description?: string
  image_url?: string
  aliases?: string[]
  total_mentions: number
  mentions_24h: number
  mentions_7d: number
  trend: 'rising' | 'stable' | 'falling'
  last_mentioned_at?: string
  is_active: boolean
  is_watchable: boolean
  created_at: string
  updated_at: string
}

export interface EntityListResponse {
  entities: PoliticalEntity[]
  total: number
  limit: number
  offset: number
}

export interface EntityStoryItem {
  id: string
  title: string
  summary?: string
  url: string
  source_id: string
  source_name?: string
  category?: string
  severity?: string
  nepal_relevance?: string
  published_at?: string
  linked_at?: string
}

export interface EntityStoriesResponse {
  entity_id: string
  entity_name: string
  entity_name_ne?: string
  entity_type: string
  stories: EntityStoryItem[]
  total: number
  hours: number
  limit: number
  offset: number
}

export interface EntityTimelineItem {
  date: string
  count: number
}

export interface EntityTimelineResponse {
  entity_id: string
  entity_name: string
  days: number
  timeline: EntityTimelineItem[]
}

export const getPoliticalEntities = async (
  entityType?: string,
  search?: string,
  hasMentions: boolean = true,
  limit: number = 50,
  offset: number = 0
): Promise<EntityListResponse> => {
  const response = await apiClient.get('/entities', {
    params: {
      entity_type: entityType,
      search,
      has_mentions: hasMentions,
      limit,
      offset,
    },
  })
  return response.data
}

export const getPoliticalEntity = async (entityId: string): Promise<PoliticalEntity> => {
  const response = await apiClient.get(`/entities/${entityId}`)
  return response.data
}

export const getPoliticalEntityByCanonicalId = async (canonicalId: string): Promise<PoliticalEntity> => {
  const response = await apiClient.get(`/entities/by-canonical/${canonicalId}`)
  return response.data
}

export const getEntityStories = async (
  entityId: string,
  hours: number = 168,
  limit: number = 50,
  offset: number = 0,
  category?: string
): Promise<EntityStoriesResponse> => {
  const response = await apiClient.get(`/entities/${entityId}/stories`, {
    params: {
      hours,
      limit,
      offset,
      category,
    },
  })
  return response.data
}

export const getEntityTimeline = async (
  entityId: string,
  days: number = 30
): Promise<EntityTimelineResponse> => {
  const response = await apiClient.get(`/entities/${entityId}/timeline`, {
    params: { days },
  })
  return response.data
}


// ============================================================================
// THREAT MATRIX
// ============================================================================

export interface ThreatMatrixCell {
  category: string
  level: 'critical' | 'elevated' | 'guarded' | 'low'
  trend: 'escalating' | 'stable' | 'deescalating'
  event_count: number
  top_event?: string
  severity_breakdown: {
    critical: number
    high: number
    medium: number
    low: number
  }
}

export interface ThreatMatrix {
  matrix: ThreatMatrixCell[]
  overall_threat_level: string
  last_updated: string
}

export const getThreatMatrix = async (hours: number = 24, districts?: string[]): Promise<ThreatMatrix> => {
  const response = await apiClient.get('/analytics/threat-matrix', {
    params: { hours, districts: districts?.join(',') || undefined },
  })
  return response.data
}


// ============================================================================
// AI-ENHANCED THREAT MATRIX (Claude Haiku powered)
// ============================================================================

export interface CategoryInsight {
  narrative: string
  key_development: string
  watch_for: string
}

export interface ThreatMatrixAI extends ThreatMatrix {
  overall_assessment: string
  category_insights: Record<string, CategoryInsight>
  priority_watch_items: string[]
  escalation_risk: 'LOW' | 'MODERATE' | 'HIGH'
  ai_generated: boolean
}

/**
 * Get AI-enhanced threat matrix with Claude Haiku insights.
 * Cost: ~$0.001 per request (very cheap!)
 */
export const getThreatMatrixAI = async (hours: number = 24): Promise<ThreatMatrixAI> => {
  const response = await apiClient.get('/analytics/threat-matrix/ai', {
    params: { hours },
  })
  return response.data
}


// ============================================================================
// DISTRICT THREATS (for map)
// ============================================================================

export interface DistrictThreat {
  district: string
  lat: number
  lng: number
  threat_level: 'critical' | 'high' | 'medium' | 'low'
  critical_events: number
  high_events: number
  medium_events: number
  low_events: number
  total_events: number
  top_event_type?: string
  recent_events: Array<{
    id: string
    type: string
    severity: string
  }>
}

export const getDistrictThreats = async (hours: number = 24): Promise<DistrictThreat[]> => {
  const response = await apiClient.get('/analytics/district-threats', {
    params: { hours },
  })
  return response.data
}


// ============================================================================
// CONSOLIDATED INTELLIGENCE
// ============================================================================

export interface SourceLink {
  source_id: string
  url: string
  title?: string
}

export interface SourceProvenance {
  source_id: string
  url?: string
  title?: string
  reliability_grade: string  // A-F Admiralty scale
  access_method: string      // OSINT, Direct, Secondary
  is_first_report: boolean
}

export interface IntelligenceGaps {
  unanswered_questions: string[]
  collection_requirements: string[]
  watch_indicators: string[]
}

// =============================================================================
// MILITARY INTELLIGENCE INTERFACES
// Pre-computed during consolidation for professional intel products
// =============================================================================

export interface StructuredExtraction {
  event_type?: string
  event_date?: string
  location?: {
    primary_district?: string
    secondary_locations?: string[]
    coordinates_hint?: string
  }
  monetary_value?: {
    amount?: number
    currency?: string
    context?: string
  }
  source_entity?: string
  recipient_entity?: string
  authorization_level?: string
}

export interface IntelEntities {
  persons: Array<{
    name: string
    title?: string
    role?: string
    affiliation?: string
  }>
  organizations: Array<{
    name: string
    type?: string
    country?: string
    role?: string
  }>
  financial: Array<{
    amount?: number
    currency?: string
    description?: string
    flow_direction?: string
  }>
}

export interface LinkAnalysis {
  connections_to_existing: Array<{
    entity_name: string
    connection_type?: string
    confidence?: number
    evidence?: string
  }>
  shell_company_indicators: Array<{
    company_name: string
    red_flags?: string[]
    risk_score?: number
  }>
  network_position?: string
}

export interface AnalyticAssessment {
  confidence_basis?: string
  key_judgments: string[]
  alternative_hypotheses: Array<{
    hypothesis: string
    likelihood?: string
    disconfirming_evidence?: string
  }>
  information_gaps: string[]
}

// Historical context types for Palantir-grade intelligence
export interface HistoricalMatch {
  story_id: string
  headline: string
  occurred_at: string
  district: string
  story_type: string
  severity: string
  similarity_score: number
  match_reasons: string[]
  fatalities?: number
  injuries?: number
}

export interface DistrictHistoricalProfile {
  district: string
  total_events_1y: number
  total_events_2y: number
  fatalities_1y: number
  fatalities_2y: number
  injuries_1y: number
  events_by_type: Record<string, number>
  events_by_month: Record<string, number>
  peak_months: number[]
  notable_events: HistoricalMatch[]
  election_violence_history?: {
    year: number
    description: string
    fatalities?: number
  }
  is_high_risk_district: boolean
  risk_factors: string[]
}

export interface SeasonalContext {
  current_season: string
  season_name: string
  historical_avg_events: number
  historical_max_events: number
  historical_max_year?: number
  historical_fatalities: number
  current_season_events: number
  comparison_to_baseline: string
  comparison_pct: number
  is_high_risk_season: boolean
  seasonal_risk_factors: string[]
}

export interface EscalationContext {
  current_count_7d: number
  current_count_24h: number
  baseline_avg_7d: number
  baseline_avg_24h: number
  pct_change_7d: number
  pct_change_24h: number
  trend_direction: string
  trend_strength: string
  velocity: number
  days_since_last_similar?: number
  is_escalating: boolean
  escalation_level: string
}

export interface EntityTimeline {
  entity_name: string
  entity_type: string
  total_mentions: number
  mentions_30d: number
  mentions_7d: number
  mentions_24h: number
  trend: string
  trend_pct_change: number
  top_co_entities?: Array<{ name: string; type: string; co_occurrence_count: number }>
  story_appearances?: Array<{ story_id: string; headline: string; date: string }>
}

export interface HistoricalPatterns {
  similar_events?: HistoricalMatch[]
  district_profile?: DistrictHistoricalProfile
  seasonal_context?: SeasonalContext
  escalation_context?: EscalationContext
  entity_timelines?: EntityTimeline[]
  computed_at?: string
  computation_time_ms?: number
  lookback_days?: number
}

export interface NepalContext {
  relevant_sectors: string[]
  historical_patterns?: string[] | HistoricalPatterns  // Support both legacy and new format
  watch_indicators: string[]
  border_implications?: {
    india?: string
    china?: string
  }
  ethnic_communal_dimension?: string
}

export interface SourceEvaluation {
  reliability?: string  // A-F
  reliability_rationale?: string
  credibility?: string  // 1-6
  credibility_rationale?: string
  combined_rating?: string  // e.g., B2
}

export interface CollectionPriorities {
  documents_to_obtain: Array<{
    document_type: string
    source?: string
    priority?: string
  }>
  entities_to_investigate: Array<{
    entity_name: string
    investigation_focus?: string
    priority?: string
  }>
  open_source_monitoring: string[]
}

export interface MilRecommendedAction {
  action: string
  responsible_agency?: string
  timeline?: string  // immediate, 24h, 48h, week
  priority?: string  // CRITICAL, HIGH, MEDIUM, LOW
}

export interface ConsolidatedStory {
  id: string
  source_id: string
  source_name?: string
  url: string
  canonical_headline: string
  canonical_headline_ne?: string
  summary?: string
  summary_ne?: string
  story_type?: string
  severity?: string
  admiralty_rating?: string
  nepal_relevance?: string
  source_count: number
  first_reported_at?: string
  last_updated_at?: string
  districts_affected: string[]
  key_entities: Array<{
    name: string
    name_ne?: string
    type: string
    is_key_actor?: boolean
  }>
  is_verified: boolean
  confidence_score?: number
  source_links?: SourceLink[]
  cluster_id?: string  // StoryCluster ID for workspace navigation

  // Palantir-grade intelligence fields (legacy - computed at API time)
  key_judgment?: string
  confidence_level?: 'HIGH' | 'MODERATE' | 'LOW'
  confidence_basis?: string
  time_sensitivity?: 'IMMEDIATE' | 'NEAR_TERM' | 'ONGOING'
  information_cutoff?: string
  impact_scope?: 'LOCAL' | 'DISTRICT' | 'PROVINCIAL' | 'NATIONAL'
  corroboration_level?: 'CONFIRMED' | 'CORROBORATED' | 'SINGLE_SOURCE' | 'UNVERIFIED'
  intelligence_gaps?: IntelligenceGaps
  source_provenance?: SourceProvenance[]
  recommended_actions?: string[]

  // ==========================================================================
  // MILITARY INTELLIGENCE FIELDS (Pre-computed during consolidation)
  // Professional-grade intel from military_intel_service
  // ==========================================================================

  // BLUF - Bottom Line Up Front
  bluf?: string

  // Structured extraction
  structured_extraction?: StructuredExtraction

  // Named entities with roles (military format)
  intel_entities?: IntelEntities

  // Link analysis
  link_analysis?: LinkAnalysis

  // Analytic assessment
  analytic_assessment?: AnalyticAssessment

  // Nepal context
  nepal_context?: NepalContext

  // Source evaluation (NATO Admiralty detailed)
  source_evaluation?: SourceEvaluation

  // Collection priorities
  collection_priorities?: CollectionPriorities

  // Recommended actions (military format with agency/timeline)
  mil_recommended_actions?: MilRecommendedAction[]

  // Analysis metadata
  intel_analysis_model?: string
  intel_analyzed_at?: string

  // ==========================================================================
  // INTELLIGENCE PRE-SCREENING FIELDS (Palantir-grade 4-layer system)
  // ==========================================================================

  // Priority score (0-100) - higher = more important
  intel_priority_score?: number

  // Reasons for the priority score (e.g., "CRITICAL: bomb blast", "Watchlist: PM")
  intel_priority_reasons?: string[]

  // Layer 1 auto-triggered critical event
  intel_is_critical?: boolean

  // Analysis status: "analyzed" | "queued" | "pending"
  intel_analysis_status?: 'analyzed' | 'queued' | 'pending'
}

export interface CanonicalEvent {
  id: string
  event_type: string
  category?: string
  canonical_headline?: string
  canonical_description?: string
  severity?: string
  admiralty_rating?: string
  district_name?: string
  source_count: number
  first_reported_at?: string
  is_verified: boolean
  verification_status?: string
}

export const getConsolidatedStories = async (
  hours: number = 72,
  storyType?: string,
  severity?: string,
  limit: number = 500,
  districts?: string[]
): Promise<ConsolidatedStory[]> => {
  const response = await apiClient.get('/analytics/consolidated-stories', {
    params: { hours, story_type: storyType, severity, limit, districts: districts?.join(',') || undefined },
  })
  return response.data
}

export const getCanonicalEvents = async (
  hours: number = 24,
  eventType?: string,
  district?: string,
  limit: number = 20
): Promise<CanonicalEvent[]> => {
  const response = await apiClient.get('/analytics/canonical-events', {
    params: { hours, event_type: eventType, district, limit },
  })
  return response.data
}

export const runConsolidation = async (hours: number = 48): Promise<{
  story_consolidation: Record<string, unknown>
  event_deduplication: Record<string, unknown>
}> => {
  const response = await apiClient.post('/analytics/consolidation/run', null, {
    params: { hours },
  })
  return response.data
}

export const checkRelevance = async (text: string): Promise<{
  relevance: string
  confidence: number
  reasoning: string
  nepal_districts_mentioned: string[]
  nepal_entities_mentioned: string[]
  neighbor_country?: string
  nepal_impact?: string
}> => {
  const response = await apiClient.post('/analytics/relevance/check', null, {
    params: { text },
  })
  return response.data
}


// ============================================================================
// INTELLIGENCE INSIGHTS (Advanced Analytics)
// ============================================================================

export interface TrendItem {
  metric_name: string
  direction: 'increasing' | 'decreasing' | 'stable' | 'volatile'
  strength: 'strong' | 'moderate' | 'weak' | 'none'
  change_pct: number
  start_value: number
  end_value: number
  r_squared: number
  periods: number
}

export interface AnomalyItem {
  id: string
  anomaly_type: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  timestamp: string
  description: string
  confidence: number
  affected_locations: string[]
  affected_entities: string[]
  evidence: Record<string, unknown>
  recommended_actions: string[]
}

export interface TrendSummary {
  total_trends: number
  direction_distribution: Record<string, number>
  strong_trend_count: number
  accelerating_count: number
  observations: string[]
  average_r_squared: number
}

export interface AnomalySummary {
  total: number
  by_severity: {
    critical: number
    high: number
    medium: number
    low: number
  }
  by_type: Record<string, number>
}

export interface ForecastData {
  direction: string
  forecast_7d: Array<{
    date: string
    value: number
  }>
}

export interface IntelligenceInsights {
  overall_threat_level: 'critical' | 'elevated' | 'guarded' | 'low'
  assessment_summary: string
  trends: TrendItem[]
  trend_summary: TrendSummary
  anomalies: AnomalyItem[]
  anomaly_summary: AnomalySummary
  observations: string[]
  forecasts: Record<string, ForecastData>
  analysis_timestamp: string
  data_window_hours: number
}

export interface DistrictIntelligenceAnalysis {
  district: string
  province: string
  current_metrics: {
    communal_tension_score: number
    economic_health_score: number
    violent_crime_score: number
    political_stability_score: number
    overall_stability_score: number
    risk_level: string
  }
  trends: {
    communal: string
    economic: string
    crime: string
    overall: string
  }
  province_comparison: {
    district_count: number
    rankings: Record<string, {
      rank: number
      total: number
      percentile: number
    }>
  }
  incident_counts: {
    crime_7d: number
    crime_fatalities_7d: number
    communal_7d: number
    economic_7d: number
  }
  time_series: {
    crime: Array<{ date: string; count: number }>
    communal: Array<{ date: string; count: number }>
  }
  last_computed_at: string
  analysis_window_hours: number
}

/**
 * Get comprehensive intelligence insights with trends, anomalies, and forecasts.
 * This is the Palantir-grade intelligence endpoint.
 */
export const getIntelligenceInsights = async (
  hours: number = 168
): Promise<IntelligenceInsights> => {
  const response = await apiClient.get('/analytics/intelligence/insights', {
    params: { hours },
  })
  return response.data
}

/**
 * Get detailed intelligence analysis for a specific district.
 */
export const getDistrictIntelligenceAnalysis = async (
  districtName: string,
  hours: number = 168
): Promise<DistrictIntelligenceAnalysis> => {
  const response = await apiClient.get(`/analytics/intelligence/district-analysis/${districtName}`, {
    params: { hours },
  })
  return response.data
}


// ============================================================================
// DISTRICT INTELLIGENCE BRIEF (AI-powered explanation with sources)
// ============================================================================

export interface SourceReference {
  story_id: string
  title: string
  source?: string
  url?: string
  published_at?: string
  relevance: 'primary' | 'supporting' | 'context'
}

export interface DistrictBrief {
  district: string
  province: string
  summary: string
  key_factors: string[]
  risk_level: string
  stress_score: number
  sources: SourceReference[]
  generated_at: string
  llm_model?: string
}

/**
 * Get AI-generated intelligence brief for a district.
 * Explains why the district has its current risk/stress level with source links.
 */
export const getDistrictBrief = async (
  districtName: string,
  hours: number = 168
): Promise<DistrictBrief> => {
  const response = await apiClient.get(`/analytics/intelligence/district-brief/${encodeURIComponent(districtName)}`, {
    params: { hours },
  })
  return response.data
}


// ============================================================================
// EXECUTIVE SUMMARY (AI-Generated - Claude Haiku)
// ============================================================================

export interface PriorityDevelopment {
  headline: string
  significance: string
  districts: string[]
}

export interface ExecutiveSummary {
  key_judgment: string
  situation_overview: string
  priority_developments: PriorityDevelopment[]
  geographic_focus: string[]
  threat_level: 'CRITICAL' | 'ELEVATED' | 'GUARDED' | 'LOW'
  threat_trajectory: 'ESCALATING' | 'STABLE' | 'DE-ESCALATING'
  watch_items: string[]
  story_count: number
  time_range_hours: number
  generated_at: string
}

/**
 * Get AI-generated executive summary of the intelligence situation.
 * Uses Claude Haiku to analyze all consolidated stories from the specified time window.
 * Results are cached for 6 hours.
 *
 * Cost: ~$0.002 per generation with prompt caching.
 */
export const getExecutiveSummary = async (
  hours: number = 6,
  forceRefresh: boolean = false,
  districts?: string[]
): Promise<ExecutiveSummary> => {
  const response = await apiClient.get('/analytics/executive-summary', {
    params: { hours, force_refresh: forceRefresh, districts: districts?.join(',') || undefined },
  })
  return response.data
}


// ============================================================================
// DYNAMIC ALERTS
// ============================================================================

export interface DynamicAlert {
  id: string
  title: string
  description?: string
  severity: string
  story_type?: string
  districts: string[]
  source_count: number
  first_reported_at?: string
  threat_level?: string
}

export interface DynamicAlertList {
  items: DynamicAlert[]
  total: number
  time_range_hours: number
}

export const getDynamicAlerts = async (
  hours: number = 24,
  districts?: string[],
  limit: number = 20
): Promise<DynamicAlertList> => {
  const response = await apiClient.get('/alerts/dynamic', {
    params: { hours, districts: districts?.join(',') || undefined, limit },
  })
  return response.data
}


// ============================================================================
// AI STORY SUMMARIES (Claude Haiku 3.5 powered)
// ============================================================================

export interface StorySummaryResponse {
  headline: string
  summary: string
  category: string
  severity: string
  key_entities: string[]
  verified: boolean
  confidence: number
  cached: boolean
  usage: {
    input_tokens: number
    output_tokens: number
    cache_status: 'HIT' | 'MISS'
  }
}

export interface ClusterSummaryResponse {
  cluster_id: string
  headline: string
  summary: string
  category: string
  severity: string
  key_entities: string[]
  source_count: number
  story_count: number
  sources: string[]
  verified: boolean
  confidence: number
  cached: boolean
  usage: {
    input_tokens: number
    output_tokens: number
    cache_status: 'HIT' | 'MISS'
  }
}

/**
 * Get AI-generated summary for a single story.
 * Uses Claude Haiku 3.5 with prompt caching for cost efficiency.
 */
export const getStorySummary = async (storyId: string): Promise<StorySummaryResponse> => {
  const response = await apiClient.get(`/analysis/stories/${storyId}/summary`)
  return response.data
}

/**
 * Get AI-generated summary for a story cluster.
 * Aggregates information from all stories in the cluster.
 */
export const getClusterSummary = async (clusterId: string): Promise<ClusterSummaryResponse> => {
  const response = await apiClient.get(`/analysis/clusters/${clusterId}/summary`)
  return response.data
}
