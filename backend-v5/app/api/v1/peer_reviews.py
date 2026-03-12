"""Peer review API endpoints for published StoryClusters (public feed quality control)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_analyst
from app.models.cluster_peer_review import ClusterPeerReview, PeerReviewVerdict
from app.models.story_cluster import StoryCluster
from app.models.user import User
from app.schemas.collaboration import UserBrief
from app.schemas.publishing import PeerReviewCreate, PeerReviewResponse, PeerReviewVerdictEnum

router = APIRouter(prefix="/clusters", tags=["peer-reviews"])


def user_to_brief(user: User) -> UserBrief:
    return UserBrief(id=user.id, email=user.email, full_name=user.full_name)


@router.post("/{cluster_id}/peer-reviews", response_model=PeerReviewResponse)
async def upsert_peer_review(
    cluster_id: UUID,
    data: PeerReviewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create or update the current user's peer review for a published cluster."""
    cluster = await db.scalar(select(StoryCluster).where(StoryCluster.id == cluster_id))
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")
    if not cluster.is_published:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cluster is not published",
        )

    existing = await db.scalar(
        select(ClusterPeerReview).where(
            ClusterPeerReview.cluster_id == cluster_id,
            ClusterPeerReview.reviewer_id == current_user.id,
        )
    )

    now = datetime.now(timezone.utc)
    if existing:
        existing.verdict = PeerReviewVerdict(data.verdict.value)
        existing.notes = data.notes
        existing.updated_at = now
        await db.commit()
        await db.refresh(existing)
        review = existing
    else:
        review = ClusterPeerReview(
            cluster_id=cluster_id,
            reviewer_id=current_user.id,
            verdict=PeerReviewVerdict(data.verdict.value),
            notes=data.notes,
            created_at=now,
            updated_at=now,
        )
        db.add(review)
        await db.commit()
        await db.refresh(review)

    return PeerReviewResponse(
        id=review.id,
        cluster_id=review.cluster_id,
        reviewer=user_to_brief(current_user),
        verdict=data.verdict,
        notes=review.notes,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


@router.get("/{cluster_id}/peer-reviews", response_model=list[PeerReviewResponse])
async def list_peer_reviews(
    cluster_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List peer reviews for a cluster (analyst-only)."""
    cluster = await db.scalar(select(StoryCluster).where(StoryCluster.id == cluster_id))
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")

    result = await db.execute(
        select(ClusterPeerReview)
        .where(ClusterPeerReview.cluster_id == cluster_id)
        .order_by(ClusterPeerReview.updated_at.desc())
    )
    reviews = result.scalars().all()

    # Load reviewers in a simple way (N+1 acceptable here at low volume; optimize later if needed)
    responses: list[PeerReviewResponse] = []
    for r in reviews:
        reviewer = await db.scalar(select(User).where(User.id == r.reviewer_id))
        verdict_value = r.verdict.value if hasattr(r.verdict, "value") else r.verdict
        responses.append(
            PeerReviewResponse(
                id=r.id,
                cluster_id=r.cluster_id,
                reviewer=user_to_brief(reviewer) if reviewer else UserBrief(id=r.reviewer_id, email="unknown", full_name=None),
                verdict=PeerReviewVerdictEnum(verdict_value),
                notes=r.notes,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )

    return responses
