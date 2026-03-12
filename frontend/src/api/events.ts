import apiClient from './client'
import type { Event, PaginatedResponse, EventType, Severity } from '../types/api'

export interface EventParams {
  page?: number
  pageSize?: number
  eventType?: EventType
  severity?: Severity
  fromDate?: string
  toDate?: string
}

export const getEvents = async (params: EventParams = {}): Promise<PaginatedResponse<Event>> => {
  const response = await apiClient.get('/events', {
    params: {
      page: params.page,
      page_size: params.pageSize,
      event_type: params.eventType,
      severity: params.severity,
      from_date: params.fromDate,
      to_date: params.toDate,
    },
  })
  return response.data
}

export const getEventTypes = async (): Promise<{ event_types: EventType[] }> => {
  const response = await apiClient.get('/events/types')
  return response.data
}

export const getEventStats = async (fromDate?: string, toDate?: string) => {
  const response = await apiClient.get('/events/stats', {
    params: {
      from_date: fromDate,
      to_date: toDate,
    },
  })
  return response.data
}

export const getEventsByDistrict = async (fromDate?: string, toDate?: string) => {
  const response = await apiClient.get('/events/by-district', {
    params: {
      from_date: fromDate,
      to_date: toDate,
    },
  })
  return response.data
}
