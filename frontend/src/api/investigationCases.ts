/**
 * Investigation Case Management API client
 * Endpoints: /api/v1/investigation-cases
 */
import { apiClient } from './client'

// ── Enums ──────────────────────────────────────────────────────

export type InvestigationStatus = 'open' | 'active' | 'closed' | 'archived'
export type InvestigationPriority = 'low' | 'medium' | 'high' | 'critical'
export type EntityType = 'company' | 'person' | 'pan'
export type FindingType = 'risk_flag' | 'anomaly' | 'observation' | 'evidence'
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

// ── Types ──────────────────────────────────────────────────────

export interface UserBrief {
  id: string
  email: string
  full_name: string | null
}

export interface InvestigationCase {
  id: string
  title: string
  description: string | null
  status: InvestigationStatus
  priority: InvestigationPriority
  created_by: UserBrief
  assigned_to: UserBrief | null
  created_at: string
  updated_at: string
  closed_at: string | null
  entity_count: number
  finding_count: number
  note_count: number
}

export interface InvestigationCaseDetail extends InvestigationCase {
  entities: CaseEntityRecord[]
  findings: CaseFindingRecord[]
  notes: CaseNoteRecord[]
}

export interface CaseListResponse {
  items: InvestigationCase[]
  total: number
  skip: number
  limit: number
}

export interface CaseEntityRecord {
  id: string
  case_id: string
  entity_type: EntityType
  entity_id: string
  entity_label: string
  added_by: UserBrief
  added_at: string
  notes: string | null
}

export interface CaseFindingRecord {
  id: string
  case_id: string
  finding_type: FindingType
  title: string
  description: string | null
  severity: FindingSeverity
  source_type: string | null
  source_id: string | null
  created_by: UserBrief
  created_at: string
}

export interface CaseNoteRecord {
  id: string
  case_id: string
  content: string
  created_by: UserBrief
  created_at: string
  updated_at: string
}

// ── Request Types ──────────────────────────────────────────────

export interface CreateCaseRequest {
  title: string
  description?: string
  priority?: InvestigationPriority
  assigned_to_id?: string
}

export interface UpdateCaseRequest {
  title?: string
  description?: string
  status?: InvestigationStatus
  priority?: InvestigationPriority
  assigned_to_id?: string
}

export interface AddEntityRequest {
  entity_type: EntityType
  entity_id: string
  entity_label: string
  notes?: string
}

export interface AddFindingRequest {
  finding_type: FindingType
  title: string
  description?: string
  severity?: FindingSeverity
  source_type?: string
  source_id?: string
}

export interface AddNoteRequest {
  content: string
}

// ── API Functions ──────────────────────────────────────────────

const BASE = '/investigation-cases'

export async function createCase(data: CreateCaseRequest): Promise<InvestigationCase> {
  const { data: result } = await apiClient.post(BASE, data)
  return result
}

export async function listCases(params?: {
  status?: InvestigationStatus
  skip?: number
  limit?: number
}): Promise<CaseListResponse> {
  const { data } = await apiClient.get(BASE, { params })
  return data
}

export async function getCase(caseId: string): Promise<InvestigationCaseDetail> {
  const { data } = await apiClient.get(`${BASE}/${caseId}`)
  return data
}

export async function updateCase(caseId: string, data: UpdateCaseRequest): Promise<InvestigationCase> {
  const { data: result } = await apiClient.patch(`${BASE}/${caseId}`, data)
  return result
}

export async function addEntity(caseId: string, data: AddEntityRequest): Promise<CaseEntityRecord> {
  const { data: result } = await apiClient.post(`${BASE}/${caseId}/entities`, data)
  return result
}

export async function removeEntity(caseId: string, entityId: string): Promise<void> {
  await apiClient.delete(`${BASE}/${caseId}/entities/${entityId}`)
}

export async function addFinding(caseId: string, data: AddFindingRequest): Promise<CaseFindingRecord> {
  const { data: result } = await apiClient.post(`${BASE}/${caseId}/findings`, data)
  return result
}

export async function addNote(caseId: string, data: AddNoteRequest): Promise<CaseNoteRecord> {
  const { data: result } = await apiClient.post(`${BASE}/${caseId}/notes`, data)
  return result
}
