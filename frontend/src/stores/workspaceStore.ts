import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Queue panel tabs
export type QueueTab = 'inbox' | 'cases' | 'watchlist'

// Main canvas view types
export type CanvasView = 'cluster' | 'case' | 'entity' | 'empty'

// Context panel sections that can be expanded/collapsed
export type ContextSection = 'entity' | 'sources' | 'actions' | 'activity'

export interface WorkspaceState {
  // Queue Panel
  activeQueueTab: QueueTab
  selectedItemId: string | null
  selectedItemType: CanvasView

  // Main Canvas
  canvasView: CanvasView

  // Context Panel
  contextPanelOpen: boolean
  contextSections: Record<ContextSection, boolean>

  // Command Bar
  commandBarOpen: boolean
  searchQuery: string

  // Keyboard shortcuts
  shortcutsHelpOpen: boolean

  // Selected items for bulk actions
  selectedItems: Set<string>
  bulkMode: boolean

  // Actions
  setActiveQueueTab: (tab: QueueTab) => void
  selectItem: (id: string | null, type: CanvasView) => void
  setCanvasView: (view: CanvasView) => void
  toggleContextPanel: () => void
  setContextPanelOpen: (open: boolean) => void
  toggleContextSection: (section: ContextSection) => void
  openCommandBar: () => void
  closeCommandBar: () => void
  setSearchQuery: (query: string) => void
  toggleShortcutsHelp: () => void

  // Bulk selection
  toggleItemSelection: (id: string) => void
  selectAllItems: (ids: string[]) => void
  clearSelection: () => void
  setBulkMode: (enabled: boolean) => void

  // Reset
  resetWorkspace: () => void
}

const initialState = {
  activeQueueTab: 'inbox' as QueueTab,
  selectedItemId: null,
  selectedItemType: 'empty' as CanvasView,
  canvasView: 'empty' as CanvasView,
  contextPanelOpen: true,
  contextSections: {
    entity: true,
    sources: true,
    actions: true,
    activity: true,
  },
  commandBarOpen: false,
  searchQuery: '',
  shortcutsHelpOpen: false,
  selectedItems: new Set<string>(),
  bulkMode: false,
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setActiveQueueTab: (tab) =>
        set({ activeQueueTab: tab }),

      selectItem: (id, type) =>
        set({
          selectedItemId: id,
          selectedItemType: id ? type : 'empty',
          canvasView: id ? type : 'empty',
        }),

      setCanvasView: (view) =>
        set({ canvasView: view }),

      toggleContextPanel: () =>
        set((state) => ({ contextPanelOpen: !state.contextPanelOpen })),

      setContextPanelOpen: (open) =>
        set({ contextPanelOpen: open }),

      toggleContextSection: (section) =>
        set((state) => ({
          contextSections: {
            ...state.contextSections,
            [section]: !state.contextSections[section],
          },
        })),

      openCommandBar: () =>
        set({ commandBarOpen: true }),

      closeCommandBar: () =>
        set({ commandBarOpen: false, searchQuery: '' }),

      setSearchQuery: (query) =>
        set({ searchQuery: query }),

      toggleShortcutsHelp: () =>
        set((state) => ({ shortcutsHelpOpen: !state.shortcutsHelpOpen })),

      toggleItemSelection: (id) =>
        set((state) => {
          const newSet = new Set(state.selectedItems)
          if (newSet.has(id)) {
            newSet.delete(id)
          } else {
            newSet.add(id)
          }
          return {
            selectedItems: newSet,
            bulkMode: newSet.size > 0,
          }
        }),

      selectAllItems: (ids) =>
        set({
          selectedItems: new Set(ids),
          bulkMode: ids.length > 0,
        }),

      clearSelection: () =>
        set({
          selectedItems: new Set(),
          bulkMode: false,
        }),

      setBulkMode: (enabled) =>
        set({
          bulkMode: enabled,
          selectedItems: enabled ? get().selectedItems : new Set(),
        }),

      resetWorkspace: () =>
        set({
          ...initialState,
          selectedItems: new Set(),
        }),
    }),
    {
      name: 'analyst-workspace-v1',
      partialize: (state) => ({
        activeQueueTab: state.activeQueueTab,
        contextPanelOpen: state.contextPanelOpen,
        contextSections: state.contextSections,
      }),
    }
  )
)
