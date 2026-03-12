import { apiClient } from './client'

export interface CorrectionEntry {
  id: string
  candidate_external_id: string
  candidate_name: string
  field: string
  old_value: string | null
  new_value: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'rolled_back'
  submitted_by: string
  submitted_by_email: string
  submitted_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  rejection_reason: string | null
  rolled_back_at: string | null
  rollback_reason: string | null
  batch_id: string | null
  created_at: string
}

export interface CorrectionListResponse {
  items: CorrectionEntry[]
  pending_count: number
  page: number
  total: number
  total_pages: number
}

export interface BulkUploadResponse {
  total_rows: number
  valid: number
  invalid: number
  errors: { row: number; error: string }[]
  corrections_created: number
  batch_id: string | null
  status: string
}

export async function fetchCorrections(
  status?: string,
  page: number = 1,
  perPage: number = 20,
): Promise<CorrectionListResponse> {
  const { data } = await apiClient.get('/admin/corrections', {
    params: { status, page, per_page: perPage },
  })
  return data
}

export async function submitCorrection(
  candidateExternalId: string,
  payload: { field: string; new_value: string; reason: string },
): Promise<{ id: string; status: string; message: string }> {
  const { data } = await apiClient.post(
    `/elections/candidates/${candidateExternalId}/corrections`,
    payload,
  )
  return data
}

export async function approveCorrection(
  correctionId: string,
  notes?: string,
): Promise<{ id: string; status: string; message: string }> {
  const { data } = await apiClient.post(`/admin/corrections/${correctionId}/approve`, { notes })
  return data
}

export async function rejectCorrection(
  correctionId: string,
  reason: string,
): Promise<{ id: string; status: string; message: string }> {
  const { data } = await apiClient.post(`/admin/corrections/${correctionId}/reject`, { reason })
  return data
}

export async function rollbackCorrection(
  correctionId: string,
  reason: string,
): Promise<{ id: string; status: string; message: string }> {
  const { data } = await apiClient.post(`/admin/corrections/${correctionId}/rollback`, { reason })
  return data
}

export async function bulkUploadCorrections(file: File): Promise<BulkUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await apiClient.post('/admin/corrections/bulk', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}
