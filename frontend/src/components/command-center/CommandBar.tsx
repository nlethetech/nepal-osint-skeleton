import { useNavigate } from 'react-router-dom'
import {
  Search,
  Bell,
  Settings,
  Keyboard,
  FolderPlus,
  CheckCircle,
  GitBranch,
  Target,
  Download,
  ChevronDown,
} from 'lucide-react'
import { useCommandCenterStore, QUICK_ACTIONS } from '../../stores/commandCenterStore'

const ICON_MAP: Record<string, typeof FolderPlus> = {
  FolderPlus,
  CheckCircle,
  GitBranch,
  Target,
  Download,
}

interface CommandBarProps {
  onSearch?: (query: string) => void
}

export function CommandBar({ onSearch }: CommandBarProps) {
  const navigate = useNavigate()
  const {
    executeQuickAction,
    showShortcutsModal,
    setShowShortcutsModal,
    threatLevel,
  } = useCommandCenterStore()
  const getThreatBadgeColor = () => {
    switch (threatLevel) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/30'
      case 'ELEVATED': return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
      case 'GUARDED': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      case 'LOW': return 'bg-green-500/20 text-green-400 border-green-500/30'
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    }
  }

  return (
    <div className="h-full flex items-center justify-between px-4 bg-[var(--pro-bg-surface)] border-b border-[var(--pro-border-subtle)]">
      {/* Left: Logo + Quick Actions */}
      <div className="flex items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">N</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-[var(--pro-text-primary)] tracking-tight leading-none">
              NARADA
            </h1>
            <span className="text-[9px] text-[var(--pro-text-muted)] uppercase tracking-wider">
              Command Center
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-[var(--pro-border-subtle)]" />

        {/* Quick Actions */}
        <div className="flex items-center gap-1">
          {QUICK_ACTIONS.map((action) => {
            const Icon = ICON_MAP[action.icon] || FolderPlus
            return (
              <button
                key={action.key}
                onClick={() => executeQuickAction(action.key)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors group"
                title={`${action.label} (${action.shortcut})`}
              >
                <Icon size={14} />
                <span className="hidden lg:inline">{action.label}</span>
                <kbd className="hidden lg:inline text-[9px] px-1 py-0.5 bg-[var(--pro-bg-elevated)] rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  {action.shortcut}
                </kbd>
              </button>
            )
          })}
        </div>
      </div>

      {/* Center: Search Bar */}
      <div className="flex-1 max-w-xl mx-8">
        <button
          className="w-full flex items-center gap-2 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg pl-3 pr-4 py-2 text-xs text-[var(--pro-text-disabled)] hover:border-[var(--pro-accent)]/50 transition-colors text-left cursor-default"
        >
          <Search size={14} />
          <span className="flex-1">Search candidates, constituencies, entities, stories...</span>
          <kbd className="px-1.5 py-0.5 bg-[var(--pro-bg-surface)] border border-[var(--pro-border-subtle)] rounded text-[9px] text-[var(--pro-text-muted)]">
            {'\u2318'}K
          </kbd>
        </button>
      </div>

      {/* Right: Threat Badge + Alerts + Actions */}
      <div className="flex items-center gap-3">
        {/* Threat Level Badge */}
        <button className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase rounded border ${getThreatBadgeColor()}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          {threatLevel}
          <ChevronDown size={10} />
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-[var(--pro-border-subtle)]" />

        {/* Keyboard Shortcuts */}
        <button
          onClick={() => setShowShortcutsModal(!showShortcutsModal)}
          className="p-2 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors"
          title="Keyboard shortcuts (Cmd+/)"
        >
          <Keyboard size={16} />
        </button>

        {/* Notifications */}
        <button className="p-2 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors relative">
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* Settings */}
        <button
          onClick={() => navigate('/settings')}
          className="p-2 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Shortcuts Modal */}
      {showShortcutsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowShortcutsModal(false)}
        >
          <div
            className="bg-[var(--pro-bg-surface)] border border-[var(--pro-border-default)] rounded-xl p-5 w-96 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--pro-text-primary)] mb-4">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-3">
              <div className="text-xs text-[var(--pro-text-muted)] uppercase tracking-wider mb-2">Navigation</div>
              <div className="space-y-1.5 text-xs">
                <ShortcutRow label="Navigate stories" keys={['J', 'K']} />
                <ShortcutRow label="Open story" keys={['Enter']} />
                <ShortcutRow label="Refresh data" keys={['R']} />
                <ShortcutRow label="Clear filters" keys={['Esc']} />
              </div>
              <div className="text-xs text-[var(--pro-text-muted)] uppercase tracking-wider mb-2 mt-4">Workspace Modes</div>
              <div className="space-y-1.5 text-xs">
                <ShortcutRow label="Situational mode" keys={['1']} />
                <ShortcutRow label="Investigation mode" keys={['2']} />
                <ShortcutRow label="Geospatial mode" keys={['3']} />
                <ShortcutRow label="Entities mode" keys={['4']} />
              </div>
              <div className="text-xs text-[var(--pro-text-muted)] uppercase tracking-wider mb-2 mt-4">Quick Actions</div>
              <div className="space-y-1.5 text-xs">
                {QUICK_ACTIONS.map((action) => (
                  <ShortcutRow key={action.key} label={action.label} keys={[action.shortcut]} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[var(--pro-text-muted)]">{label}</span>
      <div className="flex gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="px-1.5 py-0.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded text-[var(--pro-text-secondary)] font-mono"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}
