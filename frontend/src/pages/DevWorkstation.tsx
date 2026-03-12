import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, FileEdit, LineChart, LogOut, ScrollText, ShieldCheck, Users, Wrench } from 'lucide-react'
import { fetchCorrections } from '../api/corrections'
import { AutomationControlsPanel } from '../components/dev/AutomationControlsPanel'
import { CorrectionQueuePanel } from '../components/dev/CorrectionQueuePanel'
import { DevOverviewPanel } from '../components/dev/DevOverviewPanel'
import { EditorialControlPanel } from '../components/dev/EditorialControlPanel'
import { PromiseManagerPanel } from '../components/dev/PromiseManagerPanel'
import { UsersAccessPanel } from '../components/dev/UsersAccessPanel'
import { ApiMonitorPanel } from '../components/dev/ApiMonitorPanel'
import { AuditLogPanel } from '../components/dev/AuditLogPanel'
import { SystemHealthPanel } from '../components/dev/SystemHealthPanel'
import { useDevWorkstationStore } from '../stores/devWorkstationStore'
import { useAuthStore } from '../store/slices/authSlice'

const DEV_PAGES = [
  { slug: 'overview', label: 'Overview', icon: Activity, title: 'Overview' },
  { slug: 'editorial', label: 'Editorial Control', icon: ShieldCheck, title: 'Editorial Control' },
  { slug: 'automation', label: 'Automation Controls', icon: Wrench, title: 'Automation Controls' },
  { slug: 'users', label: 'Users & Access', icon: Users, title: 'Users & Access' },
  { slug: 'api-monitor', label: 'API Monitor', icon: LineChart, title: 'API Monitor' },
  { slug: 'reliability', label: 'Reliability & Audit', icon: ScrollText, title: 'Reliability & Audit' },
]

function PageCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-h-0 rounded-[32px] border border-white/8 bg-[#090d18]/90 p-5 md:p-6">
      <div className="mb-5 text-xs uppercase tracking-[0.28em] text-white/28">{title}</div>
      {children}
    </section>
  )
}

export default function DevWorkstation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuthStore()
  const setPendingCount = useDevWorkstationStore((state) => state.setPendingCount)
  const pageSlug = location.pathname.split('/')[2] || 'overview'
  const activePage = DEV_PAGES.find((page) => page.slug === pageSlug) ?? DEV_PAGES[0]

  useEffect(() => {
    fetchCorrections('pending', 1, 1)
      .then((result) => setPendingCount(result.pending_count))
      .catch(() => {})
  }, [setPendingCount])

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow

    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [])

  const renderPage = () => {
    switch (activePage.slug) {
      case 'overview':
        return (
          <PageCard title="Overview">
            <DevOverviewPanel />
          </PageCard>
        )
      case 'editorial':
        return (
          <PageCard title="Editorial Control">
            <EditorialControlPanel />
          </PageCard>
        )
      case 'automation':
        return (
          <PageCard title="Automation Controls">
            <AutomationControlsPanel />
          </PageCard>
        )
      case 'users':
        return (
          <PageCard title="Users & Access">
            <UsersAccessPanel />
          </PageCard>
        )
      case 'api-monitor':
        return (
          <PageCard title="API Monitor">
            <ApiMonitorPanel />
          </PageCard>
        )
      case 'reliability':
        return (
          <PageCard title="Reliability & Audit">
            <div className="space-y-8">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <SystemHealthPanel />
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <AuditLogPanel />
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <CorrectionQueuePanel />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-5 flex items-center gap-2 text-white">
                  <FileEdit size={16} className="text-blue-400" />
                  <h2 className="text-lg font-semibold tracking-tight">Promise Management</h2>
                </div>
                <PromiseManagerPanel />
              </div>
            </div>
          </PageCard>
        )
      default:
        return null
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-[#060913] text-white">
      <div className="mx-auto flex h-full max-w-[1700px] flex-col px-4 py-5 md:px-6 md:py-6">
        <header className="rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(35,99,255,0.18),_transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6 md:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/45">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Developer Command Center
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Editorial control plane and platform intelligence for live operations.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55 md:text-base">
                The dev console is now split into separate pages. API Monitor has its own dedicated page under `/dev/api-monitor`.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60 hover:text-white hover:border-white/20 transition-colors"
              >
                <ArrowLeft size={16} />
                Back to Dashboard
              </button>
              <button
                onClick={logout}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200 hover:bg-red-500/20 transition-colors"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </div>
        </header>

        <nav className="z-20 mt-5 overflow-x-auto rounded-2xl border border-white/8 bg-[#090d18]/90 px-3 py-3 backdrop-blur">
          <div className="flex min-w-max items-center gap-2">
            {DEV_PAGES.map(({ slug, label, icon: Icon }) => {
              const isActive = activePage.slug === slug

              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => navigate(`/dev/${slug}`)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'border-blue-400/30 bg-blue-500/12 text-white'
                      : 'border-white/8 bg-white/[0.03] text-white/55 hover:text-white hover:border-white/18'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              )
            })}
          </div>
        </nav>

        <main className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-5 pb-6">
            {renderPage()}
          </div>
        </main>
      </div>
    </div>
  )
}
