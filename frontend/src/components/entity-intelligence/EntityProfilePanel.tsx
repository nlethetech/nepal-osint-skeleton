import { useEffect, useState } from 'react'
import {
  User,
  Users,
  Building,
  Landmark,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  RefreshCw,
  GitBranch,
  Newspaper,
  BarChart3,
  ChevronRight,
  Crown,
  Target,
} from 'lucide-react'
import { Button, Tag, Intent, Spinner, Tabs, Tab } from '@blueprintjs/core'
import { getEntityProfile, type EntityProfile } from '../../api/entityIntelligence'

interface EntityProfilePanelProps {
  entityId: string
  onStoryClick?: (storyId: string) => void
  onEntityClick?: (entityId: string) => void
  className?: string
}

const ENTITY_TYPE_ICONS: Record<string, typeof User> = {
  person: User,
  party: Users,
  organization: Building,
  institution: Landmark,
}

export function EntityProfilePanel({
  entityId,
  onStoryClick,
  onEntityClick,
  className = '',
}: EntityProfilePanelProps) {
  const [profile, setProfile] = useState<EntityProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'stories' | 'network' | 'parliament'>('overview')

  useEffect(() => {
    loadProfile()
  }, [entityId])

  const loadProfile = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await getEntityProfile(entityId)
      setProfile(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <Spinner size={24} intent={Intent.PRIMARY} />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center">
          <p className="text-sm text-red-400 mb-2">{error || 'Profile not found'}</p>
          <button
            onClick={loadProfile}
            className="text-xs hover:underline"
            style={{ color: '#5c7cba' }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const { entity, mention_summary, network_metrics, recent_stories, top_co_mentions, parliament_record } = profile
  const Icon = ENTITY_TYPE_ICONS[entity.entity_type] || User
  const metrics7d = network_metrics?.['7d']

  const getTrendIcon = () => {
    switch (entity.trend) {
      case 'rising': return <TrendingUp size={12} className="text-green-400" />
      case 'falling': return <TrendingDown size={12} className="text-red-400" />
      default: return <Minus size={12} className="text-gray-400" />
    }
  }

  return (
    <div className={`flex flex-col h-full ${className}`} style={{ backgroundColor: '#141416' }}>
      {/* Header */}
      <div className="p-4" style={{ borderBottom: '1px solid #252528' }}>
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ backgroundColor: '#1a1a1c' }}
          >
            {entity.image_url ? (
              <img
                src={entity.image_url}
                alt={entity.name_en}
                className="w-full h-full object-cover"
              />
            ) : (
              <Icon size={28} style={{ color: '#b6bcc8' }} />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold truncate" style={{ color: '#e8e8ea' }}>
                {entity.name_en}
              </h2>
              {metrics7d?.is_hub && (
                <Tag minimal intent={Intent.PRIMARY} style={{ fontSize: 9, minHeight: 'auto', padding: '1px 6px' }}>HUB</Tag>
              )}
              {metrics7d?.is_bridge && (
                <Tag minimal style={{ fontSize: 9, minHeight: 'auto', padding: '1px 6px', backgroundColor: 'rgba(6,182,212,0.2)', color: '#22d3ee' }}>BRIDGE</Tag>
              )}
            </div>
            {entity.name_ne && (
              <p className="text-sm mb-1" style={{ color: '#b6bcc8' }}>{entity.name_ne}</p>
            )}
            <div className="flex items-center gap-2 text-xs" style={{ color: '#b6bcc8' }}>
              <span className="capitalize">{entity.entity_type}</span>
              {entity.party && (
                <>
                  <span>•</span>
                  <span>{entity.party}</span>
                </>
              )}
              {entity.role && (
                <>
                  <span>•</span>
                  <span>{entity.role}</span>
                </>
              )}
            </div>
          </div>

          {/* Refresh */}
          <Button
            minimal
            small
            icon="refresh"
            onClick={loadProfile}
            style={{ color: '#b6bcc8' }}
          />
        </div>

        {/* Mention Stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <StatCard
            label="24h"
            value={entity.mentions_24h}
            trend={entity.trend}
          />
          <StatCard
            label="7d"
            value={entity.mentions_7d}
          />
          <StatCard
            label="Total"
            value={entity.total_mentions}
          />
          <StatCard
            label="Rank"
            value={metrics7d?.influence_rank ? `#${metrics7d.influence_rank}` : '-'}
            icon={<Crown size={10} className="text-yellow-400" />}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #252528' }}>
      <Tabs
        id="entity-profile-tabs"
        selectedTabId={activeTab}
        onChange={(t) => setActiveTab(t as any)}
        renderActiveTabPanelOnly
      >
        <Tab
          id="overview"
          title={
            <span className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
              <BarChart3 size={12} />Overview
            </span>
          }
        />
        <Tab
          id="stories"
          title={
            <span className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
              <Newspaper size={12} />Stories
              {recent_stories && recent_stories.length > 0 && (
                <span
                  className="text-[10px] px-1 py-0.5 rounded"
                  style={{ backgroundColor: '#1a1a1c' }}
                >
                  {recent_stories.length}
                </span>
              )}
            </span>
          }
        />
        <Tab
          id="network"
          title={
            <span className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
              <GitBranch size={12} />Network
              {top_co_mentions && top_co_mentions.length > 0 && (
                <span
                  className="text-[10px] px-1 py-0.5 rounded"
                  style={{ backgroundColor: '#1a1a1c' }}
                >
                  {top_co_mentions.length}
                </span>
              )}
            </span>
          }
        />
        {parliament_record && (
          <Tab
            id="parliament"
            title={
              <span className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
                <Landmark size={12} />Parliament
              </span>
            }
          />
        )}
      </Tabs>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <OverviewTab
            profile={profile}
            onEntityClick={onEntityClick}
          />
        )}
        {activeTab === 'stories' && (
          <StoriesTab
            stories={recent_stories || []}
            onStoryClick={onStoryClick}
          />
        )}
        {activeTab === 'network' && (
          <NetworkTab
            topCoMentions={top_co_mentions || []}
            metrics={metrics7d}
            onEntityClick={onEntityClick}
          />
        )}
        {activeTab === 'parliament' && parliament_record && (
          <ParliamentTab record={parliament_record} />
        )}
      </div>
    </div>
  )
}

// Stat Card Component
function StatCard({
  label,
  value,
  trend,
  icon,
}: {
  label: string
  value: number | string
  trend?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: '#1a1a1c' }}>
      <div className="text-[10px] mb-0.5" style={{ color: '#b6bcc8' }}>{label}</div>
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold" style={{ color: '#e8e8ea' }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {trend && (
          trend === 'rising' ? (
            <TrendingUp size={10} className="text-green-400" />
          ) : trend === 'falling' ? (
            <TrendingDown size={10} className="text-red-400" />
          ) : null
        )}
        {icon}
      </div>
    </div>
  )
}

// Overview Tab
function OverviewTab({
  profile,
  onEntityClick,
}: {
  profile: EntityProfile
  onEntityClick?: (id: string) => void
}) {
  const { entity, mention_summary, story_categories, top_co_mentions } = profile
  const extraData = entity.extra_data as Record<string, unknown> | undefined
  const partnerArchitecture = (
    extraData?.partner_architecture &&
    typeof extraData.partner_architecture === 'object'
      ? extraData.partner_architecture as Record<string, unknown>
      : undefined
  )
  const cooperationGroup = (
    extraData?.development_cooperation_group &&
    typeof extraData.development_cooperation_group === 'object'
      ? extraData.development_cooperation_group as Record<string, unknown>
      : undefined
  )

  return (
    <div className="p-4 space-y-6">
      {/* Description */}
      {entity.description && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>About</h4>
          <p className="text-xs leading-relaxed" style={{ color: '#b6bcc8' }}>
            {entity.description}
          </p>
        </div>
      )}

      {/* DFIMS Metadata */}
      {extraData?.source === 'dfims' && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>Development Finance</h4>
          <div className="grid grid-cols-2 gap-2">
            {typeof extraData?.abbreviation === 'string' && (
              <InfoCard label="Abbreviation" value={extraData.abbreviation} />
            )}
            {typeof partnerArchitecture?.name === 'string' && (
              <InfoCard label="Architecture" value={partnerArchitecture.name} />
            )}
            {typeof cooperationGroup?.name === 'string' && (
              <InfoCard label="Cooperation Group" value={cooperationGroup.name} />
            )}
            {typeof extraData?.iati_identifier === 'string' && (
              <InfoCard label="IATI ID" value={extraData.iati_identifier} />
            )}
          </div>
        </div>
      )}

      {/* Aliases */}
      {entity.aliases.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>Also Known As</h4>
          <div className="flex flex-wrap gap-1">
            {entity.aliases.map((alias, i) => (
              <span
                key={i}
                className="px-2 py-0.5 text-[10px] rounded"
                style={{ backgroundColor: '#1a1a1c', color: '#b6bcc8' }}
              >
                {alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Story Categories */}
      {story_categories && Object.keys(story_categories).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>Coverage by Category</h4>
          <div className="space-y-1">
            {Object.entries(story_categories)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([category, count]) => {
                const total = Object.values(story_categories).reduce((a, b) => a + b, 0)
                const percentage = (count / total) * 100

                return (
                  <div key={category} className="flex items-center gap-2">
                    <span className="text-[10px] w-20 capitalize truncate" style={{ color: '#b6bcc8' }}>
                      {category}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1a1c' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${percentage}%`, backgroundColor: '#5c7cba' }}
                      />
                    </div>
                    <span className="text-[10px] w-8 text-right" style={{ color: '#b6bcc8' }}>
                      {count}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Top Co-mentions */}
      {top_co_mentions && top_co_mentions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>
            Top Connections
          </h4>
          <div className="space-y-1">
            {top_co_mentions.slice(0, 5).map((item) => (
              <button
                key={item.entity.id}
                onClick={() => onEntityClick?.(item.entity.id)}
                className="w-full flex items-center gap-2 p-2 rounded-lg transition-colors text-left"
                style={{ backgroundColor: 'transparent' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#1a1a1c' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#1a1a1c' }}
                >
                  <User size={12} style={{ color: '#b6bcc8' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs truncate block" style={{ color: '#e8e8ea' }}>
                    {item.entity.name_en}
                  </span>
                  <span className="text-[10px]" style={{ color: '#b6bcc8' }}>
                    {item.entity.party}
                  </span>
                </div>
                <span className="text-[10px]" style={{ color: '#b6bcc8' }}>
                  {item.co_mention_count} co-mentions
                </span>
                <ChevronRight size={12} style={{ color: '#b6bcc8' }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Stories Tab
function StoriesTab({
  stories,
  onStoryClick,
}: {
  stories: EntityProfile['recent_stories']
  onStoryClick?: (id: string) => void
}) {
  if (!stories || stories.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs" style={{ color: '#b6bcc8' }}>
        No recent stories
      </div>
    )
  }

  return (
    <div style={{ borderColor: '#252528' }}>
      {stories.map((story, idx) => (
        <button
          key={story.id}
          onClick={() => onStoryClick?.(story.id)}
          className="w-full p-3 text-left transition-colors"
          style={{
            backgroundColor: 'transparent',
            borderBottom: idx < stories.length - 1 ? '1px solid #252528' : 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#1a1a1c' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h5 className="text-xs font-medium line-clamp-2 mb-1" style={{ color: '#e8e8ea' }}>
                {story.title}
              </h5>
              <div className="flex items-center gap-2 text-[10px]" style={{ color: '#b6bcc8' }}>
                <span>{story.source_name}</span>
                {story.category && (
                  <>
                    <span>•</span>
                    <span className="capitalize">{story.category}</span>
                  </>
                )}
                {story.published_at && (
                  <>
                    <span>•</span>
                    <span>{new Date(story.published_at).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
            {story.is_title_mention && (
              <span
                className="px-1 py-0.5 text-[8px] rounded"
                style={{ backgroundColor: 'rgba(92,124,186,0.15)', color: '#5c7cba' }}
              >
                TITLE
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

// Network Tab
function NetworkTab({
  topCoMentions,
  metrics,
  onEntityClick,
}: {
  topCoMentions: EntityProfile['top_co_mentions']
  metrics?: NonNullable<EntityProfile['network_metrics']>['7d']
  onEntityClick?: (id: string) => void
}) {
  return (
    <div className="p-4 space-y-6">
      {/* Network Metrics */}
      {metrics && (
        <div>
          <h4 className="text-xs font-semibold mb-3" style={{ color: '#b6bcc8' }}>
            Network Metrics (7d)
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="PageRank" value={metrics.pagerank?.toFixed(4)} />
            <MetricCard label="Degree" value={metrics.degree_centrality?.toFixed(4)} />
            <MetricCard label="Betweenness" value={metrics.betweenness_centrality?.toFixed(4)} />
            <MetricCard label="Clustering" value={metrics.clustering_coefficient?.toFixed(4)} />
            <MetricCard label="Connections" value={metrics.total_connections} />
            <MetricCard label="Cluster ID" value={metrics.cluster_id} />
          </div>
        </div>
      )}

      {/* Co-mentions */}
      {topCoMentions && topCoMentions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>
            Co-mentioned With
          </h4>
          <div className="space-y-1">
            {topCoMentions.map((item) => (
              <button
                key={item.entity.id}
                onClick={() => onEntityClick?.(item.entity.id)}
                className="w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left"
                style={{ backgroundColor: 'transparent' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#1a1a1c' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#1a1a1c' }}
                >
                  <User size={14} style={{ color: '#b6bcc8' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium block truncate" style={{ color: '#e8e8ea' }}>
                    {item.entity.name_en}
                  </span>
                  <span className="text-[10px]" style={{ color: '#b6bcc8' }}>
                    {item.entity.party}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono" style={{ color: '#b6bcc8' }}>
                    {item.co_mention_count}
                  </div>
                  <div className="text-[9px]" style={{ color: '#b6bcc8' }}>
                    co-mentions
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: '#1a1a1c' }}>
      <div className="text-[9px] mb-0.5" style={{ color: '#b6bcc8' }}>{label}</div>
      <div className="text-xs font-mono" style={{ color: '#b6bcc8' }}>
        {value ?? '-'}
      </div>
    </div>
  )
}

// Parliament Tab
function ParliamentTab({ record }: { record: NonNullable<EntityProfile['parliament_record']> }) {
  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {record.constituency && (
          <InfoCard label="Constituency" value={record.constituency} />
        )}
        {record.election_type && (
          <InfoCard label="Election Type" value={record.election_type} />
        )}
        {record.term_start && (
          <InfoCard label="Term Start" value={new Date(record.term_start).toLocaleDateString()} />
        )}
        {record.term_end && (
          <InfoCard label="Term End" value={new Date(record.term_end).toLocaleDateString()} />
        )}
        <InfoCard label="Speeches" value={record.speeches_count.toString()} />
        <InfoCard label="Questions" value={record.questions_count.toString()} />
        {record.attendance_rate !== undefined && (
          <InfoCard label="Attendance" value={`${(record.attendance_rate * 100).toFixed(1)}%`} />
        )}
      </div>

      {record.committee_memberships && record.committee_memberships.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: '#b6bcc8' }}>
            Committee Memberships
          </h4>
          <div className="space-y-1">
            {record.committee_memberships.map((committee, i) => (
              <div
                key={i}
                className="px-2 py-1.5 text-xs rounded"
                style={{ color: '#b6bcc8', backgroundColor: '#1a1a1c' }}
              >
                {committee}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: '#1a1a1c' }}>
      <div className="text-[9px] mb-0.5" style={{ color: '#b6bcc8' }}>{label}</div>
      <div className="text-xs" style={{ color: '#b6bcc8' }}>{value}</div>
    </div>
  )
}
