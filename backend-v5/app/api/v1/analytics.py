"""Analytics API endpoints for dashboard widgets."""
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, case, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.repositories.story import StoryRepository
from app.repositories.story_cluster import StoryClusterRepository
from app.models.cluster_publication import ClusterPublication
from app.models.cluster_peer_review import ClusterPeerReview, PeerReviewVerdict
from app.models.political_entity import PoliticalEntity, EntityType
from app.models.story_entity_link import StoryEntityLink
from app.models.story import Story
from app.models.curfew_alert import get_province_for_district
from app.schemas.analytics import (
    AnalyticsSummaryResponse,
    ConsolidatedStoryResponse,
    DevelopingStoryEntry,
    ThreatMatrixResponse,
    ThreatCategoryItem,
    HourlyTrend,
    AggregatedNewsResponse,
    AggregatedCluster,
    ClusterStoryGroupItem,
    KeyActorResponse,
    StoryBrief,
    ExecutiveSummaryResponse,
    PriorityDevelopment,
    ThreatMatrixAIResponse,
    CategoryInsight,
    ClusterTimelineEntry,
    ClusterTimelineStory,
    StoryTrackerEntry,
    StoryTrackerClusterRef,
)
from app.schemas.publishing import PeerReviewSummary
from app.core.redis import get_redis
from app.services.story_products_service import DevelopingStoriesService, StoryTrackerService

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _parse_districts_param(districts_param: Optional[str]) -> List[str]:
    """
    Parse comma-separated districts parameter into a list.
    Returns empty list if None or empty.
    Normalizes to proper case for matching.
    """
    if not districts_param:
        return []
    # Split by comma, strip whitespace, convert to proper case
    return [d.strip().title() for d in districts_param.split(",") if d.strip()]


def _normalize_geo_token(value: str) -> str:
    """Normalize district/province tokens for resilient matching."""
    return value.strip().lower().replace("_", " ")


def _selected_provinces_from_districts(districts: List[str]) -> set[str]:
    """Derive selected provinces from selected districts."""
    provinces: set[str] = set()
    for district in districts:
        province = get_province_for_district(district)
        if province:
            provinces.add(_normalize_geo_token(province))
    return provinces


def _filter_stories_by_districts(
    stories: List,
    districts: List[str],
) -> List:
    """
    Filter stories by district names.
    Checks both the story.districts field and falls back to title matching.
    """
    if not districts:
        return stories

    districts_lower = {_normalize_geo_token(d) for d in districts}
    selected_provinces_lower = _selected_provinces_from_districts(districts)

    filtered = []
    for story in stories:
        # First, check the districts field on the story
        if story.districts:
            story_districts_lower = {_normalize_geo_token(d) for d in story.districts}
            if story_districts_lower & districts_lower:
                filtered.append(story)
                continue

        # Province fallback: include stories tagged only at province level.
        if selected_provinces_lower and story.provinces:
            story_provinces_lower = {
                _normalize_geo_token(p)
                for p in story.provinces
                if isinstance(p, str) and p.strip()
            }
            if story_provinces_lower & selected_provinces_lower:
                filtered.append(story)
                continue

        # Fallback: check if district name appears in title
        title_lower = story.title.lower()
        if any(d in title_lower for d in districts_lower):
            filtered.append(story)
            continue

        # Final fallback: province mention in title.
        if selected_provinces_lower and any(p in title_lower for p in selected_provinces_lower):
            filtered.append(story)

    return filtered


@router.get("/consolidated-stories", response_model=list[ConsolidatedStoryResponse])
async def get_consolidated_stories(
    hours: int = Query(72, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(100, ge=1, le=500, description="Max stories to return"),
    story_type: Optional[str] = Query(None, description="Filter by story type (category)"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    category: Optional[str] = Query(None, description="Filter by category (alias for story_type)"),
    districts: Optional[str] = Query(None, description="Comma-separated district names to filter by"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get consolidated stories for the StoriesWidget.

    Returns deduplicated, classified stories sorted by recency.
    Supports filtering by category (story_type), severity, and districts.
    """
    repo = StoryRepository(db)

    # Use category param or story_type param (they're the same thing)
    cat_filter = category or story_type

    # Parse districts parameter
    district_list = _parse_districts_param(districts)

    # Fetch more stories if filtering by district (to account for filtering)
    fetch_limit = limit * 3 if district_list else limit

    stories = await repo.get_recent(
        hours=hours,
        limit=fetch_limit,
        nepal_only=True,
        category=cat_filter,
        severity=severity,
    )

    # Filter by districts if specified
    if district_list:
        stories = _filter_stories_by_districts(stories, district_list)
        stories = stories[:limit]  # Apply limit after filtering

    # Convert to consolidated format
    consolidated = [
        ConsolidatedStoryResponse.from_story(story)
        for story in stories
    ]

    return consolidated


@router.get("/summary", response_model=AnalyticsSummaryResponse)
async def get_analytics_summary(
    hours: int = Query(72, ge=1, le=720, description="Time window in hours"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get KPI summary for the dashboard.

    Returns story count, source breakdown, and hourly trend.
    """
    repo = StoryRepository(db)

    # Get counts
    story_count = await repo.count_total(hours=hours, nepal_only=True)

    # Get source breakdown
    sources_breakdown = await repo.count_by_source(hours=hours)

    # Get hourly trend
    hourly_data = await repo.get_hourly_trend(hours=hours)
    hourly_trend = []
    for h, c in hourly_data:
        if h is not None:
            hourly_trend.append(HourlyTrend(hour=h.isoformat(), count=c))

    return AnalyticsSummaryResponse(
        stories=story_count,
        events=0,  # Placeholder - no events model yet
        entities=0,  # Placeholder
        active_alerts=0,  # Placeholder
        sources_breakdown=sources_breakdown,
        hourly_trend=hourly_trend,
        time_range_hours=hours,
    )


@router.get("/threat-matrix", response_model=ThreatMatrixResponse)
async def get_threat_matrix(
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get threat level matrix for the ThreatsWidget.

    Categorizes stories by type and calculates threat levels.
    """
    # Redis cache (5 min TTL)
    cache_key = f"narada:threat_matrix:{hours}"
    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            return ThreatMatrixResponse.model_validate_json(cached)
    except Exception:
        pass  # Redis unavailable, compute fresh

    repo = StoryRepository(db)
    stories = await repo.get_recent(hours=hours, limit=500, nepal_only=True)

    # Categorize stories
    categories: dict[str, dict] = {}

    for story in stories:
        # Determine category from story
        story_type = _categorize_story(story)

        if story_type not in categories:
            categories[story_type] = {
                "count": 0,
                "severities": {"critical": 0, "high": 0, "medium": 0, "low": 0},
                "top_story": None,
            }

        cat = categories[story_type]
        cat["count"] += 1

        # Determine severity
        severity = _get_severity(story)
        cat["severities"][severity] += 1

        # Track most recent as top story
        if cat["top_story"] is None:
            cat["top_story"] = story.title[:100]

    # Build response
    matrix = []
    for cat_name, data in categories.items():
        # Calculate threat level from severity distribution
        severities = data["severities"]
        score = (
            severities["critical"] * 4 +
            severities["high"] * 3 +
            severities["medium"] * 2 +
            severities["low"] * 1
        )

        if score > 20:
            level = "critical"
        elif score > 10:
            level = "elevated"
        elif score > 5:
            level = "guarded"
        else:
            level = "low"

        matrix.append(ThreatCategoryItem(
            category=cat_name,
            level=level,
            trend="stable",  # Would need historical data to calculate
            event_count=data["count"],
            top_event=data["top_story"],
            severity_breakdown=severities,
        ))

    # Sort by event count
    matrix.sort(key=lambda x: x.event_count, reverse=True)

    # Determine overall threat level
    if any(m.level == "critical" for m in matrix):
        overall = "CRITICAL"
    elif any(m.level == "elevated" for m in matrix):
        overall = "ELEVATED"
    elif any(m.level == "guarded" for m in matrix):
        overall = "GUARDED"
    else:
        overall = "LOW"

    response = ThreatMatrixResponse(
        matrix=matrix[:8],  # Top 8 categories
        overall_threat_level=overall,
        last_updated=datetime.now(timezone.utc),
    )

    # Cache result
    try:
        redis = await get_redis()
        await redis.set(cache_key, response.model_dump_json(), ex=300)  # 5 min
    except Exception:
        pass

    return response


@router.get("/threat-matrix/ai", response_model=ThreatMatrixAIResponse)
async def get_threat_matrix_ai(
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get AI-enhanced threat matrix with narrative insights.

    Returns the standard threat matrix plus AI-generated analysis.
    Cost: ~$0.001 per request with Claude Haiku.
    """
    repo = StoryRepository(db)
    stories = await repo.get_recent(hours=hours, limit=500, nepal_only=True)

    # Build standard matrix first
    categories: dict[str, dict] = {}
    for story in stories:
        story_type = _categorize_story(story)
        if story_type not in categories:
            categories[story_type] = {
                "count": 0,
                "severities": {"critical": 0, "high": 0, "medium": 0, "low": 0},
                "top_story": None,
                "stories": [],
            }
        cat = categories[story_type]
        cat["count"] += 1
        severity = _get_severity(story)
        cat["severities"][severity] += 1
        if cat["top_story"] is None:
            cat["top_story"] = story.title[:100]
        cat["stories"].append(story)

    # Build matrix items
    matrix = []
    for cat_name, data in categories.items():
        severities = data["severities"]
        score = (
            severities["critical"] * 4 +
            severities["high"] * 3 +
            severities["medium"] * 2 +
            severities["low"] * 1
        )
        if score > 20:
            level = "critical"
        elif score > 10:
            level = "elevated"
        elif score > 5:
            level = "guarded"
        else:
            level = "low"

        matrix.append(ThreatCategoryItem(
            category=cat_name,
            level=level,
            trend="stable",
            event_count=data["count"],
            top_event=data["top_story"],
            severity_breakdown=severities,
        ))

    matrix.sort(key=lambda x: x.event_count, reverse=True)

    # Determine overall threat level
    if any(m.level == "critical" for m in matrix):
        overall = "CRITICAL"
    elif any(m.level == "elevated" for m in matrix):
        overall = "ELEVATED"
    elif any(m.level == "guarded" for m in matrix):
        overall = "GUARDED"
    else:
        overall = "LOW"

    # Generate category insights (placeholder - would use LLM in production)
    category_insights = {}
    for item in matrix[:8]:
        cat_stories = categories.get(item.category, {}).get("stories", [])
        top_titles = [s.title for s in cat_stories[:3]]
        category_insights[item.category] = CategoryInsight(
            narrative=f"{item.event_count} {item.category} events detected in the last {hours} hours.",
            key_development=top_titles[0] if top_titles else "No key developments",
            watch_for=f"Monitor {item.category} sector for escalation patterns",
        )

    # Determine escalation risk
    critical_count = sum(1 for m in matrix if m.level == "critical")
    high_count = sum(1 for m in matrix if m.level == "elevated")
    if critical_count >= 2 or (critical_count >= 1 and high_count >= 2):
        escalation_risk = "HIGH"
    elif critical_count >= 1 or high_count >= 2:
        escalation_risk = "MODERATE"
    else:
        escalation_risk = "LOW"

    # Generate overall assessment
    total_events = sum(m.event_count for m in matrix)
    top_categories = [m.category for m in matrix[:3]]
    overall_assessment = (
        f"Analyzed {total_events} Nepal-relevant events in the last {hours} hours. "
        f"Primary activity in {', '.join(top_categories) if top_categories else 'no'} sectors. "
        f"Overall threat level: {overall}. Escalation risk: {escalation_risk}."
    )

    # Priority watch items
    priority_watch = []
    for item in matrix[:3]:
        if item.top_event:
            priority_watch.append(f"{item.category.title()}: {item.top_event[:80]}")

    return ThreatMatrixAIResponse(
        matrix=matrix[:8],
        overall_threat_level=overall,
        last_updated=datetime.now(timezone.utc),
        overall_assessment=overall_assessment,
        category_insights=category_insights,
        priority_watch_items=priority_watch,
        escalation_risk=escalation_risk,
        ai_generated=True,
    )


@router.get("/executive-summary", response_model=ExecutiveSummaryResponse)
async def get_executive_summary(
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    force_refresh: bool = Query(False, description="Bypass cache"),
    districts: Optional[str] = Query(None, description="Comma-separated district filter"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get AI-generated executive summary of the intelligence situation.

    Returns a high-level assessment suitable for executive briefings.
    Results are cached for 30 minutes.
    """
    # Redis cache (30 min TTL)
    district_key = districts or "all"
    cache_key = f"narada:executive_summary:{hours}:{district_key}"
    if not force_refresh:
        try:
            redis = await get_redis()
            cached = await redis.get(cache_key)
            if cached:
                return ExecutiveSummaryResponse.model_validate_json(cached)
        except Exception:
            pass  # Redis unavailable, compute fresh

    repo = StoryRepository(db)

    # Parse districts filter
    district_list = _parse_districts_param(districts)

    # Get stories for the time window
    stories = await repo.get_recent(hours=hours, limit=500, nepal_only=True)

    # Filter by districts if specified
    if district_list:
        stories = _filter_stories_by_districts(stories, district_list)

    # Build priority developments from top stories by severity
    priority_developments = []
    critical_stories = [s for s in stories if _get_severity(s) == "critical"]
    high_stories = [s for s in stories if _get_severity(s) == "high"]

    for story in (critical_stories + high_stories)[:5]:
        priority_developments.append(PriorityDevelopment(
            headline=story.title[:150],
            significance=f"{_get_severity(story).upper()} severity {_categorize_story(story)} event",
            districts=story.districts or [],
        ))

    # Determine geographic focus
    all_districts = set()
    for story in stories:
        if story.districts:
            all_districts.update(story.districts)
    geographic_focus = list(all_districts)[:10]

    # Categorize stories for situation overview
    category_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for story in stories:
        cat = _categorize_story(story)
        category_counts[cat] = category_counts.get(cat, 0) + 1
        sev = _get_severity(story)
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    # Determine threat level
    total_events = len(stories)
    if severity_counts["critical"] >= 3 or (severity_counts["critical"] >= 1 and severity_counts["high"] >= 5):
        threat_level = "CRITICAL"
    elif severity_counts["critical"] >= 1 or severity_counts["high"] >= 3:
        threat_level = "ELEVATED"
    elif severity_counts["high"] >= 1 or severity_counts["medium"] >= 5:
        threat_level = "GUARDED"
    else:
        threat_level = "LOW"

    # Build situation overview
    top_categories = sorted(category_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    cat_summary = ", ".join([f"{c[0]} ({c[1]})" for c in top_categories])
    situation_overview = (
        f"In the last {hours} hours, {total_events} Nepal-relevant events were recorded. "
        f"Primary activity sectors: {cat_summary}. "
        f"Severity distribution: {severity_counts['critical']} critical, {severity_counts['high']} high, "
        f"{severity_counts['medium']} medium, {severity_counts['low']} low."
    )

    # Key judgment
    key_judgment = (
        f"The current security environment is assessed as {threat_level}. "
        f"{'Immediate attention required on critical events. ' if threat_level in ['CRITICAL', 'ELEVATED'] else ''}"
        f"Primary drivers: {', '.join([c[0] for c in top_categories]) if top_categories else 'mixed activity'}."
    )

    # Watch items
    watch_items = []
    for cat, count in top_categories[:3]:
        watch_items.append(f"Monitor {cat} sector for continued activity ({count} events)")
    if severity_counts["critical"] > 0:
        watch_items.insert(0, f"CRITICAL: {severity_counts['critical']} events require immediate attention")

    # Trajectory (simplified - would compare with previous period)
    threat_trajectory = "STABLE"
    if severity_counts["critical"] >= 2:
        threat_trajectory = "ESCALATING"
    elif total_events < 10 and severity_counts["critical"] == 0:
        threat_trajectory = "DE-ESCALATING"

    response = ExecutiveSummaryResponse(
        key_judgment=key_judgment,
        situation_overview=situation_overview,
        priority_developments=priority_developments,
        geographic_focus=geographic_focus,
        threat_level=threat_level,
        threat_trajectory=threat_trajectory,
        watch_items=watch_items,
        story_count=total_events,
        time_range_hours=hours,
        generated_at=datetime.now(timezone.utc),
    )

    # Cache result
    try:
        redis = await get_redis()
        await redis.set(cache_key, response.model_dump_json(), ex=1800)  # 30 min
    except Exception:
        pass

    return response


@router.get("/aggregated-news", response_model=AggregatedNewsResponse)
async def get_aggregated_news(
    hours: int = Query(72, ge=1, le=168, description="Time window in hours"),
    category: Optional[str] = Query(None, description="Filter by category"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    published_only: bool = Query(False, description="Only include analyst-published events"),
    include_story_groups: bool = Query(False, description="Include soft-dedup story groups"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get aggregated news with story clustering.

    Returns clustered stories grouped by similarity, plus unclustered stories count.
    """
    story_repo = StoryRepository(db)
    cluster_repo = StoryClusterRepository(db)

    # Get clusters
    clusters = await cluster_repo.list_clusters(
        hours=hours,
        category=category,
        severity=severity,
        limit=100,
        published_only=published_only,
    )

    story_groups_by_cluster: dict[UUID, list[ClusterStoryGroupItem]] = {}
    if include_story_groups and clusters:
        from app.services.ops.event_dedup import group_stories_by_near_duplicate

        for cluster in clusters:
            grouped = await group_stories_by_near_duplicate(db, cluster.stories, similarity_threshold=0.95)
            groups: list[ClusterStoryGroupItem] = []
            for g in grouped:
                canonical = g[0]
                duplicates = g[1:]
                groups.append(
                    ClusterStoryGroupItem(
                        canonical={
                            "id": canonical.id,
                            "source_id": canonical.source_id,
                            "source_name": canonical.source_name,
                            "title": canonical.title,
                            "summary": canonical.summary,
                            "url": canonical.url,
                            "published_at": canonical.published_at,
                        },
                        duplicates=[
                            {
                                "id": d.id,
                                "source_id": d.source_id,
                                "source_name": d.source_name,
                                "title": d.title,
                                "summary": d.summary,
                                "url": d.url,
                                "published_at": d.published_at,
                            }
                            for d in duplicates
                        ],
                        duplicate_count=len(duplicates),
                    )
                )
            story_groups_by_cluster[cluster.id] = groups

    # Convert to response format
    latest_pub_map: dict[UUID, ClusterPublication] = {}
    peer_review_map: dict[UUID, PeerReviewSummary] = {}

    if published_only and clusters:
        cluster_ids = [c.id for c in clusters]

        # Latest publication per cluster (versioned public snapshot)
        pub_subq = (
            select(
                ClusterPublication.cluster_id.label("cluster_id"),
                func.max(ClusterPublication.version).label("max_version"),
            )
            .where(ClusterPublication.cluster_id.in_(cluster_ids))
            .group_by(ClusterPublication.cluster_id)
            .subquery()
        )
        pubs_result = await db.execute(
            select(ClusterPublication).join(
                pub_subq,
                and_(
                    ClusterPublication.cluster_id == pub_subq.c.cluster_id,
                    ClusterPublication.version == pub_subq.c.max_version,
                ),
            )
        )
        pubs = pubs_result.scalars().all()
        latest_pub_map = {p.cluster_id: p for p in pubs}

        # Peer review aggregates (counts + last timestamps)
        review_rows = await db.execute(
            select(
                ClusterPeerReview.cluster_id,
                func.sum(case((ClusterPeerReview.verdict == PeerReviewVerdict.AGREE, 1), else_=0)).label("agree"),
                func.sum(case((ClusterPeerReview.verdict == PeerReviewVerdict.NEEDS_CORRECTION, 1), else_=0)).label("needs"),
                func.sum(case((ClusterPeerReview.verdict == PeerReviewVerdict.DISPUTE, 1), else_=0)).label("dispute"),
                func.max(ClusterPeerReview.updated_at).label("last_reviewed_at"),
                func.max(
                    case(
                        (
                            ClusterPeerReview.verdict.in_([PeerReviewVerdict.NEEDS_CORRECTION, PeerReviewVerdict.DISPUTE]),
                            ClusterPeerReview.updated_at,
                        ),
                        else_=None,
                    )
                ).label("last_contested_at"),
            )
            .where(ClusterPeerReview.cluster_id.in_(cluster_ids))
            .group_by(ClusterPeerReview.cluster_id)
        )

        for row in review_rows.all():
            cid: UUID = row[0]
            agree_count = int(row[1] or 0)
            needs_count = int(row[2] or 0)
            dispute_count = int(row[3] or 0)
            last_reviewed_at = row[4]
            last_contested_at = row[5]

            latest_pub = latest_pub_map.get(cid)
            latest_version = latest_pub.version if latest_pub else None
            latest_publication_at = latest_pub.created_at if latest_pub else None
            citations_count = len(latest_pub.citations or []) if latest_pub else None
            official_confirmation = None
            if latest_pub and isinstance(latest_pub.policy_check, dict):
                official_confirmation = latest_pub.policy_check.get("official_confirmation")

            peer_state = "unreviewed"
            if (agree_count + needs_count + dispute_count) > 0:
                if (needs_count + dispute_count) > 0:
                    if latest_publication_at and last_contested_at and latest_publication_at > last_contested_at:
                        peer_state = "corrected"
                    else:
                        peer_state = "contested"
                else:
                    peer_state = "reviewed"

            peer_review_map[cid] = PeerReviewSummary(
                peer_state=peer_state,
                agree_count=agree_count,
                needs_correction_count=needs_count,
                dispute_count=dispute_count,
                last_reviewed_at=last_reviewed_at,
                last_contested_at=last_contested_at,
                latest_version=latest_version,
                latest_publication_at=latest_publication_at,
                official_confirmation=official_confirmation,
                citations_count=citations_count,
            )

    aggregated_clusters = []
    for cluster in clusters:
        pub = latest_pub_map.get(cluster.id)
        peer_review = peer_review_map.get(cluster.id)

        citations_count = len(pub.citations or []) if pub else None
        official_confirmation = None
        latest_version = None
        latest_publication_at = None
        if pub:
            latest_version = pub.version
            latest_publication_at = pub.created_at
            if isinstance(pub.policy_check, dict):
                official_confirmation = pub.policy_check.get("official_confirmation")

        if published_only and peer_review is None:
            peer_review = PeerReviewSummary(
                peer_state="unreviewed",
                agree_count=0,
                needs_correction_count=0,
                dispute_count=0,
                last_reviewed_at=None,
                last_contested_at=None,
                latest_version=latest_version,
                latest_publication_at=latest_publication_at,
                official_confirmation=official_confirmation,
                citations_count=citations_count,
            )

        aggregated_clusters.append(
            AggregatedCluster.from_cluster(
                cluster,
                prefer_analyst=published_only,
                story_groups=story_groups_by_cluster.get(cluster.id),
                published_at=cluster.published_at,
                latest_version=latest_version,
                latest_publication_at=latest_publication_at,
                citations_count=citations_count,
                official_confirmation=official_confirmation,
                peer_review=peer_review,
            )
        )

    # Get total story count
    if published_only:
        # Customer feed is event-first: count events, not raw stories
        total_stories = len(aggregated_clusters)
        unclustered_count = 0
    else:
        total_stories = await story_repo.count_total(hours=hours, nepal_only=True)

        # Get unclustered stories count
        unclustered_stories = await cluster_repo.get_unclustered_stories(
            hours=hours,
            limit=500,
        )
        unclustered_count = len(unclustered_stories)

    return AggregatedNewsResponse(
        clusters=aggregated_clusters,
        unclustered_count=unclustered_count,
        total_stories=total_stories,
    )


def _categorize_story(story) -> str:
    """Categorize story by content. Uses persisted category if available."""
    # Use persisted category if available
    if story.category:
        return story.category

    title_lower = story.title.lower()
    categories = story.categories or []
    cat_str = " ".join(c.lower() for c in categories)
    text = f"{title_lower} {cat_str}"

    # Check categories
    if any(k in text for k in ["earthquake", "flood", "landslide", "disaster", "avalanche"]):
        return "disaster"
    if any(k in text for k in ["election", "vote", "parliament", "cabinet", "minister"]):
        return "political"
    if any(k in text for k in ["police", "arrest", "murder", "crime", "theft", "court"]):
        return "security"
    if any(k in text for k in ["economy", "market", "nepse", "inflation", "budget"]):
        return "economic"
    if any(k in text for k in ["protest", "strike", "bandh", "rally", "demonstration"]):
        return "social"
    if any(k in text for k in ["army", "military", "border", "security"]):
        return "security"

    return "social"


def _get_severity(story) -> str:
    """Determine story severity. Uses persisted severity if available."""
    # Use persisted severity if available
    if story.severity:
        return story.severity

    title_lower = story.title.lower()

    # Critical keywords
    if any(k in title_lower for k in [
        "killed", "death", "dead", "earthquake", "bomb", "explosion",
        "emergency", "disaster", "critical"
    ]):
        return "critical"

    # High keywords
    if any(k in title_lower for k in [
        "injured", "arrest", "protest", "flood", "landslide",
        "clash", "violence", "strike"
    ]):
        return "high"

    # Medium - Nepal domestic
    if story.nepal_relevance == "NEPAL_DOMESTIC":
        if story.relevance_score and story.relevance_score > 0.7:
            return "medium"

    return "low"


# ============================================================
# Key Actors (Political Entities) Endpoint
# ============================================================

@router.get("/key-actors", response_model=list[KeyActorResponse])
async def get_key_actors(
    hours: int = Query(24, ge=1, le=168, description="Time window for mention counts"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type (person, party, organization)"),
    limit: int = Query(10, ge=1, le=50, description="Maximum entities to return"),
    include_stories: bool = Query(True, description="Include top stories for each entity"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get trending political actors (key actors) with mention statistics.

    This powers the KeyActorsPanel in the Political Analyst dashboard.
    Returns entities sorted by total mentions, with trend indicators.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)

    # Build query for entities with recent activity
    query = (
        select(PoliticalEntity)
        .where(PoliticalEntity.is_active == True)
        .where(PoliticalEntity.total_mentions > 0)
    )

    # Filter by entity type if specified
    if entity_type:
        try:
            et = EntityType(entity_type.lower())
            query = query.where(PoliticalEntity.entity_type == et)
        except ValueError:
            pass  # Invalid entity type, ignore filter

    # Order by 24h mentions first, then total
    query = query.order_by(
        PoliticalEntity.mentions_24h.desc(),
        PoliticalEntity.total_mentions.desc(),
    ).limit(limit)

    result = await db.execute(query)
    entities = result.scalars().all()

    # Build response with optional top stories
    responses = []

    if include_stories and entities:
        # Batch fetch all stories for all entities in 1 query (instead of N)
        entity_ids = [e.id for e in entities]

        all_stories_query = (
            select(Story, StoryEntityLink.entity_id)
            .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
            .where(StoryEntityLink.entity_id.in_(entity_ids))
            .order_by(StoryEntityLink.entity_id, Story.published_at.desc())
        )
        all_stories_result = await db.execute(all_stories_query)

        # Group stories by entity_id, take top 5 per entity
        from collections import defaultdict
        stories_by_entity: dict = defaultdict(list)
        for story, entity_id in all_stories_result.all():
            if len(stories_by_entity[entity_id]) < 5:
                stories_by_entity[entity_id].append(story)

        for entity in entities:
            top_stories = stories_by_entity.get(entity.id, [])
            responses.append(
                KeyActorResponse.from_entity(entity, top_stories=top_stories)
            )
    else:
        for entity in entities:
            responses.append(
                KeyActorResponse.from_entity(entity, top_stories=[])
            )

    return responses


@router.get("/key-actors/{entity_id}", response_model=KeyActorResponse)
async def get_key_actor_detail(
    entity_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a specific political entity.
    """
    result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Entity not found")

    # Get top 10 recent stories
    stories_query = (
        select(Story)
        .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
        .where(StoryEntityLink.entity_id == entity.id)
        .order_by(Story.published_at.desc())
        .limit(10)
    )
    stories_result = await db.execute(stories_query)
    top_stories = stories_result.scalars().all()

    return KeyActorResponse.from_entity(entity, top_stories=top_stories)


# ============================================================
# Cluster Timeline (Situation Monitor)
# ============================================================

@router.get("/cluster-timeline", response_model=list[ClusterTimelineEntry])
async def get_cluster_timeline(
    hours: int = Query(72, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(10, ge=1, le=50, description="Max clusters to return"),
    category: Optional[str] = Query(None, description="Filter by category"),
    min_stories: int = Query(2, ge=2, le=20, description="Min stories per cluster"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get top active story clusters with chronological source timelines.

    Returns clusters sorted by recency with their constituent stories
    ordered chronologically. Zero additional Claude API cost.
    """
    cluster_repo = StoryClusterRepository(db)

    # Over-fetch from DB since min_stories filter happens post-query
    fetch_limit = limit * 5 if min_stories > 2 else limit
    clusters = await cluster_repo.list_clusters(
        hours=hours,
        category=category,
        limit=min(fetch_limit, 200),
    )

    entries = []
    for cluster in clusters:
        if cluster.story_count < min_stories:
            continue

        # Build timeline from stories, sorted chronologically ASC
        stories_sorted = sorted(
            cluster.stories,
            key=lambda s: s.published_at or datetime.min.replace(tzinfo=timezone.utc),
        )

        timeline = [
            ClusterTimelineStory(
                source_name=s.source_name or s.source_id,
                title=s.title,
                published_at=s.published_at,
                url=s.url,
            )
            for s in stories_sorted
        ]

        # Compute development stage from temporal signals
        dev_stage = "emerging"
        if cluster.first_published and cluster.last_updated:
            spread_h = (cluster.last_updated - cluster.first_published).total_seconds() / 3600
            age_h = (datetime.now(timezone.utc) - cluster.first_published).total_seconds() / 3600
            stale_h = (datetime.now(timezone.utc) - cluster.last_updated).total_seconds() / 3600
            if stale_h > 12:
                dev_stage = "resolved"
            elif spread_h > 12 and cluster.source_count >= 4:
                dev_stage = "mature"
            elif spread_h > 3 or cluster.source_count >= 3:
                dev_stage = "developing"

        entries.append(ClusterTimelineEntry(
            cluster_id=cluster.id,
            headline=cluster.analyst_headline or cluster.headline,
            category=cluster.analyst_category or cluster.category,
            severity=cluster.analyst_severity or cluster.severity,
            story_count=cluster.story_count,
            source_count=cluster.source_count,
            first_published=cluster.first_published,
            last_updated=cluster.last_updated,
            diversity_score=cluster.diversity_score,
            confidence_level=cluster.confidence_level,
            bluf=cluster.bluf,
            development_stage=dev_stage,
            timeline=timeline,
        ))

    # Sort by story count DESC so biggest developing stories surface first
    entries.sort(key=lambda e: e.story_count, reverse=True)

    return entries[:limit]


@router.get("/developing-stories", response_model=list[DevelopingStoryEntry])
async def get_developing_stories(
    hours: int = Query(72, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(15, ge=1, le=50, description="Max events to return"),
    category: Optional[str] = Query(None, description="Filter by category"),
    refresh: bool = Query(False, description="Generate missing BLUFs for returned clusters"),
    db: AsyncSession = Depends(get_db),
):
    """Event-level feed for fast-moving clusters only."""
    service = DevelopingStoriesService(db)
    rows = await service.list_entries(hours=hours, limit=limit, category=category, refresh=refresh)
    return [DevelopingStoryEntry(**row) for row in rows]


@router.get("/story-tracker", response_model=list[StoryTrackerEntry])
async def get_story_tracker(
    hours: int = Query(72, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(20, ge=1, le=50, description="Max narratives to return"),
    refresh: bool = Query(False, description="Force narrative refresh before reading"),
    db: AsyncSession = Depends(get_db),
):
    """Narrative-level tracker spanning multiple related clusters."""
    service = StoryTrackerService(db)
    if refresh:
        await service.refresh_narratives(hours=hours, limit=limit)
    narratives = await service.list_narratives(hours=hours, limit=limit)

    response = []
    for narrative in narratives:
        clusters = []
        ordered_links = sorted(narrative.cluster_links, key=lambda link: link.position)
        for link in ordered_links:
            cluster = link.cluster
            clusters.append(
                StoryTrackerClusterRef(
                    cluster_id=cluster.id,
                    headline=cluster.analyst_headline or cluster.headline,
                    category=cluster.analyst_category or cluster.category,
                    severity=cluster.analyst_severity or cluster.severity,
                    story_count=cluster.story_count,
                    source_count=cluster.source_count,
                    last_updated=cluster.last_updated,
                    bluf=cluster.bluf,
                    similarity_score=link.similarity_score,
                )
            )
        response.append(
            StoryTrackerEntry(
                narrative_id=narrative.id,
                label=narrative.label,
                thesis=narrative.thesis,
                category=narrative.category,
                direction=narrative.direction,
                momentum_score=narrative.momentum_score,
                confidence=narrative.confidence,
                cluster_count=narrative.cluster_count,
                lead_regions=list(narrative.lead_regions or []),
                lead_entities=list(narrative.lead_entities or []),
                first_seen_at=narrative.first_seen_at,
                last_updated=narrative.last_updated,
                clusters=clusters,
            )
        )

    return response
