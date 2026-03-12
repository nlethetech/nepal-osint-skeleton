import { apiClient } from './client'

export interface AuditLogEntry {
  id: string
  user_id: string
  user_email: string
  action: string
  target_type: string | null
  target_id: string | null
  details: Record<string, any> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface AuditLogResponse {
  items: AuditLogEntry[]
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface AuditFilters {
  action?: string
  user_search?: string
  start_date?: string
  end_date?: string
  page?: number
  per_page?: number
}

export interface UserAccount {
  id: string
  email: string
  full_name: string | null
  auth_provider: string
  auth_provider_label: string
  role: string
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export interface UsersResponse {
  items: UserAccount[]
  page: number
  per_page: number
  total: number
  total_pages: number
  filters: {
    auth_provider?: string | null
    search?: string | null
  }
}

export interface UserFilters {
  page?: number
  per_page?: number
  auth_provider?: 'local' | 'google' | 'guest'
  search?: string
}

export interface ActiveSession {
  user_id: string
  email: string
  role: string
  last_active: string
}

export interface UsersSummaryResponse {
  total_users: number
  active_last_hour: number
  new_last_24h: number
  new_last_7d: number
  provider_counts: Record<string, number>
  role_counts: Record<string, number>
  guest_to_registered: {
    guest: number
    registered: number
  }
  signups_by_day: Array<{
    date: string
    count: number
  }>
}

export async function fetchAuditLogs(filters: AuditFilters = {}): Promise<AuditLogResponse> {
  const { data } = await apiClient.get('/admin/audit-log', { params: filters })
  return data
}

export async function exportAuditLogsCsv(filters: AuditFilters = {}): Promise<Blob> {
  const { data } = await apiClient.get('/admin/audit-log/export', {
    params: filters,
    responseType: 'blob',
  })
  return data
}

export async function fetchUsers(filters: UserFilters = {}): Promise<UsersResponse> {
  const { data } = await apiClient.get('/admin/users', { params: filters })
  return data
}

export async function fetchActiveSessions(): Promise<{ active_sessions: ActiveSession[]; count: number }> {
  const { data } = await apiClient.get('/admin/users/sessions')
  return data
}

export async function fetchUsersSummary(): Promise<UsersSummaryResponse> {
  const { data } = await apiClient.get('/admin/users/summary')
  return data
}
