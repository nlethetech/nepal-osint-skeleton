import { useEffect, useState } from 'react'
import { Modal } from '../common/Modal'

interface ActionReasonModalProps {
  isOpen: boolean
  title: string
  description: string
  confirmLabel: string
  isLoading?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}

export function ActionReasonModal({
  isOpen,
  title,
  description,
  confirmLabel,
  isLoading = false,
  onClose,
  onConfirm,
}: ActionReasonModalProps) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (isOpen) {
      setReason('')
    }
  }, [isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/50 border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-500/80 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
            disabled={isLoading || reason.trim().length < 3}
          >
            {isLoading ? 'Working...' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-white/60">{description}</p>
        <div>
          <label className="block text-xs uppercase tracking-[0.22em] text-white/35 mb-2">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Required. This action will be written to the audit log."
            className="w-full min-h-28 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      </div>
    </Modal>
  )
}
