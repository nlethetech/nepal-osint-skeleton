"""KPI repository for optimized database queries."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from sqlalchemy import select, func, and_, or_, text, case, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.disaster import DisasterIncident, DisasterAlert

logger = logging.getLogger(__name__)


class KPIRepository:
    """Optimized queries for KPI computation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _build_story_district_filter(self, districts: List[str]):
        """
        Build a filter condition for stories by district.

        Checks both the story.districts JSONB array field and falls back to title matching.
        Returns None if no districts are specified.
        """
        if not districts:
            return None

        # Convert to lowercase for case-insensitive matching
        districts_lower = [d.lower() for d in districts]

        # Build OR condition: any district in story.districts OR title contains district
        conditions = []
        for district in districts_lower:
            # Check if district is in the JSONB districts array using @> operator
            # We need to check both exact match and case-insensitive
            conditions.append(
                Story.districts.op("@>")(func.cast(f'["{district.title()}"]', text("jsonb")))
            )
            # Fallback: check if title contains district name
            conditions.append(func.lower(Story.title).contains(district))

        return or_(*conditions)

    def _build_disaster_district_filter(self, districts: List[str]):
        """
        Build a filter condition for disasters by district.

        Returns None if no districts are specified.
        """
        if not districts:
            return None

        districts_lower = [d.lower() for d in districts]
        return func.lower(DisasterIncident.district).in_(districts_lower)

    async def get_active_alerts_data(
        self, hours: int = 6, districts: List[str] = None
    ) -> dict:
        """
        Get active alert metrics (CRITICAL/HIGH severity in time window).

        Combines stories and disasters into unified alert count.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Build base conditions for stories
        story_conditions = [
            Story.severity.in_(["critical", "high"]),
            Story.published_at >= cutoff,
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]

        # Add district filter for stories if specified
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            story_conditions.append(story_district_filter)

        # Stories with CRITICAL or HIGH severity
        story_query = (
            select(
                Story.category,
                Story.severity,
                func.count(Story.id).label("count"),
                func.min(Story.published_at).label("oldest"),
            )
            .where(and_(*story_conditions))
            .group_by(Story.category, Story.severity)
        )

        story_result = await self.db.execute(story_query)
        story_rows = story_result.all()

        # Build base conditions for disasters
        disaster_conditions = [
            DisasterIncident.incident_on >= cutoff,
            or_(
                DisasterIncident.deaths > 0,
                DisasterIncident.estimated_loss > 2_500_000,
            ),
        ]

        # Add district filter for disasters if specified
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            disaster_conditions.append(disaster_district_filter)

        # Disasters with deaths > 0 or significant loss
        disaster_query = (
            select(
                literal_column("'disaster'").label("category"),
                DisasterIncident.severity,
                func.count(DisasterIncident.id).label("count"),
                func.min(DisasterIncident.incident_on).label("oldest"),
            )
            .where(and_(*disaster_conditions))
            .group_by(DisasterIncident.severity)
        )

        disaster_result = await self.db.execute(disaster_query)
        disaster_rows = disaster_result.all()

        # Aggregate results
        by_category: dict[str, int] = {}
        by_severity: dict[str, int] = {"critical": 0, "high": 0}
        total_count = 0
        oldest_time: Optional[datetime] = None

        for row in story_rows:
            cat = row.category or "uncategorized"
            by_category[cat] = by_category.get(cat, 0) + row.count
            if row.severity in by_severity:
                by_severity[row.severity] += row.count
            total_count += row.count
            if row.oldest and (oldest_time is None or row.oldest < oldest_time):
                oldest_time = row.oldest

        for row in disaster_rows:
            by_category["disaster"] = by_category.get("disaster", 0) + row.count
            sev = row.severity or "medium"
            if sev in by_severity:
                by_severity[sev] += row.count
            total_count += row.count
            if row.oldest and (oldest_time is None or row.oldest < oldest_time):
                oldest_time = row.oldest

        # Calculate hours since oldest
        oldest_hours = 0.0
        if oldest_time:
            oldest_hours = (datetime.now(timezone.utc) - oldest_time).total_seconds() / 3600

        return {
            "count": total_count,
            "by_category": by_category,
            "by_severity": by_severity,
            "oldest_unresolved_hours": round(oldest_hours, 1),
            "requires_attention": by_severity.get("critical", 0) > 0,
        }

    async def get_events_summary(
        self, hours: int = 24, districts: List[str] = None
    ) -> dict:
        """
        Get event counts with clustering awareness.

        Counts unique events by deduplicating clustered stories.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        yesterday_start = cutoff - timedelta(hours=24)

        # Build base conditions for stories
        story_conditions = [
            Story.published_at >= cutoff,
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]

        # Add district filter for stories if specified
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            story_conditions.append(story_district_filter)

        # Current period: stories
        story_query = (
            select(
                func.count(Story.id).label("total_stories"),
                func.count(func.distinct(Story.cluster_id)).filter(
                    Story.cluster_id.isnot(None)
                ).label("clusters"),
                func.count(Story.id).filter(
                    Story.cluster_id.is_(None)
                ).label("unclustered"),
            )
            .where(and_(*story_conditions))
        )

        result = await self.db.execute(story_query)
        row = result.first()

        clusters = row.clusters if row else 0
        unclustered = row.unclustered if row else 0

        # Build disaster conditions
        disaster_conditions = [DisasterIncident.incident_on >= cutoff]
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            disaster_conditions.append(disaster_district_filter)

        # Disaster incidents in period
        disaster_count_query = (
            select(func.count(DisasterIncident.id))
            .where(and_(*disaster_conditions))
        )
        disaster_count = await self.db.scalar(disaster_count_query) or 0

        # Total unique events = clusters + unclustered stories + disaster incidents
        total = clusters + unclustered + disaster_count

        # Yesterday's count for comparison (with same district filter)
        yesterday_conditions = [
            Story.published_at >= yesterday_start,
            Story.published_at < cutoff,
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]
        if story_district_filter is not None:
            yesterday_conditions.append(story_district_filter)

        yesterday_query = (
            select(
                func.count(func.distinct(
                    case(
                        (Story.cluster_id.isnot(None), Story.cluster_id),
                        else_=Story.id
                    )
                )).label("events"),
            )
            .where(and_(*yesterday_conditions))
        )

        yesterday_result = await self.db.execute(yesterday_query)
        yesterday_row = yesterday_result.first()
        yesterday_events = yesterday_row.events if yesterday_row else 0

        # Calculate change percentage
        change = 0.0
        trend = "STABLE"
        if yesterday_events > 0:
            change = ((total - yesterday_events) / yesterday_events) * 100
            if change > 10:
                trend = "INCREASING"
            elif change < -10:
                trend = "DECREASING"

        return {
            "total": total,
            "clustered": clusters,
            "unclustered": unclustered,
            "disaster_incidents": disaster_count,
            "change_vs_yesterday": round(change, 1),
            "trend": trend,
        }

    async def get_threat_score_data(
        self, hours: int = 24, districts: List[str] = None
    ) -> dict:
        """
        Get data for threat level calculation.

        Returns severity counts by category for weighted scoring.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        prev_cutoff = cutoff - timedelta(hours=hours)

        # Build base conditions for current period
        current_conditions = [
            Story.published_at >= cutoff,
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
            Story.severity.isnot(None),
        ]

        # Add district filter if specified
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            current_conditions.append(story_district_filter)

        # Current period severity counts by category
        current_query = (
            select(
                Story.category,
                Story.severity,
                func.count(Story.id).label("count"),
            )
            .where(and_(*current_conditions))
            .group_by(Story.category, Story.severity)
        )

        result = await self.db.execute(current_query)
        rows = result.all()

        # Previous period for trajectory (with same district filter)
        prev_conditions = [
            Story.published_at >= prev_cutoff,
            Story.published_at < cutoff,
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
            Story.severity.isnot(None),
        ]
        if story_district_filter is not None:
            prev_conditions.append(story_district_filter)

        prev_query = (
            select(
                Story.severity,
                func.count(Story.id).label("count"),
            )
            .where(and_(*prev_conditions))
            .group_by(Story.severity)
        )

        prev_result = await self.db.execute(prev_query)
        prev_rows = prev_result.all()

        # Add disaster severities (with district filter)
        disaster_conditions = [DisasterIncident.incident_on >= cutoff]
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            disaster_conditions.append(disaster_district_filter)

        disaster_query = (
            select(
                DisasterIncident.severity,
                func.count(DisasterIncident.id).label("count"),
            )
            .where(and_(*disaster_conditions))
            .group_by(DisasterIncident.severity)
        )

        disaster_result = await self.db.execute(disaster_query)
        disaster_rows = disaster_result.all()

        return {
            "current": [
                {"category": r.category, "severity": r.severity, "count": r.count}
                for r in rows
            ],
            "previous": [
                {"severity": r.severity, "count": r.count}
                for r in prev_rows
            ],
            "disasters": [
                {"severity": r.severity, "count": r.count}
                for r in disaster_rows
            ],
        }

    async def get_district_spread(
        self, hours: int = 24, districts: List[str] = None
    ) -> dict:
        """
        Get geographic distribution of events.

        Returns affected districts count and hotspots.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Build conditions
        conditions = [
            DisasterIncident.incident_on >= cutoff,
            DisasterIncident.district.isnot(None),
        ]

        # Add district filter if specified
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            conditions.append(disaster_district_filter)

        # Stories with districts (extracted from content)
        # For now, use disaster incidents which have proper district data
        district_query = (
            select(
                DisasterIncident.district,
                DisasterIncident.province,
                func.count(DisasterIncident.id).label("count"),
            )
            .where(and_(*conditions))
            .group_by(DisasterIncident.district, DisasterIncident.province)
            .order_by(func.count(DisasterIncident.id).desc())
        )

        result = await self.db.execute(district_query)
        rows = result.all()

        affected_districts = set()
        by_province: dict[str, int] = {}
        hotspots: list[tuple[str, int]] = []

        for row in rows:
            if row.district:
                affected_districts.add(row.district)
                hotspots.append((row.district, row.count))

            if row.province:
                prov_key = f"Province {row.province}"
                by_province[prov_key] = by_province.get(prov_key, 0) + 1

        affected_count = len(affected_districts)
        # If districts filter is applied, use that as the denominator
        total_districts = len(districts) if districts else 77

        return {
            "affected_count": affected_count,
            "total_districts": total_districts,
            "affected_percentage": round((affected_count / total_districts) * 100, 1) if total_districts > 0 else 0,
            "by_province": by_province,
            "hotspots": [h[0] for h in hotspots[:3]],
        }

    async def get_source_coverage(self, hours: int = 24) -> dict:
        """
        Get data pipeline health metrics.

        Counts all unique sources from the database that have delivered data.
        Active = delivered data in last 24 hours (most sources don't publish hourly)
        Total = all sources that have delivered data in last 30 days
        """
        # Active = sources that published in last 24 hours
        active_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        # Stale = sources that haven't published in 48 hours
        stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        # Total = sources active in last 30 days
        total_cutoff = datetime.now(timezone.utc) - timedelta(days=30)

        # Get all sources that delivered data in last 30 days (total)
        total_query = (
            select(
                Story.source_id,
                Story.source_name,
                func.max(Story.created_at).label("last_seen"),
            )
            .where(Story.created_at >= total_cutoff)
            .group_by(Story.source_id, Story.source_name)
        )
        total_result = await self.db.execute(total_query)
        all_sources = {row.source_id: {"name": row.source_name, "last_seen": row.last_seen}
                       for row in total_result.all()}
        total_sources = len(all_sources)

        # Get sources with data in last 24 hours (active)
        active_query = (
            select(Story.source_id)
            .where(Story.created_at >= active_cutoff)
            .group_by(Story.source_id)
        )
        active_result = await self.db.execute(active_query)
        active_source_ids = {row.source_id for row in active_result.all()}
        active_sources = len(active_source_ids)

        # Get most recent fetch time
        last_fetch_query = select(func.max(Story.created_at))
        last_fetch = await self.db.scalar(last_fetch_query)

        last_fetch_seconds = 0
        if last_fetch:
            last_fetch_seconds = int(
                (datetime.now(timezone.utc) - last_fetch).total_seconds()
            )

        # Identify stale sources (delivered data before but not in last 48h)
        stale_sources = []
        for source_id, info in all_sources.items():
            if info["last_seen"] < stale_cutoff:
                stale_sources.append(info["name"] or source_id)

        # Sort stale sources by name
        stale_sources.sort()

        coverage = 0.0
        if total_sources > 0:
            coverage = (active_sources / total_sources) * 100

        return {
            "active_sources": active_sources,
            "total_sources": total_sources,
            "coverage_percentage": round(coverage, 1),
            "last_fetch_seconds_ago": last_fetch_seconds,
            "stale_sources": stale_sources[:10],  # Top 10 stale source names
        }

    async def get_hourly_trend(
        self, hours: int = 24, districts: List[str] = None
    ) -> list[dict]:
        """
        Get hour-by-hour event counts for sparkline.

        Returns list of hourly counts with category breakdown.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Build conditions
        conditions = [
            Story.published_at >= cutoff,
            Story.published_at.isnot(None),
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]

        # Add district filter if specified
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            conditions.append(story_district_filter)

        # Hourly story counts by category
        #
        # Important: keep the date_trunc granularity literalized so Postgres treats
        # the SELECT/GROUP BY/ORDER BY expressions as identical. If SQLAlchemy
        # parameterizes "hour" separately for each func.date_trunc call, Postgres
        # can raise a GROUP BY error because the expressions differ by bind param.
        hour_bucket = func.date_trunc(literal_column("'hour'"), Story.published_at)
        story_query = (
            select(
                hour_bucket.label("hour"),
                Story.category,
                func.count(Story.id).label("count"),
            )
            .where(and_(*conditions))
            .group_by(
                hour_bucket,
                Story.category,
            )
            .order_by(hour_bucket)
        )

        result = await self.db.execute(story_query)
        rows = result.all()

        # Aggregate by hour
        hourly: dict[datetime, dict] = {}
        for row in rows:
            if row.hour is None:
                continue
            if row.hour not in hourly:
                hourly[row.hour] = {"total": 0, "categories": {}}
            hourly[row.hour]["total"] += row.count
            cat = row.category or "other"
            hourly[row.hour]["categories"][cat] = (
                hourly[row.hour]["categories"].get(cat, 0) + row.count
            )

        return [
            {
                "hour": hour,
                "count": data["total"],
                "category_breakdown": data["categories"],
            }
            for hour, data in sorted(hourly.items())
        ]

    async def get_velocity_data(self, districts: List[str] = None) -> dict:
        """
        Get trend velocity data (current hour vs previous hour).

        Used for anomaly detection.

        Args:
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        now = datetime.now(timezone.utc)
        current_hour_start = now.replace(minute=0, second=0, microsecond=0)
        prev_hour_start = current_hour_start - timedelta(hours=1)

        # Build base conditions
        base_conditions = [
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]

        # Add district filter if specified
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            base_conditions.append(story_district_filter)

        # Current hour events
        current_conditions = base_conditions + [Story.published_at >= current_hour_start]
        current_query = (
            select(func.count(Story.id))
            .where(and_(*current_conditions))
        )
        current_count = await self.db.scalar(current_query) or 0

        # Previous hour events
        prev_conditions = base_conditions + [
            Story.published_at >= prev_hour_start,
            Story.published_at < current_hour_start,
        ]
        prev_query = (
            select(func.count(Story.id))
            .where(and_(*prev_conditions))
        )
        prev_count = await self.db.scalar(prev_query) or 0

        # Get hourly average over last 7 days for anomaly detection
        week_ago = now - timedelta(days=7)
        avg_conditions = base_conditions + [Story.published_at >= week_ago]
        avg_query = (
            select(func.count(Story.id) / (7 * 24))
            .where(and_(*avg_conditions))
        )
        avg_hourly = await self.db.scalar(avg_query) or 1

        # Calculate change
        change = 0.0
        direction = "STABLE"
        if prev_count > 0:
            change = ((current_count - prev_count) / prev_count) * 100
            if change > 20:
                direction = "UP"
            elif change < -20:
                direction = "DOWN"
        elif current_count > 0:
            direction = "UP"
            change = 100.0

        # Anomaly if > 2x average
        anomaly = current_count > (avg_hourly * 2) if avg_hourly > 0 else False

        return {
            "events_this_hour": current_count,
            "events_prev_hour": prev_count,
            "change_percentage": round(change, 1),
            "direction": direction,
            "anomaly_detected": anomaly,
        }

    async def get_casualties_summary(
        self, hours: int = 24, districts: List[str] = None
    ) -> dict:
        """
        Get total casualties from disasters in time window.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Build conditions
        conditions = [DisasterIncident.incident_on >= cutoff]
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            conditions.append(disaster_district_filter)

        query = (
            select(
                func.coalesce(func.sum(DisasterIncident.deaths), 0).label("deaths"),
                func.coalesce(func.sum(DisasterIncident.injured), 0).label("injured"),
                func.coalesce(func.sum(DisasterIncident.missing), 0).label("missing"),
                func.coalesce(func.sum(DisasterIncident.affected_families), 0).label(
                    "affected_families"
                ),
                func.coalesce(func.sum(DisasterIncident.estimated_loss), 0).label(
                    "economic_impact"
                ),
            )
            .where(and_(*conditions))
        )

        result = await self.db.execute(query)
        row = result.first()

        return {
            "deaths": int(row.deaths) if row else 0,
            "injured": int(row.injured) if row else 0,
            "missing": int(row.missing) if row else 0,
            "affected_families": int(row.affected_families) if row else 0,
            "economic_impact": float(row.economic_impact) if row else 0.0,
        }

    async def get_critical_events_count(
        self, hours: int = 24, districts: List[str] = None
    ) -> int:
        """
        Count CRITICAL severity events only.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Build story conditions
        story_conditions = [
            Story.published_at >= cutoff,
            Story.severity == "critical",
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            story_conditions.append(story_district_filter)

        # Critical stories
        story_count = await self.db.scalar(
            select(func.count(Story.id))
            .where(and_(*story_conditions))
        ) or 0

        # Build disaster conditions
        disaster_conditions = [
            DisasterIncident.incident_on >= cutoff,
            DisasterIncident.severity == "critical",
        ]
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            disaster_conditions.append(disaster_district_filter)

        # Critical disasters
        disaster_count = await self.db.scalar(
            select(func.count(DisasterIncident.id))
            .where(and_(*disaster_conditions))
        ) or 0

        return story_count + disaster_count

    async def get_alert_details(
        self,
        severity_filter: list[str],
        hours: int = 6,
        limit: int = 20,
        districts: List[str] = None,
    ) -> list[dict]:
        """
        Get detailed alert list for drill-down view.

        Combines stories and disasters matching severity filter.

        Args:
            severity_filter: List of severity levels to include
            hours: Time window in hours
            limit: Max alerts to return
            districts: Optional list of district names to filter by
        """
        districts = districts or []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Build story conditions
        story_conditions = [
            Story.severity.in_(severity_filter),
            Story.published_at >= cutoff,
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        ]
        story_district_filter = self._build_story_district_filter(districts)
        if story_district_filter is not None:
            story_conditions.append(story_district_filter)

        # High severity stories
        story_query = (
            select(Story)
            .where(and_(*story_conditions))
            .order_by(Story.published_at.desc())
            .limit(limit)
        )

        story_result = await self.db.execute(story_query)
        stories = story_result.scalars().all()

        # Build disaster conditions
        disaster_conditions = [
            DisasterIncident.incident_on >= cutoff,
            or_(
                DisasterIncident.deaths > 0,
                DisasterIncident.estimated_loss > 2_500_000,
            ),
        ]
        disaster_district_filter = self._build_disaster_district_filter(districts)
        if disaster_district_filter is not None:
            disaster_conditions.append(disaster_district_filter)

        # Significant disasters
        disaster_query = (
            select(DisasterIncident)
            .where(and_(*disaster_conditions))
            .order_by(DisasterIncident.incident_on.desc())
            .limit(limit)
        )

        disaster_result = await self.db.execute(disaster_query)
        disasters = disaster_result.scalars().all()

        alerts = []

        for story in stories:
            alerts.append({
                "id": story.id,
                "title": story.title,
                "category": story.category or "uncategorized",
                "severity": story.severity,
                "source": story.source_name or story.source_id,
                "district": None,
                "timestamp": story.published_at,
                "url": story.url,
                "summary": story.summary,
                "deaths": None,
                "injured": None,
                "estimated_loss": None,
            })

        for disaster in disasters:
            alerts.append({
                "id": disaster.id,
                "title": disaster.title,
                "category": "disaster",
                "severity": disaster.severity or "medium",
                "source": "BIPAD Portal",
                "district": disaster.district,
                "timestamp": disaster.incident_on,
                "url": None,
                "summary": None,
                "deaths": disaster.deaths,
                "injured": disaster.injured,
                "estimated_loss": disaster.estimated_loss,
            })

        # Sort by timestamp descending
        alerts.sort(key=lambda x: x["timestamp"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

        return alerts[:limit]
