"""KPI computation service - Palantir-grade metrics engine."""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.kpi_repository import KPIRepository
from app.schemas.kpi import (
    KPISnapshot,
    ActiveAlertsKPI,
    EventsKPI,
    ThreatLevelKPI,
    DistrictsKPI,
    SourceCoverageKPI,
    TrendVelocityKPI,
    CasualtiesKPI,
    EntityMention,
    AlertDetail,
    HourlyTrend,
)

logger = logging.getLogger(__name__)


class KPIService:
    """Palantir-grade KPI computation engine."""

    # Severity weights for threat scoring
    SEVERITY_WEIGHTS = {
        "critical": 4,
        "high": 3,
        "medium": 2,
        "low": 1,
    }

    # Threat level thresholds (normalized 0-100)
    THREAT_THRESHOLDS = {
        "CRITICAL": 75,
        "ELEVATED": 50,
        "GUARDED": 25,
        "LOW": 0,
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = KPIRepository(db)

    async def compute_all_kpis(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> KPISnapshot:
        """
        Compute all KPIs in a single snapshot.

        This is the main entry point for KPI computation.
        Returns a complete KPISnapshot with all metrics.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        district_desc = f", districts={districts}" if districts else ""
        logger.info(f"Computing KPI snapshot for {hours}h window{district_desc}")
        start_time = datetime.now(timezone.utc)

        # Compute all KPIs (passing districts filter)
        active_alerts = await self.get_active_alerts(districts=districts)
        events_today = await self.get_events_count(hours, districts=districts)
        threat_level = await self.compute_threat_level(hours, districts=districts)
        districts_affected = await self.get_districts_affected(hours, districts=districts)
        source_coverage = await self.get_source_coverage()
        trend_velocity = await self.get_trend_velocity(districts=districts)

        # Secondary KPIs (passing districts filter)
        critical_events = await self.repo.get_critical_events_count(hours, districts)
        casualties_data = await self.repo.get_casualties_summary(hours, districts)
        casualties_24h = CasualtiesKPI(
            deaths=casualties_data["deaths"],
            injured=casualties_data["injured"],
            missing=casualties_data["missing"],
            affected_families=casualties_data["affected_families"],
        )
        economic_impact = casualties_data["economic_impact"]

        # Entity mentions (placeholder - would need NER integration)
        top_entities: list[EntityMention] = []

        # Calculate data freshness
        freshness_seconds = int(
            (datetime.now(timezone.utc) - start_time).total_seconds()
        )

        snapshot = KPISnapshot(
            timestamp=datetime.now(timezone.utc),
            data_freshness_seconds=freshness_seconds,
            time_window_hours=hours,
            active_alerts=active_alerts,
            events_today=events_today,
            threat_level=threat_level,
            districts_affected=districts_affected,
            source_coverage=source_coverage,
            trend_velocity=trend_velocity,
            critical_events=critical_events,
            casualties_24h=casualties_24h,
            economic_impact_npr=economic_impact,
            top_entities=top_entities,
        )

        logger.info(
            f"KPI snapshot computed: {events_today.total} events, "
            f"threat={threat_level.level}, alerts={active_alerts.count}"
        )

        return snapshot

    async def get_active_alerts(
        self, hours: int = 6, districts: Optional[List[str]] = None
    ) -> ActiveAlertsKPI:
        """
        Get active alerts requiring immediate attention.

        Alerts are defined as:
        - Stories with CRITICAL or HIGH severity in last 6 hours
        - Disasters with deaths > 0 or estimated_loss > 25 lakhs

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        data = await self.repo.get_active_alerts_data(hours, districts or [])

        return ActiveAlertsKPI(
            count=data["count"],
            by_category=data["by_category"],
            by_severity=data["by_severity"],
            oldest_unresolved_hours=data["oldest_unresolved_hours"],
            requires_attention=data["requires_attention"],
        )

    async def get_events_count(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> EventsKPI:
        """
        Get unique event counts.

        Events are deduplicated by:
        - Counting clusters as single events (not individual stories)
        - Adding unclustered stories
        - Adding disaster incidents

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        data = await self.repo.get_events_summary(hours, districts or [])

        return EventsKPI(
            total=data["total"],
            clustered=data["clustered"],
            unclustered=data["unclustered"],
            disaster_incidents=data["disaster_incidents"],
            change_vs_yesterday=data["change_vs_yesterday"],
            trend=data["trend"],
        )

    async def compute_threat_level(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> ThreatLevelKPI:
        """
        Compute composite threat assessment.

        Formula:
        - Score = (critical×4 + high×3 + medium×2 + low×1) / max_possible
        - Normalized to 0-100 scale
        - Trajectory based on comparison with previous period

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        data = await self.repo.get_threat_score_data(hours, districts or [])

        # Calculate current period score
        current_severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        category_scores: dict[str, float] = {}

        for item in data["current"]:
            sev = item["severity"] or "low"
            current_severity_counts[sev] = (
                current_severity_counts.get(sev, 0) + item["count"]
            )

            # Track by category
            cat = item["category"] or "other"
            cat_score = self.SEVERITY_WEIGHTS.get(sev, 1) * item["count"]
            category_scores[cat] = category_scores.get(cat, 0) + cat_score

        # Add disaster severity counts
        for item in data["disasters"]:
            sev = item["severity"] or "medium"
            current_severity_counts[sev] = (
                current_severity_counts.get(sev, 0) + item["count"]
            )
            cat_score = self.SEVERITY_WEIGHTS.get(sev, 1) * item["count"]
            category_scores["disaster"] = category_scores.get("disaster", 0) + cat_score

        # Calculate weighted score
        total_events = sum(current_severity_counts.values())
        if total_events == 0:
            return ThreatLevelKPI(
                level="LOW",
                score=0.0,
                trajectory="STABLE",
                primary_driver="",
                confidence=0.0,
            )

        weighted_score = sum(
            self.SEVERITY_WEIGHTS.get(sev, 1) * count
            for sev, count in current_severity_counts.items()
        )

        # Normalize to 0-100
        # Max possible would be if all events were CRITICAL (weight 4)
        max_possible = total_events * 4
        normalized_score = (weighted_score / max_possible) * 100 if max_possible > 0 else 0

        # Determine threat level
        if normalized_score >= self.THREAT_THRESHOLDS["CRITICAL"]:
            level = "CRITICAL"
        elif normalized_score >= self.THREAT_THRESHOLDS["ELEVATED"]:
            level = "ELEVATED"
        elif normalized_score >= self.THREAT_THRESHOLDS["GUARDED"]:
            level = "GUARDED"
        else:
            level = "LOW"

        # Calculate trajectory by comparing with previous period
        prev_severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for item in data["previous"]:
            sev = item["severity"] or "low"
            prev_severity_counts[sev] = prev_severity_counts.get(sev, 0) + item["count"]

        prev_total = sum(prev_severity_counts.values())
        prev_weighted = sum(
            self.SEVERITY_WEIGHTS.get(sev, 1) * count
            for sev, count in prev_severity_counts.items()
        )
        prev_score = (prev_weighted / (prev_total * 4) * 100) if prev_total > 0 else 0

        trajectory = "STABLE"
        if normalized_score > prev_score + 10:
            trajectory = "ESCALATING"
        elif normalized_score < prev_score - 10:
            trajectory = "DE-ESCALATING"

        # Find primary driver (category with highest score)
        primary_driver = ""
        if category_scores:
            primary_driver = max(category_scores, key=category_scores.get)

        # Confidence based on data volume
        # More events = higher confidence (up to ~50 events = 1.0)
        confidence = min(1.0, total_events / 50)

        return ThreatLevelKPI(
            level=level,
            score=round(normalized_score, 1),
            trajectory=trajectory,
            primary_driver=primary_driver,
            confidence=round(confidence, 2),
        )

    async def get_districts_affected(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> DistrictsKPI:
        """
        Get geographic spread of events.

        Currently uses disaster incidents for district data.
        Future: Extract districts from story content using NER.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        data = await self.repo.get_district_spread(hours, districts or [])

        return DistrictsKPI(
            affected_count=data["affected_count"],
            total_districts=data["total_districts"],
            affected_percentage=data["affected_percentage"],
            by_province=data["by_province"],
            hotspots=data["hotspots"],
        )

    async def get_source_coverage(self) -> SourceCoverageKPI:
        """
        Get data pipeline health metrics.

        Monitors which sources are actively delivering data (last 24h).
        """
        data = await self.repo.get_source_coverage(hours=24)

        return SourceCoverageKPI(
            active_sources=data["active_sources"],
            total_sources=data["total_sources"],
            coverage_percentage=data["coverage_percentage"],
            last_fetch_seconds_ago=data["last_fetch_seconds_ago"],
            stale_sources=data["stale_sources"],
        )

    async def get_trend_velocity(
        self, districts: Optional[List[str]] = None
    ) -> TrendVelocityKPI:
        """
        Get rate of change metrics.

        Compares current hour vs previous hour.
        Detects anomalies (>2 std dev from normal).

        Args:
            districts: Optional list of district names to filter by
        """
        data = await self.repo.get_velocity_data(districts or [])

        return TrendVelocityKPI(
            events_this_hour=data["events_this_hour"],
            events_prev_hour=data["events_prev_hour"],
            change_percentage=data["change_percentage"],
            direction=data["direction"],
            anomaly_detected=data["anomaly_detected"],
        )

    async def get_hourly_trends(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> list[HourlyTrend]:
        """
        Get hourly breakdown for sparkline visualization.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        data = await self.repo.get_hourly_trend(hours, districts or [])

        return [
            HourlyTrend(
                hour=item["hour"],
                count=item["count"],
                category_breakdown=item["category_breakdown"],
            )
            for item in data
        ]

    async def get_alert_details(
        self,
        severity: str = "critical,high",
        limit: int = 20,
        hours: int = 6,
        districts: Optional[List[str]] = None,
    ) -> list[AlertDetail]:
        """
        Get detailed alert list for drill-down view.

        Args:
            severity: Comma-separated severity filter
            limit: Max alerts to return
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        severity_list = [s.strip().lower() for s in severity.split(",")]
        data = await self.repo.get_alert_details(
            severity_list, hours, limit, districts or []
        )

        return [
            AlertDetail(
                id=item["id"],
                title=item["title"],
                category=item["category"],
                severity=item["severity"],
                source=item["source"],
                district=item["district"],
                timestamp=item["timestamp"],
                url=item["url"],
                summary=item["summary"],
                deaths=item["deaths"],
                injured=item["injured"],
                estimated_loss=item["estimated_loss"],
            )
            for item in data
        ]
