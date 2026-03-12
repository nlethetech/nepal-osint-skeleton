import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Upload, FileText, AlertCircle, Check } from 'lucide-react'
import { bulkUploadCorrections, type BulkUploadResponse } from '../../api/corrections'

interface BulkUploadModalProps {
  onClose: () => void
  onSuccess?: () => void
}

export function BulkUploadModal({ onClose, onSuccess }: BulkUploadModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const mutation = useMutation({
    mutationFn: (file: File) => bulkUploadCorrections(file),
    onSuccess: () => onSuccess?.(),
  })

  const handleUpload = () => {
    if (selectedFile) mutation.mutate(selectedFile)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[#12121a] border border-white/[0.08] rounded-xl p-6 w-[520px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload size={16} className="text-white/40" />
            Bulk CSV Upload
          </h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* CSV Format */}
        <div className="bg-white/[0.02] border border-white/[0.04] rounded p-3 mb-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Expected CSV Format</p>
          <code className="text-[11px] text-emerald-400/70 font-mono leading-relaxed block">
            candidate_external_id,field,new_value,reason{'\n'}
            ECN-12345,name_en_roman,Ram Bahadur Thapa,Corrected romanization{'\n'}
            ECN-12346,biography,"Former minister...",Adding career history
          </code>
        </div>

        {/* File Picker */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        />

        <button
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-white/[0.08] rounded-lg p-8 flex flex-col items-center gap-2 hover:border-white/[0.15] transition-colors mb-4"
        >
          <FileText size={24} className="text-white/20" />
          <span className="text-xs text-white/40">
            {selectedFile ? selectedFile.name : 'Click to select CSV file'}
          </span>
        </button>

        {/* Upload Result */}
        {mutation.isSuccess && mutation.data && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-3 mb-4 text-xs text-emerald-400">
            <p className="flex items-center gap-1.5 font-medium mb-1">
              <Check size={12} /> Upload Complete
            </p>
            <p>Processed {mutation.data.total_rows} rows: {mutation.data.valid} valid, {mutation.data.invalid} invalid</p>
            {mutation.data.errors.length > 0 && (
              <div className="mt-2 space-y-0.5 text-red-400">
                {mutation.data.errors.map((e: { row: number; error: string }, i: number) => (
                  <p key={i}>Row {e.row}: {e.error}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {mutation.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded p-3 mb-4 text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={12} /> Upload failed. Check CSV format and try again.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors">
            {mutation.isSuccess ? 'Done' : 'Cancel'}
          </button>
          {!mutation.isSuccess && (
            <button
              onClick={handleUpload}
              disabled={!selectedFile || mutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded hover:bg-blue-500/20 disabled:opacity-40 transition-colors"
            >
              <Upload size={12} />
              {mutation.isPending ? 'Uploading...' : 'Upload & Process'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
