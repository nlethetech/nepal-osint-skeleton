/**
 * NewsFeedWidget - Real-time live news feed via WebSocket
 *
 * Shows raw news stories as they arrive from RSS ingestion.
 * Updates in near real-time without page refresh.
 * Groups stories by cluster_id to show multi-source verification.
 */

import { memo, useState, useMemo, useCallback } from 'react'
import { Rss, ExternalLink, Wifi, WifiOff, Users, ChevronDown, ShieldCheck, CheckCircle } from 'lucide-react'
import { Widget } from '../Widget'
import { useNewsFeed, NewsItem } from '../../../hooks/useNewsFeed'
import { useRequestFactCheck } from '../../../api/hooks'
import { WidgetError, WidgetEmpty, formatTimeAgo } from './shared'

interface GroupedNewsItem {
  id: string
  title: string
  category?: string
  severity?: string
  published_at?: string
  created_at?: string
  sources: NewsItem[]
}

export const NewsFeedWidget = memo(function NewsFeedWidget() {
  const { items, isConnected, error } = useNewsFeed({
    autoConnect: true,
  })
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null)
  const [requestedStories, setRequestedStories] = useState<Set<string>>(new Set())
  const [factCheckConfirm, setFactCheckConfirm] = useState<string | null>(null)
  const factCheckMutation = useRequestFactCheck()

  const handleFactCheckClick = useCallback((storyId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (requestedStories.has(storyId)) return
    setFactCheckConfirm(storyId)
  }, [requestedStories])

  const confirmFactCheck = useCallback(() => {
    if (!factCheckConfirm) return
    const storyId = factCheckConfirm
    factCheckMutation.mutate(storyId, {
      onSuccess: () => {
        setRequestedStories(prev => new Set(prev).add(storyId))
      },
    })
    setFactCheckConfirm(null)
  }, [factCheckConfirm, factCheckMutation])

  // Group items by cluster_id for multi-source display
  const groupedItems = useMemo(() => {
    const groups = new Map<string, GroupedNewsItem>()

    items.forEach(item => {
      const groupKey = item.cluster_id || `standalone_${item.id}`

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          title: item.title,
          category: item.category,
          severity: item.severity,
          published_at: item.published_at,
          created_at: item.created_at,
          sources: [item],
        })
      } else {
        const group = groups.get(groupKey)!
        group.sources.push(item)
        // Use most recent timestamp
        const itemTime = item.published_at || item.created_at
        const groupTime = group.published_at || group.created_at
        if (itemTime && groupTime && new Date(itemTime) > new Date(groupTime)) {
          group.published_at = item.published_at
          group.created_at = item.created_at
        }
        // Use highest severity
        if (item.severity === 'critical' || (item.severity === 'high' && group.severity !== 'critical')) {
          group.severity = item.severity
        }
      }
    })

    return Array.from(groups.values())
      .sort((a, b) => {
        const timeA = new Date(a.published_at || a.created_at || 0).getTime()
        const timeB = new Date(b.published_at || b.created_at || 0).getTime()
        return timeB - timeA
      })
  }, [items])

  // Map severity to badge display
  const getSeverityBadge = (severity?: string) => {
    const badges: Record<string, { text: string; className: string }> = {
      critical: { text: 'CRIT', className: 'critical' },
      high: { text: 'HIGH', className: 'high' },
      medium: { text: 'MED', className: 'medium' },
      low: { text: 'LOW', className: 'low' },
    }
    return badges[severity || 'low'] || badges.low
  }

  // Get category color
  const getCategoryClass = (category?: string) => {
    const classes: Record<string, string> = {
      political: 'tag-political',
      economic: 'tag-economic',
      security: 'tag-security',
      disaster: 'tag-disaster',
      social: 'tag-social',
    }
    return classes[category || ''] || ''
  }

  if (error && items.length === 0) {
    return (
      <Widget
        id="newsfeed"
        icon={<Rss size={14} />}
        actions={
          <span className="connection-status disconnected">
            <WifiOff size={12} />
          </span>
        }
      >
        <WidgetError message={error} onRetry={() => window.location.reload()} />
      </Widget>
    )
  }

  if (items.length === 0) {
    return (
      <Widget
        id="newsfeed"
        icon={<Rss size={14} />}
        actions={
          <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          </span>
        }
      >
        <WidgetEmpty message="Waiting for news..." />
      </Widget>
    )
  }

  return (
    <Widget
      id="newsfeed"
      icon={<Rss size={14} />}
      badge={groupedItems.length}
      actions={
        <>
          {items.length > groupedItems.length && (
            <span className="source-count-badge" style={{ marginRight: 8 }}>
              <Users size={10} />
              {items.length} total
            </span>
          )}
          <span
            className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}
            title={isConnected ? 'Live' : 'Reconnecting...'}
          >
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="status-text">{isConnected ? 'LIVE' : 'OFFLINE'}</span>
          </span>
        </>
      }
    >
      <div className="feed-list live-feed live-feed-scroll">
        {groupedItems.map((group) => {
          const badge = getSeverityBadge(group.severity)
          const isMultiSource = group.sources.length > 1
          const isExpanded = expandedCluster === group.id

          return (
            <div key={group.id} className="feed-item">
              <div className={`feed-indicator ${isMultiSource ? 'verified' : badge.className}`} />
              <div className="feed-content">
                <div className="feed-meta">
                  <span className={`feed-badge ${badge.className}`}>{badge.text}</span>
                  {group.category && (
                    <span className={`feed-tag ${getCategoryClass(group.category)}`}>
                      {group.category}
                    </span>
                  )}
                  {isMultiSource && (
                    <span className="source-count-badge">
                      <Users size={10} />
                      {group.sources.length} sources
                    </span>
                  )}
                  {group.sources.length >= 2 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '2px',
                      fontSize: '8px', fontWeight: 700, letterSpacing: '0.3px',
                      padding: '1px 5px', borderRadius: '2px',
                      background: '#23855118', color: '#238551',
                    }}>
                      <CheckCircle size={8} />
                      VERIFIED
                    </span>
                  )}
                  {group.sources.length >= 3 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '2px',
                      fontSize: '8px', fontWeight: 700, letterSpacing: '0.3px',
                      padding: '1px 5px', borderRadius: '2px',
                      background: '#2D72D218', color: '#2D72D2',
                    }}>
                      <ShieldCheck size={8} />
                      FACT-CHECKED
                    </span>
                  )}
                </div>
                <span className="feed-title">
                  {group.title}
                </span>
                <div className="feed-time">
                  {formatTimeAgo(group.published_at || group.created_at)}
                  {!isMultiSource && group.sources[0]?.source_name && (
                    <span className="feed-source">{group.sources[0].source_name}</span>
                  )}
                  {isMultiSource ? (
                    <button
                      className="expand-btn"
                      onClick={() => setExpandedCluster(isExpanded ? null : group.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: 'var(--osint-muted)',
                      }}
                    >
                      <ChevronDown
                        size={14}
                        style={{
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                        }}
                      />
                    </button>
                  ) : (
                    <a
                      href={group.sources[0]?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-link"
                      title="Open source"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                  {/* Fact-check request button */}
                  {(() => {
                    const storyId = group.sources[0]?.id
                    if (!storyId) return null
                    const alreadyRequested = requestedStories.has(storyId)
                    return (
                      <button
                        onClick={(e) => handleFactCheckClick(storyId, e)}
                        disabled={alreadyRequested || factCheckMutation.isPending}
                        title={alreadyRequested ? 'Fact-check requested' : 'Request fact-check'}
                        style={{
                          background: 'none', border: 'none', cursor: alreadyRequested ? 'default' : 'pointer',
                          padding: '2px 4px', display: 'inline-flex', alignItems: 'center', gap: '2px',
                          color: alreadyRequested ? 'var(--status-low)' : 'var(--text-muted)',
                          opacity: alreadyRequested ? 0.7 : 1,
                          fontSize: '10px', transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { if (!alreadyRequested) e.currentTarget.style.color = 'var(--accent-primary)' }}
                        onMouseLeave={e => { if (!alreadyRequested) e.currentTarget.style.color = 'var(--text-muted)' }}
                      >
                        <ShieldCheck size={11} />
                      </button>
                    )
                  })()}
                </div>

                {/* Expanded sources list — show developing timeline */}
                {isExpanded && isMultiSource && (
                  <div className="cluster-stories" style={{ marginTop: 8 }}>
                    <div style={{
                      fontSize: '9px',
                      color: 'var(--osint-success)',
                      fontWeight: 600,
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      {group.sources.length} sources — developing story
                    </div>
                    {group.sources
                      .sort((a, b) => {
                        const ta = new Date(b.published_at || b.created_at || 0).getTime()
                        const tb = new Date(a.published_at || a.created_at || 0).getTime()
                        return ta - tb
                      })
                      .map((source) => (
                      <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cluster-story-link"
                        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                          <span className="cluster-story-source">
                            {source.source_name || source.source_id}
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--text-disabled)', marginLeft: 'auto' }}>
                            {formatTimeAgo(source.published_at || source.created_at)}
                          </span>
                          <ExternalLink size={10} />
                        </div>
                        {source.title !== group.title && (
                          <span className="cluster-story-title" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {source.title}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fact-check confirmation popup */}
      {factCheckConfirm && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        }} onClick={() => setFactCheckConfirm(null)}>
          <div
            style={{
              background: 'var(--bg-elevated, #1C2127)',
              border: '1px solid var(--border-default, #404854)',
              borderRadius: '8px', padding: '20px 24px',
              maxWidth: '320px', width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Request Fact Check
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
              Do you want to put this story up for fact-check? Our AI analyst will verify the key claims.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setFactCheckConfirm(null)}
                style={{
                  padding: '6px 16px', fontSize: '11px', fontWeight: 600,
                  background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                  borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmFactCheck}
                style={{
                  padding: '6px 16px', fontSize: '11px', fontWeight: 600,
                  background: 'rgba(45, 114, 210, 0.2)', border: '1px solid rgba(45, 114, 210, 0.4)',
                  borderRadius: '4px', color: '#5C9CF5', cursor: 'pointer',
                }}
              >
                Yes, Fact Check
              </button>
            </div>
          </div>
        </div>
      )}
    </Widget>
  )
});
