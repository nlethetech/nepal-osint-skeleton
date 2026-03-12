import { useEffect, useRef, useState } from 'react'
import {
  Search,
  X,
  FileText,
  FolderKanban,
  User,
  Plus,
  CheckCircle2,
  UploadCloud,
  XCircle,
  Settings,
  Keyboard,
} from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: typeof Search
  shortcut?: string
  action: () => void
  category: 'navigation' | 'action' | 'create' | 'settings'
}

export function CommandBar() {
  const {
    commandBarOpen,
    closeCommandBar,
    searchQuery,
    setSearchQuery,
    toggleShortcutsHelp,
    setActiveQueueTab,
  } = useWorkspaceStore()

  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const commands: CommandItem[] = [
    // Navigation
    {
      id: 'goto-inbox',
      label: 'Go to Inbox',
      description: 'View event queue',
      icon: FileText,
      shortcut: 'G I',
      action: () => {
        setActiveQueueTab('inbox')
        closeCommandBar()
      },
      category: 'navigation',
    },
    {
      id: 'goto-cases',
      label: 'Go to Cases',
      description: 'View investigation cases',
      icon: FolderKanban,
      shortcut: 'G C',
      action: () => {
        setActiveQueueTab('cases')
        closeCommandBar()
      },
      category: 'navigation',
    },
    {
      id: 'goto-watchlist',
      label: 'Go to Watchlist',
      description: 'View entity watchlist',
      icon: User,
      shortcut: 'G W',
      action: () => {
        setActiveQueueTab('watchlist')
        closeCommandBar()
      },
      category: 'navigation',
    },
    // Actions
    {
      id: 'verify-event',
      label: 'Verify Event',
      description: 'Mark selected event as verified',
      icon: CheckCircle2,
      shortcut: 'V',
      action: () => closeCommandBar(),
      category: 'action',
    },
    {
      id: 'publish-event',
      label: 'Publish Event',
      description: 'Publish selected event to customers',
      icon: UploadCloud,
      shortcut: 'P',
      action: () => closeCommandBar(),
      category: 'action',
    },
    {
      id: 'reject-event',
      label: 'Reject Event',
      description: 'Reject selected event',
      icon: XCircle,
      shortcut: 'R',
      action: () => closeCommandBar(),
      category: 'action',
    },
    // Create
    {
      id: 'create-story',
      label: 'Create Story',
      description: 'Add a new story manually',
      icon: Plus,
      shortcut: '\u2318N',
      action: () => closeCommandBar(),
      category: 'create',
    },
    {
      id: 'create-case',
      label: 'Create Case',
      description: 'Start a new investigation case',
      icon: FolderKanban,
      action: () => closeCommandBar(),
      category: 'create',
    },
    // Settings
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View all keyboard shortcuts',
      icon: Keyboard,
      shortcut: '\u2318/',
      action: () => {
        toggleShortcutsHelp()
        closeCommandBar()
      },
      category: 'settings',
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Configure workspace',
      icon: Settings,
      action: () => closeCommandBar(),
      category: 'settings',
    },
  ]

  // Filter commands based on search
  const filteredCommands = commands.filter((cmd) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      cmd.label.toLowerCase().includes(query) ||
      cmd.description?.toLowerCase().includes(query)
    )
  })

  // Group by category
  const groupedCommands = {
    navigation: filteredCommands.filter((c) => c.category === 'navigation'),
    action: filteredCommands.filter((c) => c.category === 'action'),
    create: filteredCommands.filter((c) => c.category === 'create'),
    settings: filteredCommands.filter((c) => c.category === 'settings'),
  }

  // Focus input when opened
  useEffect(() => {
    if (commandBarOpen && inputRef.current) {
      inputRef.current.focus()
      setSelectedIndex(0)
    }
  }, [commandBarOpen])

  // Keyboard navigation
  useEffect(() => {
    if (!commandBarOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCommandBar()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filteredCommands[selectedIndex]
        if (cmd) cmd.action()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandBarOpen, selectedIndex, filteredCommands, closeCommandBar])

  if (!commandBarOpen) return null

  let flatIndex = 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeCommandBar}
      />

      {/* Command palette */}
      <div className="relative w-full max-w-xl bg-[var(--pro-bg-surface)] border border-[var(--pro-border-default)] rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--pro-border-subtle)]">
          <Search size={18} className="text-[var(--pro-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-[var(--pro-text-primary)] placeholder-[var(--pro-text-disabled)] focus:outline-none"
          />
          <button
            onClick={closeCommandBar}
            className="p-1 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Commands list */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--pro-text-muted)]">
              No commands found
            </div>
          ) : (
            <>
              {groupedCommands.navigation.length > 0 && (
                <div className="px-3 pt-2 pb-1">
                  <p className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
                    Navigation
                  </p>
                </div>
              )}
              {groupedCommands.navigation.map((cmd) => {
                const index = flatIndex++
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={selectedIndex === index}
                    onSelect={() => {
                      setSelectedIndex(index)
                      cmd.action()
                    }}
                  />
                )
              })}

              {groupedCommands.action.length > 0 && (
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
                    Actions
                  </p>
                </div>
              )}
              {groupedCommands.action.map((cmd) => {
                const index = flatIndex++
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={selectedIndex === index}
                    onSelect={() => {
                      setSelectedIndex(index)
                      cmd.action()
                    }}
                  />
                )
              })}

              {groupedCommands.create.length > 0 && (
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
                    Create
                  </p>
                </div>
              )}
              {groupedCommands.create.map((cmd) => {
                const index = flatIndex++
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={selectedIndex === index}
                    onSelect={() => {
                      setSelectedIndex(index)
                      cmd.action()
                    }}
                  />
                )
              })}

              {groupedCommands.settings.length > 0 && (
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
                    Settings
                  </p>
                </div>
              )}
              {groupedCommands.settings.map((cmd) => {
                const index = flatIndex++
                return (
                  <CommandItem
                    key={cmd.id}
                    command={cmd}
                    isSelected={selectedIndex === index}
                    onSelect={() => {
                      setSelectedIndex(index)
                      cmd.action()
                    }}
                  />
                )
              })}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--pro-border-subtle)] flex items-center gap-4 text-[10px] text-[var(--pro-text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded text-[9px]">
              {'\u2191\u2193'}
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded text-[9px]">
              {'\u21B5'}
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded text-[9px]">
              esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}

function CommandItem({
  command,
  isSelected,
  onSelect,
}: {
  command: CommandItem
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = command.icon

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
        isSelected
          ? 'bg-[var(--pro-accent-muted)] text-[var(--pro-text-primary)]'
          : 'hover:bg-[var(--pro-bg-hover)] text-[var(--pro-text-secondary)]'
      }`}
    >
      <Icon size={16} className={isSelected ? 'text-[var(--pro-accent)]' : 'text-[var(--pro-text-muted)]'} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{command.label}</p>
        {command.description && (
          <p className="text-[10px] text-[var(--pro-text-muted)] truncate">{command.description}</p>
        )}
      </div>
      {command.shortcut && (
        <kbd className="px-1.5 py-0.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded text-[10px] text-[var(--pro-text-muted)]">
          {command.shortcut}
        </kbd>
      )}
    </button>
  )
}
