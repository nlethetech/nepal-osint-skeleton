import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bot, Clock3, Newspaper, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { fetchEditorialOverview } from '../../api/editorial'

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">{label}</div>
        <div className="text-white/35">{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-white/45">{sub}</div>}
    </div>
  )
}

function formatDate(value?: string | null) {
  if (!value) return 'never'
  return new Date(value).toLocaleString()
}

export function DevOverviewPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['editorial-overview'],
    queryFn: fetchEditorialOverview,
    refetchInterval: 60000,
  })

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Overview</h2>
          <p className="mt-1 text-sm text-white/45">
            Editorial backlog, automation health, user activity, and recent developer actions.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/60 hover:text-white hover:border-white/20 transition-colors"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Fact Check Review"
          value={isLoading ? '...' : String(data?.editorial_backlog.fact_check_pending_review ?? 0)}
          sub={`${data?.editorial_backlog.fact_check_queue ?? 0} queued · ${data?.editorial_backlog.fact_check_reruns ?? 0} reruns`}
          icon={<ShieldCheck size={16} />}
        />
        <StatCard
          label="Developing Stories"
          value={isLoading ? '...' : String(data?.editorial_backlog.developing_stories_review ?? 0)}
          sub="Needs developer review"
          icon={<Newspaper size={16} />}
        />
        <StatCard
          label="Story Tracker"
          value={isLoading ? '...' : String(data?.editorial_backlog.story_tracker_review ?? 0)}
          sub={`${data?.editorial_backlog.story_tracker_stale ?? 0} stale narratives`}
          icon={<Bot size={16} />}
        />
        <StatCard
          label="Paused Automations"
          value={isLoading ? '...' : String(data?.paused_automations ?? 0)}
          sub={`Analyst brief: ${data?.analyst_brief.latest_status ?? 'unknown'}`}
          icon={<Clock3 size={16} />}
        />
        <StatCard
          label="Active Users (1h)"
          value={isLoading ? '...' : String(data?.users.active_last_hour ?? 0)}
          sub={`Total users ${data?.users.total_users ?? 0}`}
          icon={<Users size={16} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle size={14} className="text-amber-300" />
            Needs Attention
          </div>
          <div className="mt-4 space-y-3">
            {(data?.alerts.length ? data.alerts : [{ severity: 'ok', title: 'No active alerts', detail: 'All monitored editorial automations are healthy.' }]).map((alert, index) => (
              <div key={`${alert.title}-${index}`} className="rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                <div className="text-sm font-medium text-white">{alert.title}</div>
                <div className="mt-1 text-xs text-white/45">{alert.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white">Recent Dev Actions</div>
          <div className="mt-4 space-y-3">
            {(data?.recent_actions || []).slice(0, 6).map((action) => (
              <div key={action.id} className="rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-white">{action.action}</span>
                  <span className="text-[11px] text-white/35">{formatDate(action.created_at)}</span>
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {action.user_email || 'Unknown user'} · {action.target_type || 'system'}
                  {action.target_id ? ` · ${action.target_id}` : ''}
                </div>
              </div>
            ))}
            {(!data?.recent_actions || data.recent_actions.length === 0) && (
              <div className="text-sm text-white/35">No recent audited actions.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
