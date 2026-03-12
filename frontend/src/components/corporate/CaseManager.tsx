/**
 * CaseManager -- Investigation Case Management for NARADA v6
 * Blueprint Card-based layout: case list sidebar + selected case detail.
 * Blueprint dark theme with bp-* Tailwind tokens.
 */
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card,
  Tag,
  Intent,
  Button,
  ButtonGroup,
  Spinner,
  NonIdealState,
  Icon,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  InputGroup,
  TextArea,
  HTMLSelect,
  Tabs,
  Tab,
} from '@blueprintjs/core'
import {
  listCases,
  getCase,
  createCase,
  updateCase,
  addEntity,
  removeEntity,
  addFinding,
  addNote,
  type InvestigationCase,
  type InvestigationCaseDetail,
  type InvestigationStatus,
  type InvestigationPriority,
  type EntityType,
  type FindingType,
  type FindingSeverity,
  type CaseEntityRecord,
  type CaseFindingRecord,
  type CaseNoteRecord,
} from '../../api/investigationCases'

// ── Intent maps ────────────────────────────────────────────────

const STATUS_INTENT: Record<InvestigationStatus, Intent> = {
  open: Intent.PRIMARY,
  active: Intent.SUCCESS,
  closed: Intent.NONE,
  archived: Intent.WARNING,
}

const PRIORITY_INTENT: Record<InvestigationPriority, Intent> = {
  low: Intent.NONE,
  medium: Intent.PRIMARY,
  high: Intent.WARNING,
  critical: Intent.DANGER,
}

const SEVERITY_INTENT: Record<FindingSeverity, Intent> = {
  info: Intent.NONE,
  low: Intent.PRIMARY,
  medium: Intent.WARNING,
  high: Intent.DANGER,
  critical: Intent.DANGER,
}

const SEVERITY_BORDER_CLASS: Record<FindingSeverity, string> = {
  info: 'border-l-bp-text-muted',
  low: 'border-l-bp-primary',
  medium: 'border-l-severity-high',
  high: 'border-l-severity-critical',
  critical: 'border-l-severity-critical',
}

const ENTITY_ICON: Record<EntityType, string> = {
  company: 'office',
  person: 'person',
  pan: 'id-number',
}

const STATUS_OPTIONS: InvestigationStatus[] = ['open', 'active', 'closed', 'archived']
const PRIORITY_OPTIONS: InvestigationPriority[] = ['low', 'medium', 'high', 'critical']
const ENTITY_TYPE_OPTIONS: EntityType[] = ['company', 'person', 'pan']
const FINDING_TYPE_OPTIONS: FindingType[] = ['risk_flag', 'anomaly', 'observation', 'evidence']
const SEVERITY_OPTIONS: FindingSeverity[] = ['info', 'low', 'medium', 'high', 'critical']

// ── Props ──────────────────────────────────────────────────────

interface CaseManagerProps {
  onEntityClick?: (entityType: EntityType, entityId: string) => void
}

// ── Component ──────────────────────────────────────────────────

export function CaseManager({ onEntityClick }: CaseManagerProps) {
  const queryClient = useQueryClient()

  // State
  const [statusFilter, setStatusFilter] = useState<InvestigationStatus | 'all'>('all')
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showAddEntityDialog, setShowAddEntityDialog] = useState(false)
  const [showAddFindingDialog, setShowAddFindingDialog] = useState(false)
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('entities')

  // Create form state
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createPriority, setCreatePriority] = useState<InvestigationPriority>('medium')

  // Add entity form state
  const [entityType, setEntityType] = useState<EntityType>('company')
  const [entityId, setEntityId] = useState('')
  const [entityLabel, setEntityLabel] = useState('')
  const [entityNotes, setEntityNotes] = useState('')

  // Add finding form state
  const [findingType, setFindingType] = useState<FindingType>('observation')
  const [findingTitle, setFindingTitle] = useState('')
  const [findingDescription, setFindingDescription] = useState('')
  const [findingSeverity, setFindingSeverity] = useState<FindingSeverity>('info')

  // Add note form state
  const [noteContent, setNoteContent] = useState('')

  // ── Queries ────────────────────────────────────────────────

  const {
    data: caseList,
    isLoading: listLoading,
    isError: listError,
  } = useQuery({
    queryKey: ['investigation-cases', statusFilter],
    queryFn: () =>
      listCases({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
      }),
  })

  const {
    data: selectedCase,
    isLoading: detailLoading,
  } = useQuery({
    queryKey: ['investigation-case', selectedCaseId],
    queryFn: () => getCase(selectedCaseId!),
    enabled: !!selectedCaseId,
  })

  // ── Mutations ──────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () =>
      createCase({
        title: createTitle,
        description: createDescription || undefined,
        priority: createPriority,
      }),
    onSuccess: (newCase) => {
      queryClient.invalidateQueries({ queryKey: ['investigation-cases'] })
      setSelectedCaseId(newCase.id)
      resetCreateForm()
      setShowCreateDialog(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: { caseId: string; status?: InvestigationStatus; priority?: InvestigationPriority }) =>
      updateCase(data.caseId, { status: data.status, priority: data.priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-cases'] })
      queryClient.invalidateQueries({ queryKey: ['investigation-case', selectedCaseId] })
    },
  })

  const addEntityMutation = useMutation({
    mutationFn: () =>
      addEntity(selectedCaseId!, {
        entity_type: entityType,
        entity_id: entityId,
        entity_label: entityLabel,
        notes: entityNotes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-case', selectedCaseId] })
      queryClient.invalidateQueries({ queryKey: ['investigation-cases'] })
      resetEntityForm()
      setShowAddEntityDialog(false)
    },
  })

  const removeEntityMutation = useMutation({
    mutationFn: (entityRecordId: string) => removeEntity(selectedCaseId!, entityRecordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-case', selectedCaseId] })
      queryClient.invalidateQueries({ queryKey: ['investigation-cases'] })
    },
  })

  const addFindingMutation = useMutation({
    mutationFn: () =>
      addFinding(selectedCaseId!, {
        finding_type: findingType,
        title: findingTitle,
        description: findingDescription || undefined,
        severity: findingSeverity,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-case', selectedCaseId] })
      queryClient.invalidateQueries({ queryKey: ['investigation-cases'] })
      resetFindingForm()
      setShowAddFindingDialog(false)
    },
  })

  const addNoteMutation = useMutation({
    mutationFn: () => addNote(selectedCaseId!, { content: noteContent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-case', selectedCaseId] })
      queryClient.invalidateQueries({ queryKey: ['investigation-cases'] })
      setNoteContent('')
      setShowAddNoteDialog(false)
    },
  })

  // ── Helpers ────────────────────────────────────────────────

  const resetCreateForm = useCallback(() => {
    setCreateTitle('')
    setCreateDescription('')
    setCreatePriority('medium')
  }, [])

  const resetEntityForm = useCallback(() => {
    setEntityType('company')
    setEntityId('')
    setEntityLabel('')
    setEntityNotes('')
  }, [])

  const resetFindingForm = useCallback(() => {
    setFindingType('observation')
    setFindingTitle('')
    setFindingDescription('')
    setFindingSeverity('info')
  }, [])

  const cases = useMemo(() => caseList?.items ?? [], [caseList])

  // ── Render ─────────────────────────────────────────────────

  if (listLoading) {
    return (
      <div className="bp6-dark flex items-center justify-center p-16 bg-bp-bg">
        <Spinner intent={Intent.PRIMARY} size={48} />
      </div>
    )
  }

  if (listError) {
    return (
      <div className="bp6-dark p-8 bg-bp-bg">
        <NonIdealState
          icon="error"
          title="Failed to load cases"
          description="Could not fetch investigation cases."
        />
      </div>
    )
  }

  return (
    <div className="bp6-dark flex h-full bg-bp-bg text-bp-text">
      {/* ── Sidebar: Case List ──────────────────────────────── */}
      <div
        className="flex flex-col border-r border-bp-border h-full overflow-hidden"
        style={{ width: 360, minWidth: 360 }}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between p-4 border-b border-bp-border">
          <div className="flex items-center gap-2">
            <Icon icon="briefcase" size={18} className="text-bp-primary" />
            <span className="text-base font-semibold">Investigations</span>
            <Tag minimal round className="bg-bp-surface text-bp-text-muted">
              {caseList?.total ?? 0}
            </Tag>
          </div>
          <Button
            icon="plus"
            intent={Intent.PRIMARY}
            small
            onClick={() => setShowCreateDialog(true)}
          />
        </div>

        {/* Status filter */}
        <div className="px-4 py-2 border-b border-bp-border">
          <ButtonGroup fill>
            <Button
              text="All"
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            />
            {STATUS_OPTIONS.map((s) => (
              <Button
                key={s}
                text={s.charAt(0).toUpperCase() + s.slice(1)}
                active={statusFilter === s}
                intent={statusFilter === s ? STATUS_INTENT[s] : Intent.NONE}
                onClick={() => setStatusFilter(s)}
              />
            ))}
          </ButtonGroup>
        </div>

        {/* Case cards */}
        <div className="flex-1 overflow-y-auto p-2">
          {cases.length === 0 ? (
            <NonIdealState
              icon="search"
              title="No cases found"
              description="Create a new investigation case to get started."
            />
          ) : (
            cases.map((c) => (
              <CaseListItem
                key={c.id}
                caseItem={c}
                selected={c.id === selectedCaseId}
                onClick={() => setSelectedCaseId(c.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Main: Case Detail ──────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedCaseId ? (
          <div className="flex flex-1 items-center justify-center">
            <NonIdealState
              icon="briefcase"
              title="Select a case"
              description="Choose an investigation case from the sidebar to view details."
            />
          </div>
        ) : detailLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner intent={Intent.PRIMARY} size={40} />
          </div>
        ) : selectedCase ? (
          <CaseDetail
            caseData={selectedCase}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onStatusChange={(s) => updateMutation.mutate({ caseId: selectedCase.id, status: s })}
            onPriorityChange={(p) => updateMutation.mutate({ caseId: selectedCase.id, priority: p })}
            onAddEntity={() => setShowAddEntityDialog(true)}
            onRemoveEntity={(id) => removeEntityMutation.mutate(id)}
            onAddFinding={() => setShowAddFindingDialog(true)}
            onAddNote={() => setShowAddNoteDialog(true)}
            onEntityClick={onEntityClick}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <NonIdealState icon="error" title="Case not found" />
          </div>
        )}
      </div>

      {/* ── Create Case Dialog ─────────────────────────────── */}
      <Dialog
        isOpen={showCreateDialog}
        onClose={() => { setShowCreateDialog(false); resetCreateForm() }}
        title="Create Investigation Case"
        className="bp6-dark bg-bp-card"
      >
        <DialogBody>
          <FormGroup label="Title" labelFor="case-title">
            <InputGroup
              id="case-title"
              placeholder="Investigation case title..."
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              autoFocus
            />
          </FormGroup>
          <FormGroup label="Description" labelFor="case-desc">
            <TextArea
              id="case-desc"
              placeholder="Describe the scope and objectives..."
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              fill
              rows={3}
            />
          </FormGroup>
          <FormGroup label="Priority" labelFor="case-priority">
            <HTMLSelect
              id="case-priority"
              value={createPriority}
              onChange={(e) => setCreatePriority(e.target.value as InvestigationPriority)}
              options={PRIORITY_OPTIONS}
              fill
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => { setShowCreateDialog(false); resetCreateForm() }} />
              <Button
                text="Create"
                intent={Intent.PRIMARY}
                onClick={() => createMutation.mutate()}
                disabled={!createTitle.trim()}
                loading={createMutation.isPending}
              />
            </>
          }
        />
      </Dialog>

      {/* ── Add Entity Dialog ──────────────────────────────── */}
      <Dialog
        isOpen={showAddEntityDialog}
        onClose={() => { setShowAddEntityDialog(false); resetEntityForm() }}
        title="Add Entity to Case"
        className="bp6-dark bg-bp-card"
      >
        <DialogBody>
          <FormGroup label="Entity Type" labelFor="entity-type">
            <HTMLSelect
              id="entity-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              options={ENTITY_TYPE_OPTIONS}
              fill
            />
          </FormGroup>
          <FormGroup label="Entity ID" labelFor="entity-id">
            <InputGroup
              id="entity-id"
              placeholder="UUID or PAN number..."
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
          </FormGroup>
          <FormGroup label="Label" labelFor="entity-label">
            <InputGroup
              id="entity-label"
              placeholder="Display name for this entity..."
              value={entityLabel}
              onChange={(e) => setEntityLabel(e.target.value)}
            />
          </FormGroup>
          <FormGroup label="Notes (optional)" labelFor="entity-notes">
            <TextArea
              id="entity-notes"
              placeholder="Why is this entity relevant?"
              value={entityNotes}
              onChange={(e) => setEntityNotes(e.target.value)}
              fill
              rows={2}
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => { setShowAddEntityDialog(false); resetEntityForm() }} />
              <Button
                text="Add Entity"
                intent={Intent.PRIMARY}
                onClick={() => addEntityMutation.mutate()}
                disabled={!entityId.trim() || !entityLabel.trim()}
                loading={addEntityMutation.isPending}
              />
            </>
          }
        />
      </Dialog>

      {/* ── Add Finding Dialog ─────────────────────────────── */}
      <Dialog
        isOpen={showAddFindingDialog}
        onClose={() => { setShowAddFindingDialog(false); resetFindingForm() }}
        title="Add Finding"
        className="bp6-dark bg-bp-card"
      >
        <DialogBody>
          <FormGroup label="Finding Type" labelFor="finding-type">
            <HTMLSelect
              id="finding-type"
              value={findingType}
              onChange={(e) => setFindingType(e.target.value as FindingType)}
              options={FINDING_TYPE_OPTIONS}
              fill
            />
          </FormGroup>
          <FormGroup label="Title" labelFor="finding-title">
            <InputGroup
              id="finding-title"
              placeholder="Finding title..."
              value={findingTitle}
              onChange={(e) => setFindingTitle(e.target.value)}
            />
          </FormGroup>
          <FormGroup label="Description" labelFor="finding-desc">
            <TextArea
              id="finding-desc"
              placeholder="Describe the finding..."
              value={findingDescription}
              onChange={(e) => setFindingDescription(e.target.value)}
              fill
              rows={3}
            />
          </FormGroup>
          <FormGroup label="Severity" labelFor="finding-severity">
            <HTMLSelect
              id="finding-severity"
              value={findingSeverity}
              onChange={(e) => setFindingSeverity(e.target.value as FindingSeverity)}
              options={SEVERITY_OPTIONS}
              fill
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => { setShowAddFindingDialog(false); resetFindingForm() }} />
              <Button
                text="Add Finding"
                intent={Intent.PRIMARY}
                onClick={() => addFindingMutation.mutate()}
                disabled={!findingTitle.trim()}
                loading={addFindingMutation.isPending}
              />
            </>
          }
        />
      </Dialog>

      {/* ── Add Note Dialog ────────────────────────────────── */}
      <Dialog
        isOpen={showAddNoteDialog}
        onClose={() => { setShowAddNoteDialog(false); setNoteContent('') }}
        title="Add Note"
        className="bp6-dark bg-bp-card"
      >
        <DialogBody>
          <FormGroup label="Content" labelFor="note-content">
            <TextArea
              id="note-content"
              placeholder="Write your investigation note..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              fill
              rows={6}
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => { setShowAddNoteDialog(false); setNoteContent('') }} />
              <Button
                text="Add Note"
                intent={Intent.PRIMARY}
                onClick={() => addNoteMutation.mutate()}
                disabled={!noteContent.trim()}
                loading={addNoteMutation.isPending}
              />
            </>
          }
        />
      </Dialog>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function CaseListItem({
  caseItem,
  selected,
  onClick,
}: {
  caseItem: InvestigationCase
  selected: boolean
  onClick: () => void
}) {
  return (
    <Card
      interactive
      onClick={onClick}
      className={`cursor-pointer mb-1.5 px-3 py-2.5 ${selected ? 'bg-bp-surface border-bp-primary' : 'bg-bp-card border-bp-border'} border`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="truncate text-sm font-semibold text-bp-text" style={{ maxWidth: 200 }}>
            {caseItem.title}
          </span>
          <Tag
            intent={STATUS_INTENT[caseItem.status]}
            minimal
            className="capitalize"
          >
            {caseItem.status}
          </Tag>
        </div>
        <div className="flex items-center gap-2">
          <Tag
            intent={PRIORITY_INTENT[caseItem.priority]}
            minimal
            className="capitalize"
          >
            {caseItem.priority}
          </Tag>
          <span className="text-xs text-bp-text-muted">
            {caseItem.entity_count} entities
          </span>
          <span className="text-xs text-bp-text-muted">
            {caseItem.finding_count} findings
          </span>
        </div>
        <span className="text-xs text-bp-text-muted">
          {new Date(caseItem.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' by '}
          {caseItem.created_by.full_name ?? caseItem.created_by.email}
        </span>
      </div>
    </Card>
  )
}

function CaseDetail({
  caseData,
  activeTab,
  onTabChange,
  onStatusChange,
  onPriorityChange,
  onAddEntity,
  onRemoveEntity,
  onAddFinding,
  onAddNote,
  onEntityClick,
}: {
  caseData: InvestigationCaseDetail
  activeTab: string
  onTabChange: (tab: string) => void
  onStatusChange: (status: InvestigationStatus) => void
  onPriorityChange: (priority: InvestigationPriority) => void
  onAddEntity: () => void
  onRemoveEntity: (entityId: string) => void
  onAddFinding: () => void
  onAddNote: () => void
  onEntityClick?: (entityType: EntityType, entityId: string) => void
}) {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Case header */}
      <div className="flex flex-col gap-3 p-5 border-b border-bp-border">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-xl font-bold text-bp-text">
              {caseData.title}
            </h2>
            {caseData.description && (
              <p className="m-0 text-sm text-bp-text-muted">
                {caseData.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <HTMLSelect
              value={caseData.status}
              onChange={(e) => onStatusChange(e.target.value as InvestigationStatus)}
              options={STATUS_OPTIONS}
            />
            <HTMLSelect
              value={caseData.priority}
              onChange={(e) => onPriorityChange(e.target.value as InvestigationPriority)}
              options={PRIORITY_OPTIONS}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-bp-text-muted">
          <span>Created: {formatDate(caseData.created_at)}</span>
          <span>Updated: {formatDate(caseData.updated_at)}</span>
          {caseData.closed_at && <span>Closed: {formatDate(caseData.closed_at)}</span>}
          <span>By: {caseData.created_by.full_name ?? caseData.created_by.email}</span>
          {caseData.assigned_to && (
            <span>Assigned: {caseData.assigned_to.full_name ?? caseData.assigned_to.email}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs
          id="case-tabs"
          selectedTabId={activeTab}
          onChange={(newTab) => onTabChange(newTab as string)}
          large={false}
          renderActiveTabPanelOnly
          className="flex flex-1 flex-col overflow-hidden"
        >
          <Tab
            id="entities"
            title={
              <span className="flex items-center gap-1">
                <Icon icon="people" size={14} />
                Entities ({caseData.entities.length})
              </span>
            }
            panel={
              <EntitiesPanel
                entities={caseData.entities}
                onAdd={onAddEntity}
                onRemove={onRemoveEntity}
                onEntityClick={onEntityClick}
              />
            }
          />
          <Tab
            id="findings"
            title={
              <span className="flex items-center gap-1">
                <Icon icon="flag" size={14} />
                Findings ({caseData.findings.length})
              </span>
            }
            panel={
              <FindingsPanel
                findings={caseData.findings}
                onAdd={onAddFinding}
              />
            }
          />
          <Tab
            id="notes"
            title={
              <span className="flex items-center gap-1">
                <Icon icon="annotation" size={14} />
                Notes ({caseData.notes.length})
              </span>
            }
            panel={
              <NotesPanel
                notes={caseData.notes}
                onAdd={onAddNote}
              />
            }
          />
        </Tabs>
      </div>
    </div>
  )
}

function EntitiesPanel({
  entities,
  onAdd,
  onRemove,
  onEntityClick,
}: {
  entities: CaseEntityRecord[]
  onAdd: () => void
  onRemove: (id: string) => void
  onEntityClick?: (entityType: EntityType, entityId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-bp-text">
          Linked Entities
        </span>
        <Button icon="plus" text="Add Entity" small intent={Intent.PRIMARY} onClick={onAdd} />
      </div>

      {entities.length === 0 ? (
        <NonIdealState
          icon="people"
          title="No entities"
          description="Add companies, persons, or PAN numbers to this case."
        />
      ) : (
        entities.map((entity) => (
          <Card
            key={entity.id}
            className="bg-bp-card border border-bp-border px-3.5 py-2.5"
          >
            <div className="flex items-center gap-3">
              <Icon
                icon={ENTITY_ICON[entity.entity_type] as any}
                size={16}
                className="text-bp-primary"
              />
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="cursor-pointer text-sm font-semibold text-bp-primary"
                    onClick={() => onEntityClick?.(entity.entity_type, entity.entity_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onEntityClick?.(entity.entity_type, entity.entity_id)
                      }
                    }}
                  >
                    {entity.entity_label}
                  </span>
                  <Tag minimal className="capitalize">
                    {entity.entity_type}
                  </Tag>
                </div>
                {entity.notes && (
                  <span className="text-xs text-bp-text-muted">
                    {entity.notes}
                  </span>
                )}
                <span className="text-xs text-bp-text-muted">
                  Added by {entity.added_by.full_name ?? entity.added_by.email}
                  {' - '}
                  {new Date(entity.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <Button
                icon="cross"
                minimal
                small
                intent={Intent.DANGER}
                onClick={() => onRemove(entity.id)}
              />
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

function FindingsPanel({
  findings,
  onAdd,
}: {
  findings: CaseFindingRecord[]
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-bp-text">
          Case Findings
        </span>
        <Button icon="plus" text="Add Finding" small intent={Intent.PRIMARY} onClick={onAdd} />
      </div>

      {findings.length === 0 ? (
        <NonIdealState
          icon="flag"
          title="No findings"
          description="Document risk flags, anomalies, or observations."
        />
      ) : (
        findings.map((finding) => (
          <Card
            key={finding.id}
            className={`bg-bp-card border border-bp-border border-l-[3px] ${SEVERITY_BORDER_CLASS[finding.severity]} px-3.5 py-2.5`}
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Tag
                  intent={SEVERITY_INTENT[finding.severity]}
                  className="uppercase font-semibold text-[10px]"
                >
                  {finding.severity}
                </Tag>
                <Tag minimal className="capitalize">
                  {finding.finding_type.replace('_', ' ')}
                </Tag>
              </div>
              <span className="text-sm font-semibold text-bp-text">
                {finding.title}
              </span>
              {finding.description && (
                <span className="text-xs text-bp-text-muted">
                  {finding.description}
                </span>
              )}
              <span className="text-xs text-bp-text-muted">
                By {finding.created_by.full_name ?? finding.created_by.email}
                {' - '}
                {new Date(finding.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

function NotesPanel({
  notes,
  onAdd,
}: {
  notes: CaseNoteRecord[]
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-bp-text">
          Investigation Notes
        </span>
        <Button icon="plus" text="Add Note" small intent={Intent.PRIMARY} onClick={onAdd} />
      </div>

      {notes.length === 0 ? (
        <NonIdealState
          icon="annotation"
          title="No notes"
          description="Add investigation notes and observations."
        />
      ) : (
        notes.map((note) => (
          <Card
            key={note.id}
            className="bg-bp-card border border-bp-border px-3.5 py-3"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-bp-primary">
                  {note.created_by.full_name ?? note.created_by.email}
                </span>
                <span className="text-xs text-bp-text-muted">
                  {new Date(note.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-sm text-bp-text whitespace-pre-wrap leading-relaxed">
                {note.content}
              </div>
              {note.updated_at !== note.created_at && (
                <span className="text-xs italic text-bp-text-muted">
                  edited {new Date(note.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
