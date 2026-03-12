import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileEdit, Check, X, RotateCcw, Upload, AlertCircle } from 'lucide-react'
import {
  fetchCorrections,
  approveCorrection,
  rejectCorrection,
  rollbackCorrection,
  bulkUploadCorrections,
  type CorrectionEntry,
} from '../../api/corrections'
import { useDevWorkstationStore } from '../../stores/devWorkstationStore'

type StatusTab = 'pending' | 'approved' | 'rejected'

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
    rolled_back: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${styles[status] || ''}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function formatRelative(dateStr: string): string {
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

export function CorrectionQueuePanel() {
  const [tab, setTab] = useState<StatusTab>('pending')
  const [rejectModal, setRejectModal] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rollbackModal, setRollbackModal] = useState<string | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const setPendingCount = useDevWorkstationStore((s) => s.setPendingCount)

  const { data, isLoading } = useQuery({
    queryKey: ['corrections', tab],
    queryFn: () => fetchCorrections(tab),
  })

  // Update pending count
  if (data?.pending_count !== undefined) {
    setPendingCount(data.pending_count)
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => approveCorrection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corrections'] }),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectCorrection(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] })
      setRejectModal(null)
      setRejectReason('')
    },
  })

  const rollbackMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rollbackCorrection(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] })
      setRollbackModal(null)
      setRollbackReason('')
    },
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => bulkUploadCorrections(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corrections'] }),
  })

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadMut.mutate(file)
    e.target.value = ''
  }

  const tabItems: { key: StatusTab; label: string; color: string }[] = [
    { key: 'pending', label: 'Pending', color: 'amber' },
    { key: 'approved', label: 'Approved', color: 'emerald' },
    { key: 'rejected', label: 'Rejected', color: 'red' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileEdit size={15} className="text-white/30" />
          Data Corrections
        </h2>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/60 bg-white/[0.03] border border-white/[0.08] rounded hover:bg-white/[0.06] transition-colors"
          >
            <Upload size={12} />
            Bulk CSV Upload
          </button>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2">
        {tabItems.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-xs font-medium rounded transition-colors ${
              tab === key
                ? `bg-${color}-500/20 text-${color}-400 border border-${color}-500/30`
                : 'text-white/30 bg-white/[0.02] border border-white/[0.06] hover:text-white/60'
            }`}
          >
            {label}
            {key === 'pending' && data?.pending_count ? ` (${data.pending_count})` : ''}
          </button>
        ))}
      </div>

      {/* Bulk upload result */}
      {uploadMut.isSuccess && uploadMut.data && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400">
          Uploaded {uploadMut.data.total_rows} rows: {uploadMut.data.valid} valid, {uploadMut.data.invalid} invalid.
          {uploadMut.data.errors.length > 0 && (
            <ul className="mt-1 text-red-400">
              {uploadMut.data.errors.slice(0, 5).map((e: { row: number; error: string }, i: number) => (
                <li key={i}>Row {e.row}: {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Correction Cards */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-white/20 text-xs text-center py-8">Loading corrections...</div>
        ) : !data?.items.length ? (
          <div className="text-white/20 text-xs text-center py-8">No {tab} corrections</div>
        ) : (
          data.items.map((c: CorrectionEntry) => (
            <div key={c.id} className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 hover:border-white/[0.10] transition-colors">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-sm font-medium text-white">{c.candidate_name || c.candidate_external_id}</h3>
                  <p className="text-[11px] text-white/30 mt-0.5">
                    Submitted by {c.submitted_by_email} &bull; {formatRelative(c.submitted_at)}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>

              {/* Diff View */}
              <div className="bg-black/30 rounded p-3 mb-3 border border-white/[0.04]">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">
                  Field: <span className="text-white/60 font-mono normal-case">{c.field}</span>
                </p>
                <div className="flex gap-4 items-start">
                  <div className="flex-1">
                    <p className="text-[10px] text-white/20 mb-0.5">Old Value</p>
                    <p className="text-xs text-red-400/80 font-mono leading-relaxed break-all">{c.old_value || '(empty)'}</p>
                  </div>
                  <div className="text-white/10 pt-3">&rarr;</div>
                  <div className="flex-1">
                    <p className="text-[10px] text-white/20 mb-0.5">New Value</p>
                    <p className="text-xs text-emerald-400/80 font-mono leading-relaxed break-all">{c.new_value}</p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-white/40 mb-3">
                <span className="text-white/20">Reason:</span> {c.reason}
              </p>

              {/* Actions */}
              {c.status === 'pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => approveMut.mutate(c.id)}
                    disabled={approveMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                  >
                    <Check size={12} />
                    Approve & Apply
                  </button>
                  <button
                    onClick={() => setRejectModal(c.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
                  >
                    <X size={12} />
                    Reject
                  </button>
                </div>
              )}

              {c.status === 'approved' && (
                <button
                  onClick={() => setRollbackModal(c.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded hover:bg-orange-500/20 transition-colors"
                >
                  <RotateCcw size={12} />
                  Rollback
                </button>
              )}

              {c.status === 'rejected' && c.rejection_reason && (
                <p className="text-xs text-red-400/70">
                  <span className="text-white/20">Rejection reason:</span> {c.rejection_reason}
                </p>
              )}

              {c.status === 'rolled_back' && c.rollback_reason && (
                <p className="text-xs text-orange-400/70">
                  <span className="text-white/20">Rollback reason:</span> {c.rollback_reason}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#12121a] border border-white/[0.08] rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <AlertCircle size={16} className="text-red-400" />
              Rejection Reason
            </h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why is this correction being rejected?"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 h-24 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setRejectModal(null); setRejectReason('') }}
                className="px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => rejectMut.mutate({ id: rejectModal, reason: rejectReason })}
                disabled={!rejectReason.trim() || rejectMut.isPending}
                className="px-4 py-2 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                Reject Correction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Modal */}
      {rollbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#12121a] border border-white/[0.08] rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <RotateCcw size={16} className="text-orange-400" />
              Rollback Reason
            </h3>
            <textarea
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              placeholder="Why is this correction being rolled back?"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-orange-500/50 h-24 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setRollbackModal(null); setRollbackReason('') }}
                className="px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => rollbackMut.mutate({ id: rollbackModal, reason: rollbackReason })}
                disabled={!rollbackReason.trim() || rollbackMut.isPending}
                className="px-4 py-2 text-xs font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded hover:bg-orange-500/20 disabled:opacity-50 transition-colors"
              >
                Rollback Correction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
