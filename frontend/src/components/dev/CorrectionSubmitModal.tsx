import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Send } from 'lucide-react'
import { submitCorrection } from '../../api/corrections'

interface Candidate {
  external_id: string
  name_en: string
  name_ne?: string
  name_en_roman?: string
  biography?: string
  biography_source?: string
  education?: string
  age?: number
  gender?: string
  aliases?: string[]
  previous_positions?: any[]
}

interface CorrectionSubmitModalProps {
  candidate: Candidate
  onClose: () => void
}

function formatPreviousPositions(positions?: any[]): string {
  if (!positions?.length) return ''
  return positions
    .map((pos) => {
      if (typeof pos === 'string') return pos
      if (pos && typeof pos === 'object') {
        const year = pos.year ? `${pos.year}` : ''
        const constituency = pos.constituency || pos.constituency_name || ''
        const party = pos.party || pos.party_name || ''
        return [year, constituency, party].filter(Boolean).join(' · ')
      }
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

const EDITABLE_FIELDS = [
  { key: 'name_en_roman', label: 'Romanized Name', getter: (c: Candidate) => c.name_en_roman || c.name_en },
  { key: 'aliases', label: 'Aliases', getter: (c: Candidate) => c.aliases?.join(', ') || '' },
  { key: 'biography', label: 'Biography', getter: (c: Candidate) => c.biography || '' },
  { key: 'biography_source', label: 'Biography Source URL', getter: (c: Candidate) => c.biography_source || '' },
  { key: 'age', label: 'Age', getter: (c: Candidate) => (c.age != null ? String(c.age) : '') },
  { key: 'gender', label: 'Gender', getter: (c: Candidate) => c.gender || '' },
  { key: 'previous_positions', label: 'Previous Positions', getter: (c: Candidate) => formatPreviousPositions(c.previous_positions) },
]

export function CorrectionSubmitModal({ candidate, onClose }: CorrectionSubmitModalProps) {
  const [field, setField] = useState('')
  const [newValue, setNewValue] = useState('')
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      submitCorrection(candidate.external_id, { field, new_value: newValue, reason }),
    onSuccess: () => onClose(),
  })

  const selectedField = EDITABLE_FIELDS.find((f) => f.key === field)
  const currentValue = selectedField?.getter(candidate) || ''
  const isValid = field && newValue.trim() && reason.trim().length >= 10

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[#12121a] border border-white/[0.08] rounded-xl p-6 w-[480px] shadow-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-white">Suggest Correction</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Field to Correct</label>
            <select
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-xs text-white appearance-none focus:outline-none focus:border-blue-500/50"
              value={field}
              onChange={(e) => { setField(e.target.value); setNewValue('') }}
            >
              <option value="">Select field...</option>
              {EDITABLE_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>

          {selectedField && (
            <>
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Current Value</label>
                <div className="bg-white/[0.02] border border-white/[0.04] rounded px-3 py-2 text-xs text-white/40 font-mono max-h-24 overflow-auto">
                  {currentValue || '(empty)'}
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Corrected Value</label>
                {field === 'biography' || field === 'previous_positions' ? (
                  <textarea
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50 h-32 resize-none"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={field === 'biography' ? 'Enter corrected biography...' : 'Enter corrected positions (comma-separated)...'}
                  />
                ) : (
                  <input
                    type="text"
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="Enter corrected value..."
                  />
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Reason for Correction</label>
            <textarea
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50 h-20 resize-none"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this correction needed? (min 10 characters)"
            />
          </div>

          {mutation.isError && (
            <p className="text-xs text-red-400">Failed to submit correction. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!isValid || mutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded hover:bg-blue-500/20 disabled:opacity-40 transition-colors"
            >
              <Send size={12} />
              {mutation.isPending ? 'Submitting...' : 'Submit for Review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
