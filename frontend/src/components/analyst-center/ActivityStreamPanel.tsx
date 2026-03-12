import { useMemo } from 'react'
import {
  Activity,
  FolderKanban,
  ShieldCheck,
  FileText,
  MessageSquare,
  Eye,
  UserPlus,
  Tag,
  AlertCircle,
} from 'lucide-react'
import { useActivityFeed } from '../../api/hooks/useCollaboration'
import { useAuthStore } from '../../store/slices/authSlice'
import type { Activity as ActivityType } from '../../api/collaboration'

// Demo activity for when API is unavailable
const DEMO_ACTIVITIES: ActivityType[] = [
  {
    id: 'demo-a1',
    user: { id: 'demo-1', email: 'sarah.k@narada.io', full_name: 'Sarah K.' },
    activity_type: 'verification_voted',
    target_type: 'verification',
    target_id: 'v-123',
    description: 'voted to verify flood report',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-a2',
    user: { id: 'demo-2', email: 'john.m@narada.io', full_name: 'John M.' },
    activity_type: 'evidence_added',
    target_type: 'case',
    target_id: 'case-456',
    description: 'added evidence to Border Investigation case',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-a3',
    user: { id: 'demo-3', email: 'priya.t@narada.io', full_name: 'Priya T.' },
    activity_type: 'case_created',
    target_type: 'case',
    target_id: 'case-789',
    description: 'created Election Misinformation Tracking case',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-a4',
    user: { id: 'demo-1', email: 'sarah.k@narada.io', full_name: 'Sarah K.' },
    activity_type: 'comment_added',
    target_type: 'case',
    target_id: 'case-456',
    description: 'commented: "@john check the customs records"',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-a5',
    user: { id: 'demo-4', email: 'raj.s@narada.io', full_name: 'Raj S.' },
    activity_type: 'verification_requested',
    target_type: 'story',
    target_id: 'story-321',
    description: 'requested verification for entity merge',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-a6',
    user: { id: 'demo-2', email: 'john.m@narada.io', full_name: 'John M.' },
    activity_type: 'case_updated',
    target_type: 'case',
    target_id: 'case-456',
    description: 'changed status to Review',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-a7',
    user: { id: 'demo-5', email: 'maya.g@narada.io', full_name: 'Maya G.' },
    activity_type: 'watchlist_match',
    target_type: 'entity',
    target_id: 'entity-111',
    description: 'detected match for "KP Oli" watchlist',
    extra_data: null,
    team_id: null,
    created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
]

const ACTIVITY_ICONS: Record<string, { icon: typeof Activity; color: string }> = {
  'case_created': { icon: FolderKanban, color: 'text-blue-400' },
  'case_updated': { icon: FolderKanban, color: 'text-blue-400' },
  'case_closed': { icon: FolderKanban, color: 'text-green-400' },
  'evidence_added': { icon: FileText, color: 'text-purple-400' },
  'comment_added': { icon: MessageSquare, color: 'text-cyan-400' },
  'verification_requested': { icon: ShieldCheck, color: 'text-yellow-400' },
  'verification_voted': { icon: ShieldCheck, color: 'text-green-400' },
  'verification_resolved': { icon: ShieldCheck, color: 'text-green-400' },
  'watchlist_match': { icon: Eye, color: 'text-orange-400' },
  'team_joined': { icon: UserPlus, color: 'text-blue-400' },
  'entity_created': { icon: Tag, color: 'text-purple-400' },
  'alert_triggered': { icon: AlertCircle, color: 'text-red-400' },
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ActivityItem({ activity }: { activity: ActivityType }) {
  const info = ACTIVITY_ICONS[activity.activity_type] || { icon: Activity, color: 'text-[var(--pro-text-muted)]' }
  const Icon = info.icon

  const userName = activity.user.full_name || activity.user.email.split('@')[0]

  // Format activity description
  let actionText = activity.description || activity.activity_type.replace(/_/g, ' ')

  // Highlight @mentions
  const mentionRegex = /@(\w+)/g
  const parts = actionText.split(mentionRegex)
  const formattedText = parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span key={i} className="text-[var(--pro-accent)] font-medium">
          @{part}
        </span>
      )
    }
    return part
  })

  return (
    <div className="flex gap-3 px-4 py-2.5 hover:bg-[var(--pro-bg-hover)] transition-colors">
      {/* Icon */}
      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center ${info.color} bg-current/10`}>
        <Icon size={12} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--pro-text-secondary)]">
          <span className="font-medium text-[var(--pro-text-primary)]">{userName}</span>{' '}
          {formattedText}
        </p>
        <p className="text-[9px] text-[var(--pro-text-disabled)] mt-0.5">
          {formatTimeAgo(activity.created_at)}
        </p>
      </div>
    </div>
  )
}

function groupActivitiesByTime(activities: ActivityType[]): { label: string; items: ActivityType[] }[] {
  const groups: { label: string; items: ActivityType[] }[] = []
  const now = new Date()

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const today: ActivityType[] = []
  const yesterday: ActivityType[] = []
  const thisWeek: ActivityType[] = []
  const older: ActivityType[] = []

  activities.forEach((activity) => {
    const date = new Date(activity.created_at)
    if (date >= todayStart) {
      today.push(activity)
    } else if (date >= yesterdayStart) {
      yesterday.push(activity)
    } else if (date >= weekStart) {
      thisWeek.push(activity)
    } else {
      older.push(activity)
    }
  })

  if (today.length > 0) groups.push({ label: 'Today', items: today })
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', items: yesterday })
  if (thisWeek.length > 0) groups.push({ label: 'This Week', items: thisWeek })
  if (older.length > 0) groups.push({ label: 'Older', items: older })

  return groups
}

export function ActivityStreamPanel() {
  const { isAuthenticated } = useAuthStore()
  const { data, isLoading, error } = useActivityFeed({ limit: 30 })

  // Use demo data when not authenticated or on error
  const activities = useMemo(() => {
    if (data?.items && data.items.length > 0) {
      return data.items
    }
    if (error || !isAuthenticated) {
      return DEMO_ACTIVITIES
    }
    return []
  }, [data, error, isAuthenticated])

  const isUsingDemo = (!data?.items || data.items.length === 0) && activities.length > 0
  const groups = groupActivitiesByTime(activities)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-[var(--pro-accent)]" />
          <h2 className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
            Activity Stream
          </h2>
          {activities.length > 0 && !isUsingDemo && (
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          )}
          {isUsingDemo && (
            <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
              Demo
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--pro-text-muted)] mt-1">
          Live updates from the community
        </p>
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[var(--pro-bg-elevated)] animate-pulse" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-3/4 bg-[var(--pro-bg-elevated)] rounded animate-pulse" />
                  <div className="h-2 w-1/4 bg-[var(--pro-bg-elevated)] rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-8">
            <Activity size={24} className="mx-auto text-[var(--pro-text-disabled)] mb-2" />
            <p className="text-xs text-[var(--pro-text-muted)]">No activity yet</p>
            <p className="text-[10px] text-[var(--pro-text-disabled)]">
              Activity will appear here as analysts work
            </p>
          </div>
        ) : (
          <div>
            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 px-4 py-1.5 bg-[var(--pro-bg-surface)] border-b border-[var(--pro-border-subtle)]">
                  <span className="text-[9px] font-semibold text-[var(--pro-text-disabled)] uppercase tracking-wide">
                    {group.label}
                  </span>
                </div>
                <div className="divide-y divide-[var(--pro-border-subtle)]">
                  {group.items.map((activity) => (
                    <ActivityItem key={activity.id} activity={activity} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
