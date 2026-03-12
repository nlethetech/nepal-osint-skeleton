import { apiClient } from './client'

export interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  data: Record<string, any> | null
  is_read: boolean
  created_at: string
}

export interface NotificationListResponse {
  items: Notification[]
  unread_count: number
}

export async function fetchNotifications(): Promise<NotificationListResponse> {
  const { data } = await apiClient.get('/notifications/')
  return data
}

export async function markNotificationRead(notificationId: string): Promise<{ success: boolean }> {
  const { data } = await apiClient.post(`/notifications/${notificationId}/read`)
  return data
}

export async function markAllNotificationsRead(): Promise<{ success: boolean; marked_read: number }> {
  const { data } = await apiClient.post('/notifications/read-all')
  return data
}
