"""KPI Pydantic schemas for Palantir-grade dashboard metrics."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ActiveAlertsKPI(BaseModel):
    """Active alerts requiring immediate attention."""

    count: int = Field(description="Total active alerts (CRITICAL + HIGH severity in last 6h)")
    by_category: dict[str, int] = Field(
        default_factory=dict,
        description="Alert count by category (DISASTER, SECURITY, etc.)",
    )
    by_severity: dict[str, int] = Field(
        default_factory=dict,
        description="Alert count by severity (CRITICAL, HIGH)",
    )
    oldest_unresolved_hours: float = Field(
        default=0.0,
        description="Age of oldest unresolved alert in hours",
    )
    requires_attention: bool = Field(
        default=False,
        description="True if any CRITICAL alerts exist",
    )


class EventsKPI(BaseModel):
    """Event counts for the time window."""

    total: int = Field(description="Total unique events (deduplicated)")
    clustered: int = Field(default=0, description="Events that are part of clusters")
    unclustered: int = Field(default=0, description="Standalone events")
    disaster_incidents: int = Field(default=0, description="BIPAD disaster incidents")
    change_vs_yesterday: float = Field(
        default=0.0,
        description="Percentage change vs previous day",
    )
    trend: str = Field(
        default="STABLE",
        description="INCREASING | STABLE | DECREASING",
    )


class ThreatLevelKPI(BaseModel):
    """Composite threat assessment."""

    level: str = Field(description="CRITICAL | ELEVATED | GUARDED | LOW")
    score: float = Field(
        ge=0,
        le=100,
        description="Normalized threat score 0-100",
    )
    trajectory: str = Field(
        default="STABLE",
        description="ESCALATING | STABLE | DE-ESCALATING",
    )
    primary_driver: str = Field(
        default="",
        description="Category causing highest score",
    )
    confidence: float = Field(
        ge=0,
        le=1,
        default=1.0,
        description="Confidence based on data volume (0-1)",
    )


class DistrictsKPI(BaseModel):
    """Geographic spread metrics."""

    affected_count: int = Field(description="Number of districts with activity")
    total_districts: int = Field(default=77, description="Total districts in Nepal")
    affected_percentage: float = Field(description="Percentage of districts affected")
    by_province: dict[str, int] = Field(
        default_factory=dict,
        description="Affected districts by province",
    )
    hotspots: list[str] = Field(
        default_factory=list,
        description="Top 3 districts by event count",
    )


class SourceCoverageKPI(BaseModel):
    """Data pipeline health metrics."""

    active_sources: int = Field(description="Sources with data in last hour")
    total_sources: int = Field(description="Total configured sources")
    coverage_percentage: float = Field(description="Active/Total percentage")
    last_fetch_seconds_ago: int = Field(
        default=0,
        description="Seconds since last successful fetch",
    )
    stale_sources: list[str] = Field(
        default_factory=list,
        description="Sources with no data > 1 hour",
    )


class TrendVelocityKPI(BaseModel):
    """Rate of change metrics."""

    events_this_hour: int = Field(description="Events in current hour")
    events_prev_hour: int = Field(description="Events in previous hour")
    change_percentage: float = Field(description="Hour-over-hour change %")
    direction: str = Field(default="STABLE", description="UP | DOWN | STABLE")
    anomaly_detected: bool = Field(
        default=False,
        description="True if >2 std dev from normal",
    )


class CasualtiesKPI(BaseModel):
    """Casualty metrics from disasters."""

    deaths: int = Field(default=0)
    injured: int = Field(default=0)
    missing: int = Field(default=0)
    affected_families: int = Field(default=0)


class EntityMention(BaseModel):
    """Top entity mention."""

    name: str
    mention_count: int
    category: str = Field(default="UNKNOWN", description="PERSON | ORGANIZATION | LOCATION")


class KPISnapshot(BaseModel):
    """Complete KPI state at a point in time."""

    timestamp: datetime = Field(description="When this snapshot was computed")
    data_freshness_seconds: int = Field(
        description="Age of underlying data in seconds",
    )
    time_window_hours: int = Field(description="Time window for KPI computation")

    # Primary KPIs
    active_alerts: ActiveAlertsKPI
    events_today: EventsKPI
    threat_level: ThreatLevelKPI
    districts_affected: DistrictsKPI
    source_coverage: SourceCoverageKPI
    trend_velocity: TrendVelocityKPI

    # Secondary KPIs
    critical_events: int = Field(default=0, description="CRITICAL severity events only")
    casualties_24h: CasualtiesKPI = Field(default_factory=CasualtiesKPI)
    economic_impact_npr: float = Field(
        default=0.0,
        description="Sum of estimated_loss from disasters",
    )
    top_entities: list[EntityMention] = Field(
        default_factory=list,
        description="Top mentioned entities",
    )


class AlertDetail(BaseModel):
    """Detailed alert for drill-down view."""

    id: UUID
    title: str
    category: str
    severity: str
    source: str
    district: Optional[str] = None
    timestamp: datetime
    url: Optional[str] = None
    summary: Optional[str] = None

    # For disasters
    deaths: Optional[int] = None
    injured: Optional[int] = None
    estimated_loss: Optional[float] = None


class HourlyTrend(BaseModel):
    """Hourly event count for sparkline."""

    hour: datetime
    count: int
    category_breakdown: dict[str, int] = Field(default_factory=dict)
