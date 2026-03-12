import { useEffect, useState } from 'react'
import { ExternalLink, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../common/Modal'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { getStory } from '../../api/stories'
import type { Story } from '../../types/api'

interface StoryDetailModalProps {
  storyId: string | null
  onClose: () => void
}

export function StoryDetailModal({ storyId, onClose }: StoryDetailModalProps) {
  const navigate = useNavigate()
  const [story, setStory] = useState<Story | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storyId) {
      setStory(null)
      return
    }

    async function fetchStory(id: string) {
      setLoading(true)
      setError(null)
      try {
        const data = await getStory(id)
        setStory(data)
      } catch (err) {
        setError('Failed to load story details')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchStory(storyId)
  }, [storyId])

  return (
    <Modal
      isOpen={!!storyId}
      onClose={onClose}
      title="Story Details"
      size="lg"
    >
      {loading && <LoadingSpinner message="Loading story..." />}

      {error && (
        <div className="text-center text-severity-critical py-4">{error}</div>
      )}

      {story && !loading && (
        <div className="space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-1 bg-osint-accent/20 text-osint-accent text-sm rounded">
                {story.source_id}
              </span>
              <span className="px-2 py-1 bg-osint-border text-osint-muted text-sm rounded">
                {story.language.toUpperCase()}
              </span>
            </div>
            <h3 className="text-xl font-semibold leading-relaxed">{story.title}</h3>
            {story.title_ne && (
              <p className="text-lg text-osint-muted mt-2">{story.title_ne}</p>
            )}
          </div>

          {/* Meta */}
          <div className="flex items-center gap-6 text-sm">
            {story.published_at && (
              <div className="flex items-center gap-2 text-osint-muted">
                <Calendar className="w-4 h-4" />
                <span>
                  {format(new Date(story.published_at), 'MMMM d, yyyy')} at{' '}
                  {format(new Date(story.published_at), 'HH:mm')}
                </span>
              </div>
            )}
          </div>

          {/* Summary */}
          {story.summary && (
            <div className="space-y-2">
              <h4 className="font-medium text-osint-muted">Summary</h4>
              <p className="text-osint-text leading-relaxed">{story.summary}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-osint-border">
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Read Full Article
            </a>
            <button
              onClick={() => {
                navigate(`/dossier/story/${story.id}`)
                onClose()
              }}
              className="flex-1 px-4 py-2 bg-osint-border hover:bg-osint-border/70 rounded-lg transition-colors"
            >
              Open Dossier
            </button>
          </div>

          {/* External ID */}
          <div className="text-xs text-osint-muted pt-2">
            ID: {story.external_id}
          </div>
        </div>
      )}
    </Modal>
  )
}
