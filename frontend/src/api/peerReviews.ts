import apiClient from './client'

export type PeerReviewVerdict = 'agree' | 'needs_correction' | 'dispute'

export interface PeerReview {
  id: string
  cluster_id: string
  reviewer: {
    id: string
    email: string
    full_name: string | null
  }
  verdict: PeerReviewVerdict
  notes: string | null
  created_at: string
  updated_at: string
}

export async function upsertPeerReview(clusterId: string, body: {
  verdict: PeerReviewVerdict
  notes?: string
}): Promise<PeerReview> {
  const { data } = await apiClient.post(`/clusters/${clusterId}/peer-reviews`, body)
  return data
}

