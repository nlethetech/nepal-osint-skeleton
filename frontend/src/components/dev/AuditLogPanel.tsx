import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Search, FileText } from 'lucide-react'
import { fetchAuditLogs, exportAuditLogsCsv, type AuditFilters } from '../../api/admin'

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    login: 'bg-blue-500/10 text-blue-400',
    logout: 'bg-white/5 text-white/40',
    create: 'bg-emerald-500/10 text-emerald-400',
    update: 'bg-amber-500/10 text-amber-400',
    delete: 'bg-red-500/10 text-red-400',
    approve: 'bg-emerald-500/10 text-emerald-400',
    reject: 'bg-red-500/10 text-red-400',
    rollback: 'bg-orange-500/10 text-orange-400',
    train: 'bg-purple-500/10 text-purple-400',
    promote: 'bg-cyan-500/10 text-cyan-400',
    flush: 'bg-red-500/10 text-red-400',
    export: 'bg-blue-500/10 text-blue-400',
    bulk_upload: 'bg-indigo-500/10 text-indigo-400',
  }
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${styles[action] || 'bg-white/5 text-white/40'}`}>
      {action}
    </span>
  )
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

export function AuditLogPanel() {
  const [filters, setFilters] = useState<AuditFilters>({ page: 1, per_page: 50 })

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => fetchAuditLogs(filters),
  })

  const handleExport = async () => {
    try {
      const blob = await exportAuditLogsCsv(filters)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Handle error silently
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText size={15} className="text-white/30" />
          Audit Log
        </h2>
        <div className="flex items-center gap-3">
          <p className="text-[10px] text-white/20">
            Retained for 7 days. Export to CSV for permanent records.
          </p>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-colors"
          >
            <Download size={12} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select
          className="bg-white/[0.03] border border-white/[0.08] rounded px-3 py-1.5 text-xs text-white appearance-none cursor-pointer focus:outline-none focus:border-blue-500/50"
          value={filters.action || ''}
          onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined, page: 1 })}
        >
          <option value="">All Actions</option>
          <option value="login">Login</option>
          <option value="logout">Logout</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
          <option value="train">Train</option>
        </select>

        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/20" />
          <input
            type="text"
            placeholder="Search user..."
            className="bg-white/[0.03] border border-white/[0.08] rounded pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50 w-48"
            value={filters.user_search || ''}
            onChange={(e) => setFilters({ ...filters, user_search: e.target.value || undefined, page: 1 })}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-white/20 text-xs">Loading...</td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-white/20 text-xs">No audit log entries</td></tr>
            ) : (
              data.items.map((log) => (
                <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 text-[11px] text-white/40 font-mono whitespace-nowrap">
                    {formatDateTime(log.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-white">{log.user_email}</td>
                  <td className="px-4 py-2.5"><ActionBadge action={log.action} /></td>
                  <td className="px-4 py-2.5 text-xs text-white/50">
                    {log.target_type && <>{log.target_type}{log.target_id ? `: ${log.target_id}` : ''}</>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-white/30 max-w-[200px] truncate font-mono">
                    {log.details ? JSON.stringify(log.details) : ''}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-white/25 font-mono">{log.ip_address}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between text-xs text-white/30">
          <span>
            Page {data.page} of {data.total_pages} ({data.total} entries)
          </span>
          <div className="flex gap-1">
            <button
              disabled={data.page <= 1}
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
              className="px-3 py-1 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
            >
              Prev
            </button>
            <button
              disabled={data.page >= data.total_pages}
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
              className="px-3 py-1 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
