import { useQuery } from '@tanstack/react-query'
import { Shield, Users } from 'lucide-react'
import { fetchUsersSummary } from '../../api/admin'
import { UserManagementPanel } from './UserManagementPanel'

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  )
}

function formatProviderMix(providerCounts: Record<string, number>) {
  return ['Email', 'Google', 'Guest']
    .filter((provider) => providerCounts[provider] !== undefined)
    .map((provider) => `${provider} ${providerCounts[provider]}`)
    .join(' · ')
}

export function UsersAccessPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users-summary'],
    queryFn: fetchUsersSummary,
    refetchInterval: 60000,
  })

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-white">
            <Users size={16} className="text-blue-400" />
            <h2 className="text-lg font-semibold tracking-tight">Users & Access</h2>
          </div>
          <p className="mt-1 text-sm text-white/45">
            Provider mix, active usage, and account-level operational visibility.
          </p>
        </div>
        {data && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2 text-xs text-white/50">
            {formatProviderMix(data.provider_counts)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Users" value={isLoading ? '...' : String(data?.total_users ?? 0)} />
        <SummaryCard label="Active (1h)" value={isLoading ? '...' : String(data?.active_last_hour ?? 0)} accent="text-emerald-300" />
        <SummaryCard label="New (24h)" value={isLoading ? '...' : String(data?.new_last_24h ?? 0)} accent="text-blue-300" />
        <SummaryCard
          label="Guest vs Registered"
          value={
            isLoading
              ? '...'
              : `${data?.guest_to_registered.guest ?? 0} / ${data?.guest_to_registered.registered ?? 0}`
          }
          accent="text-amber-300"
        />
      </div>

      {data && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield size={14} className="text-white/40" />
              Provider Breakdown
            </div>
            <div className="mt-4 space-y-3">
              {Object.entries(data.provider_counts).map(([provider, count]) => (
                <div key={provider} className="flex items-center justify-between text-sm">
                  <span className="text-white/55">{provider}</span>
                  <span className="font-mono text-white">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield size={14} className="text-white/40" />
              Role Breakdown
            </div>
            <div className="mt-4 space-y-3">
              {Object.entries(data.role_counts).map(([role, count]) => (
                <div key={role} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-white/55">{role}</span>
                  <span className="font-mono text-white">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <UserManagementPanel />
    </section>
  )
}
