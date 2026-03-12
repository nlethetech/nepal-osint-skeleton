import { useEffect, useMemo, useState } from 'react'
import { Button, InputGroup, Tag, TextArea } from '@blueprintjs/core'
import {
  submitGraphCorrection,
  fetchGraphCorrections,
  approveGraphCorrection,
  rejectGraphCorrection,
  rollbackGraphCorrection,
  type GraphCorrectionEntry,
} from '../../api/unifiedGraph'
import { useAuthStore } from '../../store/slices/authSlice'

interface GraphCorrectionsPanelProps {
  selectedNodeId: string | null
  className?: string
}

type PanelTab = 'submit' | 'review'

const ACTIONS = [
  'update_node_field',
  'add_edge',
  'deactivate_edge',
  'predicate_correction',
  'merge_nodes',
  'split_suggestion',
]

export function GraphCorrectionsPanel({ selectedNodeId, className = '' }: GraphCorrectionsPanelProps) {
  const user = useAuthStore((s) => s.user)
  const isDev = user?.role === 'dev'

  const [tab, setTab] = useState<PanelTab>('submit')
  const [action, setAction] = useState('update_node_field')
  const [reason, setReason] = useState('')
  const [payloadText, setPayloadText] = useState('{\n  "field": "description",\n  "new_value": ""\n}')
  const [message, setMessage] = useState<string | null>(null)
  const [items, setItems] = useState<GraphCorrectionEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('pending')

  const parsedPayload = useMemo(() => {
    try {
      return JSON.parse(payloadText) as Record<string, unknown>
    } catch {
      return null
    }
  }, [payloadText])

  const loadCorrections = async () => {
    setIsLoading(true)
    try {
      const data = await fetchGraphCorrections({ status: statusFilter || undefined, per_page: 50 }).then((r) => r.data)
      setItems(data.items)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load corrections')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'review') return
    void loadCorrections()
  }, [tab, statusFilter])

  const handleSubmit = async () => {
    if (!reason || reason.length < 10) {
      setMessage('Reason must be at least 10 characters.')
      return
    }
    if (!parsedPayload) {
      setMessage('Payload must be valid JSON.')
      return
    }
    try {
      const payload = { ...parsedPayload }
      if (selectedNodeId && !payload.node_id) payload.node_id = selectedNodeId
      const response = await submitGraphCorrection({
        action,
        reason,
        payload,
        node_id: selectedNodeId || undefined,
      }).then((r) => r.data)
      setMessage(response.message)
      setReason('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to submit correction')
    }
  }

  const handleApprove = async (id: string) => {
    await approveGraphCorrection(id, 'Approved from investigation panel')
    await loadCorrections()
  }
  const handleReject = async (id: string) => {
    await rejectGraphCorrection(id, 'Needs more evidence')
    await loadCorrections()
  }
  const handleRollback = async (id: string) => {
    await rollbackGraphCorrection(id, 'Rollback requested from reviewer panel')
    await loadCorrections()
  }

  return (
    <div className={`h-full overflow-y-auto p-3 space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Button
          minimal
          small
          active={tab === 'submit'}
          onClick={() => setTab('submit')}
        >
          Submit
        </Button>
        <Button
          minimal
          small
          active={tab === 'review'}
          onClick={() => setTab('review')}
        >
          Review Queue
        </Button>
      </div>

      {tab === 'submit' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-bp-border bg-bp-surface p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-bp-text-secondary">Correction Draft</p>
            <div>
              <label className="text-[10px] text-bp-text-secondary">Action</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full mt-1 rounded border border-bp-border bg-bp-bg text-bp-text text-xs px-2 py-1"
              >
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-bp-text-secondary">Selected node</label>
              <InputGroup value={selectedNodeId || ''} readOnly placeholder="Select a node in graph context" />
            </div>
            <div>
              <label className="text-[10px] text-bp-text-secondary">Payload (JSON)</label>
              <TextArea
                fill
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                className="text-xs font-mono min-h-[120px]"
              />
            </div>
            <div>
              <label className="text-[10px] text-bp-text-secondary">Reason / evidence summary</label>
              <TextArea
                fill
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-xs min-h-[70px]"
              />
            </div>
            <Button small intent="primary" onClick={() => void handleSubmit()}>
              Submit Correction
            </Button>
          </div>
        </div>
      )}

      {tab === 'review' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-bp-border bg-bp-bg text-bp-text text-xs px-2 py-1"
            >
              <option value="">all</option>
              <option value="pending">pending</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="rolled_back">rolled_back</option>
            </select>
            <Button small minimal onClick={() => void loadCorrections()} loading={isLoading}>Refresh</Button>
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded border border-bp-border bg-bp-surface p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-bp-text">{item.action}</p>
                    <p className="text-[10px] text-bp-text-secondary">{item.reason}</p>
                  </div>
                  <Tag minimal round>{item.status}</Tag>
                </div>
                <pre className="mt-1 text-[10px] text-bp-text-secondary whitespace-pre-wrap break-words">
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
                {isDev && (
                  <div className="flex items-center gap-2 mt-2">
                    {item.status === 'pending' && (
                      <>
                        <Button small intent="success" onClick={() => void handleApprove(item.id)}>Approve</Button>
                        <Button small intent="danger" onClick={() => void handleReject(item.id)}>Reject</Button>
                      </>
                    )}
                    {item.status === 'approved' && (
                      <Button small intent="warning" onClick={() => void handleRollback(item.id)}>Rollback</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-xs text-bp-text-secondary">No corrections in this queue.</p>
            )}
          </div>
        </div>
      )}

      {message && <p className="text-xs text-bp-primary">{message}</p>}
    </div>
  )
}
