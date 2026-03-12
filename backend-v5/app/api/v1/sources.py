"""Source Reliability API endpoints using Admiralty System ratings."""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user, require_analyst
from app.models.user import User
from app.models.annotation import SourceReliability
from app.schemas.collaboration import (
    SourceReliabilityResponse,
    SourceRatingCreate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sources", tags=["sources"])


# ============================================================
# Source Reliability Endpoints
# ============================================================

@router.get("", response_model=list[SourceReliabilityResponse])
async def list_sources(
    source_type: Optional[str] = Query(None, description="Filter by source type: rss, social, government, wire, blog"),
    min_confidence: Optional[int] = Query(None, ge=0, le=100, description="Minimum confidence score"),
    sort_by: str = Query("confidence", description="Sort by: confidence, name, stories"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List all source reliability ratings."""
    query = select(SourceReliability)

    # Apply filters
    if source_type:
        query = query.where(SourceReliability.source_type == source_type)
    if min_confidence is not None:
        query = query.where(SourceReliability.confidence_score >= min_confidence)

    # Sort
    if sort_by == "name":
        query = query.order_by(SourceReliability.source_name)
    elif sort_by == "stories":
        query = query.order_by(SourceReliability.total_stories.desc())
    else:  # confidence (default)
        query = query.order_by(SourceReliability.confidence_score.desc())

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    sources = result.scalars().all()

    return [
        SourceReliabilityResponse(
            source_id=s.source_id,
            source_name=s.source_name,
            source_type=s.source_type,
            reliability_rating=s.reliability_rating,
            credibility_rating=s.credibility_rating,
            confidence_score=s.confidence_score,
            admiralty_code=s.admiralty_code,
            total_stories=s.total_stories,
            verified_true=s.verified_true,
            verified_false=s.verified_false,
            total_ratings=s.total_ratings,
            average_user_rating=s.average_user_rating,
            notes=s.notes,
        )
        for s in sources
    ]


@router.get("/stats")
async def get_source_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get aggregate statistics about source reliability."""
    total_sources = (await db.execute(
        select(func.count()).select_from(SourceReliability)
    )).scalar() or 0

    # Count by rating
    rating_counts = {}
    for rating in ['A', 'B', 'C', 'D', 'E', 'F']:
        count = (await db.execute(
            select(func.count()).where(SourceReliability.reliability_rating == rating)
        )).scalar() or 0
        rating_counts[rating] = count

    # Average confidence
    avg_confidence = (await db.execute(
        select(func.avg(SourceReliability.confidence_score))
    )).scalar() or 0

    # Count by type
    type_counts = {}
    for source_type in ['rss', 'social', 'government', 'wire', 'blog']:
        count = (await db.execute(
            select(func.count()).where(SourceReliability.source_type == source_type)
        )).scalar() or 0
        type_counts[source_type] = count

    return {
        "total_sources": total_sources,
        "rating_distribution": rating_counts,
        "average_confidence": round(avg_confidence, 1),
        "type_distribution": type_counts,
    }


@router.get("/{source_id}", response_model=SourceReliabilityResponse)
async def get_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get a source reliability rating by ID."""
    result = await db.execute(
        select(SourceReliability).where(SourceReliability.source_id == source_id)
    )
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )

    return SourceReliabilityResponse(
        source_id=source.source_id,
        source_name=source.source_name,
        source_type=source.source_type,
        reliability_rating=source.reliability_rating,
        credibility_rating=source.credibility_rating,
        confidence_score=source.confidence_score,
        admiralty_code=source.admiralty_code,
        total_stories=source.total_stories,
        verified_true=source.verified_true,
        verified_false=source.verified_false,
        total_ratings=source.total_ratings,
        average_user_rating=source.average_user_rating,
        notes=source.notes,
    )


@router.post("/{source_id}/rate", response_model=SourceReliabilityResponse)
async def rate_source(
    source_id: str,
    data: SourceRatingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Rate a source's reliability (analyst action)."""
    result = await db.execute(
        select(SourceReliability).where(SourceReliability.source_id == source_id)
    )
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )

    # Validate rating values
    if data.reliability_rating not in 'ABCDEF':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reliability rating must be A-F",
        )
    if data.credibility_rating < 1 or data.credibility_rating > 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Credibility rating must be 1-6",
        )

    # Update the rating
    source.reliability_rating = data.reliability_rating
    source.credibility_rating = data.credibility_rating
    if data.notes:
        source.notes = data.notes

    # Recalculate confidence score based on Admiralty ratings
    # A=100, B=80, C=60, D=40, E=20, F=10 for reliability
    # 1=100, 2=80, 3=60, 4=40, 5=20, 6=10 for credibility
    reliability_scores = {'A': 100, 'B': 80, 'C': 60, 'D': 40, 'E': 20, 'F': 10}
    credibility_scores = {1: 100, 2: 80, 3: 60, 4: 40, 5: 20, 6: 10}

    rel_score = reliability_scores.get(data.reliability_rating, 50)
    cred_score = credibility_scores.get(data.credibility_rating, 50)
    source.confidence_score = int((rel_score + cred_score) / 2)

    source.total_ratings += 1
    source.last_rated_by_id = current_user.id
    source.last_rated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(source)

    return SourceReliabilityResponse(
        source_id=source.source_id,
        source_name=source.source_name,
        source_type=source.source_type,
        reliability_rating=source.reliability_rating,
        credibility_rating=source.credibility_rating,
        confidence_score=source.confidence_score,
        admiralty_code=source.admiralty_code,
        total_stories=source.total_stories,
        verified_true=source.verified_true,
        verified_false=source.verified_false,
        total_ratings=source.total_ratings,
        average_user_rating=source.average_user_rating,
        notes=source.notes,
    )


@router.post("", response_model=SourceReliabilityResponse, status_code=status.HTTP_201_CREATED)
async def create_source(
    source_id: str = Query(..., description="Unique source identifier"),
    source_name: str = Query(..., description="Display name"),
    source_type: str = Query(..., description="Source type: rss, social, government, wire, blog"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new source reliability entry."""
    # Check if source already exists
    existing = await db.execute(
        select(SourceReliability).where(SourceReliability.source_id == source_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source already exists",
        )

    source = SourceReliability(
        source_id=source_id,
        source_name=source_name,
        source_type=source_type,
        reliability_rating='F',  # Default: cannot be judged
        credibility_rating=6,    # Default: cannot be judged
        confidence_score=10,     # Default: low confidence
    )

    db.add(source)
    await db.commit()
    await db.refresh(source)

    return SourceReliabilityResponse(
        source_id=source.source_id,
        source_name=source.source_name,
        source_type=source.source_type,
        reliability_rating=source.reliability_rating,
        credibility_rating=source.credibility_rating,
        confidence_score=source.confidence_score,
        admiralty_code=source.admiralty_code,
        total_stories=source.total_stories,
        verified_true=source.verified_true,
        verified_false=source.verified_false,
        total_ratings=source.total_ratings,
        average_user_rating=source.average_user_rating,
        notes=source.notes,
    )
