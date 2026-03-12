/**
 * PhoneClusters - Companies sharing the same phone/mobile number (hash-based).
 *
 * Includes analyst-authored cluster grouping:
 * - Build named groups of clusters
 * - Set a main cluster
 * - Add named directed/bidirectional links between clusters
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import {
  Button,
  Tag,
  Spinner,
  NonIdealState,
  Section,
  Intent,
  FormGroup,
  InputGroup,
  TextArea,
  HTMLSelect,
  Switch,
} from '@blueprintjs/core'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
} from 'lucide-react'
import {
  getPhoneClusters,
  listAnalystClusterGroups,
  createAnalystClusterGroup,
  updateAnalystClusterGroup,
  deleteAnalystClusterGroup,
  type PhoneCluster,
  type AnalystClusterNode,
  type AnalystClusterEdge,
} from '../../api/corporate'
import { InlinePagination } from './InlinePagination'

const NEW_GROUP_ID = '__new_group__'

interface PhoneClustersProps {
  onCompanyClick?: (id: string) => void
  onPANClick?: (pan: string) => void
}

function getCountIntent(count: number): Intent {
  if (count >= 10) return Intent.DANGER
  if (count >= 5) return Intent.WARNING
  return Intent.PRIMARY
}

function getIrdIntent(status: string | null | undefined): Intent {
  if (!status) return Intent.NONE
  const lower = status.toLowerCase()
  if (lower === 'a' || lower.includes('active')) return Intent.SUCCESS
  if (lower.includes('non-filer') || lower.includes('cancelled')) return Intent.DANGER
  return Intent.WARNING
}

function getHashTypeTag(hashType: string): { label: string; intent: Intent } {
  switch (hashType) {
    case 'both':
      return { label: 'Phone + Mobile', intent: Intent.DANGER }
    case 'phone':
      return { label: 'Phone', intent: Intent.PRIMARY }
    case 'mobile':
      return { label: 'Mobile', intent: Intent.SUCCESS }
    default:
      return { label: hashType, intent: Intent.NONE }
  }
}

function buildClusterFallbackId(cluster: PhoneCluster, idx: number): string {
  return `${cluster.hash_type}-${cluster.first_registered.company_id}-${cluster.company_count}-${idx}`
}

function toAnalystNode(cluster: PhoneCluster, idx: number): AnalystClusterNode {
  const clusterId = cluster.cluster_id || buildClusterFallbackId(cluster, idx)
  const baseLabel = cluster.first_registered.company_name || clusterId
  return {
    cluster_id: clusterId,
    label: `${baseLabel} (${cluster.company_count})`,
    hash_type: cluster.hash_type,
    company_count: cluster.company_count,
    first_registered_company_id: cluster.first_registered.company_id,
    first_registered_company_name: cluster.first_registered.company_name,
  }
}

function toAnalystNodeWithMain(
  cluster: PhoneCluster,
  idx: number,
  mainCompanyId?: string | null,
  mainCompanyName?: string | null,
): AnalystClusterNode {
  const node = toAnalystNode(cluster, idx)
  if (!mainCompanyId) return node

  const name = (mainCompanyName || '').trim()
  node.first_registered_company_id = mainCompanyId
  node.first_registered_company_name = name || node.first_registered_company_name
  if (name) {
    node.label = `${name} (${cluster.company_count})`
  }
  return node
}

const CYTOSCAPE_STYLE: cytoscape.StylesheetCSS[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': '9px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 5,
      color: '#ABB3BF',
      'text-max-width': '80px',
      'text-wrap': 'ellipsis',
      width: 28,
      height: 28,
      'background-color': '#5F6B7C',
      'background-opacity': 0.9,
      'border-width': 2,
      'border-color': '#404854',
    },
  },
  {
    selector: 'node[irdCategory="active"]',
    style: {
      'background-color': '#238551',
      'border-color': '#1C6E42',
    },
  },
  {
    selector: 'node[irdCategory="nonfiler"]',
    style: {
      'background-color': '#CD4246',
      'border-color': '#AC2F33',
    },
  },
  {
    selector: 'node[irdCategory="unknown"]',
    style: {
      'background-color': '#5F6B7C',
      'border-color': '#404854',
    },
  },
  {
    selector: 'edge[edgeType="phone"]',
    style: {
      'line-color': '#2D72D2',
      width: 2,
      opacity: 0.7,
      'curve-style': 'bezier',
      'target-arrow-shape': 'none',
    },
  },
  {
    selector: 'edge[edgeType="mobile"]',
    style: {
      'line-color': '#238551',
      width: 2,
      opacity: 0.7,
      'curve-style': 'bezier',
      'target-arrow-shape': 'none',
    },
  },
  {
    selector: 'edge[edgeType="both"]',
    style: {
      'line-color': '#C87619',
      width: 3,
      opacity: 0.8,
      'curve-style': 'bezier',
      'target-arrow-shape': 'none',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#2D72D2',
    },
  },
  {
    selector: 'node[mainNode = 1]',
    style: {
      shape: 'ellipse',
      width: 44,
      height: 44,
      'background-color': '#D9822B',
      'border-color': '#A66321',
      color: '#F6F7F9',
      'font-size': '10px',
      'font-weight': 700,
      'text-wrap': 'wrap',
      'text-max-width': '120px',
      'border-width': 3,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      opacity: 1,
      width: 4,
    },
  },
] as any

const ANALYST_GROUP_STYLE: cytoscape.StylesheetCSS[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': '10px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      color: '#D3DBE6',
      'text-max-width': '160px',
      'text-wrap': 'ellipsis',
      width: 38,
      height: 38,
      'background-color': '#394B59',
      'border-width': 2,
      'border-color': '#5C7080',
    },
  },
  {
    selector: 'node[mainNode = 1]',
    style: {
      width: 52,
      height: 52,
      'background-color': '#D9822B',
      'border-color': '#A66321',
      'border-width': 3,
      'font-weight': 700,
      color: '#F6F7F9',
    },
  },
  {
    selector: 'edge',
    style: {
      label: 'data(label)',
      'font-size': '9px',
      color: '#CED9E0',
      'text-background-color': '#182026',
      'text-background-opacity': 0.9,
      'text-background-padding': 2,
      width: 2,
      'line-color': '#738694',
      'target-arrow-color': '#738694',
      'source-arrow-color': '#738694',
      'target-arrow-shape': 'data(targetArrow)',
      'source-arrow-shape': 'data(sourceArrow)',
      'curve-style': 'bezier',
      'arrow-scale': 0.9,
    },
  },
] as any

export function PhoneClusters({ onCompanyClick, onPANClick }: PhoneClustersProps) {
  const queryClient = useQueryClient()

  const [clusterPage, setClusterPage] = useState(1)
  const [clusterPageSize, setClusterPageSize] = useState(20)
  const [activeGraphClusterId, setActiveGraphClusterId] = useState<string | null>(null)

  const [selectedGroupId, setSelectedGroupId] = useState<string>(NEW_GROUP_ID)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [draftNodes, setDraftNodes] = useState<AnalystClusterNode[]>([])
  const [draftEdges, setDraftEdges] = useState<AnalystClusterEdge[]>([])
  const [draftMainClusterId, setDraftMainClusterId] = useState<string | null>(null)
  const [clusterMainCompanyOverrides, setClusterMainCompanyOverrides] = useState<Record<string, {
    companyId: string
    companyName: string
  }>>({})

  const [edgeSource, setEdgeSource] = useState('')
  const [edgeTarget, setEdgeTarget] = useState('')
  const [edgeLabel, setEdgeLabel] = useState('')
  const [edgeBidirectional, setEdgeBidirectional] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['phone-clusters'],
    queryFn: () =>
      getPhoneClusters({
        limit: 60,
        min_companies: 2,
        max_members_per_cluster: 200,
      }),
    staleTime: 120_000,
    retry: 1,
  })

  const {
    data: groupsData,
    isLoading: groupsLoading,
    isError: groupsError,
  } = useQuery({
    queryKey: ['analyst-cluster-groups'],
    queryFn: () => listAnalystClusterGroups({ limit: 200 }),
    staleTime: 30_000,
  })

  const createGroupMutation = useMutation({
    mutationFn: createAnalystClusterGroup,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['analyst-cluster-groups'] })
      setSelectedGroupId(created.id)
    },
  })

  const updateGroupMutation = useMutation({
    mutationFn: (payload: { groupId: string; body: Parameters<typeof updateAnalystClusterGroup>[1] }) =>
      updateAnalystClusterGroup(payload.groupId, payload.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-cluster-groups'] })
    },
  })

  const deleteGroupMutation = useMutation({
    mutationFn: deleteAnalystClusterGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-cluster-groups'] })
      setSelectedGroupId(NEW_GROUP_ID)
      setGroupName('')
      setGroupDescription('')
      setDraftNodes([])
      setDraftEdges([])
      setDraftMainClusterId(null)
    },
  })

  const clusters = data?.clusters ?? []
  const totalClusters = data?.total_clusters ?? 0
  const totalLinked = data?.total_linked_companies ?? 0
  const totalPages = Math.max(1, Math.ceil(clusters.length / clusterPageSize))
  const currentPage = Math.min(clusterPage, totalPages)
  const pagedClusters = clusters.slice(
    (currentPage - 1) * clusterPageSize,
    currentPage * clusterPageSize
  )

  const savedGroups = groupsData?.items ?? []
  const selectedGroup = savedGroups.find((group) => group.id === selectedGroupId) ?? null
  const isNewGroupDraft = selectedGroupId === NEW_GROUP_ID
  const groupIsBusy = createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending

  useEffect(() => {
    setClusterPage(1)
  }, [clusterPageSize])

  useEffect(() => {
    if (clusterPage > totalPages) {
      setClusterPage(totalPages)
    }
  }, [clusterPage, totalPages])

  useEffect(() => {
    if (!selectedGroupId || selectedGroupId === NEW_GROUP_ID) return
    if (savedGroups.some((group) => group.id === selectedGroupId)) return
    setSelectedGroupId(savedGroups.length > 0 ? savedGroups[0].id : NEW_GROUP_ID)
  }, [savedGroups, selectedGroupId])

  useEffect(() => {
    if (!selectedGroup) return
    setGroupName(selectedGroup.name)
    setGroupDescription(selectedGroup.description || '')
    setDraftNodes(selectedGroup.clusters || [])
    setDraftEdges(selectedGroup.edges || [])
    setDraftMainClusterId(selectedGroup.main_cluster_id || null)
    const overrides: Record<string, { companyId: string; companyName: string }> = {}
    for (const node of selectedGroup.clusters || []) {
      if (node.first_registered_company_id) {
        overrides[node.cluster_id] = {
          companyId: node.first_registered_company_id,
          companyName: node.first_registered_company_name || '',
        }
      }
    }
    setClusterMainCompanyOverrides(overrides)
  }, [selectedGroup])

  const createEmptyGroupDraft = useCallback(() => {
    setSelectedGroupId(NEW_GROUP_ID)
    setGroupName('')
    setGroupDescription('')
    setDraftNodes([])
    setDraftEdges([])
    setDraftMainClusterId(null)
    setClusterMainCompanyOverrides({})
  }, [])

  const saveCurrentGroup = async () => {
    const name = groupName.trim()
    if (!name) return

    const payload = {
      name,
      description: groupDescription.trim() || null,
      main_cluster_id: draftMainClusterId,
      clusters: draftNodes,
      edges: draftEdges,
    }

    if (isNewGroupDraft) {
      await createGroupMutation.mutateAsync(payload)
      return
    }

    if (!selectedGroupId) return
    await updateGroupMutation.mutateAsync({ groupId: selectedGroupId, body: payload })
  }

  const deleteCurrentGroup = async () => {
    if (!selectedGroupId || isNewGroupDraft) return
    await deleteGroupMutation.mutateAsync(selectedGroupId)
  }

  const addClusterToDraft = useCallback((cluster: PhoneCluster, idx: number) => {
    const clusterId = cluster.cluster_id || buildClusterFallbackId(cluster, idx)
    const override = clusterMainCompanyOverrides[clusterId]
    const node = toAnalystNodeWithMain(
      cluster,
      idx,
      override?.companyId,
      override?.companyName,
    )
    setDraftNodes((prev) => {
      if (prev.some((existing) => existing.cluster_id === node.cluster_id)) return prev
      return [...prev, node]
    })
    setDraftMainClusterId((prev) => prev || node.cluster_id)
  }, [clusterMainCompanyOverrides])

  const removeClusterFromDraft = useCallback((clusterId: string) => {
    setDraftNodes((prev) => {
      const next = prev.filter((node) => node.cluster_id !== clusterId)
      setDraftMainClusterId((currentMain) => {
        if (currentMain !== clusterId) return currentMain
        return next[0]?.cluster_id || null
      })
      return next
    })
    setDraftEdges((prev) => prev.filter((edge) => edge.source_cluster_id !== clusterId && edge.target_cluster_id !== clusterId))
    setClusterMainCompanyOverrides((prev) => {
      if (!prev[clusterId]) return prev
      const next = { ...prev }
      delete next[clusterId]
      return next
    })
  }, [])

  const setMainCluster = useCallback((clusterId: string) => {
    setDraftMainClusterId(clusterId)
  }, [])

  const setClusterMainCompany = useCallback((
    cluster: PhoneCluster,
    clusterIndex: number,
    companyId: string,
    companyName: string,
  ) => {
    const clusterId = cluster.cluster_id || buildClusterFallbackId(cluster, clusterIndex)
    setClusterMainCompanyOverrides((prev) => ({
      ...prev,
      [clusterId]: { companyId, companyName },
    }))
    setDraftNodes((prev) => prev.map((node) => {
      if (node.cluster_id !== clusterId) return node
      return {
        ...node,
        first_registered_company_id: companyId,
        first_registered_company_name: companyName,
        label: `${companyName || node.label} (${cluster.company_count})`,
      }
    }))
  }, [])

  const addEdgeToDraft = () => {
    const label = edgeLabel.trim()
    if (!edgeSource || !edgeTarget || !label) return
    if (edgeSource === edgeTarget) return

    const hasSource = draftNodes.some((node) => node.cluster_id === edgeSource)
    const hasTarget = draftNodes.some((node) => node.cluster_id === edgeTarget)
    if (!hasSource || !hasTarget) return

    const edgeId = `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setDraftEdges((prev) => [
      ...prev,
      {
        id: edgeId,
        source_cluster_id: edgeSource,
        target_cluster_id: edgeTarget,
        label,
        bidirectional: edgeBidirectional,
      },
    ])
    setEdgeLabel('')
  }

  const removeEdgeFromDraft = (edgeId: string | null | undefined) => {
    if (!edgeId) return
    setDraftEdges((prev) => prev.filter((edge) => edge.id !== edgeId))
  }

  const nodeOptions = draftNodes.map((node) => ({
    id: node.cluster_id,
    label: node.label,
  }))

  return (
    <div className="bp6-dark flex flex-col gap-4 p-4 bg-bp-bg min-h-full">
      <div className="flex items-center justify-between rounded-lg px-5 py-4 bg-bp-card border border-bp-border">
        <div className="flex items-center gap-4">
          <h2 className="m-0 text-lg font-semibold text-bp-text">
            Phone / Mobile Clusters
          </h2>
          {totalClusters > 0 && (
            <>
              <Tag minimal intent={Intent.PRIMARY} large>
                {totalClusters} cluster{totalClusters !== 1 ? 's' : ''}
              </Tag>
              <Tag minimal intent={Intent.WARNING} large>
                {totalLinked} linked companies
              </Tag>
            </>
          )}
        </div>
      </div>

      <AnalystGroupBuilder
        isLoading={groupsLoading}
        isError={groupsError}
        savedGroups={savedGroups}
        selectedGroupId={selectedGroupId}
        onSelectGroup={setSelectedGroupId}
        onCreateNew={createEmptyGroupDraft}
        groupName={groupName}
        setGroupName={setGroupName}
        groupDescription={groupDescription}
        setGroupDescription={setGroupDescription}
        draftNodes={draftNodes}
        draftEdges={draftEdges}
        draftMainClusterId={draftMainClusterId}
        setMainCluster={setMainCluster}
        removeClusterFromDraft={removeClusterFromDraft}
        edgeSource={edgeSource}
        setEdgeSource={setEdgeSource}
        edgeTarget={edgeTarget}
        setEdgeTarget={setEdgeTarget}
        edgeLabel={edgeLabel}
        setEdgeLabel={setEdgeLabel}
        edgeBidirectional={edgeBidirectional}
        setEdgeBidirectional={setEdgeBidirectional}
        addEdgeToDraft={addEdgeToDraft}
        removeEdgeFromDraft={removeEdgeFromDraft}
        nodeOptions={nodeOptions}
        onSave={saveCurrentGroup}
        onDelete={deleteCurrentGroup}
        isNewGroupDraft={isNewGroupDraft}
        isBusy={groupIsBusy}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Spinner intent={Intent.PRIMARY} size={48} />
        </div>
      )}

      {isError && (
        <NonIdealState
          icon="error"
          title="Failed to load phone clusters"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
        />
      )}

      {!isLoading && !isError && clusters.length === 0 && (
        <NonIdealState
          icon="search"
          title="No phone clusters found"
          description="No companies sharing the same phone or mobile number were found in the dataset."
        />
      )}

      {!isLoading && !isError && clusters.length > 0 && (
        <div className="flex flex-col gap-2">
          {pagedClusters.map((cluster, idx) => {
            const globalIndex = (currentPage - 1) * clusterPageSize + idx
            const stableClusterId = cluster.cluster_id || buildClusterFallbackId(cluster, globalIndex)
            const isInGroup = draftNodes.some((node) => node.cluster_id === stableClusterId)
            const isMain = draftMainClusterId === stableClusterId
            const preferredMainCompanyId = clusterMainCompanyOverrides[stableClusterId]?.companyId || null

            return (
              <ClusterSection
                key={stableClusterId}
                cluster={cluster}
                index={globalIndex}
                clusterId={stableClusterId}
                graphOpen={activeGraphClusterId === stableClusterId}
                onToggleGraph={(clusterId) => {
                  setActiveGraphClusterId((prev) => (prev === clusterId ? null : clusterId))
                }}
                onCompanyClick={onCompanyClick}
                onPANClick={onPANClick}
                canAddToGroup={!!groupName.trim() || isInGroup || isNewGroupDraft}
                isInGroup={isInGroup}
                isMainInGroup={isMain}
                onAddToGroup={() => addClusterToDraft(cluster, globalIndex)}
                onRemoveFromGroup={() => removeClusterFromDraft(stableClusterId)}
                onSetMain={() => setMainCluster(stableClusterId)}
                mainCompanyId={preferredMainCompanyId}
                onSetMainCompany={(companyId, companyName) =>
                  setClusterMainCompany(cluster, globalIndex, companyId, companyName)
                }
              />
            )
          })}

          <InlinePagination
            page={currentPage}
            pageSize={clusterPageSize}
            total={clusters.length}
            onPageChange={setClusterPage}
            onPageSizeChange={setClusterPageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      )}
    </div>
  )
}

interface AnalystGroupBuilderProps {
  isLoading: boolean
  isError: boolean
  savedGroups: Array<{
    id: string
    name: string
  }>
  selectedGroupId: string
  onSelectGroup: (groupId: string) => void
  onCreateNew: () => void
  groupName: string
  setGroupName: (value: string) => void
  groupDescription: string
  setGroupDescription: (value: string) => void
  draftNodes: AnalystClusterNode[]
  draftEdges: AnalystClusterEdge[]
  draftMainClusterId: string | null
  setMainCluster: (clusterId: string) => void
  removeClusterFromDraft: (clusterId: string) => void
  edgeSource: string
  setEdgeSource: (value: string) => void
  edgeTarget: string
  setEdgeTarget: (value: string) => void
  edgeLabel: string
  setEdgeLabel: (value: string) => void
  edgeBidirectional: boolean
  setEdgeBidirectional: (value: boolean) => void
  addEdgeToDraft: () => void
  removeEdgeFromDraft: (edgeId: string | null | undefined) => void
  nodeOptions: Array<{ id: string; label: string }>
  onSave: () => void
  onDelete: () => void
  isNewGroupDraft: boolean
  isBusy: boolean
}

function AnalystGroupBuilder({
  isLoading,
  isError,
  savedGroups,
  selectedGroupId,
  onSelectGroup,
  onCreateNew,
  groupName,
  setGroupName,
  groupDescription,
  setGroupDescription,
  draftNodes,
  draftEdges,
  draftMainClusterId,
  setMainCluster,
  removeClusterFromDraft,
  edgeSource,
  setEdgeSource,
  edgeTarget,
  setEdgeTarget,
  edgeLabel,
  setEdgeLabel,
  edgeBidirectional,
  setEdgeBidirectional,
  addEdgeToDraft,
  removeEdgeFromDraft,
  nodeOptions,
  onSave,
  onDelete,
  isNewGroupDraft,
  isBusy,
}: AnalystGroupBuilderProps) {
  const saveDisabled = isBusy || !groupName.trim()
  const addEdgeDisabled = !edgeSource || !edgeTarget || !edgeLabel.trim() || edgeSource === edgeTarget

  return (
    <div className="rounded-lg border border-bp-border bg-bp-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-sm font-semibold text-bp-text">Analyst Cluster Group Graph</h3>
          {draftNodes.length > 0 && (
            <Tag minimal intent={Intent.PRIMARY}>{draftNodes.length} clusters</Tag>
          )}
          {draftEdges.length > 0 && (
            <Tag minimal intent={Intent.WARNING}>{draftEdges.length} links</Tag>
          )}
        </div>
        <div className="flex items-center gap-2">
          <HTMLSelect
            value={selectedGroupId}
            onChange={(event) => {
              const nextId = event.target.value
              if (nextId === NEW_GROUP_ID) {
                onCreateNew()
                return
              }
              onSelectGroup(nextId)
            }}
            disabled={isLoading || isBusy}
          >
            <option value={NEW_GROUP_ID}>New unsaved group</option>
            {savedGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </HTMLSelect>
          <Button small text="New" icon="add" onClick={onCreateNew} disabled={isBusy} />
          <Button small text="Save" icon="floppy-disk" intent={Intent.PRIMARY} onClick={onSave} disabled={saveDisabled} loading={isBusy} />
          <Button small text="Delete" icon="trash" intent={Intent.DANGER} onClick={onDelete} disabled={isBusy || isNewGroupDraft} />
        </div>
      </div>

      {isError && (
        <div className="mt-2 text-xs text-bp-danger">Failed to load saved analyst groups.</div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <FormGroup label="Group name" className="m-0">
          <InputGroup
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Example: Construction shell ring"
            disabled={isBusy}
          />
        </FormGroup>

        <FormGroup label="Description" className="m-0">
          <TextArea
            value={groupDescription}
            onChange={(event) => setGroupDescription(event.target.value)}
            placeholder="Analyst notes for why these clusters are linked"
            fill
            rows={2}
            disabled={isBusy}
          />
        </FormGroup>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded border border-bp-border bg-bp-bg p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bp-text-secondary">Clusters in group</div>
          {draftNodes.length === 0 ? (
            <div className="text-xs text-bp-text-secondary">Add clusters from the list below.</div>
          ) : (
            <div className="space-y-1.5">
              {draftNodes.map((node) => {
                const isMain = draftMainClusterId === node.cluster_id
                return (
                  <div key={node.cluster_id} className="rounded border border-bp-border bg-bp-card px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs text-bp-text">{node.label}</div>
                        <div className="mt-0.5 flex items-center gap-1">
                          {node.hash_type && <Tag minimal>{node.hash_type}</Tag>}
                          {node.company_count != null && <Tag minimal>{node.company_count}</Tag>}
                          {isMain && <Tag minimal intent={Intent.WARNING}>Main</Tag>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          small
                          minimal
                          icon="star"
                          title="Set as main"
                          intent={isMain ? Intent.WARNING : Intent.NONE}
                          disabled={isMain}
                          onClick={() => setMainCluster(node.cluster_id)}
                        />
                        <Button
                          small
                          minimal
                          icon="cross"
                          title="Remove cluster"
                          onClick={() => removeClusterFromDraft(node.cluster_id)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded border border-bp-border bg-bp-bg p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bp-text-secondary">Add named link</div>
          <div className="space-y-2">
            <FormGroup label="Source" className="m-0">
              <HTMLSelect value={edgeSource} onChange={(event) => setEdgeSource(event.target.value)} fill disabled={isBusy}>
                <option value="">Select source cluster</option>
                {nodeOptions.map((node) => (
                  <option key={node.id} value={node.id}>{node.label}</option>
                ))}
              </HTMLSelect>
            </FormGroup>
            <FormGroup label="Target" className="m-0">
              <HTMLSelect value={edgeTarget} onChange={(event) => setEdgeTarget(event.target.value)} fill disabled={isBusy}>
                <option value="">Select target cluster</option>
                {nodeOptions.map((node) => (
                  <option key={node.id} value={node.id}>{node.label}</option>
                ))}
              </HTMLSelect>
            </FormGroup>
            <FormGroup label="Link label" className="m-0">
              <InputGroup
                value={edgeLabel}
                onChange={(event) => setEdgeLabel(event.target.value)}
                placeholder="e.g. common director, fund flow, front company"
                disabled={isBusy}
              />
            </FormGroup>
            <Switch
              checked={edgeBidirectional}
              label="Bidirectional"
              onChange={(event) => setEdgeBidirectional((event.target as HTMLInputElement).checked)}
              disabled={isBusy}
            />
            <Button
              small
              text="Add Link"
              icon="link"
              intent={Intent.PRIMARY}
              onClick={addEdgeToDraft}
              disabled={addEdgeDisabled || isBusy}
            />
          </div>
        </div>

        <div className="rounded border border-bp-border bg-bp-bg p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bp-text-secondary">Saved links</div>
          {draftEdges.length === 0 ? (
            <div className="text-xs text-bp-text-secondary">No links defined yet.</div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-auto pr-1">
              {draftEdges.map((edge) => (
                <div key={edge.id || `${edge.source_cluster_id}-${edge.target_cluster_id}-${edge.label}`} className="rounded border border-bp-border bg-bp-card px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 text-bp-text">
                      <span className="truncate">{edge.source_cluster_id}</span>
                      <span className="mx-1 text-bp-text-secondary">{edge.bidirectional ? '<->' : '->'}</span>
                      <span className="truncate">{edge.target_cluster_id}</span>
                      <span className="mx-1 text-bp-text-secondary">|</span>
                      <span className="truncate text-bp-text-secondary">{edge.label}</span>
                    </div>
                    <Button
                      small
                      minimal
                      icon="trash"
                      title="Remove link"
                      onClick={() => removeEdgeFromDraft(edge.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <AnalystClusterGroupGraph
          nodes={draftNodes}
          edges={draftEdges}
          mainClusterId={draftMainClusterId}
        />
      </div>
    </div>
  )
}

interface ClusterSectionProps {
  cluster: PhoneCluster
  index: number
  clusterId: string
  graphOpen: boolean
  onToggleGraph: (clusterId: string) => void
  onCompanyClick?: (id: string) => void
  onPANClick?: (pan: string) => void
  canAddToGroup: boolean
  isInGroup: boolean
  isMainInGroup: boolean
  onAddToGroup: () => void
  onRemoveFromGroup: () => void
  onSetMain: () => void
  mainCompanyId: string | null
  onSetMainCompany: (companyId: string, companyName: string) => void
}

function ClusterSection({
  cluster,
  index,
  clusterId,
  graphOpen,
  onToggleGraph,
  onCompanyClick,
  onPANClick,
  canAddToGroup,
  isInGroup,
  isMainInGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onSetMain,
  mainCompanyId,
  onSetMainCompany,
}: ClusterSectionProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [companyPage, setCompanyPage] = useState(1)
  const [companyPageSize, setCompanyPageSize] = useState(25)
  const intent = getCountIntent(cluster.company_count)
  const hashTag = getHashTypeTag(cluster.hash_type)
  const members = (cluster.companies && cluster.companies.length > 0)
    ? cluster.companies
    : [cluster.first_registered]
  const activeMainCompanyId = mainCompanyId || cluster.first_registered.company_id
  const totalCompanyPages = Math.max(1, Math.ceil(members.length / companyPageSize))
  const currentCompanyPage = Math.min(companyPage, totalCompanyPages)
  const pagedMembers = members.slice(
    (currentCompanyPage - 1) * companyPageSize,
    currentCompanyPage * companyPageSize,
  )

  useEffect(() => {
    setCompanyPage(1)
  }, [companyPageSize, isOpen, clusterId])

  useEffect(() => {
    if (companyPage > totalCompanyPages) {
      setCompanyPage(totalCompanyPages)
    }
  }, [companyPage, totalCompanyPages])

  return (
    <div className="rounded-lg overflow-hidden bg-bp-card border border-bp-border">
      <Section
        title={
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-bp-text-secondary">
              #{index + 1}
            </span>
            <Tag intent={hashTag.intent} minimal>
              {hashTag.label}
            </Tag>
            <Tag intent={intent} round minimal>
              {cluster.company_count} {cluster.company_count === 1 ? 'company' : 'companies'}
            </Tag>
            <span className="text-xs text-bp-text-secondary">
              sharing same {cluster.hash_type === 'both' ? 'phone & mobile' : cluster.hash_type} number
            </span>
          </div>
        }
        collapsible
        collapseProps={{
          isOpen,
          onToggle: () => setIsOpen((prev) => !prev),
        }}
        compact
        className="cluster-section"
      >
        <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2 bg-bp-card border-b border-bp-border">
          {isInGroup ? (
            <>
              <Button
                small
                icon="cross"
                text="Remove"
                onClick={onRemoveFromGroup}
              />
              <Button
                small
                icon="star"
                text={isMainInGroup ? 'Main' : 'Set Main'}
                intent={isMainInGroup ? Intent.WARNING : Intent.NONE}
                disabled={isMainInGroup}
                onClick={onSetMain}
              />
            </>
          ) : (
            <Button
              small
              icon="add"
              text="Add to Group"
              disabled={!canAddToGroup}
              onClick={onAddToGroup}
            />
          )}

          <Button
            small
            icon="graph"
            text={graphOpen ? 'Hide Graph' : 'Show Graph'}
            intent={graphOpen ? Intent.PRIMARY : Intent.NONE}
            onClick={() => {
              if (!isOpen) setIsOpen(true)
              onToggleGraph(clusterId)
            }}
          />
        </div>

        {graphOpen && (
          <div className="p-2 bg-bp-bg border-b border-bp-border">
            <PhoneGraph
              clusters={[cluster]}
              onCompanyClick={onCompanyClick}
              compact
              mainCompanyIdOverride={activeMainCompanyId}
            />
          </div>
        )}

        <div className="flex flex-col bg-bp-surface">
          <div
            className="grid px-4 py-2 text-xs font-medium uppercase tracking-wider text-bp-text-secondary border-b border-bp-border"
            style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}
          >
            <span>Company Name (First Registered)</span>
            <span>Registration #</span>
            <span>PAN</span>
            <span>District</span>
            <span>IRD Status</span>
          </div>

          {isOpen && (
            <>
              {pagedMembers.map((member) => (
                <div
                  key={member.company_id}
                  className="grid px-4 py-3 text-sm border-b border-bp-border hover:bg-bp-surface-hover cursor-pointer"
                  style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}
                  onClick={() => onCompanyClick?.(member.company_id)}
                >
                  <div className="flex flex-col gap-1">
                    <span
                      className={`font-medium ${member.company_id === activeMainCompanyId ? 'text-[#D9822B]' : 'text-bp-text'}`}
                    >
                      {member.company_name}
                      {member.company_id === activeMainCompanyId && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-[#D9822B]">
                          Main
                        </span>
                      )}
                    </span>
                    {member.company_id !== activeMainCompanyId && (
                      <button
                        type="button"
                        className="w-fit text-[10px] uppercase tracking-wide text-bp-link hover:underline"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSetMainCompany(member.company_id, member.company_name)
                        }}
                      >
                        Set Main
                      </button>
                    )}
                    {member.company_address && (
                      <span className="text-xs text-bp-text-secondary truncate">{member.company_address}</span>
                    )}
                  </div>
                  <span className="text-bp-text-secondary">
                    {member.registration_number ? `#${member.registration_number}` : '—'}
                  </span>
                  <button
                    className="text-left text-bp-link hover:underline"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (member.pan) onPANClick?.(member.pan)
                    }}
                  >
                    {member.pan || '—'}
                  </button>
                  <span className="text-bp-text-secondary">{member.district || '—'}</span>
                  <Tag
                    minimal
                    intent={getIrdIntent(member.ird_status)}
                    className="self-start"
                  >
                    {member.ird_status || 'Unknown'}
                  </Tag>
                </div>
              ))}
              <div className="px-3 py-2 bg-bp-bg">
                <InlinePagination
                  page={currentCompanyPage}
                  pageSize={companyPageSize}
                  total={members.length}
                  onPageChange={setCompanyPage}
                  onPageSizeChange={setCompanyPageSize}
                  pageSizeOptions={[10, 25, 50, 100]}
                />
              </div>
            </>
          )}
          {isOpen && cluster.company_count > members.length && (
            <div className="px-4 py-2 text-xs text-bp-text-secondary bg-bp-bg">
              Showing {members.length} of {cluster.company_count} companies for performance. Open a company to explore full linked details.
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

interface PhoneGraphProps {
  clusters: PhoneCluster[]
  onCompanyClick?: (id: string) => void
  compact?: boolean
  mainCompanyIdOverride?: string | null
}

function PhoneGraph({ clusters, onCompanyClick, compact = false, mainCompanyIdOverride = null }: PhoneGraphProps) {
  const cyRef = useRef<cytoscape.Core | null>(null)

  const elements = useMemo(() => {
    const nodes: cytoscape.ElementDefinition[] = []
    const edges: cytoscape.ElementDefinition[] = []
    const clusterGap = compact ? 420 : 560

    const classifyIrd = (status: string | null | undefined): 'active' | 'nonfiler' | 'unknown' => {
      if (!status) return 'unknown'
      const lower = status.toLowerCase()
      if (lower === 'a' || lower.includes('active')) return 'active'
      if (lower.includes('non-filer') || lower.includes('cancelled')) return 'nonfiler'
      return 'unknown'
    }

    clusters.forEach((cluster, clusterIndex) => {
      const members = (cluster.companies && cluster.companies.length > 0)
        ? cluster.companies
        : [cluster.first_registered]

      const byCompanyId = new Map<string, typeof members[number]>()
      members.forEach((member) => {
        if (!byCompanyId.has(member.company_id)) byCompanyId.set(member.company_id, member)
      })

      const mainCompany = (mainCompanyIdOverride && byCompanyId.get(mainCompanyIdOverride))
        || byCompanyId.get(cluster.first_registered.company_id)
        || cluster.first_registered
      byCompanyId.set(mainCompany.company_id, mainCompany)
      const others = Array.from(byCompanyId.values()).filter((member) => member.company_id !== mainCompany.company_id)

      const centerX = (clusterIndex % 2) * clusterGap
      const centerY = Math.floor(clusterIndex / 2) * clusterGap
      const mainNodeId = `cluster-${clusterIndex}-company-${mainCompany.company_id}`

      nodes.push({
        data: {
          id: mainNodeId,
          companyId: mainCompany.company_id,
          label: mainCompany.company_name || '(unnamed)',
          pan: mainCompany.pan,
          district: mainCompany.district,
          irdStatus: mainCompany.ird_status,
          irdCategory: classifyIrd(mainCompany.ird_status),
          clusterSize: cluster.company_count,
          nodeType: 'company',
          mainNode: 1,
        },
        position: { x: centerX, y: centerY },
      })

      const radius = Math.max(130, Math.min(240, 90 + others.length * 12))
      const divisor = Math.max(others.length, 1)

      others.forEach((company, idx) => {
        const theta = (2 * Math.PI * idx) / divisor
        const nodeX = centerX + radius * Math.cos(theta)
        const nodeY = centerY + radius * Math.sin(theta)
        const nodeId = `cluster-${clusterIndex}-company-${company.company_id}`

        nodes.push({
          data: {
            id: nodeId,
            companyId: company.company_id,
            label: company.company_name || '(unnamed)',
            pan: company.pan,
            district: company.district,
            irdStatus: company.ird_status,
            irdCategory: classifyIrd(company.ird_status),
            clusterSize: cluster.company_count,
            nodeType: 'company',
            mainNode: 0,
          },
          position: { x: nodeX, y: nodeY },
        })

        edges.push({
          data: {
            id: `edge-${clusterIndex}-${mainCompany.company_id}-${company.company_id}`,
            source: mainNodeId,
            target: nodeId,
            edgeType: cluster.hash_type,
          },
        })
      })
    })

    return [...nodes, ...edges]
  }, [clusters, compact])

  const handleCyInit = useCallback(
    (cy: cytoscape.Core) => {
      cyRef.current = cy

      cy.layout({
        name: 'preset',
        fit: true,
        padding: compact ? 30 : 60,
        animate: false,
      }).run()

      cy.on('tap', 'node', (event) => {
        const nodeType = event.target.data('nodeType')
        const companyId = event.target.data('companyId')
        if (nodeType === 'company' && companyId && onCompanyClick) {
          onCompanyClick(companyId)
        }
      })

      cy.on('tap', (event) => {
        if (event.target === cy) {
          cy.elements().style({ opacity: 1 })
        }
      })
    },
    [compact, onCompanyClick]
  )

  const handleZoomIn = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * 1.2)
  }
  const handleZoomOut = () => {
    cyRef.current?.zoom(cyRef.current.zoom() / 1.2)
  }
  const handleFit = () => {
    cyRef.current?.fit(undefined, 50)
  }
  const handleExport = () => {
    if (!cyRef.current) return
    const png = cyRef.current.png({ full: true, scale: 2, bg: '#111418' })
    const link = document.createElement('a')
    link.href = png
    link.download = 'phone-clusters-graph.png'
    link.click()
  }

  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden bg-bp-card border border-bp-border"
      style={{ height: compact ? 360 : 'calc(100vh - 280px)', minHeight: compact ? 300 : 500 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-bp-border">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-bp-text">
            Phone Cluster Network
          </h3>
          <span className="text-[10px] text-bp-text-secondary">
            {elements.length} elements
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button minimal small icon={<ZoomIn size={12} />} onClick={handleZoomIn} title="Zoom in" className="text-bp-text-secondary" />
          <Button minimal small icon={<ZoomOut size={12} />} onClick={handleZoomOut} title="Zoom out" className="text-bp-text-secondary" />
          <Button minimal small icon={<Maximize2 size={12} />} onClick={handleFit} title="Fit to view" className="text-bp-text-secondary" />
          <Button minimal small icon={<Download size={12} />} onClick={handleExport} title="Export PNG" className="text-bp-text-secondary" />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {elements.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-bp-text-secondary">No graph data available</p>
          </div>
        ) : (
          <CytoscapeComponent
            elements={elements}
            stylesheet={CYTOSCAPE_STYLE}
            style={{ width: '100%', height: '100%' }}
            cy={handleCyInit}
            wheelSensitivity={0.2}
          />
        )}
      </div>

      <div className="flex items-center gap-4 px-3 py-1.5 text-[10px] border-t border-bp-border">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#D9822B]" />
          <span className="text-bp-text-secondary">First registered (main)</span>
        </div>
        <div className="w-px h-3 mx-1 bg-bp-border" />
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-bp-success" />
          <span className="text-bp-text-secondary">Active filer</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-bp-danger" />
          <span className="text-bp-text-secondary">Non-filer</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-bp-text-disabled" />
          <span className="text-bp-text-secondary">Unknown</span>
        </div>
        <div className="w-px h-3 mx-1 bg-bp-border" />
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded bg-bp-primary" />
          <span className="text-bp-text-secondary">Phone link</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded bg-bp-success" />
          <span className="text-bp-text-secondary">Mobile link</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded bg-bp-warning" />
          <span className="text-bp-text-secondary">Both</span>
        </div>
      </div>
    </div>
  )
}

function AnalystClusterGroupGraph({
  nodes,
  edges,
  mainClusterId,
}: {
  nodes: AnalystClusterNode[]
  edges: AnalystClusterEdge[]
  mainClusterId: string | null
}) {
  const cyRef = useRef<cytoscape.Core | null>(null)

  const elements = useMemo(() => {
    const cyNodes: cytoscape.ElementDefinition[] = []
    const cyEdges: cytoscape.ElementDefinition[] = []

    if (nodes.length === 0) {
      return []
    }

    const orderedNodes = [...nodes]
    orderedNodes.sort((a, b) => {
      if (a.cluster_id === mainClusterId) return -1
      if (b.cluster_id === mainClusterId) return 1
      return a.label.localeCompare(b.label)
    })

    const centerX = 0
    const centerY = 0
    const ringNodes = orderedNodes.filter((node) => node.cluster_id !== mainClusterId)

    orderedNodes.forEach((node, index) => {
      const nodeId = `group-node-${node.cluster_id}`
      if (node.cluster_id === mainClusterId) {
        cyNodes.push({
          data: {
            id: nodeId,
            clusterId: node.cluster_id,
            label: node.label,
            mainNode: 1,
          },
          position: { x: centerX, y: centerY },
        })
        return
      }

      const orbitIndex = ringNodes.findIndex((item) => item.cluster_id === node.cluster_id)
      const divisor = Math.max(ringNodes.length, 1)
      const theta = (2 * Math.PI * Math.max(orbitIndex, index)) / divisor
      const radius = Math.max(190, Math.min(320, 170 + ringNodes.length * 8))

      cyNodes.push({
        data: {
          id: nodeId,
          clusterId: node.cluster_id,
          label: node.label,
          mainNode: 0,
        },
        position: {
          x: centerX + radius * Math.cos(theta),
          y: centerY + radius * Math.sin(theta),
        },
      })
    })

    const validNodeIds = new Set(nodes.map((node) => node.cluster_id))
    edges.forEach((edge, index) => {
      if (!validNodeIds.has(edge.source_cluster_id) || !validNodeIds.has(edge.target_cluster_id)) return
      if (edge.source_cluster_id === edge.target_cluster_id) return

      cyEdges.push({
        data: {
          id: edge.id || `group-edge-${index}`,
          source: `group-node-${edge.source_cluster_id}`,
          target: `group-node-${edge.target_cluster_id}`,
          label: edge.label,
          sourceArrow: edge.bidirectional ? 'triangle' : 'none',
          targetArrow: 'triangle',
        },
      })
    })

    return [...cyNodes, ...cyEdges]
  }, [nodes, edges, mainClusterId])

  const handleCyInit = useCallback((cy: cytoscape.Core) => {
    cyRef.current = cy
    cy.layout({
      name: 'preset',
      fit: true,
      padding: 40,
      animate: false,
    }).run()
  }, [])

  const handleZoomIn = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * 1.2)
  }

  const handleZoomOut = () => {
    cyRef.current?.zoom(cyRef.current.zoom() / 1.2)
  }

  const handleFit = () => {
    cyRef.current?.fit(undefined, 40)
  }

  const handleExport = () => {
    if (!cyRef.current) return
    const png = cyRef.current.png({ full: true, scale: 2, bg: '#111418' })
    const link = document.createElement('a')
    link.href = png
    link.download = 'analyst-cluster-group-graph.png'
    link.click()
  }

  return (
    <div className="flex flex-col rounded border border-bp-border bg-bp-bg overflow-hidden" style={{ height: 360 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-bp-border">
        <div className="text-xs font-semibold uppercase tracking-wide text-bp-text-secondary">
          Group Graph Preview
        </div>
        <div className="flex items-center gap-1">
          <Button minimal small icon={<ZoomIn size={12} />} onClick={handleZoomIn} title="Zoom in" className="text-bp-text-secondary" />
          <Button minimal small icon={<ZoomOut size={12} />} onClick={handleZoomOut} title="Zoom out" className="text-bp-text-secondary" />
          <Button minimal small icon={<Maximize2 size={12} />} onClick={handleFit} title="Fit to view" className="text-bp-text-secondary" />
          <Button minimal small icon={<Download size={12} />} onClick={handleExport} title="Export PNG" className="text-bp-text-secondary" />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {elements.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-bp-text-secondary">Add clusters and links to build a group graph.</p>
          </div>
        ) : (
          <CytoscapeComponent
            elements={elements}
            stylesheet={ANALYST_GROUP_STYLE}
            style={{ width: '100%', height: '100%' }}
            cy={handleCyInit}
            wheelSensitivity={0.2}
          />
        )}
      </div>
    </div>
  )
}
