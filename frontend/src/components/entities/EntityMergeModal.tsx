import { useState, useEffect } from 'react'
import { GitMerge, Search, AlertTriangle, Check } from 'lucide-react'
import { Modal } from '../common/Modal'
import { Badge } from '../common/Badge'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { getSimilarEntities, mergeEntities } from '../../api/entities'
import type { Entity, SimilarEntity, EntityType } from '../../types/api'

interface EntityMergeModalProps {
  entity: Entity | null
  onClose: () => void
  onMergeComplete: () => void
}

const typeBadgeVariant: Record<EntityType, 'person' | 'organization' | 'location' | 'district'> = {
  PERSON: 'person',
  ORGANIZATION: 'organization',
  LOCATION: 'location',
  DISTRICT: 'district',
}

const matchReasonLabels: Record<string, { label: string; color: string }> = {
  exact_match: { label: 'Exact', color: 'text-severity-low' },
  substring_match: { label: 'Substring', color: 'text-severity-medium' },
  shared_words: { label: 'Shared Words', color: 'text-osint-accent' },
  fuzzy_match: { label: 'Fuzzy', color: 'text-osint-muted' },
}

export function EntityMergeModal({ entity, onClose, onMergeComplete }: EntityMergeModalProps) {
  const [loading, setLoading] = useState(false)
  const [merging, setMerging] = useState(false)
  const [suggestions, setSuggestions] = useState<SimilarEntity[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [mergeDirection, setMergeDirection] = useState<'into' | 'from'>('into')
  const [threshold, setThreshold] = useState(0.5)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (entity) {
      fetchSuggestions()
    }
  }, [entity, threshold])

  const fetchSuggestions = async () => {
    if (!entity) return
    setLoading(true)
    setError(null)
    try {
      const data = await getSimilarEntities(entity.id, threshold, 20)
      setSuggestions(data.suggestions)
    } catch (err) {
      setError('Failed to load similar entities')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedIds.size === suggestions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(suggestions.map(s => s.id)))
    }
  }

  const handleMerge = async () => {
    if (!entity || selectedIds.size === 0) return

    setMerging(true)
    setError(null)
    setSuccess(null)

    try {
      const sourceIds = Array.from(selectedIds)
      const targetId = entity.id

      // If merging FROM selected into current entity
      if (mergeDirection === 'into') {
        await mergeEntities({
          source_ids: sourceIds,
          target_id: targetId,
          reason: 'Human-in-the-loop merge',
        })
        setSuccess(`Merged ${sourceIds.length} entities into "${entity.name}"`)
      } else {
        // If merging current entity INTO selected (first selected becomes target)
        const newTargetId = sourceIds[0]
        const newSourceIds = sourceIds.slice(1)
        newSourceIds.push(entity.id)

        await mergeEntities({
          source_ids: newSourceIds,
          target_id: newTargetId,
          reason: 'Human-in-the-loop merge',
        })
        const targetName = suggestions.find(s => s.id === newTargetId)?.name || 'selected entity'
        setSuccess(`Merged entities into "${targetName}"`)
      }

      setTimeout(() => {
        onMergeComplete()
        onClose()
      }, 1500)
    } catch (err) {
      setError('Failed to merge entities')
      console.error(err)
    } finally {
      setMerging(false)
    }
  }

  if (!entity) return null

  return (
    <Modal
      isOpen={!!entity}
      onClose={onClose}
      title="Merge Similar Entities"
      size="lg"
    >
      <div className="space-y-6">
        {/* Source Entity */}
        <div className="bg-osint-surface rounded-lg p-4 border border-osint-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-osint-accent/20">
              <GitMerge className="w-5 h-5 text-osint-accent" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-lg">{entity.name}</span>
                <Badge variant={typeBadgeVariant[entity.entity_type]} size="sm">
                  {entity.entity_type}
                </Badge>
              </div>
              {entity.name_ne && (
                <p className="text-osint-muted text-sm">{entity.name_ne}</p>
              )}
              <p className="text-osint-muted text-sm mt-1">
                {entity.mention_count.toLocaleString()} mentions
              </p>
            </div>
          </div>
        </div>

        {/* Merge Direction Toggle */}
        <div className="flex items-center gap-4 p-3 bg-osint-bg rounded-lg border border-osint-border">
          <span className="text-sm text-osint-muted">Merge direction:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setMergeDirection('into')}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                mergeDirection === 'into'
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
            >
              Merge INTO "{entity.name}"
            </button>
            <button
              onClick={() => setMergeDirection('from')}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                mergeDirection === 'from'
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
            >
              Merge FROM "{entity.name}"
            </button>
          </div>
        </div>

        {/* Similarity Threshold */}
        <div className="flex items-center gap-4">
          <label className="text-sm text-osint-muted">Similarity threshold:</label>
          <input
            type="range"
            min="0.3"
            max="0.9"
            step="0.1"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="flex-1 accent-osint-accent"
          />
          <span className="text-sm font-mono bg-osint-surface px-2 py-1 rounded">
            {(threshold * 100).toFixed(0)}%
          </span>
        </div>

        {/* Similar Entities List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Similar Entities ({suggestions.length})</h4>
            {suggestions.length > 0 && (
              <button
                onClick={handleSelectAll}
                className="text-sm text-osint-accent hover:text-osint-accent-hover"
              >
                {selectedIds.size === suggestions.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {loading ? (
            <LoadingSpinner message="Finding similar entities..." />
          ) : error ? (
            <div className="text-center text-severity-critical py-4">{error}</div>
          ) : suggestions.length === 0 ? (
            <div className="text-center text-osint-muted py-8">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No similar entities found above {(threshold * 100).toFixed(0)}% similarity</p>
              <p className="text-sm">Try lowering the threshold</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {suggestions.map((suggestion) => {
                const isSelected = selectedIds.has(suggestion.id)
                const matchInfo = matchReasonLabels[suggestion.match_reason]

                return (
                  <div
                    key={suggestion.id}
                    onClick={() => handleToggleSelect(suggestion.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-osint-accent/10 border-osint-accent'
                        : 'bg-osint-surface border-osint-border hover:border-osint-accent/50'
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-osint-accent border-osint-accent'
                          : 'border-osint-muted'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>

                    {/* Entity Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{suggestion.name}</span>
                        {suggestion.name_ne && (
                          <span className="text-osint-muted text-sm truncate">
                            ({suggestion.name_ne})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-osint-muted">
                          {suggestion.mention_count.toLocaleString()} mentions
                        </span>
                        <span className={matchInfo.color}>{matchInfo.label}</span>
                      </div>
                    </div>

                    {/* Similarity Score */}
                    <div className="text-right">
                      <div
                        className={`text-lg font-bold ${
                          suggestion.similarity_score >= 0.8
                            ? 'text-severity-low'
                            : suggestion.similarity_score >= 0.6
                            ? 'text-severity-medium'
                            : 'text-osint-muted'
                        }`}
                      >
                        {(suggestion.similarity_score * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-osint-muted">match</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="flex items-center gap-2 p-3 bg-severity-low/20 border border-severity-low/30 rounded-lg text-severity-low">
            <Check className="w-5 h-5" />
            <span>{success}</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center gap-2 p-3 bg-severity-critical/20 border border-severity-critical/30 rounded-lg text-severity-critical">
            <AlertTriangle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-osint-border">
          <div className="text-sm text-osint-muted">
            {selectedIds.size > 0 && (
              <span>
                {selectedIds.size} {selectedIds.size === 1 ? 'entity' : 'entities'} selected
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-osint-surface hover:bg-osint-border rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              disabled={selectedIds.size === 0 || merging}
              className="px-4 py-2 bg-osint-accent hover:bg-osint-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {merging ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <GitMerge className="w-4 h-4" />
                  Merge {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
