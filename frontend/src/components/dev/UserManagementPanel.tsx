import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, User as UserIcon } from 'lucide-react'
import { fetchUsers, fetchActiveSessions } from '../../api/admin'

const PROVIDER_OPTIONS = [
  { key: 'all' as const, label: 'All' },
  { key: 'local' as const, label: 'Email' },
  { key: 'google' as const, label: 'Google' },
  { key: 'guest' as const, label: 'Guest' },
]

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    dev: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    analyst: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    consumer: 'bg-white/5 text-white/40 border-white/10',
  }
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${styles[role] || styles.consumer}`}>
      {role}
    </span>
  )
}

function ProviderBadge({ provider }: { provider: string }) {
  const styles: Record<string, string> = {
    Email: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    Google: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    Guest: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  }
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${styles[provider] || 'bg-white/5 text-white/40 border-white/10'}`}>
      {provider}
    </span>
  )
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function UserManagementPanel() {
  const [page, setPage] = useState(1)
  const [providerFilter, setProviderFilter] = useState<'all' | 'local' | 'google' | 'guest'>('all')
  const [search, setSearch] = useState('')
  const trimmedSearch = search.trim()
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', page, providerFilter, trimmedSearch],
    queryFn: () =>
      fetchUsers({
        page,
        per_page: 40,
        auth_provider: providerFilter === 'all' ? undefined : providerFilter,
        search: trimmedSearch || undefined,
      }),
  })
  const { data: sessionsData } = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: fetchActiveSessions,
    refetchInterval: 60000,
  })

  if (isLoading) {
    return <div className="text-white/20 text-sm">Loading users...</div>
  }

  const users = usersData?.items || []
  const sessions = sessionsData?.active_sessions || []
  const onlineUserIds = new Set(sessions.map((session) => session.user_id))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield size={15} className="text-white/30" />
          User Accounts
          <span className="text-white/30 font-normal ml-1">({usersData?.total || 0})</span>
        </h2>
        {sessions.length > 0 && (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {sessions.length} active now
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {PROVIDER_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setProviderFilter(option.key)
                setPage(1)
              }}
              className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
                providerFilter === option.key
                  ? 'border-blue-400/30 bg-blue-500/10 text-blue-200'
                  : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Search email or name"
            className="w-full min-w-[240px] rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      </div>

      <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
        <div className="max-h-[700px] overflow-auto">
          <table className="w-full min-w-[860px]">
          <thead>
            <tr className="text-left text-[10px] text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Registered</th>
              <th className="px-4 py-3">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isOnline = onlineUserIds.has(u.id)
              return (
                <tr key={u.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-white/[0.05] flex items-center justify-center">
                        <UserIcon size={13} className="text-white/40" />
                      </div>
                      <div>
                        <div className="text-sm text-white">{u.full_name || u.email.split('@')[0]}</div>
                        <div className="text-[11px] text-white/30 font-mono">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ProviderBadge provider={u.auth_provider_label} />
                  </td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isOnline ? 'bg-emerald-400' : u.is_active ? 'bg-white/20' : 'bg-red-400'
                      }`} />
                      <span className="text-xs text-white/50">
                        {isOnline ? 'Online' : u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/40 font-mono">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-white/40 font-mono">{formatRelative(u.last_login_at)}</td>
                </tr>
              )
            })}
          </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3 text-xs text-white/45 md:flex-row md:items-center md:justify-between">
        <div>
          Showing {users.length === 0 ? 0 : (page - 1) * (usersData?.per_page || 40) + 1}
          {' - '}
          {(page - 1) * (usersData?.per_page || 40) + users.length} of {usersData?.total || 0} users
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/35">
            Page {usersData?.page || 1} / {Math.max(usersData?.total_pages || 1, 1)}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
            disabled={page <= 1}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(current + 1, usersData?.total_pages || current))}
            disabled={page >= (usersData?.total_pages || 1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
