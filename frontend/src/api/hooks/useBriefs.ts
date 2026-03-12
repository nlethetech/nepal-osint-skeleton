/**
 * React Query hooks for Situation Briefs (Narada Analyst Agent).
 */
import { useQuery } from '@tanstack/react-query';
import {
  getLatestBrief,
  getBriefById,
  getBriefHistory,
  getFakeNewsFlags,
  getProvinceSitrep,
} from '../briefs';
import type { BriefDetail, BriefSummary, FakeNewsFlag, ProvinceSitrep } from '../briefs';

export const briefKeys = {
  all: ['briefs'] as const,
  latest: () => [...briefKeys.all, 'latest'] as const,
  detail: (id: string) => [...briefKeys.all, 'detail', id] as const,
  history: (limit: number) => [...briefKeys.all, 'history', limit] as const,
  flags: (limit: number) => [...briefKeys.all, 'flags', limit] as const,
  province: (id: number) => [...briefKeys.all, 'province', id] as const,
};

/** Latest completed situation brief with full detail. Polls every 3 minutes. */
export function useLatestBrief() {
  return useQuery<BriefDetail | null>({
    queryKey: briefKeys.latest(),
    queryFn: getLatestBrief,
    staleTime: 60 * 1000,           // 1 minute
    refetchInterval: 3 * 60 * 1000, // 3 minutes (matches agent run interval)
  });
}

/** A specific brief by ID. */
export function useBriefById(briefId: string | null) {
  return useQuery<BriefDetail | null>({
    queryKey: briefKeys.detail(briefId || ''),
    queryFn: () => getBriefById(briefId!),
    enabled: !!briefId,
    staleTime: Infinity, // Historical briefs don't change
  });
}

/** Brief history list. */
export function useBriefHistory(limit = 10) {
  return useQuery<BriefSummary[]>({
    queryKey: briefKeys.history(limit),
    queryFn: () => getBriefHistory(limit),
    staleTime: 5 * 60 * 1000,
  });
}

/** Recent fake news flags. */
export function useFakeNewsFlags(limit = 20) {
  return useQuery<FakeNewsFlag[]>({
    queryKey: briefKeys.flags(limit),
    queryFn: () => getFakeNewsFlags(limit),
    staleTime: 60 * 1000,
  });
}

/** Latest SITREP for a specific province. */
export function useProvinceSitrep(provinceId: number) {
  return useQuery<ProvinceSitrep | null>({
    queryKey: briefKeys.province(provinceId),
    queryFn: () => getProvinceSitrep(provinceId),
    staleTime: 3 * 60 * 1000,
    enabled: provinceId >= 0 && provinceId <= 7,
  });
}
