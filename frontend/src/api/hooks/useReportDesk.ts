import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  generateAutonomousCorePapers,
  getAutonomousCorePapersSummary,
  listAutonomousCorePapers,
  listCases as listCollaborationCases,
} from '../connectedAnalyst';
import { reportsApi } from '../geospatial';
import type { ReportDeskItem, ReportDeskKpis } from '../../types/reportDesk';

export type ReportDeskTypeFilter =
  | 'political'
  | 'security'
  | 'damage'
  | 'case_summary'
  | 'situational'
  | 'threat_matrix'
  | 'network_analysis';

export interface ReportDeskFilters {
  windowHours: number;
  includeAutonomousPapers: boolean;
  includeReportJobs: boolean;
  includeCaseSummaries: boolean;
  statuses: string[];
  reportTypes: ReportDeskTypeFilter[];
}

const reportDeskKeys = {
  all: ['report-desk'] as const,
  autonomous: (createdAfter?: string) => [...reportDeskKeys.all, 'autonomous', createdAfter] as const,
  autonomousSummary: (createdAfter?: string) => [...reportDeskKeys.all, 'autonomous-summary', createdAfter] as const,
  reportJobs: () => [...reportDeskKeys.all, 'report-jobs'] as const,
  cases: () => [...reportDeskKeys.all, 'cases'] as const,
};

function toWindowStartIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function itemTimestamp(item: ReportDeskItem): number {
  if (!item.created_at) return 0;
  return new Date(item.created_at).getTime();
}

function autonomousReportTypeToFilter(reportType: string): ReportDeskTypeFilter {
  if (reportType === 'political_developments') return 'political';
  if (reportType === 'security_developments') return 'security';
  if (reportType === 'singha_durbar_damage_assessment') return 'damage';
  return 'case_summary';
}

function itemToFilterType(item: ReportDeskItem): ReportDeskTypeFilter {
  if (item.source === 'autonomous_paper') {
    return autonomousReportTypeToFilter(item.payload.report_type);
  }
  if (item.source === 'report_job') {
    const t = item.payload.report_type;
    if (t === 'threat_matrix') return 'threat_matrix';
    if (t === 'network_analysis') return 'network_analysis';
    if (t === 'situational') return 'situational';
    if (t === 'case_summary') return 'case_summary';
    if (t === 'damage_assessment') return 'damage';
    return 'situational';
  }
  return 'case_summary';
}

export function useReportDeskData(filters: ReportDeskFilters) {
  const createdAfter = toWindowStartIso(filters.windowHours);
  const statusSet = useMemo(() => new Set(filters.statuses), [filters.statuses]);
  const typeSet = useMemo(() => new Set(filters.reportTypes), [filters.reportTypes]);

  const autonomousQuery = useQuery({
    queryKey: reportDeskKeys.autonomous(createdAfter),
    queryFn: () =>
      listAutonomousCorePapers({
        limit: 200,
        offset: 0,
        created_after: createdAfter,
        generated_by_me: false,
      }),
    enabled: filters.includeAutonomousPapers,
    staleTime: 30_000,
  });

  const autonomousSummaryQuery = useQuery({
    queryKey: reportDeskKeys.autonomousSummary(createdAfter),
    queryFn: () =>
      getAutonomousCorePapersSummary({
        created_after: createdAfter,
        generated_by_me: false,
      }),
    enabled: filters.includeAutonomousPapers,
    staleTime: 30_000,
  });

  const reportJobsQuery = useQuery({
    queryKey: reportDeskKeys.reportJobs(),
    queryFn: () => reportsApi.list(undefined, undefined, 200),
    enabled: filters.includeReportJobs,
    staleTime: 15_000,
  });

  const casesQuery = useQuery({
    queryKey: reportDeskKeys.cases(),
    // Backend /cases endpoint currently caps limit at 100 (le=100).
    queryFn: () => listCollaborationCases(100),
    enabled: filters.includeCaseSummaries,
    staleTime: 30_000,
  });

  const items = useMemo<ReportDeskItem[]>(() => {
    const windowStart = Date.now() - filters.windowHours * 60 * 60 * 1000;
    const merged: ReportDeskItem[] = [];

    if (filters.includeAutonomousPapers) {
      for (const paper of autonomousQuery.data?.items ?? []) {
        merged.push({
          id: `autonomous:${paper.id}`,
          source: 'autonomous_paper',
          created_at: paper.created_at ?? null,
          status: paper.status as ReportDeskItem['status'],
          payload: paper,
        });
      }
    }

    if (filters.includeReportJobs) {
      for (const job of reportJobsQuery.data?.reports ?? []) {
        merged.push({
          id: `job:${job.id}`,
          source: 'report_job',
          created_at: job.created_at ?? null,
          status: job.status as ReportDeskItem['status'],
          payload: job,
        });
      }
    }

    if (filters.includeCaseSummaries) {
      for (const item of casesQuery.data ?? []) {
        merged.push({
          id: `case:${item.id}`,
          source: 'case_summary',
          created_at: item.created_at ?? null,
          status: item.status as ReportDeskItem['status'],
          payload: item,
        });
      }
    }

    return merged
      .filter((item) => {
        const ts = itemTimestamp(item);
        return ts >= windowStart;
      })
      .filter((item) => (statusSet.size > 0 ? statusSet.has(item.status) : true))
      .filter((item) => (typeSet.size > 0 ? typeSet.has(itemToFilterType(item)) : true))
      .sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
  }, [
    filters.windowHours,
    filters.includeAutonomousPapers,
    filters.includeReportJobs,
    filters.includeCaseSummaries,
    autonomousQuery.data,
    reportJobsQuery.data,
    casesQuery.data,
    statusSet,
    typeSet,
  ]);

  const kpis = useMemo<ReportDeskKpis>(() => {
    const reportCount = items.filter((i) => i.source === 'autonomous_paper' || i.source === 'report_job').length;
    const pendingOrFailed = items.filter(
      (i) =>
        i.source === 'report_job' &&
        (i.status === 'queued' || i.status === 'processing' || i.status === 'failed'),
    ).length;
    const activeCases = items.filter(
      (i) => i.source === 'case_summary' && i.status === 'active',
    ).length;
    const completedJobs = items.filter(
      (i) => i.source === 'report_job' && i.status === 'completed',
    ).length;

    return {
      reports_generated: reportCount,
      pending_or_failed_jobs: pendingOrFailed,
      active_cases: activeCases,
      throughput_proxy: completedJobs + activeCases,
    };
  }, [items]);

  return {
    items,
    kpis,
    autonomousSummary: autonomousSummaryQuery.data ?? null,
    isLoading:
      autonomousQuery.isLoading ||
      reportJobsQuery.isLoading ||
      casesQuery.isLoading ||
      autonomousSummaryQuery.isLoading,
    isFetching:
      autonomousQuery.isFetching ||
      reportJobsQuery.isFetching ||
      casesQuery.isFetching ||
      autonomousSummaryQuery.isFetching,
    error:
      autonomousQuery.error ||
      reportJobsQuery.error ||
      casesQuery.error ||
      autonomousSummaryQuery.error,
  };
}

export function useReportDeskActions() {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: reportDeskKeys.all });
  };

  const generateAutonomous = useMutation({
    mutationFn: (hours: number) =>
      generateAutonomousCorePapers({
        hours,
        use_llm: true,
      }),
    onSuccess: invalidate,
  });

  const generateThreatMatrixJob = useMutation({
    mutationFn: () =>
      reportsApi.generate({
        report_type: 'threat_matrix',
        format: 'json',
        include_summary: true,
        include_entities: true,
        include_stories: true,
        title: `Threat Matrix ${new Date().toISOString().slice(0, 16)}`,
      }),
    onSuccess: invalidate,
  });

  const generateEntityListJob = useMutation({
    mutationFn: () =>
      reportsApi.generate({
        report_type: 'entity_dossier',
        format: 'json',
        include_summary: true,
        include_entities: true,
        include_stories: false,
        title: `Quick Entity List ${new Date().toISOString().slice(0, 16)}`,
      }),
    onSuccess: invalidate,
  });

  return {
    generateAutonomous,
    generateThreatMatrixJob,
    generateEntityListJob,
    refreshAll: invalidate,
  };
}
