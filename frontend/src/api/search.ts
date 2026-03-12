import apiClient from './client'
import type { SearchResponse } from '../types/api'

export interface SearchParams {
  query: string
  typeFilter?: 'story' | 'entity'
  limit?: number
}

export const search = async (params: SearchParams): Promise<SearchResponse> => {
  const response = await apiClient.get('/search', {
    params: {
      q: params.query,
      type_filter: params.typeFilter,
      limit: params.limit,
    },
  })
  return response.data
}
