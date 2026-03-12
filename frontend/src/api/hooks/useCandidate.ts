/**
 * useCandidate - React Query hooks for Candidate Dossier
 *
 * Provides data fetching for candidate intelligence pages.
 */
import { useQuery } from '@tanstack/react-query'
import {
  getCandidateDossier,
  getCandidateStories,
  findCandidateKBEntity,
  type CandidateDossierResponse,
  type CandidateStoriesResponse,
  type KBEntityMatch,
} from '../elections'

// Query keys for cache management
export const candidateKeys = {
  all: ['candidates'] as const,
  dossier: (id: string) => [...candidateKeys.all, 'dossier', id] as const,
  stories: (id: string, hours: number, category?: string) =>
    [...candidateKeys.all, 'stories', id, hours, category] as const,
  kbMatch: (name: string, nameNe?: string) =>
    [...candidateKeys.all, 'kb-match', name, nameNe] as const,
}

/**
 * Hook to fetch full candidate dossier.
 * Includes KB entity match, rivals, previous runs, and story count.
 */
export function useCandidateDossier(candidateId: string | undefined) {
  return useQuery<CandidateDossierResponse>({
    queryKey: candidateKeys.dossier(candidateId || ''),
    queryFn: () => getCandidateDossier(candidateId!),
    enabled: !!candidateId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  })
}

/**
 * Hook to fetch stories mentioning a candidate.
 * Uses KB entity matching to find related stories.
 */
export function useCandidateStories(
  candidateId: string | undefined,
  hours: number = 720,
  limit: number = 50,
  category?: string
) {
  return useQuery<CandidateStoriesResponse>({
    queryKey: candidateKeys.stories(candidateId || '', hours, category),
    queryFn: () => getCandidateStories(candidateId!, hours, limit, category),
    enabled: !!candidateId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  })
}

/**
 * Hook to find KB entity match for a candidate name.
 * Useful for checking if candidate is linked to entity KB.
 */
export function useKBEntityMatch(
  nameEn: string | undefined,
  nameNe?: string,
  party?: string
) {
  return useQuery<KBEntityMatch | null>({
    queryKey: candidateKeys.kbMatch(nameEn || '', nameNe),
    queryFn: () => findCandidateKBEntity(nameEn!, nameNe, party),
    enabled: !!nameEn,
    staleTime: 30 * 60 * 1000, // 30 minutes (entity matches don't change often)
    retry: 1,
  })
}
