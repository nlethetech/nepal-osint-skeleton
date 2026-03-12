"""Activity feed and analyst metrics API endpoints."""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user, require_analyst
from app.models.user import User
from app.models.team import TeamMembership
from app.models.analyst_metrics import AnalystActivity, AnalystMetrics, ActivityType
from app.schemas.collaboration import (
    ActivityResponse,
    ActivityFeedResponse,
    AnalystMetricsResponse,
    LeaderboardEntry,
    LeaderboardResponse,
    UserBrief,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/activity", tags=["activity"])


def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


# ============================================================
# Activity Feed Endpoints
# ============================================================

@router.get("/feed", response_model=ActivityFeedResponse)
async def get_activity_feed(
    team_id: Optional[UUID] = Query(None, description="Filter by team"),
    activity_type: Optional[str] = Query(None, description="Filter by activity type"),
    target_type: Optional[str] = Query(None, description="Filter by target type"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get the activity feed for the current user's context."""
    # Get user's team IDs
    team_memberships = await db.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.user_id == current_user.id,
            TeamMembership.is_active == True,
        )
    )
    user_team_ids = [tm for tm in team_memberships.scalars().all()]

    # Build query
    query = select(AnalystActivity).options(selectinload(AnalystActivity.user))

    # Visibility: public activities OR activities in user's teams
    visibility_conditions = [AnalystActivity.is_public == True]
    if user_team_ids:
        visibility_conditions.append(AnalystActivity.team_id.in_(user_team_ids))

    query = query.where(or_(*visibility_conditions))

    # Apply filters
    if team_id:
        if team_id not in user_team_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this team's activity",
            )
        query = query.where(AnalystActivity.team_id == team_id)

    if activity_type:
        query = query.where(AnalystActivity.activity_type == activity_type)
    if target_type:
        query = query.where(AnalystActivity.target_type == target_type)

    # Get total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Order and paginate
    query = query.order_by(AnalystActivity.created_at.desc()).offset(skip).limit(limit + 1)

    result = await db.execute(query)
    activities = result.scalars().all()

    # Check if there are more
    has_more = len(activities) > limit
    if has_more:
        activities = activities[:limit]

    return ActivityFeedResponse(
        items=[
            ActivityResponse(
                id=a.id,
                user=user_to_brief(a.user),
                activity_type=a.activity_type.value,
                target_type=a.target_type,
                target_id=a.target_id,
                description=a.description,
                extra_data=a.extra_data,
                team_id=a.team_id,
                created_at=a.created_at,
            )
            for a in activities
        ],
        total=total,
        has_more=has_more,
    )


@router.get("/mentions", response_model=ActivityFeedResponse)
async def get_mentions(
    unread_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get activities where the current user is mentioned."""
    # Query for activities mentioning the current user
    # Using JSON contains for PostgreSQL JSONB
    query = select(AnalystActivity).options(
        selectinload(AnalystActivity.user)
    ).where(
        AnalystActivity.mentioned_user_ids.contains([str(current_user.id)])
    )

    # Get total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Order and paginate
    query = query.order_by(AnalystActivity.created_at.desc()).offset(skip).limit(limit + 1)

    result = await db.execute(query)
    activities = result.scalars().all()

    has_more = len(activities) > limit
    if has_more:
        activities = activities[:limit]

    return ActivityFeedResponse(
        items=[
            ActivityResponse(
                id=a.id,
                user=user_to_brief(a.user),
                activity_type=a.activity_type.value,
                target_type=a.target_type,
                target_id=a.target_id,
                description=a.description,
                extra_data=a.extra_data,
                team_id=a.team_id,
                created_at=a.created_at,
            )
            for a in activities
        ],
        total=total,
        has_more=has_more,
    )


# ============================================================
# Analyst Metrics Endpoints
# ============================================================

@router.get("/me/metrics", response_model=AnalystMetricsResponse)
async def get_my_metrics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get the current user's analyst metrics."""
    result = await db.execute(
        select(AnalystMetrics)
        .options(selectinload(AnalystMetrics.user))
        .where(AnalystMetrics.user_id == current_user.id)
    )
    metrics = result.scalar_one_or_none()

    if not metrics:
        # Create default metrics
        metrics = AnalystMetrics(user_id=current_user.id)
        db.add(metrics)
        await db.commit()
        await db.refresh(metrics, ["user"])

    return AnalystMetricsResponse(
        user=user_to_brief(metrics.user),
        total_cases=metrics.total_cases,
        cases_closed=metrics.cases_closed,
        evidence_added=metrics.evidence_added,
        comments_posted=metrics.comments_posted,
        verifications_requested=metrics.verifications_requested,
        verifications_voted=metrics.verifications_voted,
        verifications_correct=metrics.verifications_correct,
        verification_accuracy=metrics.verification_accuracy,
        entities_created=metrics.entities_created,
        stories_annotated=metrics.stories_annotated,
        notes_created=metrics.notes_created,
        active_days=metrics.active_days,
        current_streak=metrics.current_streak,
        longest_streak=metrics.longest_streak,
        last_active_at=metrics.last_active_at,
        badges=metrics.badges or [],
        reputation_score=metrics.reputation_score,
        threat_score=metrics.threat_score,
        economic_score=metrics.economic_score,
        political_score=metrics.political_score,
    )


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    sort_by: str = Query("reputation", description="Sort by: reputation, accuracy, cases"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get the analyst leaderboard."""
    query = select(AnalystMetrics).options(selectinload(AnalystMetrics.user))

    # Sort
    if sort_by == "accuracy":
        query = query.where(AnalystMetrics.verification_accuracy.isnot(None))
        query = query.order_by(AnalystMetrics.verification_accuracy.desc())
    elif sort_by == "cases":
        query = query.order_by(AnalystMetrics.total_cases.desc())
    else:
        query = query.order_by(AnalystMetrics.reputation_score.desc())

    query = query.limit(limit)

    result = await db.execute(query)
    metrics_list = result.scalars().all()

    # Get total count
    total = (await db.execute(
        select(func.count()).where(AnalystMetrics.user_id.isnot(None))
    )).scalar() or 0

    entries = []
    for rank, m in enumerate(metrics_list, start=1):
        entries.append(LeaderboardEntry(
            rank=rank,
            user=user_to_brief(m.user),
            reputation_score=m.reputation_score,
            verification_accuracy=m.verification_accuracy,
            total_cases=m.total_cases,
            badges=m.badges or [],
        ))

    return LeaderboardResponse(
        entries=entries,
        total_analysts=total,
    )


@router.get("/analysts/{user_id}/metrics", response_model=AnalystMetricsResponse)
async def get_analyst_metrics(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get metrics for a specific analyst."""
    result = await db.execute(
        select(AnalystMetrics)
        .options(selectinload(AnalystMetrics.user))
        .where(AnalystMetrics.user_id == user_id)
    )
    metrics = result.scalar_one_or_none()

    if not metrics:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analyst metrics not found",
        )

    return AnalystMetricsResponse(
        user=user_to_brief(metrics.user),
        total_cases=metrics.total_cases,
        cases_closed=metrics.cases_closed,
        evidence_added=metrics.evidence_added,
        comments_posted=metrics.comments_posted,
        verifications_requested=metrics.verifications_requested,
        verifications_voted=metrics.verifications_voted,
        verifications_correct=metrics.verifications_correct,
        verification_accuracy=metrics.verification_accuracy,
        entities_created=metrics.entities_created,
        stories_annotated=metrics.stories_annotated,
        notes_created=metrics.notes_created,
        active_days=metrics.active_days,
        current_streak=metrics.current_streak,
        longest_streak=metrics.longest_streak,
        last_active_at=metrics.last_active_at,
        badges=metrics.badges or [],
        reputation_score=metrics.reputation_score,
        threat_score=metrics.threat_score,
        economic_score=metrics.economic_score,
        political_score=metrics.political_score,
    )
