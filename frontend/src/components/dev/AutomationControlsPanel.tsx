import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, PauseCircle, PlayCircle, RotateCcw } from 'lucide-react'
import {
  fetchAutomationControls,
  pauseAutomation,
  rerunAutomation,
  resumeAutomation,
  type AutomationControl,
} from '../../api/editorial'
import { ActionReasonModal } from './ActionReasonModal'

type PendingAction =
  | { type: 'pause'; control: AutomationControl }
  | { type: 'resume'; control: AutomationControl }
  | { type: 'rerun'; control: AutomationControl }
  | null

type AutomationAction = NonNullable<PendingAction>['type']

function formatTimestamp(value?: string | null) {
  if (!value) return 'never'
  return new Date(value).toLocaleString()
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
      active
        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
        : 'border-white/10 bg-white/[0.03] text-white/45'
    }`}>
      {label}
    </span>
  )
}

export function AutomationControlsPanel() {
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['editorial-automation-controls'],
    queryFn: fetchAutomationControls,
    refetchInterval: 60000,
  })

  const mutation = useMutation({
    mutationFn: async ({ action, control, reason }: { action: AutomationAction; control: AutomationControl; reason: string }) => {
      if (action === 'pause') return pauseAutomation(control.automation_key, reason)
      if (action === 'resume') return resumeAutomation(control.automation_key, reason)
      return rerunAutomation(control.automation_key, reason)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['editorial-automation-controls'] })
      queryClient.invalidateQueries({ queryKey: ['editorial-overview'] })
      setPendingAction(null)
    },
  })

  const modalConfig = useMemo(() => {
    if (!pendingAction) return null
    if (pendingAction.type === 'pause') {
      return {
        title: `Pause ${pendingAction.control.label}`,
        description: 'This automation will stop processing until you resume it.',
        confirmLabel: 'Pause automation',
      }
    }
    if (pendingAction.type === 'resume') {
      return {
        title: `Resume ${pendingAction.control.label}`,
        description: 'This automation will resume normal processing immediately.',
        confirmLabel: 'Resume automation',
      }
    }
    return {
      title: `Rerun ${pendingAction.control.label}`,
      description: 'This will queue an immediate rerun request and write an audit event.',
      confirmLabel: 'Queue rerun',
    }
  }, [pendingAction])

  return (
    <section className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-white">
          <Bot size={16} className="text-blue-400" />
          <h2 className="text-lg font-semibold tracking-tight">Automation Controls</h2>
        </div>
        <p className="mt-1 text-sm text-white/45">
          Runtime controls for core editorial automations with audit-backed pause, resume, and rerun.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data?.openai && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 xl:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white">OpenAI Runtime Status</div>
                <div className="mt-1 text-sm text-white/45">
                  Embeddings, clustering, agent paths, and model routing currently loaded by the backend.
                </div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                data.openai.status === 'healthy'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                  : data.openai.status === 'misconfigured'
                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                    : 'border-white/10 bg-white/[0.03] text-white/45'
              }`}>
                {data.openai.status}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill label="API key" active={data.openai.api_key_configured} />
              <StatusPill label="OpenAI embeddings" active={data.openai.embedding_enabled} />
              <StatusPill label="Embedded clusters" active={data.openai.clustering_enabled} />
              <StatusPill label="Agent" active={data.openai.agent_enabled} />
              <StatusPill label="Developing stories" active={data.openai.developing_stories_enabled} />
              <StatusPill label="Story tracker" active={data.openai.story_tracker_enabled} />
              <StatusPill label="Usage limits" active={data.openai.usage_limit_enabled} />
              <StatusPill label="Local embedding fallback" active={data.openai.local_embeddings_active} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-white/45 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <div>Embedding key</div>
                <div className="mt-1 text-white/70">{data.openai.embedding_model_key}</div>
              </div>
              <div>
                <div>Embedding model</div>
                <div className="mt-1 text-white/70">{data.openai.embedding_model}</div>
              </div>
              <div>
                <div>Cluster model</div>
                <div className="mt-1 text-white/70">{data.openai.clustering_model}</div>
              </div>
              <div>
                <div>Agent models</div>
                <div className="mt-1 text-white/70">{data.openai.agent_fast_model} / {data.openai.agent_deep_model}</div>
              </div>
            </div>
          </div>
        )}

        {(data?.items || []).map((control) => (
          <div key={control.automation_key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white">{control.label}</div>
                <div className="mt-1 text-sm text-white/45">{control.description}</div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                control.is_enabled
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-400/30 bg-red-500/10 text-red-300'
              }`}>
                {control.is_enabled ? 'Live' : 'Paused'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/45">
              <div>Last success</div>
              <div className="text-right text-white/70">{formatTimestamp(control.last_success_at)}</div>
              <div>Last rerun request</div>
              <div className="text-right text-white/70">{formatTimestamp(control.last_rerun_requested_at)}</div>
              <div>Last run status</div>
              <div className="text-right text-white/70 capitalize">{control.last_run_status || 'unknown'}</div>
            </div>

            {control.last_error && (
              <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {control.last_error}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {control.is_enabled ? (
                <button
                  onClick={() => setPendingAction({ type: 'pause', control })}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 transition-colors"
                >
                  <PauseCircle size={14} />
                  Pause
                </button>
              ) : (
                <button
                  onClick={() => setPendingAction({ type: 'resume', control })}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/20 transition-colors"
                >
                  <PlayCircle size={14} />
                  Resume
                </button>
              )}
              <button
                onClick={() => setPendingAction({ type: 'rerun', control })}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-200 hover:bg-blue-500/20 transition-colors"
              >
                <RotateCcw size={14} />
                Rerun
              </button>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/35">
            Loading automation controls...
          </div>
        )}
      </div>

      {pendingAction && modalConfig && (
        <ActionReasonModal
          isOpen
          title={modalConfig.title}
          description={modalConfig.description}
          confirmLabel={modalConfig.confirmLabel}
          isLoading={mutation.isPending}
          onClose={() => setPendingAction(null)}
          onConfirm={(reason) => mutation.mutate({ action: pendingAction.type, control: pendingAction.control, reason })}
        />
      )}
    </section>
  )
}
