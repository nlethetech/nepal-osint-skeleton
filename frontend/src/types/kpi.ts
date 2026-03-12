// KPI Types for Palantir-grade Dashboard Metrics

export interface ActiveAlertsKPI {
  count: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
  oldest_unresolved_hours: number;
  requires_attention: boolean;
}

export interface EventsKPI {
  total: number;
  clustered: number;
  unclustered: number;
  disaster_incidents: number;
  change_vs_yesterday: number;
  trend: 'INCREASING' | 'STABLE' | 'DECREASING';
}

export interface ThreatLevelKPI {
  level: 'CRITICAL' | 'ELEVATED' | 'GUARDED' | 'LOW';
  score: number;
  trajectory: 'ESCALATING' | 'STABLE' | 'DE-ESCALATING';
  primary_driver: string;
  confidence: number;
}

export interface DistrictsKPI {
  affected_count: number;
  total_districts: number;
  affected_percentage: number;
  by_province: Record<string, number>;
  hotspots: string[];
}

export interface SourceCoverageKPI {
  active_sources: number;
  total_sources: number;
  coverage_percentage: number;
  last_fetch_seconds_ago: number;
  stale_sources: string[];
}

export interface TrendVelocityKPI {
  events_this_hour: number;
  events_prev_hour: number;
  change_percentage: number;
  direction: 'UP' | 'DOWN' | 'STABLE';
  anomaly_detected: boolean;
}

export interface CasualtiesKPI {
  deaths: number;
  injured: number;
  missing: number;
  affected_families: number;
}

export interface EntityMention {
  name: string;
  mention_count: number;
  category: string;
}

export interface KPISnapshot {
  timestamp: string;
  data_freshness_seconds: number;
  time_window_hours: number;

  // Primary KPIs
  active_alerts: ActiveAlertsKPI;
  events_today: EventsKPI;
  threat_level: ThreatLevelKPI;
  districts_affected: DistrictsKPI;
  source_coverage: SourceCoverageKPI;
  trend_velocity: TrendVelocityKPI;

  // Secondary KPIs
  critical_events: number;
  casualties_24h: CasualtiesKPI;
  economic_impact_npr: number;
  top_entities: EntityMention[];
}

export interface AlertDetail {
  id: string;
  title: string;
  category: string;
  severity: string;
  source: string;
  district?: string;
  timestamp: string;
  url?: string;
  summary?: string;
  deaths?: number;
  injured?: number;
  estimated_loss?: number;
}

export interface HourlyTrend {
  hour: string;
  count: number;
  category_breakdown: Record<string, number>;
}
