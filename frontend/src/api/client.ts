import axios from 'axios'
import { useAuthStore } from '../store/slices/authSlice'

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1'])
const EXPLICIT_API_BASE = (import.meta.env.VITE_API_URL || '').trim()

function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.trim()

  // When no explicit base is set, use a relative path so the Vite dev-server
  // proxy (or any reverse-proxy in front of the app) routes requests correctly.
  // Local development sets VITE_API_URL explicitly in .env.development.
  if (!trimmed) {
    return '/api/v1'
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  if (withoutTrailingSlash.endsWith('/api/v1')) {
    return withoutTrailingSlash
  }
  if (withoutTrailingSlash.endsWith('/api')) {
    return `${withoutTrailingSlash}/v1`
  }
  return `${withoutTrailingSlash}/api/v1`
}

function isConnectedAnalystPath(url: string): boolean {
  return (
    url.startsWith('/graph/') ||
    url.startsWith('/trade/') ||
    url.startsWith('/pwtt/') ||
    url.startsWith('/procurement-analysis/') ||
    url.includes('/hypotheses')
  )
}

function isLocalBaseUrl(baseUrl: string): boolean {
  if (!baseUrl) {
    return false
  }
  if (typeof window !== 'undefined' && baseUrl.startsWith('/')) {
    return LOCALHOST_HOSTNAMES.has(window.location.hostname)
  }
  try {
    return LOCALHOST_HOSTNAMES.has(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

function getLocalFallbackBase(currentBaseUrl?: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const normalizedCurrent = normalizeApiBase(currentBaseUrl || API_BASE_URL)
  if (!isLocalBaseUrl(normalizedCurrent)) {
    return null
  }

  const candidates = ['http://localhost:8000', 'http://localhost:8001'].map(normalizeApiBase)

  for (const candidate of candidates) {
    if (candidate !== normalizedCurrent) {
      return candidate
    }
  }
  return null
}

export const API_BASE_URL = normalizeApiBase(EXPLICIT_API_BASE)

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Separate client without auth interceptors for token refresh
const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

let refreshPromise: Promise<string> | null = null

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle auth errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as any
    const requestUrl = typeof originalRequest?.url === 'string' ? originalRequest.url : ''

    // Localhost resilience: retry any network failure once against alternate local backend port.
    if (!originalRequest?._localRetry && error.code === 'ERR_NETWORK') {
      const fallbackBase = getLocalFallbackBase(originalRequest?.baseURL)
      if (fallbackBase) {
        originalRequest._localRetry = true
        originalRequest.baseURL = fallbackBase
        return apiClient.request(originalRequest)
      }
    }

    // Localhost resilience: if connected analyst endpoints hit the wrong local backend,
    // retry once against an alternate local API port.
    if (!originalRequest?._localRetry && isConnectedAnalystPath(requestUrl)) {
      const status = error.response?.status
      if (status === 404 || error.code === 'ERR_NETWORK') {
        const fallbackBase = getLocalFallbackBase(originalRequest?.baseURL)
        if (fallbackBase) {
          originalRequest._localRetry = true
          originalRequest.baseURL = fallbackBase
          return apiClient.request(originalRequest)
        }
      }
    }

    if (error.response?.status !== 401) {
      return Promise.reject(error)
    }

    // Avoid infinite loops + don't refresh for login/refresh itself
    if (originalRequest?._retry || requestUrl.includes('/auth/login') || requestUrl.includes('/auth/refresh')) {
      useAuthStore.getState().logout()
      return Promise.reject(error)
    }

    const refreshToken = useAuthStore.getState().refreshToken
    if (!refreshToken) {
      useAuthStore.getState().logout()
      return Promise.reject(error)
    }

    originalRequest._retry = true

    // Single in-flight refresh to prevent stampede
    if (!refreshPromise) {
      refreshPromise = refreshClient
        .post('/auth/refresh', { refresh_token: refreshToken })
        .then((res) => {
          const newToken = res.data?.access_token as string | undefined
          if (!newToken) {
            throw new Error('No access_token in refresh response')
          }
          useAuthStore.getState().updateToken(newToken)
          return newToken
        })
        .finally(() => {
          refreshPromise = null
        })
    }

    try {
      const newToken = await refreshPromise
      originalRequest.headers = originalRequest.headers || {}
      originalRequest.headers.Authorization = `Bearer ${newToken}`
      return apiClient.request(originalRequest)
    } catch (refreshError) {
      useAuthStore.getState().logout()
      return Promise.reject(refreshError)
    }
  }
)

export default apiClient
