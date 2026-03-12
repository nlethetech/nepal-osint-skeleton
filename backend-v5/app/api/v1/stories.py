"""Stories API endpoints."""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_dev
from app.models.story import Story
from app.repositories.story import StoryRepository
from app.schemas.story import StoryResponse, StoryListResponse
from app.services.embeddings import EmbeddingService
from app.services.editorial_control_service import EditorialControlService
from app.services.ingestion_service import IngestionService
from app.services.clustering import ClusteringService

router = APIRouter(prefix="/stories", tags=["stories"])


def _parse_districts_param(districts_param: Optional[str]) -> List[str]:
    """
    Parse comma-separated districts parameter into a list.
    Returns empty list if None or empty.
    Normalizes to proper case for matching.
    """
    if not districts_param:
        return []
    return [d.strip().title() for d in districts_param.split(",") if d.strip()]


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

    districts_lower = [d.lower() for d in districts]

    filtered = []
    for story in stories:
        # Check the districts field on the story
        if story.districts:
            story_districts_lower = [d.lower() for d in story.districts]
            if any(d in story_districts_lower for d in districts_lower):
                filtered.append(story)
                continue

        # Fallback: check if district name appears in title
        title_lower = story.title.lower()
        if any(d in title_lower for d in districts_lower):
            filtered.append(story)

    return filtered


@router.get("", response_model=StoryListResponse)
async def list_stories(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    source_id: Optional[str] = Query(None, description="Filter by source ID"),
    source_ids: Optional[str] = Query(
        None,
        description="Comma-separated source IDs (multi-select filter)",
    ),
    category: Optional[str] = Query(None, description="Filter by story category"),
    from_date: Optional[datetime] = Query(None, description="Stories after this date"),
    to_date: Optional[datetime] = Query(None, description="Stories before this date"),
    nepal_only: bool = Query(True, description="Only Nepal-relevant stories"),
    multi_source_only: bool = Query(
        False,
        description="Only stories belonging to clusters with source_count > 1",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    List stories with pagination and filtering.

    By default, returns only Nepal-relevant stories.
    """
    repo = StoryRepository(db)
    parsed_source_ids = (
        [source.strip() for source in source_ids.split(",") if source.strip()]
        if source_ids
        else None
    )
    stories, total = await repo.list_stories(
        page=page,
        page_size=page_size,
        source_id=source_id,
        source_ids=parsed_source_ids,
        category=category,
        from_date=from_date,
        to_date=to_date,
        nepal_only=nepal_only,
        multi_source_only=multi_source_only,
    )

    return StoryListResponse(
        items=[StoryResponse.model_validate(s) for s in stories],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/sources")
async def list_story_sources(
    category: Optional[str] = Query(None, description="Optional category filter"),
    from_date: Optional[datetime] = Query(None, description="Source activity after this date"),
    to_date: Optional[datetime] = Query(None, description="Source activity before this date"),
    nepal_only: bool = Query(True, description="Only Nepal-relevant stories"),
    multi_source_only: bool = Query(
        False,
        description="Only sources having multi-source-cluster stories in the filter window",
    ),
    limit: int = Query(200, ge=1, le=500, description="Maximum source rows to return"),
    db: AsyncSession = Depends(get_db),
):
    """List distinct story sources and counts for stories feed filtering."""
    repo = StoryRepository(db)
    return await repo.list_sources(
        category=category,
        from_date=from_date,
        to_date=to_date,
        nepal_only=nepal_only,
        multi_source_only=multi_source_only,
        limit=limit,
    )


@router.get("/recent")
async def get_recent_stories(
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(50, ge=1, le=500, description="Max stories to return"),
    districts: Optional[str] = Query(None, description="Comma-separated district names to filter by"),
    db: AsyncSession = Depends(get_db),
):
    """Get recent Nepal-relevant stories, optionally filtered by districts."""
    repo = StoryRepository(db)

    # Parse districts parameter
    district_list = _parse_districts_param(districts)

    # Fetch more stories if filtering by district
    fetch_limit = limit * 3 if district_list else limit

    stories = await repo.get_recent(hours=hours, limit=fetch_limit, nepal_only=True)

    # Filter by districts if specified
    if district_list:
        stories = _filter_stories_by_districts(stories, district_list)
        stories = stories[:limit]

    return [StoryResponse.model_validate(s) for s in stories]


@router.get("/export")
async def export_stories_for_agent(
    hours: int = Query(4, ge=1, le=48, description="Time window in hours"),
    limit: int = Query(200, ge=1, le=1000, description="Max stories"),
    db: AsyncSession = Depends(get_db),
):
    """Export stories with full metadata for the local analyst agent.

    Returns stories with ai_summary, districts (from story_features),
    cluster info — everything the agent needs for analysis.
    """
    from sqlalchemy.orm import selectinload
    from sqlalchemy import desc, outerjoin
    from datetime import timezone, timedelta
    from app.models.story_feature import StoryFeature

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(Story, StoryFeature.districts)
        .outerjoin(StoryFeature, Story.id == StoryFeature.story_id)
        .options(selectinload(Story.cluster))
        .where(Story.created_at >= since)
        .order_by(desc(func.coalesce(Story.published_at, Story.created_at)))
        .limit(limit)
    )
    rows = result.all()

    items = []
    for s, feature_districts in rows:
        cluster_info = None
        if s.cluster:
            cluster_info = {
                "headline": s.cluster.headline,
                "confidence_level": s.cluster.confidence_level,
                "unique_sources": s.cluster.unique_sources,
                "diversity_score": s.cluster.diversity_score,
            }

        # Use feature_districts (from story_features) as primary source
        districts = feature_districts or s.districts or []

        items.append({
            "id": str(s.id),
            "title": s.title,
            "source_name": s.source_name or s.source_id,
            "published_at": s.published_at.isoformat() if s.published_at else None,
            "category": s.category,
            "severity": s.severity,
            "nepal_relevance": s.nepal_relevance,
            "ai_summary": s.ai_summary,
            "provinces": s.provinces,
            "districts": districts,
            "cluster_id": str(s.cluster_id) if s.cluster_id else None,
            "cluster": cluster_info,
        })

    return {"stories": items, "total": len(items), "since": since.isoformat()}


# ── Local Haiku runner endpoints (must be before /{story_id} catch-all) ──

class HaikuResultItem(BaseModel):
    story_id: str
    relevant: Optional[bool] = None
    ai_summary: Optional[dict] = None


class HaikuResultsPayload(BaseModel):
    task: str
    results: List[HaikuResultItem]


@router.get("/pending-haiku", dependencies=[Depends(require_dev)])
async def get_pending_haiku(
    limit: int = Query(20, ge=1, le=100),
    task: str = Query("relevance", description="relevance or summary"),
    db: AsyncSession = Depends(get_db),
):
    """Get stories needing Haiku processing (for local CLI runner)."""
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    control_service = EditorialControlService(db)
    control_key = "haiku_relevance" if task == "relevance" else "haiku_summary"
    if not await control_service.is_enabled(control_key):
        return {"task": task, "count": 0, "stories": []}

    if task == "relevance":
        cutoff = now - timedelta(hours=6)
        stmt = (
            select(Story.id, Story.title, Story.summary, Story.source_name,
                   Story.relevance_score, Story.relevance_triggers)
            .where(Story.created_at >= cutoff)
            .where(Story.relevance_score < 0.75)
            .where(Story.ai_summary.is_(None))
            .order_by(Story.created_at.desc())
            .limit(limit)
        )
    else:
        cutoff = now - timedelta(hours=12)
        stmt = (
            select(Story.id, Story.title, Story.summary, Story.source_name,
                   Story.category, Story.severity)
            .where(Story.created_at >= cutoff)
            .where(Story.nepal_relevance == "NEPAL_DOMESTIC")
            .where(Story.ai_summary.is_(None))
            .order_by(Story.created_at.desc())
            .limit(limit)
        )

    result = await db.execute(stmt)
    rows = result.all()
    return {
        "task": task,
        "count": len(rows),
        "stories": [
            {"id": str(r.id), "title": r.title, "summary": r.summary, "source_name": r.source_name}
            for r in rows
        ],
    }


@router.post("/haiku-results", dependencies=[Depends(require_dev)])
async def post_haiku_results(
    payload: HaikuResultsPayload,
    db: AsyncSession = Depends(get_db),
):
    """Ingest Haiku results from local CLI runner."""
    updated = 0
    now = datetime.now(timezone.utc)

    for item in payload.results:
        try:
            sid = UUID(item.story_id)
        except ValueError:
            continue

        if payload.task == "relevance" and item.relevant is not None:
            if not item.relevant:
                await db.execute(
                    update(Story).where(Story.id == sid).values(nepal_relevance="INTERNATIONAL")
                )
            updated += 1
        elif payload.task == "summary" and item.ai_summary:
            await db.execute(
                update(Story).where(Story.id == sid).values(ai_summary=item.ai_summary, ai_summary_at=now)
            )
            updated += 1

    await db.commit()
    return {"task": payload.task, "updated": updated, "total": len(payload.results)}


@router.get("/{story_id}", response_model=StoryResponse)
async def get_story(
    story_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single story by ID."""
    repo = StoryRepository(db)
    story = await repo.get_by_id(story_id)

    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    return StoryResponse.model_validate(story)


@router.get("/{story_id}/related")
async def get_related_stories(
    story_id: UUID,
    top_k: int = Query(8, ge=1, le=50, description="Number of related stories"),
    min_similarity: float = Query(0.6, ge=0.0, le=1.0, description="Minimum similarity threshold"),
    hours: int = Query(24 * 365 * 5, ge=1, le=24 * 365 * 10, description="Lookback window in hours"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get embedding-based related stories for a given story.

    Uses E5 semantic embeddings via pgvector nearest-neighbor search.
    """
    repo = StoryRepository(db)
    source_story = await repo.get_by_id(story_id)
    if not source_story:
        raise HTTPException(status_code=404, detail="Story not found")

    embedding_service = EmbeddingService(db)

    # Ensure the source story has an embedding before searching.
    await embedding_service.ensure_story_embedding(
        story_id=source_story.id,
        title=source_story.title,
        summary=source_story.summary,
        content=source_story.content,
        force=False,
    )

    results = await embedding_service.find_similar_to_story(
        story_id=story_id,
        hours=hours,
        top_k=top_k,
        min_similarity=min_similarity,
    )

    related_ids = [item[0] for item in results]
    if not related_ids:
        return {
            "source_story_id": str(story_id),
            "similar_stories": [],
            "total_found": 0,
            "model": "e5",
        }

    # Preserve rank returned by vector search.
    related_rows = await db.execute(select(Story).where(Story.id.in_(related_ids)))
    related_map = {story.id: story for story in related_rows.scalars().all()}

    similar_items = []
    for related_id, similarity in results:
        story = related_map.get(related_id)
        if not story:
            continue
        similar_items.append(
            {
                "story_id": str(related_id),
                "title": story.title,
                "source_name": story.source_name,
                "source_id": story.source_id,
                "url": story.url,
                "category": story.category,
                "severity": story.severity,
                "similarity": round(float(similarity), 4),
                "published_at": story.published_at.isoformat() if story.published_at else None,
            }
        )

    return {
        "source_story_id": str(story_id),
        "similar_stories": similar_items,
        "total_found": len(similar_items),
        "model": "e5",
    }


@router.post("/ingest", dependencies=[Depends(require_dev)])
async def trigger_ingestion(
    priority_only: bool = Query(False, description="Only fetch priority sources"),
    max_sources: Optional[int] = Query(None, ge=1, le=50, description="Limit sources"),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger RSS ingestion.

    Useful for testing and initial data population.
    """
    service = IngestionService(db)
    stats = await service.ingest_all(
        priority_only=priority_only,
        max_sources=max_sources,
    )
    return stats


@router.post("/ingest/{source_id}", dependencies=[Depends(require_dev)])
async def ingest_single_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a single RSS source by ID."""
    service = IngestionService(db)
    stats = await service.ingest_single_source(source_id)
    return stats


@router.post("/cluster", dependencies=[Depends(require_dev)])
async def trigger_clustering(
    hours: int = Query(72, ge=1, le=168, description="Process stories from last N hours"),
    min_cluster_size: int = Query(2, ge=2, le=10, description="Minimum stories to form cluster"),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger story clustering.

    Clusters recent stories by similarity. Stories with similar content
    from the same time window will be grouped together.
    """
    service = ClusteringService(db)
    stats = await service.cluster_stories(
        hours=hours,
        min_cluster_size=min_cluster_size,
    )

    # Also run Haiku cross-language merge pass
    try:
        merge_stats = await service.run_haiku_merge(hours=hours)
        stats["haiku_merge"] = merge_stats
    except Exception as e:
        stats["haiku_merge_error"] = str(e)

    return stats
