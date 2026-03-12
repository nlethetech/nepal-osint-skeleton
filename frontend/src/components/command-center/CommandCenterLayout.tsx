import { useEffect, useCallback, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCommandCenterStore, QUICK_ACTIONS, type WorkspaceMode } from '../../stores/commandCenterStore'
import { CommandBar } from './CommandBar'
import { IntelFusionStrip } from './IntelFusionStrip'
import { ModeRail } from './ModeRail'
import { WorkspaceContainer } from './WorkspaceContainer'
import { StatusBar } from './StatusBar'
import { connectWebSocket } from '../../api/websocket'

/**
 * @deprecated Transitional legacy layout.
 * Keep for route parity while analyst shell migration is in progress.
 */
export function CommandCenterLayout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isRailCollapsed, setIsRailCollapsed] = useState(false)
  const [isConnected, setIsConnected] = useState(true)
  const refreshThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    workspaceMode,
    setWorkspaceMode,
    selectedStoryId,
    selectStory,
    selectCase,
    stories,
    currentPage,
    pageSize,
    totalStories,
    refreshAll,
    clearFilters,
    executeQuickAction,
    setShowShortcutsModal,
  } = useCommandCenterStore()

  // Handle deep linking (e.g., ?case=<id> or ?mode=investigation)
  useEffect(() => {
    const caseId = searchParams.get('case')
    const mode = searchParams.get('mode') as WorkspaceMode | null

    if (caseId) {
      selectCase(caseId)
    }
    if (mode && ['situational', 'investigation', 'geospatial', 'entities'].includes(mode)) {
      setWorkspaceMode(mode)
    }
  }, [searchParams, selectCase, setWorkspaceMode])

  // Load data on mount
  useEffect(() => {
    refreshAll()
    const interval = setInterval(refreshAll, 5 * 60 * 1000) // 5 minute refresh
    return () => clearInterval(interval)
  }, [refreshAll])

  // WebSocket: refresh on new stories / cluster updates
  useEffect(() => {
    const ws = connectWebSocket()
    const unsubConn = ws.onConnectionChange((connected) => setIsConnected(connected))
    const unsubFeed = ws.onMessage('feed', (message) => {
      if (message.event_type !== 'new_story' && message.event_type !== 'cluster_update') return
      if (refreshThrottleRef.current) return
      refreshThrottleRef.current = setTimeout(() => {
        refreshThrottleRef.current = null
        refreshAll()
      }, 1500)
    })

    return () => {
      unsubConn()
      unsubFeed()
      if (refreshThrottleRef.current) {
        clearTimeout(refreshThrottleRef.current)
        refreshThrottleRef.current = null
      }
    }
  }, [refreshAll])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if in input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      // Calculate visible stories for navigation
      const startIdx = (currentPage - 1) * pageSize
      const endIdx = Math.min(startIdx + pageSize, totalStories)
      const visibleStories = stories.slice(startIdx, endIdx)

      // Check for Cmd/Ctrl modifiers
      const isMod = e.metaKey || e.ctrlKey

      switch (e.key) {
        // Mode switching (1-4)
        case '1':
          if (!isMod) {
            e.preventDefault()
            setWorkspaceMode('situational')
          }
          break
        case '2':
          if (!isMod) {
            e.preventDefault()
            setWorkspaceMode('investigation')
          }
          break
        case '3':
          if (!isMod) {
            e.preventDefault()
            setWorkspaceMode('geospatial')
          }
          break
        case '4':
          if (!isMod) {
            e.preventDefault()
            setWorkspaceMode('entities')
          }
          break

        // Story navigation (j/k)
        case 'j':
          e.preventDefault()
          if (workspaceMode === 'situational') {
            if (!selectedStoryId && visibleStories.length > 0) {
              selectStory(visibleStories[0].id)
            } else {
              const currentIdx = visibleStories.findIndex((s) => s.id === selectedStoryId)
              if (currentIdx < visibleStories.length - 1) {
                selectStory(visibleStories[currentIdx + 1].id)
              }
            }
          }
          break
        case 'k':
          // Cmd/Ctrl+K: command palette (reserved)
          if (isMod) {
            e.preventDefault()
            // TODO: Open command palette
            break
          }

          // Plain 'k': previous story
          e.preventDefault()
          if (workspaceMode === 'situational' && selectedStoryId) {
            const currentIdx = visibleStories.findIndex((s) => s.id === selectedStoryId)
            if (currentIdx > 0) {
              selectStory(visibleStories[currentIdx - 1].id)
            }
          }
          break

        // Open selected story
        case 'Enter':
          if (workspaceMode === 'situational' && selectedStoryId) {
            e.preventDefault()
            const selectedStory = visibleStories.find((s) => s.id === selectedStoryId)
            if (selectedStory?.cluster_id) {
              navigate(`/workspace?cluster=${selectedStory.cluster_id}`)
            }
          }
          break

        // Refresh
        case 'r':
          if (!isMod) {
            e.preventDefault()
            refreshAll()
          }
          break

        // Clear filters
        case 'Escape':
          e.preventDefault()
          clearFilters()
          break

        // Go to workspace
        case 'w':
          if (!isMod) {
            e.preventDefault()
            navigate('/workspace')
          }
          break

        // Quick actions
        case 'n': // New case
        case 'N':
          if (!isMod) {
            e.preventDefault()
            executeQuickAction('new-case')
          }
          break
        case 'v': // Verify
        case 'V':
          if (!isMod) {
            e.preventDefault()
            executeQuickAction('verify')
          }
          break
        case 'l': // Correlate (link)
        case 'L':
          if (!isMod) {
            e.preventDefault()
            executeQuickAction('correlate')
          }
          break
        case 'd': // Damage check
        case 'D':
          if (!isMod) {
            e.preventDefault()
            executeQuickAction('damage-check')
          }
          break
        case 'e': // Export
        case 'E':
          if (!isMod) {
            e.preventDefault()
            executeQuickAction('export')
          }
          break

        // Show shortcuts modal
        case '/':
          if (isMod) {
            e.preventDefault()
            setShowShortcutsModal(true)
          }
          break

      }
    },
    [
      selectedStoryId,
      stories,
      currentPage,
      pageSize,
      totalStories,
      selectStory,
      navigate,
      refreshAll,
      clearFilters,
      setWorkspaceMode,
      executeQuickAction,
      setShowShortcutsModal,
      workspaceMode,
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="h-screen flex flex-col bg-[var(--pro-bg-base)]">
      {/* Command Bar */}
      <div className="h-14 flex-shrink-0">
        <CommandBar />
      </div>

      {/* Intel Fusion Strip */}
      <div className="flex-shrink-0">
        <IntelFusionStrip />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        {/* Mode Rail */}
        <div className={`flex-shrink-0 transition-all duration-200 ${isRailCollapsed ? 'w-14' : 'w-48'}`}>
          <ModeRail
            isCollapsed={isRailCollapsed}
            onToggleCollapse={() => setIsRailCollapsed(!isRailCollapsed)}
          />
        </div>

        {/* Workspace Container */}
        <div className="flex-1 min-w-0 min-h-0">
          <WorkspaceContainer />
        </div>
      </div>

      {/* Status Bar */}
      <div className="h-6 flex-shrink-0">
        <StatusBar isConnected={isConnected} />
      </div>
    </div>
  )
}
