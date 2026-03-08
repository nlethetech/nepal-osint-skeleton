import { useState, useEffect } from 'react'
import { ExternalLink, Newspaper } from 'lucide-react'
import { fetchEntityMentions, type Mention } from '../../api/elections'

interface ConstituencyNewsPanelProps {
  constituencyId: string
  constituencyName: string
}

export function ConstituencyNewsPanel({ constituencyId, constituencyName }: ConstituencyNewsPanelProps) {
  const [mentions, setMentions] = useState<Mention[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // Use constituencyName as lookup key since it's more likely to match
    // the KB entity's canonical_name than the slug-format constituencyId
    const lookupKey = constituencyName || constituencyId
    fetchEntityMentions(lookupKey, { limit: 10 })
      .then(r => setMentions(r.mentions))
      .catch(() => setMentions([]))
      .finally(() => setLoading(false))
  }, [constituencyId, constituencyName])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <span className="text-[10px] text-osint-muted animate-pulse">Loading news...</span>
      </div>
    )
  }

  if (mentions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-1">
        <Newspaper size={14} className="text-osint-muted" />
        <span className="text-[10px] text-osint-muted">No recent news for {constituencyName}</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
      {mentions.map((m, i) => (
        <div key={i} className="bg-osint-surface/50 rounded px-2 py-1.5">
          <a
            href={m.story_url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-osint-text hover:text-osint-primary flex items-center gap-1 line-clamp-1"
          >
            {m.story_title || 'Untitled'}
            <ExternalLink size={9} className="flex-shrink-0" />
          </a>
          {m.context_window && (
            <p className="text-[9px] text-osint-muted mt-0.5 line-clamp-1">
              ...{m.context_window}...
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            {m.source_name && <span className="text-[9px] text-osint-muted">{m.source_name}</span>}
            {m.published_at && (
              <span className="text-[9px] text-osint-muted">
                {new Date(m.published_at).toLocaleDateString()}
              </span>
            )}
            {m.sentiment_score !== 0 && (
              <span className={`text-[9px] ${m.sentiment_score > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {m.sentiment_score > 0 ? '+' : ''}{m.sentiment_score.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
