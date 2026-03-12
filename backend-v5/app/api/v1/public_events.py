"""Public event (consumer feed) endpoints.

These endpoints are accessible to any authenticated user (including consumer accounts),
but only expose published content.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user
from app.models.cluster_peer_review import ClusterPeerReview, PeerReviewVerdict
from app.models.cluster_publication import ClusterPublication
from app.models.story_cluster import StoryCluster
from app.models.user import User
from app.schemas.collaboration import UserBrief
from app.schemas.publishing import (
    PublicEventDetailResponse,
    ClusterPublicationResponse,
    PeerReviewSummary,
)
from app.services.publishing_service import build_citations_from_cluster, evaluate_publish_policy

router = APIRouter(prefix="/public", tags=["public"])


def user_to_brief(user: User) -> UserBrief:
    return UserBrief(id=user.id, email=user.email, full_name=user.full_name)


async def _get_latest_publication(db: AsyncSession, cluster_id: UUID) -> ClusterPublication | None:
    return await db.scalar(
        select(ClusterPublication)
        .where(ClusterPublication.cluster_id == cluster_id)
        .order_by(ClusterPublication.version.desc())
        .limit(1)
    )


async def _peer_review_summary(
    db: AsyncSession,
    cluster_id: UUID,
    *,
    latest_publication: ClusterPublication | None,
) -> PeerReviewSummary:
    verdict_counts = await db.execute(
        select(
            ClusterPeerReview.verdict,
            func.count(ClusterPeerReview.id),
        )
        .where(ClusterPeerReview.cluster_id == cluster_id)
        .group_by(ClusterPeerReview.verdict)
    )
    counts_map = {row[0].value if hasattr(row[0], "value") else row[0]: int(row[1]) for row in verdict_counts.all()}

    agree_count = counts_map.get(PeerReviewVerdict.AGREE.value, 0)
    needs_correction_count = counts_map.get(PeerReviewVerdict.NEEDS_CORRECTION.value, 0)
    dispute_count = counts_map.get(PeerReviewVerdict.DISPUTE.value, 0)

    last_reviewed_at = await db.scalar(
        select(func.max(ClusterPeerReview.updated_at)).where(ClusterPeerReview.cluster_id == cluster_id)
    )
    last_contested_at = await db.scalar(
        select(func.max(ClusterPeerReview.updated_at)).where(
            ClusterPeerReview.cluster_id == cluster_id,
            ClusterPeerReview.verdict.in_([PeerReviewVerdict.NEEDS_CORRECTION, PeerReviewVerdict.DISPUTE]),
        )
    )

    peer_state = "unreviewed"
    if (agree_count + needs_correction_count + dispute_count) > 0:
        if (needs_correction_count + dispute_count) > 0:
            if latest_publication and last_contested_at and latest_publication.created_at > last_contested_at:
                peer_state = "corrected"
            else:
                peer_state = "contested"
        else:
            peer_state = "reviewed"

    official_confirmation = None
    citations_count = None
    latest_version = None
    latest_publication_at = None
    if latest_publication:
        latest_version = latest_publication.version
        latest_publication_at = latest_publication.created_at
        if isinstance(latest_publication.policy_check, dict):
            official_confirmation = latest_publication.policy_check.get("official_confirmation")
        citations_count = len(latest_publication.citations or [])

    return PeerReviewSummary(
        peer_state=peer_state,
        agree_count=agree_count,
        needs_correction_count=needs_correction_count,
        dispute_count=dispute_count,
        last_reviewed_at=last_reviewed_at,
        last_contested_at=last_contested_at,
        latest_version=latest_version,
        latest_publication_at=latest_publication_at,
        official_confirmation=official_confirmation,
        citations_count=citations_count,
    )


@router.get("/events/{cluster_id}", response_model=PublicEventDetailResponse)
async def get_public_event(
    cluster_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the latest published version of an event for consumers (auth required)."""
    result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == cluster_id)
    )
    cluster = result.scalar_one_or_none()
    if not cluster or not cluster.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    pub = await _get_latest_publication(db, cluster_id)
    if not pub:
        # Backfill for legacy publishes: derive citations from cluster stories
        citations = await build_citations_from_cluster(db, cluster)
        policy = evaluate_publish_policy(citations).as_dict()
        policy["total_citations"] = len(citations)

        pub = ClusterPublication(
            id=cluster.id,  # deterministic placeholder (not persisted)
            cluster_id=cluster.id,
            version=0,
            created_by_id=cluster.published_by_id,
            created_at=cluster.published_at or datetime.now(timezone.utc),
            headline=cluster.analyst_headline or cluster.headline,
            category=cluster.analyst_category or cluster.category,
            severity=cluster.analyst_severity or cluster.severity,
            customer_brief=cluster.customer_brief or cluster.analyst_summary or cluster.summary,
            citations=citations,
            policy_check=policy,
            change_note=None,
        )

    created_by = None
    if pub.created_by_id:
        user = await db.scalar(select(User).where(User.id == pub.created_by_id))
        if user:
            created_by = user_to_brief(user)

    publication_response = ClusterPublicationResponse(
        id=pub.id,
        cluster_id=pub.cluster_id,
        version=pub.version,
        created_by=created_by,
        created_at=pub.created_at,
        headline=pub.headline,
        category=pub.category,
        severity=pub.severity,
        customer_brief=pub.customer_brief,
        citations=pub.citations,
        policy_check=pub.policy_check,
        change_note=pub.change_note,
    )

    peer_review = await _peer_review_summary(db, cluster_id, latest_publication=pub if pub.version > 0 else None)

    return PublicEventDetailResponse(
        cluster_id=cluster.id,
        headline=cluster.analyst_headline or cluster.headline,
        category=cluster.analyst_category or cluster.category,
        severity=cluster.analyst_severity or cluster.severity,
        published_at=cluster.published_at,
        publication=publication_response,
        peer_review=peer_review,
    )
