import { useState, useMemo } from 'react'
import {
  Trophy,
  Medal,
  Target,
  FolderKanban,
  TrendingUp,
  TrendingDown,
  Flame,
  Star,
  Award,
  Shield,
  Zap,
} from 'lucide-react'
import { useLeaderboard, useMyMetrics } from '../../api/hooks/useCollaboration'
import { useAuthStore } from '../../store/slices/authSlice'
import type { LeaderboardEntry, AnalystMetrics } from '../../api/collaboration'

type SortBy = 'reputation' | 'accuracy' | 'cases'

// Demo leaderboard entries for when API is unavailable
const DEMO_LEADERBOARD: LeaderboardEntry[] = [
  {
    user: { id: 'demo-1', email: 'sarah.k@narada.io', full_name: 'Sarah K.' },
    rank: 1,
    reputation_score: 2450,
    verification_accuracy: 94.2,
    total_cases: 23,
    badges: ['accuracy_90', 'streak_30', 'verified_100', 'cases_10'],
  },
  {
    user: { id: 'demo-2', email: 'john.m@narada.io', full_name: 'John M.' },
    rank: 2,
    reputation_score: 2180,
    verification_accuracy: 91.5,
    total_cases: 19,
    badges: ['accuracy_90', 'streak_7', 'cases_10'],
  },
  {
    user: { id: 'demo-3', email: 'priya.t@narada.io', full_name: 'Priya T.' },
    rank: 3,
    reputation_score: 1920,
    verification_accuracy: 88.4,
    total_cases: 15,
    badges: ['streak_7', 'first_case', 'first_verification'],
  },
  {
    user: { id: 'demo-4', email: 'raj.s@narada.io', full_name: 'Raj S.' },
    rank: 4,
    reputation_score: 1650,
    verification_accuracy: 85.1,
    total_cases: 12,
    badges: ['first_case', 'first_verification'],
  },
  {
    user: { id: 'demo-5', email: 'maya.g@narada.io', full_name: 'Maya G.' },
    rank: 5,
    reputation_score: 1420,
    verification_accuracy: 82.3,
    total_cases: 8,
    badges: ['first_case'],
  },
]

// Demo metrics for current user
const DEMO_MY_METRICS: AnalystMetrics = {
  user: { id: 'demo-user', email: 'demo@narada.io', full_name: 'Demo Analyst' },
  total_cases: 6,
  cases_closed: 4,
  evidence_added: 18,
  comments_posted: 24,
  verifications_requested: 3,
  verifications_voted: 42,
  verifications_correct: 37,
  verification_accuracy: 88.1,
  entities_created: 5,
  stories_annotated: 12,
  notes_created: 8,
  active_days: 14,
  current_streak: 2,
  longest_streak: 5,
  last_active_at: new Date().toISOString(),
  badges: ['first_case', 'first_verification'],
  reputation_score: 1120,
  threat_score: 45,
  economic_score: 32,
  political_score: 28,
}

const BADGE_ICONS: Record<string, { icon: typeof Award; color: string; label: string }> = {
  'first_case': { icon: FolderKanban, color: 'text-blue-400', label: 'First Case' },
  'first_verification': { icon: Shield, color: 'text-green-400', label: 'First Vote' },
  'accuracy_90': { icon: Target, color: 'text-purple-400', label: '90% Accuracy' },
  'streak_7': { icon: Flame, color: 'text-orange-400', label: '7-Day Streak' },
  'streak_30': { icon: Zap, color: 'text-yellow-400', label: '30-Day Streak' },
  'cases_10': { icon: Star, color: 'text-blue-400', label: '10 Cases' },
  'verified_100': { icon: Award, color: 'text-green-400', label: '100 Verifications' },
}

function BadgeIcon({ badge }: { badge: string }) {
  const info = BADGE_ICONS[badge] || { icon: Award, color: 'text-[var(--pro-text-muted)]', label: badge }
  const Icon = info.icon
  return (
    <div className="relative group">
      <Icon size={12} className={info.color} />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-default)] rounded text-[8px] text-[var(--pro-text-secondary)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        {info.label}
      </div>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
        <Trophy size={12} className="text-yellow-400" />
      </div>
    )
  }
  if (rank === 2) {
    return (
      <div className="w-6 h-6 rounded-full bg-gray-400/20 flex items-center justify-center">
        <Medal size={12} className="text-gray-300" />
      </div>
    )
  }
  if (rank === 3) {
    return (
      <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center">
        <Medal size={12} className="text-orange-400" />
      </div>
    )
  }
  return (
    <div className="w-6 h-6 rounded-full bg-[var(--pro-bg-hover)] flex items-center justify-center">
      <span className="text-[10px] font-mono text-[var(--pro-text-muted)]">{rank}</span>
    </div>
  )
}

export function LeaderboardPanel() {
  const [sortBy, setSortBy] = useState<SortBy>('reputation')
  const { isAuthenticated } = useAuthStore()
  const { data: leaderboardData, isLoading, error } = useLeaderboard(sortBy, 10)
  const { data: myMetricsData } = useMyMetrics()

  // Use demo data when not authenticated or on error
  const entries = useMemo(() => {
    if (leaderboardData?.entries && leaderboardData.entries.length > 0) {
      return leaderboardData.entries
    }
    if (error || !isAuthenticated) {
      // Sort demo data based on sortBy
      const sorted = [...DEMO_LEADERBOARD].sort((a, b) => {
        if (sortBy === 'reputation') return b.reputation_score - a.reputation_score
        if (sortBy === 'accuracy') return (b.verification_accuracy || 0) - (a.verification_accuracy || 0)
        if (sortBy === 'cases') return b.total_cases - a.total_cases
        return 0
      })
      return sorted.map((e, i) => ({ ...e, rank: i + 1 }))
    }
    return []
  }, [leaderboardData, error, isAuthenticated, sortBy])

  const myMetrics = useMemo(() => {
    if (myMetricsData) return myMetricsData
    if (error || !isAuthenticated) return DEMO_MY_METRICS
    return null
  }, [myMetricsData, error, isAuthenticated])

  const isUsingDemo = (!leaderboardData?.entries || leaderboardData.entries.length === 0) && entries.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2 mb-2">
          <Trophy size={14} className="text-yellow-400" />
          <h2 className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase tracking-wide">
            Leaderboard
          </h2>
          {isUsingDemo && (
            <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
              Demo
            </span>
          )}
        </div>

        {/* Sort tabs */}
        <div className="flex items-center gap-1 bg-[var(--pro-bg-elevated)] p-0.5 rounded">
          {([
            { key: 'reputation', icon: Star, label: 'Rep' },
            { key: 'accuracy', icon: Target, label: 'Accuracy' },
            { key: 'cases', icon: FolderKanban, label: 'Cases' },
          ] as { key: SortBy; icon: typeof Star; label: string }[]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors ${
                sortBy === key
                  ? 'bg-[var(--pro-accent)] text-white'
                  : 'text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)]'
              }`}
            >
              <Icon size={10} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* My Stats Card */}
      {myMetrics && (
        <div className="px-4 py-3 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-accent-muted)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-[var(--pro-accent)] uppercase tracking-wide">
              Your Stats
            </span>
            {myMetrics.current_streak > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-orange-400">
                <Flame size={10} />
                {myMetrics.current_streak} day streak
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-lg font-bold text-[var(--pro-text-primary)]">
                {myMetrics.reputation_score}
              </p>
              <p className="text-[9px] text-[var(--pro-text-muted)] uppercase">Reputation</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-[var(--pro-text-primary)]">
                {myMetrics.verification_accuracy !== null
                  ? `${Math.round(myMetrics.verification_accuracy)}%`
                  : '--'}
              </p>
              <p className="text-[9px] text-[var(--pro-text-muted)] uppercase">Accuracy</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-[var(--pro-text-primary)]">
                {myMetrics.total_cases}
              </p>
              <p className="text-[9px] text-[var(--pro-text-muted)] uppercase">Cases</p>
            </div>
          </div>

          {/* Badges */}
          {myMetrics.badges.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--pro-border-subtle)]">
              {myMetrics.badges.slice(0, 6).map((badge) => (
                <BadgeIcon key={badge} badge={badge} />
              ))}
              {myMetrics.badges.length > 6 && (
                <span className="text-[10px] text-[var(--pro-text-muted)]">
                  +{myMetrics.badges.length - 6}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Leaderboard list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-12 bg-[var(--pro-bg-elevated)] rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8">
            <Trophy size={24} className="mx-auto text-[var(--pro-text-disabled)] mb-2" />
            <p className="text-xs text-[var(--pro-text-muted)]">No analysts yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--pro-border-subtle)]">
            {entries.map((entry) => (
              <div
                key={entry.user.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--pro-bg-hover)] transition-colors"
              >
                <RankBadge rank={entry.rank} />

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--pro-text-primary)] truncate">
                    {entry.user.full_name || entry.user.email.split('@')[0]}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-[var(--pro-text-muted)]">
                    {sortBy === 'reputation' && (
                      <span className="flex items-center gap-0.5">
                        <Star size={10} />
                        {entry.reputation_score} pts
                      </span>
                    )}
                    {sortBy === 'accuracy' && entry.verification_accuracy !== null && (
                      <span className="flex items-center gap-0.5">
                        <Target size={10} />
                        {Math.round(entry.verification_accuracy)}%
                      </span>
                    )}
                    {sortBy === 'cases' && (
                      <span className="flex items-center gap-0.5">
                        <FolderKanban size={10} />
                        {entry.total_cases} cases
                      </span>
                    )}
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1">
                  {entry.badges.slice(0, 3).map((badge) => (
                    <BadgeIcon key={badge} badge={badge} />
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
