/**
 * Temporal Patterns API Client
 * Cycles, change points, sequence mining
 */
import { apiClient } from './client'

// Types
export interface Cycle {
  cycle_id: string
  event_type: string
  period_days: number
  period_label: string  // 'weekly', 'monthly', 'quarterly', 'annual'
  strength: number
  confidence: number
  phase: number
  next_peak: string | null
  historical_occurrences: number
  nepal_context: string  // 'monsoon', 'festival', 'election', etc.
}

export interface ChangePoint {
  changepoint_id: string
  timestamp: string
  event_type: string | null
  location: string | null
  change_type: 'increase' | 'decrease' | 'shift'
  magnitude: number
  confidence: number
  description: string
  before_mean: number
  after_mean: number
}

export interface EventSequence {
  sequence_id: string
  pattern: string[]  // e.g., ['strike', 'protest', 'violence']
  support: number
  confidence: number
  lift: number
  avg_gap_days: number
  occurrences: number
  last_occurrence: string
  next_likely: string | null
}

export interface CycleRequest {
  event_types?: string[]
  min_period_days?: number
  max_period_days?: number
  min_strength?: number
}

export interface ChangePointRequest {
  event_type?: string
  location?: string
  window_days?: number
  min_confidence?: number
}

export interface SequenceRequest {
  event_types?: string[]
  min_support?: number
  max_gap_days?: number
  limit?: number
}

// API Functions
export const temporalApi = {
  /**
   * Detect cycles
   */
  async detectCycles(params: CycleRequest = {}): Promise<Cycle[]> {
    const response = await apiClient.post('/temporal/cycles', params)
    return response.data.cycles
  },

  /**
   * Detect change points
   */
  async detectChangePoints(params: ChangePointRequest = {}): Promise<ChangePoint[]> {
    const response = await apiClient.post('/temporal/changepoints', params)
    return response.data.changepoints
  },

  /**
   * Mine event sequences
   */
  async mineSequences(params: SequenceRequest = {}): Promise<EventSequence[]> {
    const response = await apiClient.post('/temporal/sequences', params)
    return response.data.sequences
  },

  /**
   * Get temporal summary
   */
  async getSummary(): Promise<Record<string, any>> {
    const response = await apiClient.get('/temporal/summary')
    return response.data
  },

  /**
   * Get upcoming pattern occurrences
   */
  async getUpcoming(days: number = 14): Promise<Array<{
    pattern_type: string
    description: string
    expected_date: string
    probability: number
  }>> {
    const response = await apiClient.get('/temporal/upcoming', {
      params: { days }
    })
    return response.data.upcoming
  },

  /**
   * Get Nepal calendar events
   */
  async getNepalCalendar(month?: number): Promise<Array<{
    date: string
    event_name: string
    event_type: string
    impact_level: string
  }>> {
    const response = await apiClient.get('/temporal/calendar', {
      params: month ? { month } : {}
    })
    return response.data.events
  },
}

export default temporalApi
