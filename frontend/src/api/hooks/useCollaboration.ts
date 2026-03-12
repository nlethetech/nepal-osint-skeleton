/**
 * React Query hooks for Collaboration API
 * Palantir-grade collaborative OSINT features
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCases, getCase, createCase, updateCase,
  getTeams, getTeam, getMyTeams,
  getVerificationQueue, getMyVerificationRequests, createVerificationRequest, castVote, getVotes,
  getWatchlists, getWatchlistItems, createWatchlistItem,
  getActivityFeed, getMentions, getMyMetrics, getLeaderboard, getAnalystMetrics,
  getNotes, getNote, createNote, updateNote, deleteNote, togglePinNote,
  getSources, getSource, getSourceStats, rateSource,
  getCaseEvidence, addCaseEvidence, updateCaseEvidence, removeCaseEvidence,
  getCaseComments, addCaseComment, updateCaseComment, deleteCaseComment,
  CaseStatus, CasePriority, VerificationStatus, VerifiableType, WatchlistScope,
  CreateCaseRequest, CreateVerificationRequest, CastVoteRequest, WatchableType,
  NoteCategory, CreateNoteRequest, SourceRatingRequest, CreateEvidenceRequest, CreateCommentRequest,
} from '../collaboration';

// ============================================
// Query Keys
// ============================================

export const collaborationKeys = {
  // Cases
  cases: ['cases'] as const,
  caseList: (filters: Record<string, any>) => [...collaborationKeys.cases, 'list', filters] as const,
  caseDetail: (id: string) => [...collaborationKeys.cases, 'detail', id] as const,

  // Teams
  teams: ['teams'] as const,
  teamList: () => [...collaborationKeys.teams, 'list'] as const,
  teamDetail: (id: string) => [...collaborationKeys.teams, 'detail', id] as const,
  myTeams: () => [...collaborationKeys.teams, 'mine'] as const,

  // Verification
  verification: ['verification'] as const,
  verificationQueue: (filters: Record<string, any>) => [...collaborationKeys.verification, 'queue', filters] as const,
  myRequests: (filters: Record<string, any>) => [...collaborationKeys.verification, 'my-requests', filters] as const,
  votes: (requestId: string) => [...collaborationKeys.verification, 'votes', requestId] as const,

  // Watchlists
  watchlists: ['watchlists'] as const,
  watchlistList: (scope?: WatchlistScope) => [...collaborationKeys.watchlists, 'list', scope] as const,
  watchlistItems: (id: string) => [...collaborationKeys.watchlists, 'items', id] as const,

  // Activity
  activity: ['activity'] as const,
  activityFeed: (filters: Record<string, any>) => [...collaborationKeys.activity, 'feed', filters] as const,
  mentions: (unreadOnly: boolean) => [...collaborationKeys.activity, 'mentions', unreadOnly] as const,
  myMetrics: () => [...collaborationKeys.activity, 'my-metrics'] as const,
  leaderboard: (sortBy: string) => [...collaborationKeys.activity, 'leaderboard', sortBy] as const,
  analystMetrics: (userId: string) => [...collaborationKeys.activity, 'analyst', userId] as const,

  // Notes
  notes: ['notes'] as const,
  noteList: (filters: Record<string, any>) => [...collaborationKeys.notes, 'list', filters] as const,
  noteDetail: (id: string) => [...collaborationKeys.notes, 'detail', id] as const,

  // Sources
  sources: ['sources'] as const,
  sourceList: (filters: Record<string, any>) => [...collaborationKeys.sources, 'list', filters] as const,
  sourceDetail: (id: string) => [...collaborationKeys.sources, 'detail', id] as const,
  sourceStats: () => [...collaborationKeys.sources, 'stats'] as const,

  // Case Evidence
  caseEvidence: (caseId: string) => [...collaborationKeys.cases, caseId, 'evidence'] as const,

  // Case Comments
  caseComments: (caseId: string) => [...collaborationKeys.cases, caseId, 'comments'] as const,
};

// ============================================
// Cases Hooks
// ============================================

export function useCases(params?: {
  status?: CaseStatus;
  priority?: CasePriority;
  assigned_to_me?: boolean;
  team_id?: string;
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.caseList(params || {}),
    queryFn: () => getCases(params),
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useCase(id: string) {
  return useQuery({
    queryKey: collaborationKeys.caseDetail(id),
    queryFn: () => getCase(id),
    enabled: !!id,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateCaseRequest) => createCase(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.cases });
    },
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...request }: { id: string } & Partial<CreateCaseRequest>) =>
      updateCase(id, request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.cases });
    },
  });
}

// ============================================
// Teams Hooks
// ============================================

export function useTeams(params?: {
  include_mine?: boolean;
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.teamList(),
    queryFn: () => getTeams(params),
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useTeam(id: string) {
  return useQuery({
    queryKey: collaborationKeys.teamDetail(id),
    queryFn: () => getTeam(id),
    enabled: !!id,
  });
}

export function useMyTeams() {
  return useQuery({
    queryKey: collaborationKeys.myTeams(),
    queryFn: () => getMyTeams(),
    staleTime: 60 * 1000,
  });
}

// ============================================
// Verification Hooks
// ============================================

export function useVerificationQueue(params?: {
  status?: VerificationStatus;
  item_type?: VerifiableType;
  priority?: string;
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.verificationQueue(params || {}),
    queryFn: () => getVerificationQueue(params),
    staleTime: 15 * 1000, // 15 seconds - queue changes frequently
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds
  });
}

export function useMyVerificationRequests(params?: {
  status?: VerificationStatus;
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.myRequests(params || {}),
    queryFn: () => getMyVerificationRequests(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateVerificationRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateVerificationRequest) => createVerificationRequest(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.verification });
    },
  });
}

export function useCastVote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, vote }: { requestId: string; vote: CastVoteRequest }) =>
      castVote(requestId, vote),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.verification });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.votes(variables.requestId) });
    },
  });
}

export function useVerificationVotes(requestId: string) {
  return useQuery({
    queryKey: collaborationKeys.votes(requestId),
    queryFn: () => getVotes(requestId),
    enabled: !!requestId,
  });
}

// ============================================
// Watchlists Hooks
// ============================================

export function useWatchlists(scope?: WatchlistScope) {
  return useQuery({
    queryKey: collaborationKeys.watchlistList(scope),
    queryFn: () => getWatchlists({ scope }),
    staleTime: 60 * 1000,
  });
}

export function useWatchlistItems(watchlistId: string) {
  return useQuery({
    queryKey: collaborationKeys.watchlistItems(watchlistId),
    queryFn: () => getWatchlistItems(watchlistId),
    enabled: !!watchlistId,
    staleTime: 30 * 1000,
  });
}

export function useCreateWatchlistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, item }: {
      watchlistId: string;
      item: { item_type: WatchableType; value: string; aliases?: string[]; notes?: string };
    }) => createWatchlistItem(watchlistId, item),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.watchlistItems(variables.watchlistId) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.watchlists });
    },
  });
}

// ============================================
// Activity Hooks
// ============================================

export function useActivityFeed(params?: {
  team_id?: string;
  activity_type?: string;
  target_type?: string;
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.activityFeed(params || {}),
    queryFn: () => getActivityFeed(params),
    staleTime: 10 * 1000, // 10 seconds - activity is real-time
    refetchInterval: 15 * 1000, // Auto-refresh every 15 seconds
  });
}

export function useMentions(unreadOnly: boolean = false) {
  return useQuery({
    queryKey: collaborationKeys.mentions(unreadOnly),
    queryFn: () => getMentions({ unread_only: unreadOnly }),
    staleTime: 15 * 1000,
  });
}

export function useMyMetrics() {
  return useQuery({
    queryKey: collaborationKeys.myMetrics(),
    queryFn: () => getMyMetrics(),
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useLeaderboard(sortBy: 'reputation' | 'accuracy' | 'cases' = 'reputation', limit: number = 10) {
  return useQuery({
    queryKey: collaborationKeys.leaderboard(sortBy),
    queryFn: () => getLeaderboard({ sort_by: sortBy, limit }),
    staleTime: 5 * 60 * 1000, // 5 minutes - leaderboard doesn't change rapidly
  });
}

export function useAnalystMetrics(userId: string) {
  return useQuery({
    queryKey: collaborationKeys.analystMetrics(userId),
    queryFn: () => getAnalystMetrics(userId),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

// ============================================
// Notes Hooks
// ============================================

export function useNotes(params?: {
  category?: NoteCategory;
  case_id?: string;
  pinned_only?: boolean;
  include_archived?: boolean;
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.noteList(params || {}),
    queryFn: () => getNotes(params),
    staleTime: 30 * 1000,
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: collaborationKeys.noteDetail(id),
    queryFn: () => getNote(id),
    enabled: !!id,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateNoteRequest) => createNote(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.notes });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...request }: { id: string } & Partial<CreateNoteRequest>) =>
      updateNote(id, request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.noteDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.notes });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.notes });
    },
  });
}

export function useTogglePinNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => togglePinNote(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.noteDetail(id) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.notes });
    },
  });
}

// ============================================
// Source Reliability Hooks
// ============================================

export function useSources(params?: {
  source_type?: string;
  min_confidence?: number;
  sort_by?: 'confidence' | 'name' | 'stories';
  skip?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: collaborationKeys.sourceList(params || {}),
    queryFn: () => getSources(params),
    staleTime: 60 * 1000,
  });
}

export function useSource(sourceId: string) {
  return useQuery({
    queryKey: collaborationKeys.sourceDetail(sourceId),
    queryFn: () => getSource(sourceId),
    enabled: !!sourceId,
  });
}

export function useSourceStats() {
  return useQuery({
    queryKey: collaborationKeys.sourceStats(),
    queryFn: () => getSourceStats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useRateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, rating }: { sourceId: string; rating: SourceRatingRequest }) =>
      rateSource(sourceId, rating),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.sourceDetail(variables.sourceId) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.sources });
    },
  });
}

// ============================================
// Case Evidence Hooks
// ============================================

export function useCaseEvidence(caseId: string) {
  return useQuery({
    queryKey: collaborationKeys.caseEvidence(caseId),
    queryFn: () => getCaseEvidence(caseId),
    enabled: !!caseId && !caseId.startsWith('demo-'),
    staleTime: 30 * 1000,
  });
}

export function useAddEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, evidence }: { caseId: string; evidence: CreateEvidenceRequest }) =>
      addCaseEvidence(caseId, evidence),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseEvidence(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseDetail(variables.caseId) });
    },
  });
}

export function useUpdateEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, evidenceId, updates }: { caseId: string; evidenceId: string; updates: Partial<CreateEvidenceRequest> }) =>
      updateCaseEvidence(caseId, evidenceId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseEvidence(variables.caseId) });
    },
  });
}

export function useRemoveEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, evidenceId }: { caseId: string; evidenceId: string }) =>
      removeCaseEvidence(caseId, evidenceId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseEvidence(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseDetail(variables.caseId) });
    },
  });
}

// ============================================
// Case Comments Hooks
// ============================================

export function useCaseComments(caseId: string) {
  return useQuery({
    queryKey: collaborationKeys.caseComments(caseId),
    queryFn: () => getCaseComments(caseId),
    enabled: !!caseId && !caseId.startsWith('demo-'),
    staleTime: 15 * 1000, // Comments change frequently
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, comment }: { caseId: string; comment: CreateCommentRequest }) =>
      addCaseComment(caseId, comment),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseComments(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity }); // Comment adds activity
    },
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, commentId, content }: { caseId: string; commentId: string; content: string }) =>
      updateCaseComment(caseId, commentId, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseComments(variables.caseId) });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, commentId }: { caseId: string; commentId: string }) =>
      deleteCaseComment(caseId, commentId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.caseComments(variables.caseId) });
    },
  });
}
