import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  Search,
  Newspaper,
  FileText,
  Plus,
  Loader2,
  ExternalLink,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import { getStories } from '../../api/stories'
import { useAddEvidence } from '../../api/hooks/useCollaboration'
import type { Story } from '../../types/api'
import type { EvidenceConfidence } from '../../api/collaboration'

interface AddEvidenceModalProps {
  caseId: string
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

type EvidenceMode = 'story' | 'note'

const CONFIDENCE_OPTIONS: { value: EvidenceConfidence; label: string; color: string }[] = [
  { value: 'confirmed', label: 'Confirmed', color: 'text-green-400' },
  { value: 'likely', label: 'Likely', color: 'text-blue-400' },
  { value: 'possible', label: 'Possible', color: 'text-yellow-400' },
  { value: 'doubtful', label: 'Doubtful', color: 'text-red-400' },
]

export function AddEvidenceModal({ caseId, isOpen, onClose, onSuccess }: AddEvidenceModalProps) {
  const [mode, setMode] = useState<EvidenceMode>('story')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStory, setSelectedStory] = useState<Story | null>(null)
  const [confidence, setConfidence] = useState<EvidenceConfidence>('likely')
  const [relevanceNotes, setRelevanceNotes] = useState('')
  const [isKeyEvidence, setIsKeyEvidence] = useState(false)

  // For note mode
  const [noteTitle, setNoteTitle] = useState('')
  const [noteSummary, setNoteSummary] = useState('')

  const addEvidence = useAddEvidence()

  // Fetch recent stories
  const { data: storiesData, isLoading: storiesLoading } = useQuery({
    queryKey: ['stories-for-evidence', { pageSize: 50 }],
    queryFn: () => getStories({ pageSize: 50 }),
    enabled: isOpen && mode === 'story',
    staleTime: 30 * 1000,
  })

  // Filter stories by search term (client-side)
  const filteredStories = useMemo(() => {
    if (!storiesData?.items) return []
    if (!searchTerm.trim()) return storiesData.items

    const term = searchTerm.toLowerCase()
    return storiesData.items.filter(
      (story) =>
        story.title.toLowerCase().includes(term) ||
        story.summary?.toLowerCase().includes(term)
    )
  }, [storiesData?.items, searchTerm])

  const handleAddStoryEvidence = async () => {
    if (!selectedStory) return

    try {
      await addEvidence.mutateAsync({
        caseId,
        evidence: {
          evidence_type: 'story',
          reference_id: selectedStory.id,
          reference_url: selectedStory.url,
          title: selectedStory.title,
          summary: selectedStory.summary || undefined,
          relevance_notes: relevanceNotes.trim() || undefined,
          is_key_evidence: isKeyEvidence,
          confidence,
        },
      })
      onSuccess?.()
      handleClose()
    } catch (err) {
      console.error('Failed to add evidence:', err)
    }
  }

  const handleAddNoteEvidence = async () => {
    if (!noteTitle.trim()) return

    try {
      await addEvidence.mutateAsync({
        caseId,
        evidence: {
          evidence_type: 'note',
          reference_id: undefined,
          reference_url: undefined,
          title: noteTitle.trim(),
          summary: noteSummary.trim() || undefined,
          relevance_notes: undefined,
          is_key_evidence: isKeyEvidence,
          confidence,
        },
      })
      onSuccess?.()
      handleClose()
    } catch (err) {
      console.error('Failed to add note:', err)
    }
  }

  const handleClose = () => {
    setSearchTerm('')
    setSelectedStory(null)
    setConfidence('likely')
    setRelevanceNotes('')
    setIsKeyEvidence(false)
    setNoteTitle('')
    setNoteSummary('')
    onClose()
  }

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)

    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--pro-bg-surface)] border border-[var(--pro-border-default)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--pro-border-subtle)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--pro-text-primary)]">
              Add Evidence
            </h2>
            <p className="text-[10px] text-[var(--pro-text-muted)] mt-0.5">
              Add stories or notes to support your case
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-5 py-2 border-b border-[var(--pro-border-subtle)] flex gap-2">
          <button
            onClick={() => setMode('story')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              mode === 'story'
                ? 'bg-[var(--pro-accent)] text-white'
                : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
            }`}
          >
            <Newspaper size={12} />
            Add Story
          </button>
          <button
            onClick={() => setMode('note')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              mode === 'note'
                ? 'bg-[var(--pro-accent)] text-white'
                : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
            }`}
          >
            <FileText size={12} />
            Add Note
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {mode === 'story' ? (
            <>
              {/* Search */}
              <div className="px-5 py-3 border-b border-[var(--pro-border-subtle)]">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--pro-text-muted)]"
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search stories..."
                    className="w-full bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg pl-9 pr-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)]"
                  />
                </div>
              </div>

              {/* Story list */}
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {storiesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-[var(--pro-text-muted)]" />
                  </div>
                ) : filteredStories.length === 0 ? (
                  <div className="text-center py-8">
                    <AlertCircle size={24} className="mx-auto text-[var(--pro-text-disabled)] mb-2" />
                    <p className="text-xs text-[var(--pro-text-muted)]">
                      {searchTerm ? 'No matching stories found' : 'No stories available'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredStories.map((story) => (
                      <button
                        key={story.id}
                        onClick={() => setSelectedStory(story)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedStory?.id === story.id
                            ? 'border-[var(--pro-accent)] bg-[var(--pro-accent)]/10'
                            : 'border-[var(--pro-border-subtle)] bg-[var(--pro-bg-elevated)] hover:border-[var(--pro-border-default)]'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {selectedStory?.id === story.id ? (
                            <CheckCircle size={14} className="text-[var(--pro-accent)] mt-0.5 flex-shrink-0" />
                          ) : (
                            <Newspaper size={14} className="text-[var(--pro-text-muted)] mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--pro-text-primary)] line-clamp-2">
                              {story.title}
                            </p>
                            {story.summary && (
                              <p className="text-[10px] text-[var(--pro-text-muted)] mt-1 line-clamp-1">
                                {story.summary}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 text-[9px] text-[var(--pro-text-disabled)]">
                              <span>{story.source_id}</span>
                              <span>•</span>
                              <span>{formatTimeAgo(story.published_at)}</span>
                            </div>
                          </div>
                          <a
                            href={story.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 text-[var(--pro-text-muted)] hover:text-[var(--pro-accent)] transition-colors"
                          >
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Story evidence options */}
              {selectedStory && (
                <div className="px-5 py-3 border-t border-[var(--pro-border-subtle)] space-y-3">
                  {/* Confidence */}
                  <div>
                    <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                      Confidence Level
                    </label>
                    <div className="flex gap-2 mt-1.5">
                      {CONFIDENCE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setConfidence(option.value)}
                          className={`px-2 py-1 text-[10px] rounded transition-colors ${
                            confidence === option.value
                              ? `bg-[var(--pro-accent)]/20 ${option.color}`
                              : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-muted)] hover:bg-[var(--pro-bg-hover)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Key evidence toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isKeyEvidence}
                      onChange={(e) => setIsKeyEvidence(e.target.checked)}
                      className="rounded border-[var(--pro-border-default)] bg-[var(--pro-bg-elevated)] text-[var(--pro-accent)] focus:ring-[var(--pro-accent)]"
                    />
                    <span className="text-xs text-[var(--pro-text-secondary)]">
                      Mark as key evidence
                    </span>
                  </label>

                  {/* Relevance notes */}
                  <div>
                    <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                      Relevance Notes (optional)
                    </label>
                    <input
                      type="text"
                      value={relevanceNotes}
                      onChange={(e) => setRelevanceNotes(e.target.value)}
                      placeholder="Why is this story relevant?"
                      className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)]"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Note mode */
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Note title */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Note Title *
                </label>
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Brief description of the finding..."
                  className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)]"
                />
              </div>

              {/* Note summary */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Details (optional)
                </label>
                <textarea
                  value={noteSummary}
                  onChange={(e) => setNoteSummary(e.target.value)}
                  placeholder="Detailed notes, analysis, or observations..."
                  rows={4}
                  className="w-full mt-1.5 bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--pro-text-primary)] placeholder:text-[var(--pro-text-disabled)] focus:outline-none focus:border-[var(--pro-accent)] resize-none"
                />
              </div>

              {/* Confidence */}
              <div>
                <label className="text-[10px] font-medium text-[var(--pro-text-muted)] uppercase tracking-wide">
                  Confidence Level
                </label>
                <div className="flex gap-2 mt-1.5">
                  {CONFIDENCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setConfidence(option.value)}
                      className={`px-2 py-1 text-[10px] rounded transition-colors ${
                        confidence === option.value
                          ? `bg-[var(--pro-accent)]/20 ${option.color}`
                          : 'bg-[var(--pro-bg-elevated)] text-[var(--pro-text-muted)] hover:bg-[var(--pro-bg-hover)]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Key evidence toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isKeyEvidence}
                  onChange={(e) => setIsKeyEvidence(e.target.checked)}
                  className="rounded border-[var(--pro-border-default)] bg-[var(--pro-bg-elevated)] text-[var(--pro-accent)] focus:ring-[var(--pro-accent)]"
                />
                <span className="text-xs text-[var(--pro-text-secondary)]">
                  Mark as key evidence
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--pro-border-subtle)] flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={mode === 'story' ? handleAddStoryEvidence : handleAddNoteEvidence}
            disabled={
              (mode === 'story' && !selectedStory) ||
              (mode === 'note' && !noteTitle.trim()) ||
              addEvidence.isPending
            }
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[var(--pro-accent)] text-white rounded-lg hover:bg-[var(--pro-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {addEvidence.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            Add Evidence
          </button>
        </div>
      </div>
    </div>
  )
}
