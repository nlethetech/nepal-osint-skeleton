/**
 * GandakiNewsFeed Component
 *
 * News feed filtered to Gandaki sources and related content.
 * Uses REST API for reliable data fetching (same as main LiveFeed).
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Newspaper, ExternalLink, RefreshCw, Loader2, AlertCircle, LogIn } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useGandakiDashboardStore, getTimeRangeHours } from '../../stores/gandakiDashboardStore'
import { GANDAKI_DISTRICTS } from '../../data/gandaki'
import { useAuthStore } from '../../store/slices/authSlice'
import apiClient from '../../api/client'
import './GandakiNewsFeed.css'

// Gandaki news source IDs - matches backend config
const GANDAKI_SOURCE_IDS = [
  'gandaki_ratopati',
  'gandaki_ekantipur',
  'gandaki_onlinekhabar',
  'gandaknews',
  'ganthan_news',
  'pokharahotline',
]

// Source patterns to match (partial matching)
const GANDAKI_SOURCE_PATTERNS = [
  'gandaki',
  'pokhara',
  'gandak',
]

// Keywords that indicate Gandaki-related content
const GANDAKI_KEYWORDS = [
  // Province name
  'gandaki', 'gandaki province', 'गण्डकी', 'गण्डकी प्रदेश',
  // Major city
  'pokhara', 'पोखरा',
  // Geographic features
  'annapurna', 'अन्नपूर्ण', 'fewa', 'phewa', 'फेवा',
  'seti river', 'kaligandaki', 'कालीगण्डकी', 'marsyangdi',
  // District HQs
  'besisahar', 'damauli', 'kawasoti', 'putalibazar', 'kusma', 'beni', 'jomsom', 'chame',
  // Districts
  ...GANDAKI_DISTRICTS.map(d => d.toLowerCase()),
]

// District aliases for better matching
const DISTRICT_ALIASES: Record<string, string[]> = {
  'nawalparasi east': ['nawalpur', 'kawasoti'],
  'tanahu': ['tanahun', 'damauli'],
  'kaski': ['pokhara', 'fewa', 'phewa'],
  'gorkha': ['barpak', 'manakamana'],
  'mustang': ['jomsom', 'lo manthang', 'muktinath'],
  'manang': ['chame', 'thorong'],
  'myagdi': ['beni', 'tatopani'],
  'baglung': ['baglung bazar'],
  'parbat': ['kusma'],
  'syangja': ['putalibazar', 'waling'],
  'lamjung': ['besisahar'],
}

interface NewsStory {
  id: string
  title: string
  url: string
  source_id: string
  source_name?: string
  severity?: string
  story_type?: string
  source_count?: number
  timestamp: string
  source_links?: Array<{ source_id: string; url: string; title?: string }>
}

function safeFormatTimeAgo(timestamp: string | null | undefined): string {
  if (!timestamp) return 'recently'
  try {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return 'recently'
    return formatDistanceToNow(date, { addSuffix: true })
  } catch {
    return 'recently'
  }
}

// Check if a news item is from Gandaki sources or mentions Gandaki content
function isGandakiRelated(story: NewsStory): boolean {
  const sourceId = (story.source_id || '').toLowerCase()
  const sourceName = (story.source_name || '').toLowerCase()

  // Check exact source ID match
  if (GANDAKI_SOURCE_IDS.some(id => sourceId === id)) {
    return true
  }

  // Check source ID/name contains Gandaki patterns
  if (GANDAKI_SOURCE_PATTERNS.some(pattern =>
    sourceId.includes(pattern) || sourceName.includes(pattern)
  )) {
    return true
  }

  // Check content for Gandaki keywords
  const titleLower = (story.title || '').toLowerCase()
  for (const keyword of GANDAKI_KEYWORDS) {
    if (titleLower.includes(keyword)) {
      return true
    }
  }

  return false
}

// Get a display-friendly source name
function getSourceDisplayName(story: NewsStory): string {
  if (story.source_name) return story.source_name

  const sourceId = story.source_id || ''
  const displayMap: Record<string, string> = {
    'gandaki_ratopati': 'Ratopati Gandaki',
    'gandaki_ekantipur': 'eKantipur Gandaki',
    'gandaki_onlinekhabar': 'OnlineKhabar Gandaki',
    'gandaknews': 'Gandak News',
    'ganthan_news': 'Ganthan News',
    'pokharahotline': 'Pokhara Hotline',
    'ratopati': 'Ratopati',
    'ekantipur': 'eKantipur',
    'onlinekhabar_ne': 'OnlineKhabar',
    'onlinekhabar_en': 'OnlineKhabar EN',
    'tkp': 'Kathmandu Post',
    'himalayan': 'Himalayan Times',
    'republica': 'My Republica',
    'setopati': 'Setopati',
    'nagariknews': 'Nagarik News',
    'annapurnapost': 'Annapurna Post',
    'multiple': 'Multiple Sources',
  }

  return displayMap[sourceId] || sourceId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

interface GandakiNewsFeedProps {
  onNewsCountChange?: (count: number) => void
}

export function GandakiNewsFeed({ onNewsCountChange }: GandakiNewsFeedProps) {
  const { viewScope, selectedDistrict, timeRange } = useGandakiDashboardStore()
  const { token, isAuthenticated } = useAuthStore()
  const [stories, setStories] = useState<NewsStory[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<'auth' | 'network' | 'server' | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const hours = getTimeRangeHours(timeRange)

  // Fetch stories from REST API
  const fetchStories = useCallback(async (isRetry = false) => {
    if (isLoading) return
    setIsLoading(true)
    if (!isRetry) {
      setError(null)
      setErrorType(null)
    }

    try {
      console.log('[GandakiNewsFeed] Fetching stories...', { hours, hasToken: !!token })

      // Fetch consolidated stories using proper axios params
      const response = await apiClient.get('/analytics/consolidated-stories', {
        params: {
          hours,
          limit: 150,
        },
        timeout: 15000, // 15 second timeout
      })

      if (response.status === 200) {
        const data = response.data || []
        console.log('[GandakiNewsFeed] Fetched', data.length, 'stories')

        // Map API response to our format
        const formattedStories: NewsStory[] = data.map((story: Record<string, unknown>) => {
          const sourceLinks = (story.source_links as Array<{ source_id: string; url: string; title?: string }>) || []
          const firstSource = sourceLinks[0]

          // Get valid timestamp
          let timestamp = story.last_updated_at || story.first_reported_at || story.created_at
          if (timestamp) {
            const date = new Date(timestamp as string)
            timestamp = isNaN(date.getTime()) ? new Date().toISOString() : (timestamp as string)
          } else {
            timestamp = new Date().toISOString()
          }

          return {
            id: (story.id as string) || `story_${Date.now()}_${Math.random()}`,
            title: (story.canonical_headline || story.canonical_headline_ne || 'Untitled') as string,
            url: firstSource?.url || '',
            source_id: firstSource?.source_id || 'multiple',
            source_name: story.source_name as string | undefined,
            severity: story.severity as string | undefined,
            story_type: story.story_type as string | undefined,
            source_count: (story.source_count as number) || 1,
            timestamp: timestamp as string,
            source_links: sourceLinks,
          }
        })

        setStories(formattedStories)
        setLastFetch(new Date())
        setError(null)
        setErrorType(null)
        setRetryCount(0)
      } else {
        throw new Error(`Server returned ${response.status}`)
      }
    } catch (err: unknown) {
      console.error('[GandakiNewsFeed] Fetch error:', err)

      // Determine error type for better UX
      const axiosError = err as { response?: { status: number }; code?: string; message?: string }

      if (axiosError.response?.status === 401) {
        setError('Login required to view news feed')
        setErrorType('auth')
      } else if (axiosError.response?.status === 403) {
        setError('Access denied - insufficient permissions')
        setErrorType('auth')
      } else if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ERR_NETWORK') {
        setError('Cannot connect to server - check if backend is running')
        setErrorType('network')
      } else if (axiosError.response?.status && axiosError.response.status >= 500) {
        setError('Server error - please try again later')
        setErrorType('server')
      } else {
        setError(axiosError.message || 'Failed to load news')
        setErrorType('network')
      }

      // Auto-retry up to 3 times for network errors
      if (errorType === 'network' && retryCount < 3) {
        setRetryCount(prev => prev + 1)
        setTimeout(() => fetchStories(true), 3000 * (retryCount + 1))
      }
    } finally {
      setIsLoading(false)
    }
  }, [hours, isLoading, token, errorType, retryCount])

  // Initial fetch and polling
  useEffect(() => {
    fetchStories()

    // Poll every 60 seconds
    const interval = setInterval(fetchStories, 60 * 1000)
    return () => clearInterval(interval)
  }, []) // Only run once on mount

  // Re-fetch when time range changes
  useEffect(() => {
    fetchStories()
  }, [hours])

  // Filter stories based on scope and district selection
  const filteredStories = useMemo(() => {
    let filtered = stories

    // Filter to Gandaki-related if in Gandaki scope
    if (viewScope === 'gandaki') {
      filtered = filtered.filter(isGandakiRelated)
    }

    // Further filter by selected district
    if (selectedDistrict) {
      const districtLower = selectedDistrict.toLowerCase()
      const aliases = DISTRICT_ALIASES[districtLower] || []
      const searchTerms = [districtLower, ...aliases]

      filtered = filtered.filter(story => {
        const titleLower = (story.title || '').toLowerCase()
        return searchTerms.some(term => titleLower.includes(term))
      })
    }

    return filtered
  }, [stories, viewScope, selectedDistrict])

  // Notify parent of count change
  useEffect(() => {
    if (onNewsCountChange) {
      onNewsCountChange(filteredStories.length)
    }
  }, [filteredStories.length, onNewsCountChange])

  // Get severity style
  const getSeverityClass = (severity?: string) => {
    switch (severity) {
      case 'critical': return 'severity-critical'
      case 'high': return 'severity-high'
      case 'medium': return 'severity-medium'
      default: return ''
    }
  }

  if (error && stories.length === 0) {
    return (
      <div className="gandaki-news-feed">
        <div className="gandaki-news-header">
          <div className="gandaki-news-title">
            <h3><Newspaper size={16} /> News Feed</h3>
          </div>
        </div>
        <div className={`gandaki-news-error ${errorType || ''}`}>
          {errorType === 'auth' ? (
            <>
              <LogIn size={24} />
              <p>{error}</p>
              <a href="/login" className="gandaki-news-login-btn">
                <LogIn size={12} /> Go to Login
              </a>
            </>
          ) : (
            <>
              <AlertCircle size={24} />
              <p>{error}</p>
              {retryCount > 0 && retryCount < 3 && (
                <span className="retry-info">Retrying... ({retryCount}/3)</span>
              )}
              <button onClick={() => { fetchStories(false) }} disabled={isLoading}>
                <RefreshCw size={12} className={isLoading ? 'spinning' : ''} /> Retry
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="gandaki-news-feed">
      <div className="gandaki-news-header">
        <div className="gandaki-news-title">
          <h3><Newspaper size={16} /> News Feed</h3>
          <span className="gandaki-news-count">{filteredStories.length}</span>
        </div>
        <button
          className="gandaki-news-refresh"
          onClick={() => fetchStories()}
          disabled={isLoading}
          title={lastFetch ? `Last updated: ${lastFetch.toLocaleTimeString()}` : 'Refresh'}
        >
          {isLoading ? (
            <Loader2 size={14} className="spinning" />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
      </div>

      <div className="gandaki-news-content">
        {isLoading && stories.length === 0 ? (
          <div className="gandaki-news-loading">
            <Loader2 size={24} className="spinning" />
            <p>Loading news...</p>
          </div>
        ) : filteredStories.length === 0 ? (
          <div className="gandaki-news-empty">
            <Newspaper size={24} />
            <p>
              {viewScope === 'gandaki'
                ? 'No Gandaki news found'
                : 'No news available'
              }
            </p>
            <span>
              {stories.length > 0
                ? `${stories.length} total stories, none match ${viewScope === 'gandaki' ? 'Gandaki' : ''} filters`
                : 'Click refresh to load news'
              }
            </span>
            <button onClick={() => fetchStories()} disabled={isLoading}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        ) : (
          filteredStories.slice(0, 50).map((story) => (
            <a
              key={story.id}
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`gandaki-news-item ${getSeverityClass(story.severity)}`}
            >
              <div className="gandaki-news-item-content">
                <h4 className="gandaki-news-item-title">{story.title}</h4>
                <div className="gandaki-news-item-meta">
                  <span className="gandaki-news-source">
                    {getSourceDisplayName(story)}
                    {story.source_count && story.source_count > 1 && (
                      <span className="source-count">+{story.source_count - 1}</span>
                    )}
                  </span>
                  <span className="gandaki-news-time">{safeFormatTimeAgo(story.timestamp)}</span>
                </div>
              </div>
              <ExternalLink size={14} className="gandaki-news-link-icon" />
            </a>
          ))
        )}
      </div>
    </div>
  )
}
