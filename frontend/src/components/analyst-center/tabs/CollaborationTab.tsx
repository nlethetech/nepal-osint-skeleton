import { CaseBoardPanel } from '../CaseBoardPanel'
import { VerificationQueuePanel } from '../VerificationQueuePanel'
import { LeaderboardPanel } from '../LeaderboardPanel'
import { ActivityStreamPanel } from '../ActivityStreamPanel'

export function CollaborationTab() {
  return (
    <div className="flex flex-1 h-full min-h-0">
      {/* Left Panel - Cases */}
      <div className="w-80 flex-shrink-0 border-r border-[var(--pro-border-subtle)] overflow-hidden flex flex-col">
        <CaseBoardPanel />
      </div>

      {/* Center Panel - Verification Queue */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <VerificationQueuePanel />
      </div>

      {/* Right Panel - Leaderboard + Activity */}
      <div className="w-72 flex-shrink-0 border-l border-[var(--pro-border-subtle)] overflow-hidden flex flex-col">
        {/* Leaderboard - 55% height */}
        <div className="flex-[55] overflow-hidden border-b border-[var(--pro-border-subtle)]">
          <LeaderboardPanel />
        </div>

        {/* Activity Stream - 45% height */}
        <div className="flex-[45] overflow-hidden">
          <ActivityStreamPanel />
        </div>
      </div>
    </div>
  )
}
