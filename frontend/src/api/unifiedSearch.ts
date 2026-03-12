import apiClient from './client'

// ============================================================================
// Types
// ============================================================================

export interface CandidateResult {
  id: string
  external_id: string
  name_en: string
  name_ne: string | null
  party: string
  party_ne: string | null
  votes: number
  vote_pct: number
  rank: number
  is_winner: boolean
  photo_url: string | null
  constituency_name: string
  constituency_code: string
  district: string
  constituency_status: string
}

export interface ConstituencyResult {
  id: string
  constituency_code: string
  name_en: string
  name_ne: string | null
  district: string
  province: string
  province_id: number
  status: string
  turnout_pct: number | null
  winner_party: string | null
  winner_votes: number | null
  winner_margin: number | null
  total_votes_cast: number | null
}

export interface EntityResult {
  id: string
  canonical_id: string
  name_en: string
  name_ne: string | null
  entity_type: string
  party: string | null
  role: string | null
  image_url: string | null
  total_mentions: number
  mentions_24h: number
  trend: string
}

export interface StoryResult {
  id: string
  title: string
  summary: string
  source_name: string | null
  category: string | null
  severity: string | null
  published_at: string | null
  url: string
}

export interface AnnouncementResult {
  id: string
  external_id: string
  source: string
  source_name: string
  title: string
  url: string
  category: string
  date_bs: string | null
  date_ad: string | null
  published_at: string | null
  fetched_at: string | null
  has_attachments: boolean
  is_important: boolean
  is_read: boolean
}

export interface MPResult {
  id: string
  mp_id: string
  name_en: string
  name_ne: string | null
  party: string | null
  constituency: string | null
  chamber: string | null
  election_type: string | null
  photo_url: string | null
  performance_score: number
  performance_tier: string | null
  is_minister: boolean
  ministry_portfolio: string | null
}

export interface UnifiedSearchResponse {
  query: string
  total: number
  categories: {
    candidates: { items: CandidateResult[]; total: number }
    constituencies: { items: ConstituencyResult[]; total: number }
    entities: { items: EntityResult[]; total: number }
    stories: { items: StoryResult[]; total: number }
    announcements?: { items: AnnouncementResult[]; total: number }
    mps?: { items: MPResult[]; total: number }
  }
}

// ============================================================================
// API Function
// ============================================================================

export const unifiedSearch = async (
  query: string,
  options?: {
    limit?: number
    electionYear?: number
  }
): Promise<UnifiedSearchResponse> => {
  const response = await apiClient.get('/search/unified', {
    params: {
      q: query,
      limit: options?.limit ?? 6,
      election_year: options?.electionYear,
    },
  })
  return response.data
}
