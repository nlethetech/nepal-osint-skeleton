"""Analysis API endpoints for cluster briefings and story summaries."""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_dev
from app.models.user import User
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.analysis_batch import AnalysisBatch
from app.services.analysis import BriefingService
from app.services.analysis.story_summarizer import get_story_summarizer
from app.schemas.analysis import (
    ClusterAnalysisResponse,
    BatchAnalysisRequest,
    BatchAnalysisResponse,
    BatchStatusResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analysis", tags=["analysis"])


# ============================================================
# Bulk BLUF Update (for local Haiku agent)
# ============================================================

class ClusterBlufItem(BaseModel):
    cluster_id: str
    bluf: str

class BulkBlufRequest(BaseModel):
    items: list[ClusterBlufItem]

@router.post("/clusters/bulk-bluf")
async def bulk_update_blufs(
    payload: BulkBlufRequest,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Bulk update BLUFs for clusters from local Haiku agent. DEV only."""
    updated = 0
    for item in payload.items:
        result = await db.execute(
            select(StoryCluster).where(StoryCluster.id == item.cluster_id)
        )
        cluster = result.scalar_one_or_none()
        if cluster:
            cluster.bluf = item.bluf
            cluster.analyzed_at = datetime.now(timezone.utc)
            cluster.analysis_model = "claude-haiku-local"
            updated += 1
    await db.commit()
    return {"updated": updated, "total": len(payload.items)}


@router.get(
    "/clusters/{cluster_id}",
    response_model=ClusterAnalysisResponse,
)
async def get_cluster_analysis(
    cluster_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Get full analysis for a cluster.

    Includes BLUF, threat assessment, and source details.
    """
    result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == cluster_id)
    )
    cluster = result.scalar_one_or_none()

    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    return ClusterAnalysisResponse.from_cluster(cluster)


@router.post(
    "/clusters/{cluster_id}/analyze",
    response_model=ClusterAnalysisResponse,
)
async def analyze_cluster_now(
    cluster_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze a cluster immediately (synchronous).

    Uses direct API call instead of batch for immediate results.
    Note: This is more expensive than batch analysis.
    """
    service = BriefingService(db)
    result = await service.generate_single_briefing(cluster_id)

    if not result.success:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {result.error}",
        )

    # Fetch and return updated cluster
    cluster_result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == cluster_id)
    )
    cluster = cluster_result.scalar_one_or_none()

    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    return ClusterAnalysisResponse.from_cluster(cluster)


@router.post(
    "/batch",
    response_model=BatchAnalysisResponse,
)
async def submit_batch_analysis(
    request: BatchAnalysisRequest = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit clusters for batch analysis.

    Uses Anthropic Batch API for 50% cost savings.
    Results available within 24 hours.
    """
    service = BriefingService(db)

    if request and request.cluster_ids:
        # Analyze specific clusters
        batch_id = await service.submit_batch_analysis(request.cluster_ids)
    else:
        # Find and analyze unanalyzed clusters
        hours = request.hours if request else 72
        limit = request.limit if request else 50
        batch_id = await service.analyze_unanalyzed_clusters(hours=hours, limit=limit)

    if not batch_id:
        raise HTTPException(
            status_code=400,
            detail="No clusters to analyze or batch submission failed",
        )

    # Get batch record
    result = await db.execute(
        select(AnalysisBatch).where(AnalysisBatch.anthropic_batch_id == batch_id)
    )
    batch = result.scalar_one_or_none()

    if not batch:
        raise HTTPException(status_code=500, detail="Failed to create batch record")

    return BatchAnalysisResponse(
        batch_id=str(batch.id),
        anthropic_batch_id=batch_id,
        clusters_queued=batch.total_clusters,
        estimated_completion="Results available within 24 hours",
    )


@router.get(
    "/batch/{batch_id}/status",
    response_model=BatchStatusResponse,
)
async def get_batch_status(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get status of a batch analysis request.

    Check this periodically to know when results are ready.
    """
    # Try to find by our ID or Anthropic ID
    result = await db.execute(
        select(AnalysisBatch).where(
            (AnalysisBatch.id == batch_id) |
            (AnalysisBatch.anthropic_batch_id == batch_id)
        )
    )
    batch = result.scalar_one_or_none()

    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Check with Anthropic if still processing
    if batch.status in ("pending", "processing"):
        service = BriefingService(db)
        status = await service.check_and_process_batch(batch.anthropic_batch_id)

        # Refresh batch from DB
        await db.refresh(batch)

    return BatchStatusResponse(
        batch_id=str(batch.id),
        status=batch.status,
        progress_percent=batch.progress_percent,
        total_clusters=batch.total_clusters,
        completed_clusters=batch.completed_clusters,
        error_message=batch.error_message,
        created_at=batch.created_at,
        completed_at=batch.completed_at,
    )


@router.get("/batches")
async def list_batches(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List recent analysis batches."""
    query = select(AnalysisBatch).order_by(AnalysisBatch.created_at.desc())

    if status:
        query = query.where(AnalysisBatch.status == status)

    query = query.limit(limit)

    result = await db.execute(query)
    batches = result.scalars().all()

    return {
        "batches": [
            {
                "id": str(b.id),
                "anthropic_batch_id": b.anthropic_batch_id,
                "status": b.status,
                "total_clusters": b.total_clusters,
                "completed_clusters": b.completed_clusters,
                "created_at": b.created_at.isoformat(),
            }
            for b in batches
        ],
        "total": len(batches),
    }


# ============================================================================
# Story Summarization Endpoints (Claude Haiku 3.5 with Prompt Caching)
# ============================================================================

class StorySummaryResponse(BaseModel):
    """Response for story summarization."""
    headline: str
    summary: str
    category: str
    severity: str
    key_entities: list[str]
    verified: bool
    confidence: float
    cached: bool  # Whether prompt caching was used
    usage: dict  # Token usage info


class ClusterSummaryResponse(BaseModel):
    """Response for cluster summarization."""
    cluster_id: str
    headline: str
    summary: str
    category: str
    severity: str
    key_entities: list[str]
    source_count: int
    story_count: int
    sources: list[str]
    verified: bool
    confidence: float
    cached: bool
    usage: dict


@router.get("/stories/{story_id}/summary", response_model=StorySummaryResponse)
async def get_story_summary(
    story_id: UUID,
    force_refresh: bool = Query(False, description="Force regenerate, ignore cache"),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a summary for a single story.

    Summaries are cached in database - subsequent requests return cached version.
    Set force_refresh=true to regenerate the summary.
    """
    from datetime import datetime, timezone

    # Fetch story
    result = await db.execute(
        select(Story).where(Story.id == story_id)
    )
    story = result.scalar_one_or_none()

    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # Check if we have a cached summary (and not forcing refresh)
    if story.ai_summary and not force_refresh:
        cached = story.ai_summary
        return StorySummaryResponse(
            headline=cached.get("headline", story.title),
            summary=cached.get("summary", ""),
            category=cached.get("category", story.category or ""),
            severity=cached.get("severity", story.severity or "medium"),
            key_entities=cached.get("key_entities", []),
            verified=cached.get("verified", False),
            confidence=cached.get("confidence", 0.5),
            cached=True,  # This is from DB cache
            usage={
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_status": "DB_CACHE",
            },
        )

    # Generate new summary
    summarizer = get_story_summarizer()
    summary = await summarizer.summarize_story(
        title=story.title,
        content=story.summary or story.content,
        source_name=story.source_name,
    )

    if not summary:
        raise HTTPException(
            status_code=503,
            detail="Summarization service unavailable. Check ANTHROPIC_API_KEY.",
        )

    # Cache the summary in database
    story.ai_summary = {
        "headline": summary.headline or story.title,
        "summary": summary.summary,
        "category": summary.category or story.category or "",
        "severity": summary.severity or story.severity or "medium",
        "key_entities": summary.key_entities,
        "verified": summary.verified,
        "confidence": summary.confidence,
    }
    story.ai_summary_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info(f"Cached AI summary for story {story_id}")

    return StorySummaryResponse(
        headline=summary.headline or story.title,
        summary=summary.summary,
        category=summary.category or story.category or "",
        severity=summary.severity or story.severity or "medium",
        key_entities=summary.key_entities,
        verified=summary.verified,
        confidence=summary.confidence,
        cached=summary.cached,  # Anthropic prompt cache status
        usage={
            "input_tokens": summary.input_tokens,
            "output_tokens": summary.output_tokens,
            "cache_status": "HIT" if summary.cached else "MISS",
        },
    )


@router.get("/clusters/{cluster_id}/summary", response_model=ClusterSummaryResponse)
async def get_cluster_summary(
    cluster_id: UUID,
    force_refresh: bool = Query(False, description="Force regenerate, ignore cache"),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate an aggregated news summary for a story cluster.

    Aggregates information from all stories in the cluster and generates
    a unified summary from multiple sources.

    Summaries are cached in database - subsequent requests return cached version.
    Set force_refresh=true to regenerate the summary.
    """
    from datetime import datetime, timezone

    # Fetch cluster with stories
    result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == cluster_id)
    )
    cluster = result.scalar_one_or_none()

    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    if not cluster.stories:
        raise HTTPException(status_code=400, detail="Cluster has no stories")

    # Get unique sources (needed for both cached and fresh responses)
    sources = list(set(
        s.source_name or s.source_id
        for s in cluster.stories
        if s.source_name or s.source_id
    ))

    # Check if we have a cached summary (and not forcing refresh)
    if cluster.analysis and not force_refresh:
        cached = cluster.analysis
        return ClusterSummaryResponse(
            cluster_id=str(cluster.id),
            headline=cached.get("headline", cluster.headline),
            summary=cached.get("summary", ""),
            category=cached.get("category", cluster.category or ""),
            severity=cached.get("severity", cluster.severity or "medium"),
            key_entities=cached.get("key_entities", []),
            source_count=len(sources),
            story_count=len(cluster.stories),
            sources=sources,
            verified=cached.get("verified", False),
            confidence=cached.get("confidence", 0.5),
            cached=True,  # This is from DB cache
            usage={
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_status": "DB_CACHE",
            },
        )

    # Build story list for summarization
    stories = [
        {
            "title": s.title,
            "summary": s.summary,
            "source_name": s.source_name,
        }
        for s in cluster.stories
    ]

    # Generate summary
    summarizer = get_story_summarizer()
    summary = await summarizer.summarize_cluster(
        stories=stories,
        cluster_headline=cluster.headline,
    )

    if not summary:
        raise HTTPException(
            status_code=503,
            detail="Summarization service unavailable. Check ANTHROPIC_API_KEY.",
        )

    # Cache the summary in database
    cluster.analysis = {
        "headline": summary.headline or cluster.headline,
        "summary": summary.summary,
        "category": summary.category or cluster.category or "",
        "severity": summary.severity or cluster.severity or "medium",
        "key_entities": summary.key_entities,
        "verified": summary.verified,
        "confidence": summary.confidence,
    }
    cluster.analyzed_at = datetime.now(timezone.utc)
    cluster.analysis_model = "claude-3-haiku-20240307"
    await db.commit()

    logger.info(f"Cached AI summary for cluster {cluster_id}")

    return ClusterSummaryResponse(
        cluster_id=str(cluster.id),
        headline=summary.headline or cluster.headline,
        summary=summary.summary,
        category=summary.category or cluster.category or "",
        severity=summary.severity or cluster.severity or "medium",
        key_entities=summary.key_entities,
        source_count=len(sources),
        story_count=len(cluster.stories),
        sources=sources,
        verified=summary.verified,
        confidence=summary.confidence,
        cached=summary.cached,  # Anthropic prompt cache status
        usage={
            "input_tokens": summary.input_tokens,
            "output_tokens": summary.output_tokens,
            "cache_status": "HIT" if summary.cached else "MISS",
        },
    )
