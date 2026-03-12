import { useState, useEffect } from 'react'
import { Play, Loader2, CheckCircle2, XCircle, Newspaper, CloudSun, Landmark, Radio, Brain } from 'lucide-react'
import {
  triggerRssIngestion,
  triggerWebScraping,
  triggerNitterAccounts,
  triggerNitterHashtags,
  triggerBipadIngestion,
  triggerGeeChangeDetection,
  triggerParliamentSync,
  triggerRecalculateScores,
  triggerAnalystAgent,
  fetchNitterStatus,
} from '../../api/operations'

type TriggerStatus = 'idle' | 'loading' | 'success' | 'error'

interface TriggerButton {
  id: string
  label: string
  description: string
  action: () => Promise<any>
}

interface TriggerGroup {
  title: string
  icon: React.ReactNode
  triggers: TriggerButton[]
}

const GROUPS: TriggerGroup[] = [
  {
    title: 'News & Social',
    icon: <Newspaper size={16} />,
    triggers: [
      { id: 'rss-priority', label: 'RSS Ingestion (Priority)', description: 'Ingest priority RSS sources only', action: () => triggerRssIngestion(true) },
      { id: 'rss-all', label: 'RSS Ingestion (All)', description: 'Ingest all configured RSS feeds', action: () => triggerRssIngestion(false) },
      { id: 'scrape-all', label: 'Web Scraping (All)', description: 'Scrape Ratopati, Ekantipur, etc.', action: triggerWebScraping },
      { id: 'nitter-accounts', label: 'Nitter Accounts', description: 'Scrape Twitter account timelines', action: triggerNitterAccounts },
      { id: 'nitter-hashtags', label: 'Nitter Hashtags', description: 'Scrape Twitter hashtag search', action: triggerNitterHashtags },
    ],
  },
  {
    title: 'Disasters & Environment',
    icon: <CloudSun size={16} />,
    triggers: [
      { id: 'bipad', label: 'BIPAD Disasters', description: 'Ingest incidents + earthquakes', action: triggerBipadIngestion },
      { id: 'gee', label: 'GEE Change Detection', description: 'Run satellite change analysis', action: triggerGeeChangeDetection },
    ],
  },
  {
    title: 'Elections & Parliament',
    icon: <Landmark size={16} />,
    triggers: [
      { id: 'parliament-sync', label: 'Parliament Full Sync', description: 'Sync MPs, bills, committees', action: triggerParliamentSync },
      { id: 'recalc-scores', label: 'Recalculate Scores', description: 'Recalculate MP performance scores', action: triggerRecalculateScores },
    ],
  },
  {
    title: 'Intelligence',
    icon: <Brain size={16} />,
    triggers: [
      { id: 'analyst-3h', label: 'Analyst Agent (3h)', description: 'Run situation brief for last 3 hours', action: () => triggerAnalystAgent(3) },
      { id: 'analyst-6h', label: 'Analyst Agent (6h)', description: 'Run situation brief for last 6 hours', action: () => triggerAnalystAgent(6) },
      { id: 'analyst-12h', label: 'Analyst Agent (12h)', description: 'Run situation brief for last 12 hours', action: () => triggerAnalystAgent(12) },
    ],
  },
]

function TriggerCard({ trigger }: { trigger: TriggerButton }) {
  const [status, setStatus] = useState<TriggerStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleRun = async () => {
    setStatus('loading')
    setErrorMsg('')
    try {
      await trigger.action()
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || err?.message || 'Failed')
      setStatus('error')
      setTimeout(() => setStatus('idle'), 5000)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 bg-white/[0.02] border border-white/[0.06] rounded-lg hover:border-white/[0.12] transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{trigger.label}</p>
        <p className="text-xs text-white/40 mt-0.5">{trigger.description}</p>
        {status === 'error' && errorMsg && (
          <p className="text-xs text-red-400 mt-1">{errorMsg}</p>
        )}
      </div>
      <button
        onClick={handleRun}
        disabled={status === 'loading'}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shrink-0
          ${status === 'success'
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : status === 'error'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 hover:border-blue-500/30 disabled:opacity-50'
          }`}
      >
        {status === 'loading' && <Loader2 size={13} className="animate-spin" />}
        {status === 'success' && <CheckCircle2 size={13} />}
        {status === 'error' && <XCircle size={13} />}
        {status === 'idle' && <Play size={13} />}
        {status === 'loading' ? 'Running…' : status === 'success' ? 'Done' : status === 'error' ? 'Failed' : 'Run'}
      </button>
    </div>
  )
}

function NitterStatusCard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchNitterStatus()
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <Radio size={16} className="text-white/40" />
        <h3 className="text-sm font-medium text-white">Nitter Status</h3>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : data ? (
        <div className="space-y-1.5 text-xs">
          {data.instances && (
            <div className="flex justify-between">
              <span className="text-white/40">Instances</span>
              <span className="text-white font-mono">{Array.isArray(data.instances) ? data.instances.length : '—'}</span>
            </div>
          )}
          {data.last_scrape && (
            <div className="flex justify-between">
              <span className="text-white/40">Last scrape</span>
              <span className="text-white font-mono">{new Date(data.last_scrape).toLocaleString()}</span>
            </div>
          )}
          {data.status && (
            <div className="flex justify-between">
              <span className="text-white/40">Status</span>
              <span className={`font-mono ${data.status === 'healthy' ? 'text-emerald-400' : 'text-amber-400'}`}>{data.status}</span>
            </div>
          )}
          {typeof data === 'object' && !data.instances && !data.last_scrape && !data.status && (
            <pre className="text-white/60 font-mono whitespace-pre-wrap break-all">{JSON.stringify(data, null, 2)}</pre>
          )}
        </div>
      ) : (
        <p className="text-xs text-white/30">Unable to fetch status</p>
      )}
    </div>
  )
}

export function OperationsPanel() {
  return (
    <div className="space-y-8">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="text-white/40">{group.icon}</div>
            <h2 className="text-sm font-semibold text-white tracking-tight">{group.title}</h2>
          </div>
          <div className="space-y-2">
            {group.triggers.map((trigger) => (
              <TriggerCard key={trigger.id} trigger={trigger} />
            ))}
          </div>
        </section>
      ))}

      {/* Status readout */}
      <section>
        <h2 className="text-sm font-semibold text-white tracking-tight mb-3">Status Readout</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NitterStatusCard />
        </div>
      </section>
    </div>
  )
}
