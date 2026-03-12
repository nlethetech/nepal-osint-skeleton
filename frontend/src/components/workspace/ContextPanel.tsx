import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  User,
  Building2,
  MapPin,
  Link2,
  Clock,
  MessageSquare,
  Activity,
  FolderKanban,
  Star,
  Bookmark,
} from 'lucide-react'
import { useWorkspaceStore, type ContextSection } from '../../stores/workspaceStore'
import { getEventDetail, type OpsEventDetailResponse } from '../../api/ops'

interface CollapsibleSectionProps {
  id: ContextSection
  title: string
  icon: typeof User
  children: React.ReactNode
  badge?: string | number
}

function CollapsibleSection({ id, title, icon: Icon, children, badge }: CollapsibleSectionProps) {
  const { contextSections, toggleContextSection } = useWorkspaceStore()
  const isOpen = contextSections[id]

  return (
    <div className="border-b border-[var(--pro-border-subtle)]">
      <button
        onClick={() => toggleContextSection(id)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--pro-bg-hover)] transition-colors"
      >
        {isOpen ? (
          <ChevronDown size={14} className="text-[var(--pro-text-muted)]" />
        ) : (
          <ChevronRight size={14} className="text-[var(--pro-text-muted)]" />
        )}
        <Icon size={14} className="text-[var(--pro-accent)]" />
        <span className="text-xs font-semibold text-[var(--pro-text-secondary)] uppercase tracking-wide flex-1">
          {title}
        </span>
        {badge !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 bg-[var(--pro-bg-elevated)] text-[var(--pro-text-muted)] rounded">
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

export function ContextPanel() {
  const { selectedItemId, selectedItemType } = useWorkspaceStore()
  const [detail, setDetail] = useState<OpsEventDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadDetail = async () => {
      if (!selectedItemId || selectedItemType !== 'cluster') {
        setDetail(null)
        setError(null)
        return
      }
      try {
        setError(null)
        const d = await getEventDetail(selectedItemId)
        setDetail(d)
      } catch (e) {
        setDetail(null)
        if (e instanceof Error && e.message.includes('404')) {
          setError('Event not found. This story may not be part of a cluster yet.')
        } else {
          setError('Failed to load event details')
        }
      }
    }
    loadDetail()
  }, [selectedItemId, selectedItemType])

  // Empty state or error state
  if (!selectedItemId || (!detail && !error)) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
          <h2 className="text-xs font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
            Context
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-[var(--pro-text-muted)] text-center">
            Select an event to see context
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
          <h2 className="text-xs font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
            Context
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-xs text-orange-400 mb-2">{error}</p>
            <p className="text-[10px] text-[var(--pro-text-disabled)]">
              Try selecting an event from the inbox
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!detail) {
    return null
  }

  // Extract entities from stories (mock for now - would come from backend)
  const mockEntities = [
    { type: 'person', name: 'PM Prachanda', role: 'Prime Minister' },
    { type: 'org', name: 'Nepal Army', role: 'Security Force' },
    { type: 'location', name: 'Kathmandu', role: 'Capital' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)] flex items-center justify-between">
        <h2 className="text-xs font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Context
        </h2>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-accent)] hover:bg-[var(--pro-accent-muted)] rounded transition-colors"
            title="Bookmark"
          >
            <Bookmark size={14} />
          </button>
          <button
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors"
            title="Star"
          >
            <Star size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Entities Section */}
        <CollapsibleSection id="entity" title="Entities" icon={User} badge={mockEntities.length}>
          <div className="space-y-2">
            {mockEntities.map((entity, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 bg-[var(--pro-bg-elevated)] rounded-lg hover:bg-[var(--pro-bg-hover)] cursor-pointer transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-[var(--pro-accent-muted)] flex items-center justify-center">
                  {entity.type === 'person' && <User size={14} className="text-[var(--pro-accent)]" />}
                  {entity.type === 'org' && <Building2 size={14} className="text-[var(--pro-accent)]" />}
                  {entity.type === 'location' && <MapPin size={14} className="text-[var(--pro-accent)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--pro-text-primary)] truncate">
                    {entity.name}
                  </p>
                  <p className="text-[10px] text-[var(--pro-text-muted)]">{entity.role}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Sources Section */}
        <CollapsibleSection id="sources" title="Sources" icon={Link2} badge={detail.source_count}>
          <div className="space-y-2">
            {detail.story_groups.slice(0, 5).map((group) => (
              <div
                key={group.canonical.id}
                className="p-2 bg-[var(--pro-bg-elevated)] rounded-lg"
              >
                <p className="text-[10px] font-semibold text-[var(--pro-accent)] uppercase mb-1">
                  {group.canonical.source_name || group.canonical.source_id}
                </p>
                <a
                  href={group.canonical.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--pro-text-secondary)] hover:text-[var(--pro-accent)] line-clamp-2"
                >
                  {group.canonical.title}
                </a>
              </div>
            ))}
            {detail.story_groups.length > 5 && (
              <p className="text-[10px] text-[var(--pro-text-muted)] text-center py-1">
                +{detail.story_groups.length - 5} more sources
              </p>
            )}
          </div>
        </CollapsibleSection>

        {/* Quick Actions Section */}
        <CollapsibleSection id="actions" title="Quick Actions" icon={FolderKanban}>
          <div className="grid grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-2 p-2 bg-[var(--pro-bg-elevated)] hover:bg-[var(--pro-bg-hover)] rounded-lg text-xs text-[var(--pro-text-secondary)] transition-colors">
              <FolderKanban size={14} />
              Add to Case
            </button>
            <button className="flex items-center justify-center gap-2 p-2 bg-[var(--pro-bg-elevated)] hover:bg-[var(--pro-bg-hover)] rounded-lg text-xs text-[var(--pro-text-secondary)] transition-colors">
              <MessageSquare size={14} />
              Add Note
            </button>
            <button className="flex items-center justify-center gap-2 p-2 bg-[var(--pro-bg-elevated)] hover:bg-[var(--pro-bg-hover)] rounded-lg text-xs text-[var(--pro-text-secondary)] transition-colors">
              <Link2 size={14} />
              Link Event
            </button>
            <button className="flex items-center justify-center gap-2 p-2 bg-[var(--pro-bg-elevated)] hover:bg-[var(--pro-bg-hover)] rounded-lg text-xs text-[var(--pro-text-secondary)] transition-colors">
              <Clock size={14} />
              Set Reminder
            </button>
          </div>
        </CollapsibleSection>

        {/* Activity Section */}
        <CollapsibleSection id="activity" title="Activity" icon={Activity}>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-green-500" />
              </div>
              <div>
                <p className="text-xs text-[var(--pro-text-secondary)]">
                  System detected event
                </p>
                <p className="text-[10px] text-[var(--pro-text-muted)]">
                  {detail.first_published ? new Date(detail.first_published).toLocaleString() : 'Unknown'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
              </div>
              <div>
                <p className="text-xs text-[var(--pro-text-secondary)]">
                  Grouped {detail.story_count} stories
                </p>
                <p className="text-[10px] text-[var(--pro-text-muted)]">Automatic clustering</p>
              </div>
            </div>
            {detail.verified_at && (
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                </div>
                <div>
                  <p className="text-xs text-[var(--pro-text-secondary)]">
                    Verified by analyst
                  </p>
                  <p className="text-[10px] text-[var(--pro-text-muted)]">
                    {new Date(detail.verified_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  )
}
