import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  Button,
  Intent,
  Slider,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { Search, ArrowRight } from 'lucide-react'
import { autocompleteEntities } from '../../api/entityIntelligence'
import {
  findPath,
  getNodeDetail,
  expandNode,
  type GraphNodeDetailResponse,
} from '../../api/unifiedGraph'
import { useInvestigationStore } from '../../stores/investigationStore'

// ============================================================================
// Types
// ============================================================================

interface PathFinderModalProps {
  isOpen: boolean
  onClose: () => void
  fromNodeId: string
  fromNodeLabel: string
}

interface AutocompleteResult {
  id: string
  name: string
  type: string
}

// ============================================================================
// Component
// ============================================================================

export function PathFinderModal({
  isOpen,
  onClose,
  fromNodeId,
  fromNodeLabel,
}: PathFinderModalProps) {
  const [toQuery, setToQuery] = useState('')
  const [toResults, setToResults] = useState<AutocompleteResult[]>([])
  const [selectedTo, setSelectedTo] = useState<AutocompleteResult | null>(null)
  const [maxDepth, setMaxDepth] = useState(5)
  const [isSearching, setIsSearching] = useState(false)
  const [isFinding, setIsFinding] = useState(false)
  const [pathResult, setPathResult] = useState<{
    found: boolean
    path: string[]
    labels: Record<string, string>
    edges: string[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { addPathNodes, setPathHighlight } = useInvestigationStore()

  // --------------------------------------------------------------------------
  // Autocomplete for "To" entity
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (toQuery.length < 2) {
      setToResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const data = await autocompleteEntities(toQuery, 8)
        setToResults(data)
      } catch {
        setToResults([])
      } finally {
        setIsSearching(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [toQuery])

  // --------------------------------------------------------------------------
  // Find path
  // --------------------------------------------------------------------------

  const handleFindPath = useCallback(async () => {
    if (!selectedTo) return
    setIsFinding(true)
    setError(null)
    setPathResult(null)

    try {
      const res = await findPath(fromNodeId, selectedTo.id, maxDepth)
      const data = res.data

      if (!data.found || data.path.length === 0) {
        setPathResult({ found: false, path: [], labels: {}, edges: [] })
        return
      }

      // Fetch labels for path nodes
      const labelPromises = data.path.map(async (nodeId) => {
        try {
          const detail = await getNodeDetail(nodeId).then((r) => r.data)
          return { id: nodeId, label: detail.title }
        } catch {
          return { id: nodeId, label: nodeId.slice(0, 8) }
        }
      })
      const labels = await Promise.all(labelPromises)
      const labelMap: Record<string, string> = {}
      for (const l of labels) labelMap[l.id] = l.label

      setPathResult({
        found: true,
        path: data.path,
        labels: labelMap,
        edges: data.edges,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Path search failed')
    } finally {
      setIsFinding(false)
    }
  }, [fromNodeId, selectedTo, maxDepth])

  // --------------------------------------------------------------------------
  // Show path in graph
  // --------------------------------------------------------------------------

  const handleShowInGraph = useCallback(async () => {
    if (!pathResult?.found) return
    setIsFinding(true)

    try {
      // For each path node, expand to get its data and edges
      const expansions = await Promise.all(
        pathResult.path.map(async (nodeId) => {
          const [detail, neighbors] = await Promise.all([
            getNodeDetail(nodeId).then((r) => r.data),
            expandNode(nodeId, { limit: 5 }).then((r) => r.data),
          ])
          return { detail, neighbors }
        }),
      )

      // Collect all unique nodes and edges along the path
      const allNodes = expansions.flatMap((exp) => [
        {
          data: {
            id: exp.detail.id,
            label: exp.detail.title,
            node_type: exp.detail.node_type,
            canonical_key: exp.detail.canonical_key ?? '',
            confidence: exp.detail.confidence,
            properties: exp.detail.properties,
            degree: exp.detail.total_outgoing + exp.detail.total_incoming,
            pagerank: 0,
            is_hub: false,
            is_bridge: false,
          },
        },
      ])

      // Only include edges that connect path nodes to each other
      const pathNodeSet = new Set(pathResult.path)
      const pathEdges = expansions.flatMap((exp) =>
        exp.neighbors.edges.filter(
          (e) => pathNodeSet.has(e.data.source) && pathNodeSet.has(e.data.target),
        ),
      )

      addPathNodes(allNodes, pathEdges, pathResult.path)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add path to graph')
    } finally {
      setIsFinding(false)
    }
  }, [pathResult, addPathNodes, onClose])

  // --------------------------------------------------------------------------
  // Reset on close
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) {
      setToQuery('')
      setToResults([])
      setSelectedTo(null)
      setPathResult(null)
      setError(null)
      setMaxDepth(5)
    }
  }, [isOpen])

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Find Shortest Path"
      className="bp5-dark"
      style={{ width: 480 }}
    >
      <DialogBody>
        <div className="space-y-4">
          {/* From node (read-only) */}
          <div>
            <label className="block text-xs text-bp-text-secondary mb-1">From</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-bp-surface border border-bp-border">
              <span className="text-xs text-bp-text font-medium">{fromNodeLabel}</span>
              <Tag minimal className="text-[9px]">
                SOURCE
              </Tag>
            </div>
          </div>

          {/* To node (autocomplete) */}
          <div>
            <label className="block text-xs text-bp-text-secondary mb-1">To</label>
            {selectedTo ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-bp-surface border border-bp-border">
                <span className="text-xs text-bp-text font-medium">{selectedTo.name}</span>
                <Tag minimal className="text-[9px] capitalize">
                  {selectedTo.type}
                </Tag>
                <div className="flex-1" />
                <Button
                  minimal
                  small
                  onClick={() => {
                    setSelectedTo(null)
                    setPathResult(null)
                  }}
                  className="text-bp-text-secondary"
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bp-text-secondary"
                />
                <input
                  type="text"
                  value={toQuery}
                  onChange={(e) => setToQuery(e.target.value)}
                  placeholder="Search for target entity..."
                  className="w-full rounded-md pl-8 pr-3 py-2 text-xs bg-bp-surface border border-bp-border text-bp-text placeholder:text-bp-text-secondary focus:outline-none focus:border-bp-primary"
                  autoFocus
                />
                {isSearching && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Spinner size={12} />
                  </div>
                )}

                {/* Autocomplete dropdown */}
                {toResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-md bg-bp-card border border-bp-border z-20 max-h-48 overflow-y-auto shadow-lg">
                    {toResults.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelectedTo(r)
                          setToQuery('')
                          setToResults([])
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-bp-hover text-xs text-bp-text flex items-center gap-2"
                      >
                        <span className="font-medium">{r.name}</span>
                        <span className="text-bp-text-secondary capitalize text-[10px]">
                          {r.type}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Max depth slider */}
          <div>
            <label className="block text-xs text-bp-text-secondary mb-2">
              Max depth: {maxDepth}
            </label>
            <Slider
              min={1}
              max={8}
              stepSize={1}
              value={maxDepth}
              onChange={(v) => setMaxDepth(v)}
              labelStepSize={1}
            />
          </div>

          {/* Path result */}
          {pathResult && (
            <div className="rounded-md bg-bp-surface border border-bp-border p-3">
              {pathResult.found ? (
                <div>
                  <div className="text-xs text-bp-text-secondary mb-2">
                    Path found ({pathResult.path.length} nodes)
                  </div>
                  <div className="flex items-center flex-wrap gap-1">
                    {pathResult.path.map((nodeId, idx) => (
                      <div key={nodeId} className="flex items-center gap-1">
                        <Tag
                          minimal
                          round
                          intent={
                            idx === 0 || idx === pathResult.path.length - 1
                              ? Intent.PRIMARY
                              : Intent.NONE
                          }
                          className="text-[10px]"
                        >
                          {pathResult.labels[nodeId] || nodeId.slice(0, 8)}
                        </Tag>
                        {idx < pathResult.path.length - 1 && (
                          <ArrowRight size={10} className="text-bp-text-secondary" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-bp-text-secondary text-center">
                  No path found within depth {maxDepth}
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <Tag intent={Intent.DANGER} minimal className="text-xs">
              {error}
            </Tag>
          )}
        </div>
      </DialogBody>

      <DialogFooter
        actions={
          <>
            <Button onClick={onClose} minimal>
              Cancel
            </Button>
            {pathResult?.found ? (
              <Button
                intent={Intent.SUCCESS}
                onClick={() => void handleShowInGraph()}
                loading={isFinding}
              >
                Show in Graph
              </Button>
            ) : (
              <Button
                intent={Intent.PRIMARY}
                onClick={() => void handleFindPath()}
                loading={isFinding}
                disabled={!selectedTo}
              >
                Find Path
              </Button>
            )}
          </>
        }
      />
    </Dialog>
  )
}
