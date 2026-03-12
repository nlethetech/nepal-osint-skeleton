/**
 * OSINT Indices API Client
 * Stability, tension, crime, economic, youth stress indices
 */
import { apiClient } from './client'

// Types
export interface IndexResult {
  index_name: string
  value: number  // 0-100 scale
  trend: 'rising' | 'falling' | 'stable'
  trend_value: number
  level: 'critical' | 'elevated' | 'moderate' | 'low' | 'minimal'
  components: Record<string, number>
  timestamp: string
}

export interface DistrictIndex {
  district: string
  province: string
  stability: number
  tension: number
  crime: number
  economic: number
  youth_stress: number
  composite: number
  level: string
  top_concerns: string[]
}

export interface NationalIndex {
  overall: number
  level: string
  indices: {
    stability: IndexResult
    tension: IndexResult
    crime: IndexResult
    economic: IndexResult
    youth_stress: IndexResult
  }
  hotspots: Array<{
    location: string
    index: string
    value: number
    level: string
  }>
  trends: Array<{
    index: string
    direction: string
    change: number
  }>
  timestamp: string
}

export interface IndexRequest {
  location?: string
  window_days?: number
  include_components?: boolean
}

// API Functions
export const indicesApi = {
  /**
   * Get stability index
   */
  async getStabilityIndex(params: IndexRequest = {}): Promise<IndexResult> {
    const response = await apiClient.get('/indices/stability', { params })
    return response.data
  },

  /**
   * Get tension index
   */
  async getTensionIndex(params: IndexRequest = {}): Promise<IndexResult> {
    const response = await apiClient.get('/indices/tension', { params })
    return response.data
  },

  /**
   * Get crime index
   */
  async getCrimeIndex(params: IndexRequest = {}): Promise<IndexResult> {
    const response = await apiClient.get('/indices/crime', { params })
    return response.data
  },

  /**
   * Get economic index
   */
  async getEconomicIndex(params: IndexRequest = {}): Promise<IndexResult> {
    const response = await apiClient.get('/indices/economic', { params })
    return response.data
  },

  /**
   * Get youth stress index
   */
  async getYouthStressIndex(params: IndexRequest = {}): Promise<IndexResult> {
    const response = await apiClient.get('/indices/youth-stress', { params })
    return response.data
  },

  /**
   * Get national composite index
   */
  async getNationalIndex(): Promise<NationalIndex> {
    const response = await apiClient.get('/indices/national')
    return response.data
  },

  /**
   * Get all district indices
   */
  async getDistrictIndices(): Promise<DistrictIndex[]> {
    const response = await apiClient.get('/indices/districts')
    return response.data.districts
  },

  /**
   * Get specific district index
   */
  async getDistrictIndex(district: string): Promise<DistrictIndex> {
    const response = await apiClient.get(`/indices/districts/${encodeURIComponent(district)}`)
    return response.data
  },

  /**
   * Get all indices for location
   */
  async getAllIndices(location?: string): Promise<Record<string, IndexResult>> {
    const params = location ? { location } : {}
    const [stability, tension, crime, economic, youth] = await Promise.all([
      this.getStabilityIndex(params),
      this.getTensionIndex(params),
      this.getCrimeIndex(params),
      this.getEconomicIndex(params),
      this.getYouthStressIndex(params),
    ])
    return { stability, tension, crime, economic, youth_stress: youth }
  },

  /**
   * Get hotspots (locations with elevated indices)
   */
  async getHotspots(index?: string, limit: number = 10): Promise<Array<{
    location: string
    index_name: string
    value: number
    level: string
  }>> {
    const response = await apiClient.get('/indices/hotspots', {
      params: { index, limit }
    })
    return response.data.hotspots
  },
}

export default indicesApi
