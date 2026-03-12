import { apiClient } from './client'

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'down'
  [key: string]: any
}

export interface SystemStatus {
  database: ComponentHealth & {
    pool_size: number
    active_connections: number
    waiting: number
    latency_ms: number
  }
  redis: ComponentHealth & {
    memory_used: string
    memory_peak: string
    connected_clients: number
    keys: number
  }
  workers: ComponentHealth & {
    scheduler_running: boolean
    registered_jobs: number
    next_run_in_seconds: number | null
  }
  queues: ComponentHealth & {
    ingestion_jobs: number
    processing_jobs: number
    realtime_jobs: number
  }
  uptime_seconds: number
  version: string
  environment: string
  last_deployment: string | null
}

export interface EndpointMetric {
  path: string
  method: string
  count: number
  avg_ms: number
  p95_ms: number
  errors: number
}

export interface ApiMetrics {
  request_count: number
  error_count: number
  error_rate: number
  avg_response_ms: number
  p95_response_ms: number
  p99_response_ms: number
  endpoints: EndpointMetric[]
  period: string
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const { data } = await apiClient.get('/system/status')
  return data
}

export async function fetchApiMetrics(period: string = '24h'): Promise<ApiMetrics> {
  const { data } = await apiClient.get('/system/metrics', { params: { period } })
  return data
}
