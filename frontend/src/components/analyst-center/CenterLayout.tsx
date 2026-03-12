import { ReactNode } from 'react'

interface CenterLayoutProps {
  header?: ReactNode
  filterToolbar?: ReactNode
  insightBanner?: ReactNode
  leftPanel: ReactNode
  centerPanel: ReactNode
  rightPanel: ReactNode
  bottomBar?: ReactNode
}

/**
 * Fixed multi-panel layout for the Analyst Command Center.
 *
 * Layout:
 * - Header (48px) - optional
 * - Filter Toolbar (36px) - time/severity filters
 * - Insight Banner (auto) - AI summary
 * - Left Panel (240px fixed) - Category matrix + timeline
 * - Center Panel (flexible) - Story feed
 * - Right Panel (280px fixed) - Key actors + districts
 * - Bottom Bar (32px) - optional status
 *
 * @deprecated Transitional legacy layout.
 * Keep while route-by-route migration converges on AnalystShell.
 */
export function CenterLayout({
  header,
  filterToolbar,
  insightBanner,
  leftPanel,
  centerPanel,
  rightPanel,
  bottomBar,
}: CenterLayoutProps) {
  return (
    <div className="h-screen flex flex-col bg-[var(--pro-bg-void)] text-[var(--pro-text-primary)] overflow-hidden bloomberg-theme">
      {/* Header */}
      {header && (
        <header className="h-12 flex-shrink-0 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-bg-base)]">
          {header}
        </header>
      )}

      {/* Filter Toolbar */}
      {filterToolbar && (
        <div className="h-9 flex-shrink-0 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)]">
          {filterToolbar}
        </div>
      )}

      {/* Insight Banner */}
      {insightBanner && (
        <div className="flex-shrink-0 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)]">
          {insightBanner}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Category Matrix + Timeline */}
        <aside className="w-60 flex-shrink-0 border-r border-[var(--pro-border-subtle)] bg-[var(--pro-bg-base)] overflow-y-auto">
          {leftPanel}
        </aside>

        {/* Center Panel - Story Feed */}
        <main className="flex-1 overflow-y-auto bg-[var(--pro-bg-void)]">
          {centerPanel}
        </main>

        {/* Right Panel - Key Actors + Districts */}
        <aside className="w-72 flex-shrink-0 border-l border-[var(--pro-border-subtle)] bg-[var(--pro-bg-base)] overflow-y-auto">
          {rightPanel}
        </aside>
      </div>

      {/* Bottom Bar */}
      {bottomBar && (
        <footer className="h-8 flex-shrink-0 border-t border-[var(--pro-border-subtle)] bg-[var(--pro-bg-surface)]">
          {bottomBar}
        </footer>
      )}
    </div>
  )
}
