/**
 * PipelinesPanel — Fact-check queue, Haiku processing, Verbatim analysis pipelines
 * Shows pending items in each queue with counts, details, and manual trigger actions.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, Brain, Landmark, RefreshCw, Loader2, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, CheckCircle2, Clock, Hash,
} from 'lucide-react'
import apiClient from '../../api/client'

// ── API helpers ──

async function fetchFactCheckQueue(limit = 15) {
  const { data } = await apiClient.get('/fact-check/pending', { params: { limit } })
  return data as Array<{
    story_id: string
    title: string
    url: string | null
    source_name: string | null
    summary: string | null
    content: string | null
    request_count: number
    first_requested: string
  }>
}

async function fetchFactCheckResults(limit = 10) {
  const { data } = await apiClient.get('/fact-check/results', { params: { limit, hours: 168 } })
  return data as Array<{
    story_id: string
    title: string
    source_name: string | null
    url: string | null
    verdict: string
    verdict_summary: string
    confidence: number
    checked_at: string
  }>
}

async function fetchHaikuQueue(task: 'relevance' | 'summary', limit = 20) {
  const { data } = await apiClient.get('/stories/pending-haiku', { params: { task, limit } })
  return data as { task: string; count: number; stories: Array<{ id: string; title: string; summary: string | null; source_name: string | null }> }
}

async function fetchVerbatimQueue(limit = 10) {
  const { data } = await apiClient.get('/verbatim/pending-analysis', { params: { limit } })
  return data as {
    total: number
    sessions: Array<{
      session_id: string
      title_ne: string
      session_date: string
      session_date_bs: string
      speech_count: number
    }>
  }
}

// ── Shared components ──

function QueueHeader({ icon, title, count, isLoading, onRefresh }: {
  icon: React.ReactNode; title: string; count: number | null; isLoading: boolean; onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2.5">
        <div className="text-white/40">{icon}</div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {count !== null && (
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full tabular-nums ${
            count > 0
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
          }`}>
            {count} pending
          </span>
        )}
      </div>
      <button
        onClick={onRefresh}
        disabled={isLoading}
        className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors disabled:opacity-50"
      >
        <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
        Refresh
      </button>
    </div>
  )
}

function EmptyQueue({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-xs text-white/30">
      <CheckCircle2 size={14} className="mr-2 text-emerald-500/50" />
      {message}
    </div>
  )
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 60000) return 'just now'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Fact-Check Queue ──

function FactCheckQueue() {
  const [showResults, setShowResults] = useState(false)
  const qc = useQueryClient()

  const { data: queue, isLoading } = useQuery({
    queryKey: ['dev', 'fc-queue'],
    queryFn: () => fetchFactCheckQueue(20),
    refetchInterval: 60000,
  })

  const { data: results } = useQuery({
    queryKey: ['dev', 'fc-results'],
    queryFn: () => fetchFactCheckResults(10),
    enabled: showResults,
  })

  return (
    <section className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-5">
      <QueueHeader
        icon={<ShieldCheck size={16} />}
        title="Fact-Check Queue"
        count={queue?.length ?? null}
        isLoading={isLoading}
        onRefresh={() => qc.invalidateQueries({ queryKey: ['dev', 'fc-queue'] })}
      />

      {!queue?.length ? (
        <EmptyQueue message="No stories awaiting fact-check" />
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {queue.map((item) => (
            <div key={item.story_id} className="flex items-start gap-3 px-3 py-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    <Hash size={9} />{item.request_count} requests
                  </span>
                  {item.source_name && (
                    <span className="text-[10px] text-white/30">{item.source_name}</span>
                  )}
                  <span className="text-[10px] text-white/20 ml-auto flex items-center gap-1">
                    <Clock size={9} />{timeAgo(item.first_requested)}
                  </span>
                </div>
                <p className="text-xs text-white/80 leading-relaxed line-clamp-2">{item.title}</p>
                {item.summary && (
                  <p className="text-[11px] text-white/30 mt-1 line-clamp-1">{item.summary}</p>
                )}
              </div>
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-white/20 hover:text-blue-400 transition-colors shrink-0 mt-1">
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent results toggle */}
      <button
        onClick={() => setShowResults(!showResults)}
        className="flex items-center gap-1.5 mt-3 text-xs text-white/30 hover:text-white/50 transition-colors"
      >
        {showResults ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Recent fact-check results
      </button>

      {showResults && results && (
        <div className="mt-2 space-y-1.5 max-h-[300px] overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-xs text-white/20 py-2">No recent results</p>
          ) : results.map((r) => (
            <div key={r.story_id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-white/[0.015] border border-white/[0.04]">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                r.verdict === 'true' ? 'bg-emerald-500/15 text-emerald-400' :
                r.verdict === 'false' ? 'bg-red-500/15 text-red-400' :
                r.verdict === 'partially_true' ? 'bg-amber-500/15 text-amber-400' :
                'bg-white/5 text-white/40'
              }`}>
                {r.verdict}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white/70 truncate">{r.title}</p>
              </div>
              <span className="text-[10px] text-white/20 shrink-0">{timeAgo(r.checked_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Haiku Processing Queue ──

function HaikuQueue() {
  const qc = useQueryClient()

  const { data: relevance, isLoading: relLoading } = useQuery({
    queryKey: ['dev', 'haiku-relevance'],
    queryFn: () => fetchHaikuQueue('relevance', 50),
    refetchInterval: 60000,
  })

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['dev', 'haiku-summary'],
    queryFn: () => fetchHaikuQueue('summary', 50),
    refetchInterval: 60000,
  })

  const relCount = relevance?.count ?? 0
  const sumCount = summary?.count ?? 0
  const totalCount = relCount + sumCount

  return (
    <section className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-5">
      <QueueHeader
        icon={<Brain size={16} />}
        title="Haiku Processing"
        count={totalCount}
        isLoading={relLoading || sumLoading}
        onRefresh={() => {
          qc.invalidateQueries({ queryKey: ['dev', 'haiku-relevance'] })
          qc.invalidateQueries({ queryKey: ['dev', 'haiku-summary'] })
        }}
      />

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white/[0.03] rounded-md p-3">
          <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Relevance Filter</div>
          <div className={`text-xl font-bold font-mono tabular-nums ${relCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {relCount}
          </div>
          <div className="text-[10px] text-white/30 mt-0.5">stories unclassified</div>
        </div>
        <div className="bg-white/[0.03] rounded-md p-3">
          <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">AI Summary</div>
          <div className={`text-xl font-bold font-mono tabular-nums ${sumCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {sumCount}
          </div>
          <div className="text-[10px] text-white/30 mt-0.5">stories unsummarized</div>
        </div>
      </div>

      {totalCount === 0 ? (
        <EmptyQueue message="All stories processed — pipeline clear" />
      ) : (
        <div className="space-y-1 max-h-[250px] overflow-y-auto">
          {(relevance?.stories || []).slice(0, 8).map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.015] border border-white/[0.04]">
              <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded uppercase shrink-0">REL</span>
              <p className="text-xs text-white/60 truncate">{s.title}</p>
              <span className="text-[10px] text-white/20 shrink-0">{s.source_name || ''}</span>
            </div>
          ))}
          {(summary?.stories || []).slice(0, 8).map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.015] border border-white/[0.04]">
              <span className="text-[9px] font-bold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded uppercase shrink-0">SUM</span>
              <p className="text-xs text-white/60 truncate">{s.title}</p>
              <span className="text-[10px] text-white/20 shrink-0">{s.source_name || ''}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Verbatim Analysis Queue ──

function VerbatimQueue() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dev', 'verbatim-queue'],
    queryFn: () => fetchVerbatimQueue(10),
    refetchInterval: 60000,
  })

  const sessions = data?.sessions || []
  const total = data?.total ?? 0

  return (
    <section className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-5">
      <QueueHeader
        icon={<Landmark size={16} />}
        title="Verbatim Analysis"
        count={total}
        isLoading={isLoading}
        onRefresh={() => qc.invalidateQueries({ queryKey: ['dev', 'verbatim-queue'] })}
      />

      {sessions.length === 0 ? (
        <EmptyQueue message="All sessions analyzed" />
      ) : (
        <div className="space-y-1.5">
          {sessions.map((s) => (
            <div key={s.session_id} className="flex items-center justify-between px-3 py-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-colors">
              <div className="min-w-0">
                <p className="text-xs text-white/80">{s.title_ne}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-white/30">{s.session_date_bs || s.session_date}</span>
                  <span className="text-[10px] text-white/30">{s.speech_count} speeches</span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded shrink-0">
                Pending
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Pipeline Overview Stats ──

function PipelineOverview() {
  const { data: fcQueue } = useQuery({ queryKey: ['dev', 'fc-queue'], queryFn: () => fetchFactCheckQueue(20) })
  const { data: relQueue } = useQuery({ queryKey: ['dev', 'haiku-relevance'], queryFn: () => fetchHaikuQueue('relevance', 1) })
  const { data: sumQueue } = useQuery({ queryKey: ['dev', 'haiku-summary'], queryFn: () => fetchHaikuQueue('summary', 1) })
  const { data: verbQueue } = useQuery({ queryKey: ['dev', 'verbatim-queue'], queryFn: () => fetchVerbatimQueue(1) })

  const stats = [
    { label: 'Fact-Check', count: fcQueue?.length ?? 0, color: fcQueue?.length ? 'text-amber-400' : 'text-emerald-400', bg: fcQueue?.length ? 'bg-amber-500/10' : 'bg-emerald-500/10' },
    { label: 'Relevance', count: relQueue?.count ?? 0, color: relQueue?.count ? 'text-amber-400' : 'text-emerald-400', bg: relQueue?.count ? 'bg-amber-500/10' : 'bg-emerald-500/10' },
    { label: 'Summaries', count: sumQueue?.count ?? 0, color: sumQueue?.count ? 'text-amber-400' : 'text-emerald-400', bg: sumQueue?.count ? 'bg-amber-500/10' : 'bg-emerald-500/10' },
    { label: 'Verbatim', count: verbQueue?.total ?? 0, color: verbQueue?.total ? 'text-amber-400' : 'text-emerald-400', bg: verbQueue?.total ? 'bg-amber-500/10' : 'bg-emerald-500/10' },
  ]

  const allClear = stats.every(s => s.count === 0)

  return (
    <div className={`rounded-lg p-4 border ${allClear ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-amber-500/5 border-amber-500/15'}`}>
      <div className="flex items-center gap-2 mb-3">
        {allClear ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : (
          <AlertTriangle size={14} className="text-amber-400" />
        )}
        <span className={`text-xs font-semibold ${allClear ? 'text-emerald-400' : 'text-amber-400'}`}>
          {allClear ? 'All pipelines clear' : 'Items pending processing'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-md p-2.5 ${s.bg}`}>
            <div className={`text-lg font-bold font-mono tabular-nums ${s.color}`}>{s.count}</div>
            <div className="text-[10px] text-white/40 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Panel ──

export function PipelinesPanel() {
  return (
    <div className="space-y-6">
      <PipelineOverview />
      <FactCheckQueue />
      <HaikuQueue />
      <VerbatimQueue />
    </div>
  )
}
