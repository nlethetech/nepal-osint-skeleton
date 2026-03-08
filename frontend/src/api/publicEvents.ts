import apiClient from './client'
import type { ClusterPublication } from './collaboration'

export interface PeerReviewSummary {
  peer_state: string
  agree_count: number
  needs_correction_count: number
  dispute_count: number
  last_reviewed_at?: string | null
  last_contested_at?: string | null
  latest_version?: number | null
  latest_publication_at?: string | null
  official_confirmation?: boolean | null
  citations_count?: number | null
}

export interface PublicEventDetail {
  cluster_id: string
  headline: string
  category?: string | null
  severity?: string | null
  published_at?: string | null
  publication: ClusterPublication
  peer_review: PeerReviewSummary
}

export async function getPublicEvent(clusterId: string): Promise<PublicEventDetail> {
  const { data } = await apiClient.get(`/public/events/${clusterId}`)
  return data
}

