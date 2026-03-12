import { ReactNode, useState } from 'react'
import {
  Maximize2,
  Minimize2,
  MoreVertical,
  RefreshCw,
  Settings,
  ExternalLink,
  ChevronDown,
} from 'lucide-react'
import { type PanelContentType } from '../../../stores/commandCenterStore'

interface PanelFrameProps {
  title: string
  contentType: PanelContentType
  children: ReactNode
  isLoading?: boolean
  onRefresh?: () => void
  onMaximize?: () => void
  onSettings?: () => void
  onExternalOpen?: () => void
  headerActions?: ReactNode
  isMaximized?: boolean
}

export function PanelFrame({
  title,
  contentType,
  children,
  isLoading,
  onRefresh,
  onMaximize,
  onSettings,
  onExternalOpen,
  headerActions,
  isMaximized,
}: PanelFrameProps) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="flex flex-col h-full bg-[var(--pro-bg-surface)] rounded-lg border border-[var(--pro-border-subtle)] overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--pro-bg-secondary)] border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase tracking-wider">
            {title}
          </h3>
          {isLoading && (
            <RefreshCw size={12} className="text-[var(--pro-accent)] animate-spin" />
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Custom header actions */}
          {headerActions}

          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}

          {/* Maximize/Minimize */}
          {onMaximize && (
            <button
              onClick={onMaximize}
              className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}

          {/* More Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            >
              <MoreVertical size={12} />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-40 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-default)] rounded-lg shadow-xl z-50">
                  {onSettings && (
                    <button
                      onClick={() => {
                        onSettings()
                        setShowMenu(false)
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] transition-colors"
                    >
                      <Settings size={12} />
                      Panel Settings
                    </button>
                  )}
                  {onExternalOpen && (
                    <button
                      onClick={() => {
                        onExternalOpen()
                        setShowMenu(false)
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] transition-colors"
                    >
                      <ExternalLink size={12} />
                      Open in New Tab
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Panel Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  )
}

// Panel content selector dropdown
interface PanelSelectorProps {
  currentContent: PanelContentType
  onSelect: (content: PanelContentType) => void
}

const PANEL_OPTIONS: { value: PanelContentType; label: string }[] = [
  { value: 'story-feed', label: 'Story Feed' },
  { value: 'intel-map', label: 'Intel Map' },
  { value: 'case-board', label: 'Case Board' },
  { value: 'evidence-timeline', label: 'Evidence Timeline' },
  { value: 'verification-queue', label: 'Verification Queue' },
  { value: 'activity-stream', label: 'Activity Stream' },
  { value: 'leaderboard', label: 'Leaderboard' },
  { value: 'damage-assessment', label: 'Damage Assessment' },
  { value: 'spatial-analysis', label: 'PWTT Spatial Analysis' },
  { value: 'pwtt-viewer', label: 'PWTT Three-Panel' },
  { value: 'entity-network', label: 'Entity Network' },
  { value: 'mentions-feed', label: 'Mentions Feed' },
  { value: 'entity-profile', label: 'Entity Profile' },
  { value: 'layer-control', label: 'Layer Control' },
]

export function PanelSelector({ currentContent, onSelect }: PanelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const current = PANEL_OPTIONS.find((o) => o.value === currentContent)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
      >
        {current?.label}
        <ChevronDown size={10} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-44 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-default)] rounded-lg shadow-xl z-50 py-1">
            {PANEL_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onSelect(option.value)
                  setIsOpen(false)
                }}
                className={`
                  flex items-center w-full px-3 py-1.5 text-xs transition-colors
                  ${option.value === currentContent
                    ? 'bg-[var(--pro-accent-muted)] text-[var(--pro-accent)]'
                    : 'text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
                  }
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
