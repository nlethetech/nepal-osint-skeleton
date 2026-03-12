import apiClient from './client'
import type { Alert, AlertRule, PaginatedResponse, Severity } from '../types/api'

export interface AlertParams {
  page?: number
  pageSize?: number
  severity?: Severity
  isRead?: boolean
  fromDate?: string
}

export interface AlertListResponse extends PaginatedResponse<Alert> {
  unread_count: number
}

export const getAlerts = async (params: AlertParams = {}): Promise<AlertListResponse> => {
  const response = await apiClient.get('/alerts', {
    params: {
      page: params.page,
      page_size: params.pageSize,
      severity: params.severity,
      is_read: params.isRead,
      from_date: params.fromDate,
    },
  })
  return response.data
}

export const acknowledgeAlert = async (alertId: string): Promise<{ message: string; id: string }> => {
  const response = await apiClient.post(`/alerts/${alertId}/acknowledge`)
  return response.data
}

export const acknowledgeAllAlerts = async (): Promise<{ message: string; count: number }> => {
  const response = await apiClient.post('/alerts/acknowledge-all')
  return response.data
}

