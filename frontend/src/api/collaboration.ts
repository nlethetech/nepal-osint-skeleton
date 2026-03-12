/**
 * Collaboration API - Cases, Teams, Verification, Watchlists, Activity
 * Palantir-grade collaborative OSINT endpoints
 */
import { apiClient } from './client';

// ============================================
// Types
// ============================================

export interface UserBrief {
  id: string;
  email: string;
  full_name: string | null;
}

// Cases
export type CaseStatus = 'draft' | 'active' | 'review' | 'closed' | 'archived';
export type CasePriority = 'critical' | 'high' | 'medium' | 'low';
export type CaseVisibility = 'public' | 'team' | 'private';

export interface Case {
  id: string;
  title: string;
  description: string | null;
  status: CaseStatus;
  priority: CasePriority;
  visibility: CaseVisibility;
  category: string | null;
  tags: string[] | null;
  created_by: UserBrief;
  assigned_to: UserBrief | null;
  team_id: string | null;
  linked_cluster_id: string | null;
  hypothesis: string | null;
  conclusion: string | null;
  evidence_count: number;
  comment_count: number;
  started_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseListResponse {
  items: Case[];
  total: number;
  skip: number;
  limit: number;
}

// Publishing (case -> public feed)
export interface CasePublishRequest {
  headline?: string;
  category?: string;
  severity?: string;
  customer_brief: string;
  change_note?: string;
}

export interface ClusterPublication {
  id: string;
  cluster_id: string;
  version: number;
  created_by: UserBrief | null;
  created_at: string;
  headline: string;
  category: string | null;
  severity: string | null;
  customer_brief: string | null;
  citations: Array<Record<string, any>> | null;
  policy_check: Record<string, any> | null;
  change_note: string | null;
}

export interface CasePublishResponse {
  publication: ClusterPublication;
}

export interface CreateCaseRequest {
  title: string;
  description?: string;
  priority?: CasePriority;
  visibility?: CaseVisibility;
  category?: string;
  tags?: string[];
  hypothesis?: string;
  team_id?: string;
  assigned_to_id?: string;
  linked_cluster_id?: string;
}

// Teams
export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamMember {
  id: string;
  user: UserBrief;
  role: TeamRole;
  is_active: boolean;
  joined_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  specialization: string | null;
  is_public: boolean;
  is_active: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
  members?: TeamMember[];
}

// Verification
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'needs_info' | 'expired';
export type VerifiableType = 'story' | 'entity' | 'entity_link' | 'case_evidence' | 'classification' | 'location';
export type VoteChoice = 'agree' | 'disagree' | 'abstain' | 'needs_info';

export interface VerificationRequest {
  id: string;
  item_type: VerifiableType;
  item_id: string;
  claim: string;
  context: string | null;
  evidence: Record<string, any> | null;
  source_urls: string[] | null;
  status: VerificationStatus;
  priority: string | null;
  required_votes: number;
  consensus_threshold: number;
  requested_by: UserBrief;
  agree_count: number;
  disagree_count: number;
  abstain_count: number;
  needs_info_count: number;
  final_verdict: string | null;
  resolution_notes: string | null;
  expires_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface VerificationListResponse {
  items: VerificationRequest[];
  total: number;
  skip: number;
  limit: number;
}

export interface CreateVerificationRequest {
  item_type: VerifiableType;
  item_id: string;
  claim: string;
  context?: string;
  evidence?: Record<string, any>;
  source_urls?: string[];
  priority?: string;
}

export interface VerificationVote {
  id: string;
  request_id: string;
  voter: UserBrief;
  choice: VoteChoice;
  confidence: number | null;
  reasoning: string | null;
  created_at: string;
}

export interface CastVoteRequest {
  choice: VoteChoice;
  confidence?: number;
  reasoning?: string;
  supporting_evidence?: Record<string, any>;
}

// Watchlists
export type WatchlistScope = 'personal' | 'team' | 'public';
export type WatchableType = 'entity' | 'keyword' | 'location' | 'organization' | 'person' | 'topic';
export type AlertFrequency = 'realtime' | 'hourly' | 'daily' | 'weekly';

export interface Watchlist {
  id: string;
  name: string;
  description: string | null;
  scope: WatchlistScope;
  alert_frequency: AlertFrequency;
  is_active: boolean;
  min_relevance_score: number | null;
  categories_filter: string[] | null;
  owner: UserBrief;
  team_id: string | null;
  item_count: number;
  total_matches: number;
  last_match_at: string | null;
  created_at: string;
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  item_type: WatchableType;
  value: string;
  reference_id: string | null;
  aliases: string[] | null;
  case_sensitive: boolean;
  exact_match: boolean;
  notes: string | null;
  is_active: boolean;
  match_count: number;
  last_match_at: string | null;
  created_at: string;
}

// Activity
export interface Activity {
  id: string;
  user: UserBrief;
  activity_type: string;
  target_type: string | null;
  target_id: string | null;
  description: string | null;
  extra_data: Record<string, any> | null;
  team_id: string | null;
  created_at: string;
}

export interface ActivityFeedResponse {
  items: Activity[];
  total: number;
  has_more: boolean;
}

// Analyst Metrics
export interface AnalystMetrics {
  user: UserBrief;
  total_cases: number;
  cases_closed: number;
  evidence_added: number;
  comments_posted: number;
  verifications_requested: number;
  verifications_voted: number;
  verifications_correct: number;
  verification_accuracy: number | null;
  entities_created: number;
  stories_annotated: number;
  notes_created: number;
  active_days: number;
  current_streak: number;
  longest_streak: number;
  last_active_at: string | null;
  badges: string[];
  reputation_score: number;
  threat_score: number;
  economic_score: number;
  political_score: number;
}

export interface LeaderboardEntry {
  rank: number;
  user: UserBrief;
  reputation_score: number;
  verification_accuracy: number | null;
  total_cases: number;
  badges: string[];
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total_analysts: number;
}

// ============================================
// API Functions - Cases
// ============================================

export async function getCases(params?: {
  status?: CaseStatus;
  priority?: CasePriority;
  assigned_to_me?: boolean;
  team_id?: string;
  skip?: number;
  limit?: number;
}): Promise<CaseListResponse> {
  const { data } = await apiClient.get('/cases', { params });
  return data;
}

export async function getCase(id: string): Promise<Case> {
  const { data } = await apiClient.get(`/cases/${id}`);
  return data;
}

export async function createCase(request: CreateCaseRequest): Promise<Case> {
  const { data } = await apiClient.post('/cases', request);
  return data;
}

export async function updateCase(id: string, request: Partial<CreateCaseRequest>): Promise<Case> {
  const { data } = await apiClient.patch(`/cases/${id}`, request);
  return data;
}

export async function publishCase(caseId: string, request: CasePublishRequest): Promise<CasePublishResponse> {
  const { data } = await apiClient.post(`/cases/${caseId}/publish`, request);
  return data;
}

// ============================================
// API Functions - Teams
// ============================================

export async function getTeams(params?: {
  include_mine?: boolean;
  skip?: number;
  limit?: number;
}): Promise<Team[]> {
  const { data } = await apiClient.get('/teams', { params });
  return data;
}

export async function getTeam(id: string): Promise<Team> {
  const { data } = await apiClient.get(`/teams/${id}`);
  return data;
}

export async function getMyTeams(): Promise<Team[]> {
  const { data } = await apiClient.get('/teams/mine');
  return data;
}

// ============================================
// API Functions - Verification
// ============================================

export async function getVerificationQueue(params?: {
  status?: VerificationStatus;
  item_type?: VerifiableType;
  priority?: string;
  skip?: number;
  limit?: number;
}): Promise<VerificationListResponse> {
  const { data } = await apiClient.get('/verification/queue', { params });
  return data;
}

export async function getMyVerificationRequests(params?: {
  status?: VerificationStatus;
  skip?: number;
  limit?: number;
}): Promise<VerificationListResponse> {
  const { data } = await apiClient.get('/verification/my-requests', { params });
  return data;
}

export async function createVerificationRequest(request: CreateVerificationRequest): Promise<VerificationRequest> {
  const { data } = await apiClient.post('/verification', request);
  return data;
}

export async function castVote(requestId: string, vote: CastVoteRequest): Promise<VerificationVote> {
  const { data } = await apiClient.post(`/verification/${requestId}/vote`, vote);
  return data;
}

export async function getVotes(requestId: string): Promise<VerificationVote[]> {
  const { data } = await apiClient.get(`/verification/${requestId}/votes`);
  return data;
}

// ============================================
// API Functions - Watchlists
// ============================================

export async function getWatchlists(params?: {
  scope?: WatchlistScope;
  skip?: number;
  limit?: number;
}): Promise<Watchlist[]> {
  const { data } = await apiClient.get('/watchlists', { params });
  return data;
}

export async function getWatchlistItems(watchlistId: string): Promise<WatchlistItem[]> {
  const { data } = await apiClient.get(`/watchlists/${watchlistId}/items`);
  return data;
}

export async function createWatchlistItem(watchlistId: string, item: {
  item_type: WatchableType;
  value: string;
  aliases?: string[];
  notes?: string;
}): Promise<WatchlistItem> {
  const { data } = await apiClient.post(`/watchlists/${watchlistId}/items`, item);
  return data;
}

// ============================================
// API Functions - Activity
// ============================================

export async function getActivityFeed(params?: {
  team_id?: string;
  activity_type?: string;
  target_type?: string;
  skip?: number;
  limit?: number;
}): Promise<ActivityFeedResponse> {
  const { data } = await apiClient.get('/activity/feed', { params });
  return data;
}

export async function getMentions(params?: {
  unread_only?: boolean;
  skip?: number;
  limit?: number;
}): Promise<ActivityFeedResponse> {
  const { data } = await apiClient.get('/activity/mentions', { params });
  return data;
}

export async function getMyMetrics(): Promise<AnalystMetrics> {
  const { data } = await apiClient.get('/activity/me/metrics');
  return data;
}

export async function getLeaderboard(params?: {
  sort_by?: 'reputation' | 'accuracy' | 'cases';
  limit?: number;
}): Promise<LeaderboardResponse> {
  const { data } = await apiClient.get('/activity/leaderboard', { params });
  return data;
}

export async function getAnalystMetrics(userId: string): Promise<AnalystMetrics> {
  const { data } = await apiClient.get(`/activity/analysts/${userId}/metrics`);
  return data;
}

// ============================================
// Types - Notes
// ============================================

export type NoteVisibility = 'private' | 'team' | 'public';
export type NoteCategory = 'quick' | 'research' | 'hypothesis' | 'todo' | 'reference';

export interface Note {
  id: string;
  title: string | null;
  content: string;
  category: NoteCategory | null;
  tags: string[] | null;
  linked_items: { type: string; id: string }[] | null;
  case_id: string | null;
  author: UserBrief;
  visibility: NoteVisibility;
  team_id: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateNoteRequest {
  title?: string;
  content: string;
  category?: NoteCategory;
  tags?: string[];
  visibility?: NoteVisibility;
  case_id?: string;
  linked_items?: { type: string; id: string }[];
  team_id?: string;
}

// ============================================
// Types - Source Reliability
// ============================================

export interface SourceReliability {
  source_id: string;
  source_name: string;
  source_type: string;
  reliability_rating: string;
  credibility_rating: number;
  confidence_score: number;
  admiralty_code: string;
  total_stories: number;
  verified_true: number;
  verified_false: number;
  total_ratings: number;
  average_user_rating: number | null;
  notes: string | null;
}

export interface SourceRatingRequest {
  reliability_rating: string;
  credibility_rating: number;
  notes?: string;
}

export interface SourceStats {
  total_sources: number;
  rating_distribution: Record<string, number>;
  average_confidence: number;
  type_distribution: Record<string, number>;
}

// ============================================
// API Functions - Notes
// ============================================

export async function getNotes(params?: {
  category?: NoteCategory;
  case_id?: string;
  pinned_only?: boolean;
  include_archived?: boolean;
  skip?: number;
  limit?: number;
}): Promise<Note[]> {
  const { data } = await apiClient.get('/notes', { params });
  return data;
}

export async function getNote(id: string): Promise<Note> {
  const { data } = await apiClient.get(`/notes/${id}`);
  return data;
}

export async function createNote(request: CreateNoteRequest): Promise<Note> {
  const { data } = await apiClient.post('/notes', request);
  return data;
}

export async function updateNote(id: string, request: Partial<CreateNoteRequest> & {
  is_pinned?: boolean;
  is_archived?: boolean;
}): Promise<Note> {
  const { data } = await apiClient.patch(`/notes/${id}`, request);
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  await apiClient.delete(`/notes/${id}`);
}

export async function togglePinNote(id: string): Promise<Note> {
  const { data } = await apiClient.post(`/notes/${id}/pin`);
  return data;
}

export async function toggleArchiveNote(id: string): Promise<Note> {
  const { data } = await apiClient.post(`/notes/${id}/archive`);
  return data;
}

// ============================================
// API Functions - Source Reliability
// ============================================

export async function getSources(params?: {
  source_type?: string;
  min_confidence?: number;
  sort_by?: 'confidence' | 'name' | 'stories';
  skip?: number;
  limit?: number;
}): Promise<SourceReliability[]> {
  const { data } = await apiClient.get('/sources', { params });
  return data;
}

export async function getSource(sourceId: string): Promise<SourceReliability> {
  const { data } = await apiClient.get(`/sources/${sourceId}`);
  return data;
}

export async function getSourceStats(): Promise<SourceStats> {
  const { data } = await apiClient.get('/sources/stats');
  return data;
}

export async function rateSource(sourceId: string, rating: SourceRatingRequest): Promise<SourceReliability> {
  const { data } = await apiClient.post(`/sources/${sourceId}/rate`, rating);
  return data;
}

// ============================================
// Types - Case Evidence
// ============================================

export type EvidenceType = 'story' | 'entity' | 'document' | 'link' | 'note';
export type EvidenceConfidence = 'confirmed' | 'likely' | 'possible' | 'doubtful';

export interface CaseEvidence {
  id: string;
  case_id: string;
  evidence_type: EvidenceType;
  reference_id: string | null;
  reference_url: string | null;
  title: string;
  summary: string | null;
  relevance_notes: string | null;
  is_key_evidence: boolean;
  confidence: EvidenceConfidence;
  added_by: UserBrief;
  created_at: string;
  extra_data: Record<string, unknown> | null;
}

export interface CreateEvidenceRequest {
  evidence_type: EvidenceType;
  reference_id?: string;
  reference_url?: string;
  title: string;
  summary?: string;
  relevance_notes?: string;
  is_key_evidence?: boolean;
  confidence?: EvidenceConfidence;
  extra_data?: Record<string, unknown>;
}

// ============================================
// Types - Case Comments
// ============================================

export interface CaseComment {
  id: string;
  case_id: string;
  content: string;
  author: UserBrief;
  parent_comment_id: string | null;
  mentions: string[];
  is_edited: boolean;
  edited_at: string | null;
  created_at: string;
  replies?: CaseComment[];
}

export interface CreateCommentRequest {
  content: string;
  parent_comment_id?: string;
}

// ============================================
// API Functions - Case Evidence
// ============================================

export async function getCaseEvidence(caseId: string): Promise<CaseEvidence[]> {
  const { data } = await apiClient.get(`/cases/${caseId}/evidence`);
  return data;
}

export async function addCaseEvidence(caseId: string, evidence: CreateEvidenceRequest): Promise<CaseEvidence> {
  const { data } = await apiClient.post(`/cases/${caseId}/evidence`, evidence);
  return data;
}

export async function updateCaseEvidence(caseId: string, evidenceId: string, updates: Partial<CreateEvidenceRequest>): Promise<CaseEvidence> {
  const { data } = await apiClient.patch(`/cases/${caseId}/evidence/${evidenceId}`, updates);
  return data;
}

export async function removeCaseEvidence(caseId: string, evidenceId: string): Promise<void> {
  await apiClient.delete(`/cases/${caseId}/evidence/${evidenceId}`);
}

// ============================================
// API Functions - Case Comments
// ============================================

export async function getCaseComments(caseId: string): Promise<CaseComment[]> {
  const { data } = await apiClient.get(`/cases/${caseId}/comments`);
  return data;
}

export async function addCaseComment(caseId: string, comment: CreateCommentRequest): Promise<CaseComment> {
  const { data } = await apiClient.post(`/cases/${caseId}/comments`, comment);
  return data;
}

export async function updateCaseComment(caseId: string, commentId: string, content: string): Promise<CaseComment> {
  const { data } = await apiClient.patch(`/cases/${caseId}/comments/${commentId}`, { content });
  return data;
}

export async function deleteCaseComment(caseId: string, commentId: string): Promise<void> {
  await apiClient.delete(`/cases/${caseId}/comments/${commentId}`);
}
