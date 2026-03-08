import { apiClient } from './client'

export interface PreviousRun {
  election_year: number
  party_name?: string
  constituency_name?: string
  is_winner: boolean
  votes_received?: number
  party_changed: boolean
}

export interface Candidate {
  id: string
  name_en: string
  name_ne?: string
  party_name?: string
  party_id?: string
  constituency_name?: string
  constituency_id?: string
  district?: string
  province?: string
  election_year: number
  votes_received?: number
  vote_percentage?: number
  rank?: number
  is_winner: boolean
  photo_url?: string
  symbol_url?: string
  previous_run?: PreviousRun
}

export interface Party {
  id: string
  name_en: string
  name_ne?: string
  candidate_count: number
  winner_count: number
  total_votes?: number
}

export interface Constituency {
  id: string
  name_en: string
  name_ne?: string
  district?: string
  province?: string
  candidate_count: number
}

export interface WatchlistItem {
  id: string
  entity_id: string
  entity_name: string
  entity_name_ne?: string
  entity_type: string
  item_type: string
  alert_level: string
  notes?: string
  created_at?: string
}

export interface ElectionAlert {
  id: string
  title: string
  description: string
  severity: string
  metadata: Record<string, any>
  created_at?: string
}

export interface Mention {
  story_id: string
  story_title?: string
  story_url?: string
  published_at?: string
  source_name?: string
  mention_text?: string
  context_window?: string
  confidence: number
  sentiment_score: number
}

export interface ElectionSummary {
  total_candidates: number
  by_party: Array<{ party: string; count: number; share_pct: number }>
  by_gender: Array<{ gender: string; count: number; share_pct: number }>
  by_province: Array<{ province: string; count: number; share_pct: number }>
  updated_at?: string
  last_scrape_at?: string
}

export interface ElectionHealth {
  last_scrape_at?: string
  data_freshness_hours?: number
  scraper_status: string
  error_count: number
  last_run_id?: string
}

// Candidates
/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchCandidates(params: {
  province?: string
  district?: string
  constituency_id?: string
  party?: string
  election_year?: number
  search?: string
  language?: string
  limit?: number
  offset?: number
}) {
  const { data } = await apiClient.get('/elections/candidates', { params })
  return data as { candidates: Candidate[]; total: number; offset: number }
}

export async function fetchCandidateDetail(candidateEntityId: string) {
  const { data } = await apiClient.get(`/elections/candidates/${candidateEntityId}`)
  return data
}

export async function fetchCandidateDossier(externalId: string, year: number = 2082) {
  const { data } = await apiClient.get(`/elections/candidates/${externalId}/dossier`, {
    params: { year },
  })
  return data
}

// Parties
/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchParties() {
  const { data } = await apiClient.get('/elections/parties')
  return data as { parties: Party[] }
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchPartyDashboard(partyEntityId: string) {
  const { data } = await apiClient.get(`/elections/parties/${partyEntityId}/dashboard`)
  return data
}

// Constituencies
export async function fetchConstituencies(params?: { province?: string; district?: string }) {
  const { data } = await apiClient.get('/elections/constituencies', { params })
  return data as { constituencies: Constituency[] }
}

export async function fetchConstituencyDetail(constituencyEntityId: string) {
  const { data } = await apiClient.get(`/elections/constituencies/${constituencyEntityId}`)
  return data
}

// Mentions
export async function fetchEntityMentions(entityId: string, params?: { limit?: number; offset?: number }) {
  const { data } = await apiClient.get(`/elections/entities/${entityId}/mentions`, { params })
  return data as { mentions: Mention[]; total: number; offset: number }
}

// Watchlist
export async function fetchWatchlist() {
  const { data } = await apiClient.get('/elections/watchlist')
  return data as { watchlist: WatchlistItem[] }
}

export async function addToWatchlist(entityId: string, itemType: string = 'candidate', alertLevel: string = 'med', notes?: string) {
  const { data } = await apiClient.post('/elections/watchlist/add', {
    entity_id: entityId,
    item_type: itemType,
    alert_level: alertLevel,
    notes,
  })
  return data
}

export async function removeFromWatchlist(entityId: string) {
  const { data } = await apiClient.post('/elections/watchlist/remove', {
    entity_id: entityId,
  })
  return data
}

export async function fetchWatchlistAlerts(limit: number = 50) {
  const { data } = await apiClient.get('/elections/watchlist/alerts', { params: { limit } })
  return data as { alerts: ElectionAlert[] }
}

// Summary & Health
/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchElectionSummary(electionYear?: number) {
  const { data } = await apiClient.get('/elections/summary', { params: { election_year: electionYear } })
  return data as ElectionSummary
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchElectionHealth() {
  const { data } = await apiClient.get('/elections/health')
  return data as ElectionHealth
}

// =============================================================================
// ELECTION MONITOR ANALYTICS API
// =============================================================================

export interface MapResult {
  constituency_id: string
  name_en: string
  name_ne?: string
  district: string
  province: string
  province_id: number
  status: 'declared' | 'counting' | 'pending'
  winner_party?: string
  winner_name?: string
  winner_votes?: number
  total_votes?: number
  turnout_pct?: number
  candidates: Array<{
    id: string
    name_en: string
    name_ne?: string
    party: string
    votes: number
    vote_pct: number
    is_winner: boolean
    photo_url?: string
  }>
}

export interface NationalSummaryResponse {
  total_constituencies: number
  declared: number
  counting: number
  pending: number
  turnout_pct: number
  total_votes_cast: number
  total_registered_voters: number
  leading_party: string
  leading_party_seats: number
  party_seats: Array<{
    party: string
    seats: number
    leading: number
    vote_share_pct: number
  }>
  last_updated?: string
}

export interface SwingEntry {
  party: string
  current_seats: number
  prev_seats: number
  gained: number
  lost: number
  net: number
}

export interface ConstituencyHistory {
  constituency: { id: string; name_en: string; name_ne?: string }
  history: Array<{
    year: number
    winner_name?: string
    winner_party?: string
    total_votes: number
    candidates: Array<{
      id: string
      name_en: string
      party: string
      votes: number
      vote_pct: number
      is_winner: boolean
    }>
  }>
}

export interface DemographicsResponse {
  age_groups: Array<{ group: string; registered: number; voted: number }>
  gender: Array<{ gender: string; registered: number; voted: number }>
  urban_rural: Array<{ type: string; turnout_pct: number }>
}

export interface LiveStatus {
  election_year: number
  is_active: boolean
  declared: number
  counting: number
  pending: number
  last_updated?: string
}

// =============================================================================
// V5 DATABASE-BACKED TYPES (matches backend-v5 schemas)
// =============================================================================

export interface ElectionResponse {
  id: string
  year_bs: number
  year_ad: number
  election_type: string
  status: string
  total_constituencies: number
  total_registered_voters?: number
  total_votes_cast?: number
  turnout_pct?: number
  started_at?: string
  completed_at?: string
}

export interface ConstituencyResponse {
  id: string
  election_id: string
  constituency_code: string
  name_en: string
  name_ne?: string
  district: string
  province: string
  province_id: number
  status: 'pending' | 'counting' | 'declared'
  total_registered_voters?: number
  total_votes_cast?: number
  turnout_pct?: number
  valid_votes?: number
  invalid_votes?: number
  winner_party?: string
  winner_votes?: number
  winner_margin?: number
}

export interface CandidateResponse {
  id: string
  election_id?: string
  constituency_id?: string
  external_id: string
  name_en: string
  name_ne?: string
  name_en_roman?: string
  aliases?: string[]
  party: string
  party_ne?: string
  votes: number
  vote_pct: number
  rank: number
  is_winner: boolean
  is_notable?: boolean
  photo_url?: string
  age?: number
  gender?: string
  education?: string
  biography?: string
  biography_source?: string
  biography_source_label?: string
  profile_origin?: 'json' | 'override' | 'seed'
  previous_positions?: any
  linked_entity_id?: string
  entity_link_confidence?: number
  entity_summary?: {
    entity_id: string
    canonical_id: string
    name_en: string
    name_ne?: string
    match_confidence?: number
  }
}

export interface ConstituencyDetailResponse {
  constituency: ConstituencyResponse
  candidates: CandidateResponse[]
}

export interface DistrictElectionData {
  district: string
  province: string
  province_id: number
  constituencies: number
  declared: number
  counting: number
  pending: number
  dominant_party?: string
  parties: Record<string, number>
  total_votes: number
}

export interface DistrictMapDataResponse {
  election_year: number
  districts: DistrictElectionData[]
}

export interface ElectionSnapshotResponse {
  election_year: number
  total_constituencies: number
  results: Array<{
    constituency_id: string
    name_en: string
    name_ne?: string
    district: string
    province: string
    province_id: number
    status: 'pending' | 'counting' | 'declared'
    winner_party?: string
    winner_name?: string
    winner_votes?: number
    total_votes: number
    turnout_pct?: number
    last_updated?: string
    candidates: CandidateResponse[]
  }>
  constituencies: Array<{
    constituency_id: string
    name_en: string
    name_ne?: string
    district: string
    province: string
    province_id: number
    status: 'pending' | 'counting' | 'declared'
    winner_party?: string
    winner_name?: string
    winner_votes?: number
    total_votes: number
    turnout_pct?: number
    last_updated?: string
    candidates: CandidateResponse[]
  }>
  national_summary?: NationalSummaryDBResponse
  source_mode?: string
}

export interface ConstituencyWatchlistItem {
  id: string
  user_id: string
  constituency_id: string
  constituency_code?: string
  constituency_name?: string
  district?: string
  province?: string
  alert_level: string
  notes?: string
  is_active: boolean
  created_at?: string
}

export interface NationalSummaryDBResponse {
  election_id: string
  year_bs: number
  year_ad: number
  status: string
  total_constituencies: number
  declared: number
  counting: number
  pending: number
  turnout_pct: number
  total_votes_cast: number
  total_registered_voters: number
  leading_party?: string
  leading_party_seats: number
  party_seats: Array<{ party: string; seats: number }>
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchResultsMap(electionYear: number = 2082) {
  const { data } = await apiClient.get('/elections/results/map', { params: { election_year: electionYear } })
  return data as { results: MapResult[]; election_year: number }
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchNationalSummary(electionYear: number = 2082) {
  const { data } = await apiClient.get('/elections/analytics/national-summary', { params: { election_year: electionYear } })
  return data as NationalSummaryResponse
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchPartySeats(electionYear: number = 2082) {
  const { data } = await apiClient.get('/elections/analytics/party-seats', { params: { election_year: electionYear } })
  return data as { party_seats: Array<{ party: string; seats: number }>; election_year: number }
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchSwingAnalysis(electionYear: number = 2082, vsYear: number = 2079) {
  const { data } = await apiClient.get('/elections/analytics/swing', { params: { election_year: electionYear, vs_year: vsYear } })
  return data as { swing: SwingEntry[]; election_year: number; vs_year: number }
}

export async function fetchConstituencyHistory(constituencyId: string) {
  const { data } = await apiClient.get(`/elections/analytics/constituency/${constituencyId}/history`)
  return data as ConstituencyHistory
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchDemographics(electionYear: number = 2082) {
  const { data } = await apiClient.get('/elections/analytics/demographics', { params: { election_year: electionYear } })
  return data as DemographicsResponse
}

/** @deprecated v4 legacy - endpoint not implemented in v5 backend */
export async function fetchLiveStatus() {
  const { data } = await apiClient.get('/elections/results/live-status')
  return data as LiveStatus
}

// =============================================================================
// V5 DATABASE-BACKED API FUNCTIONS
// =============================================================================

/**
 * List all elections in the database.
 */
export async function fetchElectionsDB() {
  const { data } = await apiClient.get('/elections/')
  return data as { elections: ElectionResponse[] }
}

/**
 * Get election by year (BS).
 */
export async function fetchElectionByYearDB(yearBs: number) {
  const { data } = await apiClient.get(`/elections/${yearBs}`)
  return data as ElectionResponse
}

/**
 * Get national summary for an election year from database.
 */
export async function fetchNationalSummaryDB(yearBs: number) {
  const { data } = await apiClient.get(`/elections/${yearBs}/results`)
  return data as NationalSummaryDBResponse
}

/**
 * List constituencies with pagination and filters.
 */
export async function fetchConstituenciesDB(
  yearBs: number,
  params?: {
    province?: string
    province_id?: number
    district?: string
    status?: string
    page?: number
    page_size?: number
  }
) {
  const { data } = await apiClient.get(`/elections/${yearBs}/constituencies`, { params })
  return data as { constituencies: ConstituencyResponse[]; total: number; page: number; page_size: number }
}

/**
 * Get constituency detail with candidates.
 */
export async function fetchConstituencyDetailDB(yearBs: number, code: string) {
  const { data } = await apiClient.get(`/elections/${yearBs}/constituencies/${code}`)
  return data as ConstituencyDetailResponse
}

/**
 * Get district-level map data for v5 DistrictPolygonsLayer.
 */
export async function fetchDistrictMapData(yearBs: number) {
  const { data } = await apiClient.get(`/elections/${yearBs}/districts`)
  return data as DistrictMapDataResponse
}

/**
 * Get full election snapshot (DB primary).
 */
export async function fetchElectionSnapshot(yearBs: number) {
  const { data } = await apiClient.get(`/elections/${yearBs}/snapshot`)
  return data as ElectionSnapshotResponse
}

/**
 * Get user's constituency watchlist.
 */
export async function fetchConstituencyWatchlist() {
  const { data } = await apiClient.get('/elections/watchlist')
  return data as { items: ConstituencyWatchlistItem[] }
}

/**
 * Add constituency to watchlist.
 */
export async function addConstituencyToWatchlist(
  constituencyId: string,
  alertLevel: string = 'medium',
  notes?: string
) {
  const { data } = await apiClient.post(`/elections/watchlist/${constituencyId}`, null, {
    params: { alert_level: alertLevel, notes }
  })
  return data as ConstituencyWatchlistItem
}

/**
 * Remove constituency from watchlist.
 */
export async function removeConstituencyFromWatchlist(constituencyId: string) {
  const { data } = await apiClient.delete(`/elections/watchlist/${constituencyId}`)
  return data as { success: boolean }
}

/**
 * Update watchlist item alert level.
 */
export async function updateWatchlistAlertLevel(
  constituencyId: string,
  alertLevel: string
) {
  const { data } = await apiClient.patch(`/elections/watchlist/${constituencyId}`, null, {
    params: { alert_level: alertLevel }
  })
  return data as ConstituencyWatchlistItem
}

/**
 * Get swing analysis comparing two election years.
 */
export async function fetchSwingAnalysisDB(yearBs: number, vsYearBs: number) {
  const { data } = await apiClient.get(`/elections/${yearBs}/swing`, { params: { vs_year: vsYearBs } })
  return data as { swing: SwingEntry[]; election_year: number; vs_year: number }
}

// =============================================================================
// CANDIDATE DOSSIER API (Palantir-grade Candidate Intelligence)
// =============================================================================

export interface ParliamentRecordSummary {
  id: string
  name_en: string
  name_ne?: string
  party?: string
  chamber: string

  // Performance scores (0-100)
  performance_score?: number
  performance_percentile?: number
  performance_tier?: string // 'top10', 'above_avg', 'average', 'below_avg', 'bottom10'

  // Category scores
  legislative_score?: number
  legislative_percentile?: number
  participation_score?: number
  participation_percentile?: number
  accountability_score?: number
  accountability_percentile?: number
  committee_score?: number
  committee_percentile?: number

  // Activity counts
  bills_introduced: number
  bills_passed: number
  session_attendance_pct?: number
  questions_asked: number
  speeches_count: number
  committee_memberships: number
  committee_leadership_roles: number

  // Peer ranking
  peer_group?: string
  peer_rank?: number
  peer_total?: number

  // Prime Minister history
  is_former_pm: boolean
  pm_terms: number
  notable_roles?: string  // Backend returns string, not array
}

export interface CandidateDossierResponse {
  candidate: CandidateResponse
  constituency_code: string
  constituency_name: string
  district: string
  province: string
  province_id: number
  rivals: CandidateResponse[]
  kb_entity?: {
    entity_id: string
    canonical_id: string
    name_en: string
    name_ne?: string
    match_confidence: number
    total_mentions: number
    mentions_7d: number
  }
  previous_runs: PreviousRun[]
  story_count: number
  constituency_rank: number
  // Election status
  election_year: number  // Which election year this record is from (BS)
  is_running_2082: boolean  // Whether running in current (2082) election
  parliamentary_record?: ParliamentRecordSummary
}

export interface CandidateStoryItem {
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
}

export interface CandidateStoriesResponse {
  candidate_id: string
  candidate_name: string
  entity_id?: string
  stories: CandidateStoryItem[]
  total: number
  hours: number
}

export interface KBEntityMatch {
  entity_id: string
  canonical_id: string
  name_en: string
  name_ne?: string
  match_confidence: number
}

/**
 * Get full dossier for a candidate.
 * Includes KB entity match, rivals, previous runs, and story count.
 */
export async function getCandidateDossier(candidateId: string): Promise<CandidateDossierResponse> {
  const { data } = await apiClient.get(`/elections/candidates/${candidateId}/dossier`)
  return data
}

/**
 * Get stories mentioning a candidate.
 * Uses KB entity matching to find related stories.
 */
export async function getCandidateStories(
  candidateId: string,
  hours: number = 720,
  limit: number = 50,
  category?: string
): Promise<CandidateStoriesResponse> {
  const { data } = await apiClient.get(`/elections/candidates/${candidateId}/stories`, {
    params: { hours, limit, category }
  })
  return data
}

/**
 * Find KB entity match for a candidate name.
 * Used for linking election candidates to the entity knowledge base.
 */
export async function findCandidateKBEntity(
  nameEn: string,
  nameNe?: string,
  party?: string
): Promise<KBEntityMatch | null> {
  try {
    const { data } = await apiClient.get('/elections/candidates/match-entity', {
      params: { name_en: nameEn, name_ne: nameNe, party }
    })
    return data
  } catch {
    return null
  }
}

// =============================================================================
// WIKILEAKS INTEGRATION (Diplomatic Cables & Leaked Documents)
// =============================================================================

export interface WikiLeaksDocument {
  title: string
  url: string
  collection: string  // e.g., "Cable Gate", "GI Files", "PlusD"
  snippet: string
  date_created?: string
  date_released?: string
  relevance_score: number
}

export interface CandidateWikiLeaksResponse {
  candidate_id: string
  candidate_name: string
  query: string
  documents: WikiLeaksDocument[]
  total_results: number
  searched_at: string
  cache_hit: boolean
}

/**
 * Search WikiLeaks for mentions of a candidate.
 * Finds diplomatic cables and leaked documents mentioning the candidate.
 * Results are cached for 24 hours.
 */
export async function getCandidateWikiLeaks(
  candidateId: string,
  maxResults: number = 20
): Promise<CandidateWikiLeaksResponse> {
  const { data } = await apiClient.get(`/elections/candidates/${candidateId}/wikileaks`, {
    params: { max_results: maxResults }
  })
  return data
}

// =============================================================================
// AI LEADERSHIP PROFILE (Claude Haiku-powered Analysis)
// =============================================================================

export interface LeadershipProfileResponse {
  candidate_id: string
  candidate_name: string

  // Core assessment
  leadership_style: string  // e.g., "Pragmatic coalition builder"
  key_strengths: string[]
  key_concerns: string[]

  // Political positioning
  ideological_position: string  // e.g., "Center-left nationalist"
  policy_priorities: string[]

  // Track record
  experience_summary: string
  controversy_summary?: string

  // International perception (from WikiLeaks)
  international_perception?: string

  // Overall assessment
  analyst_summary: string
  confidence_level: 'high' | 'medium' | 'low'

  // Metadata
  generated_at: string
  data_sources: string[]
  cache_hit: boolean
}

/**
 * Get AI-generated leadership profile for a candidate.
 * Uses Claude Haiku to synthesize education, news, WikiLeaks, and parliamentary data.
 * Results are cached for 24 hours.
 */
export async function getCandidateLeadershipProfile(
  candidateId: string,
  forceRegenerate: boolean = false
): Promise<LeadershipProfileResponse> {
  const { data } = await apiClient.get(`/elections/candidates/${candidateId}/profile`, {
    params: { force_regenerate: forceRegenerate }
  })
  return data
}

export default {
  // Legacy API functions
  fetchCandidates,
  fetchCandidateDetail,
  fetchParties,
  fetchPartyDashboard,
  fetchConstituencies,
  fetchConstituencyDetail,
  fetchEntityMentions,
  fetchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  fetchWatchlistAlerts,
  fetchElectionSummary,
  fetchElectionHealth,
  fetchResultsMap,
  fetchNationalSummary,
  fetchPartySeats,
  fetchSwingAnalysis,
  fetchConstituencyHistory,
  fetchDemographics,
  fetchLiveStatus,
  // V5 Database-backed functions
  fetchElectionsDB,
  fetchElectionByYearDB,
  fetchNationalSummaryDB,
  fetchConstituenciesDB,
  fetchConstituencyDetailDB,
  fetchDistrictMapData,
  fetchElectionSnapshot,
  fetchConstituencyWatchlist,
  addConstituencyToWatchlist,
  removeConstituencyFromWatchlist,
  updateWatchlistAlertLevel,
  fetchSwingAnalysisDB,
  // Candidate Dossier
  getCandidateDossier,
  getCandidateStories,
  findCandidateKBEntity,
  // WikiLeaks Integration
  getCandidateWikiLeaks,
  // AI Leadership Profile
  getCandidateLeadershipProfile,
}
