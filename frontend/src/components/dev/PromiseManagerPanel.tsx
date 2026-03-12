/**
 * PromiseManagerPanel — Dev console for manually toggling promise statuses
 *
 * Lists all 105 manifesto promises with inline status toggles.
 * Uses PUT /promises/{promise_id} (dev-only endpoint).
 */
import { useState, useEffect, useMemo } from 'react'
import { ClipboardCheck, Search, Save, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import apiClient from '../../api/client'

type PromiseStatus = 'not_started' | 'in_progress' | 'partially_fulfilled' | 'fulfilled' | 'stalled'

interface ManifestoPromise {
  promise_id: string
  promise: string
  category: string
  status: PromiseStatus
  detail?: string
  status_detail?: string
  last_checked_at?: string
}

const STATUSES: { value: PromiseStatus; label: string; color: string }[] = [
  { value: 'not_started',         label: 'Not Started', color: '#71717A' },
  { value: 'in_progress',         label: 'In Progress', color: '#3B82F6' },
  { value: 'partially_fulfilled', label: 'Partial',     color: '#EAB308' },
  { value: 'fulfilled',           label: 'Fulfilled',   color: '#22C55E' },
  { value: 'stalled',             label: 'Stalled',     color: '#F97316' },
]

const STATUS_COLORS: Record<PromiseStatus, string> = {
  not_started: '#71717A',
  in_progress: '#3B82F6',
  partially_fulfilled: '#EAB308',
  fulfilled: '#22C55E',
  stalled: '#F97316',
}

export function PromiseManagerPanel() {
  const [promises, setPromises] = useState<ManifestoPromise[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [pendingChanges, setPendingChanges] = useState<Record<string, { status: PromiseStatus; status_detail?: string }>>({})
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const [editingDetail, setEditingDetail] = useState<string | null>(null)
  const [detailText, setDetailText] = useState('')

  useEffect(() => {
    fetchPromises()
  }, [])

  async function fetchPromises() {
    try {
      const res = await apiClient.get('/promises/summary', {
        params: { party: 'RSP', election_year: '2082' },
      })
      if (res.data.promises?.length > 0) {
        setPromises(res.data.promises)
      }
    } catch {
      // fallback — empty
    }
    setLoading(false)
  }

  const categories = useMemo(() => {
    const cats = new Set(promises.map(p => p.category))
    return Array.from(cats).sort()
  }, [promises])

  const filtered = useMemo(() => {
    let list = promises
    if (categoryFilter) list = list.filter(p => p.category === categoryFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.promise.toLowerCase().includes(q) ||
        p.promise_id.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    }
    return list
  }, [promises, categoryFilter, search])

  const stats = useMemo(() => {
    const s: Record<string, number> = {}
    for (const p of promises) {
      const effective = pendingChanges[p.promise_id]?.status ?? p.status
      s[effective] = (s[effective] || 0) + 1
    }
    return s
  }, [promises, pendingChanges])

  function handleStatusChange(promiseId: string, newStatus: PromiseStatus) {
    setPendingChanges(prev => ({
      ...prev,
      [promiseId]: { ...prev[promiseId], status: newStatus },
    }))
  }

  async function saveChange(promiseId: string) {
    const change = pendingChanges[promiseId]
    if (!change) return

    setSaving(prev => ({ ...prev, [promiseId]: 'saving' }))
    try {
      await apiClient.put(`/promises/${promiseId}`, {
        status: change.status,
        status_detail: change.status_detail || null,
      })

      // Update local state
      setPromises(prev => prev.map(p =>
        p.promise_id === promiseId
          ? { ...p, status: change.status, status_detail: change.status_detail || p.status_detail }
          : p
      ))
      setPendingChanges(prev => {
        const next = { ...prev }
        delete next[promiseId]
        return next
      })
      setSaving(prev => ({ ...prev, [promiseId]: 'saved' }))
      setTimeout(() => setSaving(prev => {
        const next = { ...prev }
        delete next[promiseId]
        return next
      }), 2000)
    } catch {
      setSaving(prev => ({ ...prev, [promiseId]: 'error' }))
    }
  }

  async function saveAll() {
    const ids = Object.keys(pendingChanges)
    for (const id of ids) {
      await saveChange(id)
    }
  }

  const pendingCount = Object.keys(pendingChanges).length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardCheck size={18} className="text-blue-400" />
          <div>
            <h2 className="text-sm font-semibold text-white">Govt Promise Tracker</h2>
            <p className="text-xs text-white/40">{promises.length} promises &middot; Toggle statuses manually</p>
          </div>
        </div>
        {pendingCount > 0 && (
          <button
            onClick={saveAll}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md hover:bg-blue-500/30 transition-all"
          >
            <Save size={13} />
            Save All ({pendingCount})
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 px-3 py-2.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
        {STATUSES.map(s => (
          <div key={s.value} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            <span className="text-white/50">{s.label}</span>
            <span className="font-mono font-bold text-white/80">{stats[s.value] || 0}</span>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search promises..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/[0.04] border border-white/[0.08] rounded-md text-white placeholder:text-white/25 focus:outline-none focus:border-blue-500/40"
          />
        </div>
        <select
          value={categoryFilter || ''}
          onChange={e => setCategoryFilter(e.target.value || null)}
          className="px-2 py-1.5 text-xs bg-white/[0.04] border border-white/[0.08] rounded-md text-white/70 focus:outline-none focus:border-blue-500/40"
        >
          <option value="">All Categories</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Promise table */}
      <div className="rounded-md border border-white/[0.06] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-white/[0.03] text-white/40 text-left">
              <th className="px-3 py-2 font-medium w-16">ID</th>
              <th className="px-3 py-2 font-medium">Promise</th>
              <th className="px-3 py-2 font-medium w-28">Category</th>
              <th className="px-3 py-2 font-medium w-40">Status</th>
              <th className="px-3 py-2 font-medium w-20">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const effectiveStatus = pendingChanges[p.promise_id]?.status ?? p.status
              const hasChange = !!pendingChanges[p.promise_id]
              const saveState = saving[p.promise_id]
              const isEditingDetail = editingDetail === p.promise_id

              return (
                <tr
                  key={p.promise_id}
                  className={`border-t border-white/[0.04] transition-colors ${hasChange ? 'bg-blue-500/[0.04]' : 'hover:bg-white/[0.02]'}`}
                >
                  <td className="px-3 py-2 font-mono text-white/50">{p.promise_id}</td>
                  <td className="px-3 py-2">
                    <div className="text-white/80 leading-snug">{p.promise}</div>
                    {p.status_detail && !isEditingDetail && (
                      <div
                        className="text-[10px] text-blue-400/60 mt-0.5 cursor-pointer hover:text-blue-400/80"
                        onClick={() => {
                          setEditingDetail(p.promise_id)
                          setDetailText(pendingChanges[p.promise_id]?.status_detail || p.status_detail || '')
                        }}
                      >
                        {p.status_detail}
                      </div>
                    )}
                    {isEditingDetail && (
                      <div className="mt-1 flex gap-1">
                        <input
                          type="text"
                          value={detailText}
                          onChange={e => setDetailText(e.target.value)}
                          placeholder="Status detail / note..."
                          className="flex-1 px-2 py-1 text-[10px] bg-white/[0.04] border border-white/[0.1] rounded text-white/70 focus:outline-none focus:border-blue-500/40"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              setPendingChanges(prev => ({
                                ...prev,
                                [p.promise_id]: {
                                  status: prev[p.promise_id]?.status ?? p.status,
                                  status_detail: detailText,
                                },
                              }))
                              setEditingDetail(null)
                            }
                            if (e.key === 'Escape') setEditingDetail(null)
                          }}
                        />
                        <button
                          onClick={() => {
                            setPendingChanges(prev => ({
                              ...prev,
                              [p.promise_id]: {
                                status: prev[p.promise_id]?.status ?? p.status,
                                status_detail: detailText,
                              },
                            }))
                            setEditingDetail(null)
                          }}
                          className="px-2 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30"
                        >
                          Set
                        </button>
                      </div>
                    )}
                    {!p.status_detail && !isEditingDetail && (
                      <button
                        onClick={() => {
                          setEditingDetail(p.promise_id)
                          setDetailText('')
                        }}
                        className="text-[10px] text-white/20 hover:text-white/40 mt-0.5"
                      >
                        + add note
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-white/40 text-[10px]">{p.category}</td>
                  <td className="px-3 py-2">
                    <select
                      value={effectiveStatus}
                      onChange={e => handleStatusChange(p.promise_id, e.target.value as PromiseStatus)}
                      className="w-full px-2 py-1 text-[11px] font-medium rounded border focus:outline-none"
                      style={{
                        background: `${STATUS_COLORS[effectiveStatus]}15`,
                        borderColor: `${STATUS_COLORS[effectiveStatus]}40`,
                        color: STATUS_COLORS[effectiveStatus],
                      }}
                    >
                      {STATUSES.map(s => (
                        <option key={s.value} value={s.value} style={{ background: '#1C2127', color: '#F6F7F9' }}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {hasChange && !saveState && (
                      <button
                        onClick={() => saveChange(p.promise_id)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-all"
                      >
                        <Save size={10} />
                        Save
                      </button>
                    )}
                    {saveState === 'saving' && <Loader2 size={13} className="animate-spin text-blue-400" />}
                    {saveState === 'saved' && <CheckCircle2 size={13} className="text-emerald-400" />}
                    {saveState === 'error' && <AlertTriangle size={13} className="text-red-400" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-white/30 text-xs">
          No promises found
        </div>
      )}
    </div>
  )
}
