import {
  LayoutGrid,
  Search,
  Map,
  Users,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useCommandCenterStore, type WorkspaceMode } from '../../stores/commandCenterStore'

interface ModeConfig {
  key: WorkspaceMode
  label: string
  shortcut: string
  icon: typeof LayoutGrid
  description: string
}

const MODES: ModeConfig[] = [
  {
    key: 'situational',
    label: 'Situational',
    shortcut: '1',
    icon: LayoutGrid,
    description: 'Story feed + Intel map',
  },
  {
    key: 'investigation',
    label: 'Investigation',
    shortcut: '2',
    icon: Search,
    description: 'Case board + Evidence timeline',
  },
  {
    key: 'geospatial',
    label: 'Geospatial',
    shortcut: '3',
    icon: Map,
    description: 'PWTT viewer + Analysis',
  },
  {
    key: 'entities',
    label: 'Entities',
    shortcut: '4',
    icon: Users,
    description: 'Entity network + Mentions',
  },
]

interface ModeRailProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function ModeRail({ isCollapsed = false, onToggleCollapse }: ModeRailProps) {
  const { workspaceMode, setWorkspaceMode } = useCommandCenterStore()

  return (
    <div className="flex flex-col h-full bg-[var(--pro-bg-secondary)] border-r border-[var(--pro-border-subtle)]">
      {/* Mode Buttons */}
      <div className="flex-1 py-2">
        <div className="flex flex-col gap-1 px-2">
          {MODES.map((mode) => {
            const Icon = mode.icon
            const isActive = workspaceMode === mode.key

            return (
              <button
                key={mode.key}
                onClick={() => setWorkspaceMode(mode.key)}
                className={`
                  relative group flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all
                  ${isActive
                    ? 'bg-[var(--pro-accent)] text-white shadow-lg shadow-[var(--pro-accent)]/20'
                    : 'text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
                  }
                `}
                title={`${mode.label} (${mode.shortcut})`}
              >
                <Icon size={18} />
                {!isCollapsed && (
                  <div className="flex-1 text-left">
                    <div className="text-xs font-medium">{mode.label}</div>
                    <div className={`text-[9px] ${isActive ? 'text-white/70' : 'text-[var(--pro-text-disabled)]'}`}>
                      {mode.description}
                    </div>
                  </div>
                )}
                {!isCollapsed && (
                  <kbd className={`text-[9px] px-1 py-0.5 rounded ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-muted)]'
                  }`}>
                    {mode.shortcut}
                  </kbd>
                )}

                {/* Active indicator */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r" />
                )}

                {/* Tooltip for collapsed mode */}
                {isCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-default)] rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-nowrap">
                    <div className="text-xs font-medium text-[var(--pro-text-primary)]">{mode.label}</div>
                    <div className="text-[9px] text-[var(--pro-text-muted)]">{mode.description}</div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Collapse Toggle */}
      <div className="p-2 border-t border-[var(--pro-border-subtle)]">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          {!isCollapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </div>
  )
}
