import type { Case } from '../api/collaboration';
import type { ReportMetadata } from '../api/geospatial';
import type { AutonomousCorePaperListItem } from '../api/connectedAnalyst';

export type ReportDeskSource = 'autonomous_paper' | 'report_job' | 'case_summary';

export type ReportDeskStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'draft'
  | 'active'
  | 'review'
  | 'closed'
  | 'archived';

export interface ReportDeskItemBase {
  id: string;
  source: ReportDeskSource;
  created_at: string | null;
  status: ReportDeskStatus;
}

export interface AutonomousPaperDeskItem extends ReportDeskItemBase {
  source: 'autonomous_paper';
  payload: AutonomousCorePaperListItem;
}

export interface ReportJobDeskItem extends ReportDeskItemBase {
  source: 'report_job';
  payload: ReportMetadata;
}

export interface CaseSummaryDeskItem extends ReportDeskItemBase {
  source: 'case_summary';
  payload: Case;
}

export type ReportDeskItem =
  | AutonomousPaperDeskItem
  | ReportJobDeskItem
  | CaseSummaryDeskItem;

export interface ReportDeskKpis {
  reports_generated: number;
  pending_or_failed_jobs: number;
  active_cases: number;
  throughput_proxy: number;
}
