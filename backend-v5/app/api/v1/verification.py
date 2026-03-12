"""Verification API endpoints for peer review and consensus."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user, require_analyst
from app.models.user import User
from app.models.verification import (
    VerificationRequest,
    VerificationVote,
    VerificationStatus,
    VoteChoice,
)
from app.schemas.collaboration import (
    VerificationRequestCreate,
    VerificationRequestResponse,
    VerificationVoteCreate,
    VerificationVoteResponse,
    VerificationListResponse,
    UserBrief,
    VerificationStatusEnum,
    VoteChoiceEnum,
    VerifiableTypeEnum,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/verification", tags=["verification"])


def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


def request_to_response(req: VerificationRequest) -> VerificationRequestResponse:
    """Convert VerificationRequest model to response schema."""
    return VerificationRequestResponse(
        id=req.id,
        item_type=VerifiableTypeEnum(req.item_type.value),
        item_id=req.item_id,
        claim=req.claim,
        context=req.context,
        evidence=req.evidence,
        source_urls=req.source_urls,
        status=VerificationStatusEnum(req.status.value),
        priority=req.priority,
        required_votes=req.required_votes,
        consensus_threshold=req.consensus_threshold,
        requested_by=user_to_brief(req.requested_by),
        agree_count=req.agree_count,
        disagree_count=req.disagree_count,
        abstain_count=req.abstain_count,
        needs_info_count=req.needs_info_count,
        final_verdict=req.final_verdict,
        resolution_notes=req.resolution_notes,
        expires_at=req.expires_at,
        resolved_at=req.resolved_at,
        created_at=req.created_at,
    )


async def update_vote_counts(
    request: VerificationRequest,
    db: AsyncSession,
) -> None:
    """Recalculate vote counts and check for consensus."""
    # Get all votes
    result = await db.execute(
        select(VerificationVote).where(VerificationVote.request_id == request.id)
    )
    votes = result.scalars().all()

    # Count votes
    request.agree_count = sum(1 for v in votes if v.choice == VoteChoice.AGREE)
    request.disagree_count = sum(1 for v in votes if v.choice == VoteChoice.DISAGREE)
    request.abstain_count = sum(1 for v in votes if v.choice == VoteChoice.ABSTAIN)
    request.needs_info_count = sum(1 for v in votes if v.choice == VoteChoice.NEEDS_INFO)

    # Check for consensus
    total_decisive_votes = request.agree_count + request.disagree_count
    if total_decisive_votes >= request.required_votes:
        if request.agree_count > 0:
            agreement_ratio = request.agree_count / total_decisive_votes
            if agreement_ratio >= request.consensus_threshold:
                request.status = VerificationStatus.VERIFIED
                request.final_verdict = "verified"
                request.resolved_at = datetime.now(timezone.utc)
            elif (1 - agreement_ratio) >= request.consensus_threshold:
                request.status = VerificationStatus.REJECTED
                request.final_verdict = "rejected"
                request.resolved_at = datetime.now(timezone.utc)

    # Check if needs_info dominates
    if request.needs_info_count > total_decisive_votes:
        request.status = VerificationStatus.NEEDS_INFO


# ============================================================
# Verification Request Endpoints
# ============================================================

@router.post("", response_model=VerificationRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_verification_request(
    data: VerificationRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new verification request."""
    # Set expiration (default 7 days)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    if data.priority == "urgent":
        expires_at = datetime.now(timezone.utc) + timedelta(days=2)

    request = VerificationRequest(
        item_type=data.item_type.value,
        item_id=data.item_id,
        claim=data.claim,
        context=data.context,
        evidence=data.evidence,
        source_urls=data.source_urls,
        priority=data.priority,
        requested_by_id=current_user.id,
        expires_at=expires_at,
    )

    db.add(request)
    await db.commit()
    await db.refresh(request, ["requested_by"])

    return request_to_response(request)


@router.get("/queue", response_model=VerificationListResponse)
async def get_verification_queue(
    status_filter: Optional[VerificationStatusEnum] = Query(None, alias="status"),
    item_type: Optional[VerifiableTypeEnum] = Query(None),
    priority: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get verification queue (items pending review)."""
    query = select(VerificationRequest).options(
        selectinload(VerificationRequest.requested_by)
    )

    # Default to pending if no status specified
    if status_filter:
        query = query.where(VerificationRequest.status == status_filter.value)
    else:
        query = query.where(VerificationRequest.status == VerificationStatus.PENDING)

    if item_type:
        query = query.where(VerificationRequest.item_type == item_type.value)
    if priority:
        query = query.where(VerificationRequest.priority == priority)

    # Exclude user's own requests from queue
    query = query.where(VerificationRequest.requested_by_id != current_user.id)

    # Exclude already voted
    voted_subquery = select(VerificationVote.request_id).where(
        VerificationVote.voter_id == current_user.id
    )
    query = query.where(VerificationRequest.id.notin_(voted_subquery))

    # Get total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Order by priority and creation time
    query = query.order_by(
        VerificationRequest.priority.desc(),
        VerificationRequest.created_at.asc(),
    ).offset(skip).limit(limit)

    result = await db.execute(query)
    items = result.scalars().all()

    return VerificationListResponse(
        items=[request_to_response(r) for r in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/my-requests", response_model=VerificationListResponse)
async def get_my_verification_requests(
    status_filter: Optional[VerificationStatusEnum] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get verification requests created by the current user."""
    query = select(VerificationRequest).options(
        selectinload(VerificationRequest.requested_by)
    ).where(VerificationRequest.requested_by_id == current_user.id)

    if status_filter:
        query = query.where(VerificationRequest.status == status_filter.value)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    query = query.order_by(VerificationRequest.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    items = result.scalars().all()

    return VerificationListResponse(
        items=[request_to_response(r) for r in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/{request_id}", response_model=VerificationRequestResponse)
async def get_verification_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get a specific verification request."""
    result = await db.execute(
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.requested_by))
        .where(VerificationRequest.id == request_id)
    )
    request = result.scalar_one_or_none()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification request not found",
        )

    return request_to_response(request)


@router.get("/{request_id}/votes", response_model=list[VerificationVoteResponse])
async def get_verification_votes(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get all votes for a verification request."""
    # Verify request exists
    result = await db.execute(
        select(VerificationRequest).where(VerificationRequest.id == request_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification request not found",
        )

    # Get votes
    result = await db.execute(
        select(VerificationVote)
        .options(selectinload(VerificationVote.voter))
        .where(VerificationVote.request_id == request_id)
        .order_by(VerificationVote.created_at)
    )
    votes = result.scalars().all()

    return [
        VerificationVoteResponse(
            id=v.id,
            request_id=v.request_id,
            voter=user_to_brief(v.voter),
            choice=VoteChoiceEnum(v.choice.value),
            confidence=v.confidence,
            reasoning=v.reasoning,
            created_at=v.created_at,
        )
        for v in votes
    ]


# ============================================================
# Voting Endpoints
# ============================================================

@router.post("/{request_id}/vote", response_model=VerificationVoteResponse, status_code=status.HTTP_201_CREATED)
async def vote_on_verification(
    request_id: UUID,
    data: VerificationVoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Cast a vote on a verification request."""
    result = await db.execute(
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.requested_by))
        .where(VerificationRequest.id == request_id)
    )
    request = result.scalar_one_or_none()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification request not found",
        )

    # Cannot vote on resolved requests
    if request.status not in (VerificationStatus.PENDING, VerificationStatus.NEEDS_INFO):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification request is already resolved",
        )

    # Cannot vote on own request
    if request.requested_by_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot vote on your own verification request",
        )

    # Check if already voted
    existing_vote = await db.execute(
        select(VerificationVote).where(
            VerificationVote.request_id == request_id,
            VerificationVote.voter_id == current_user.id,
        )
    )
    if existing_vote.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already voted on this request",
        )

    # Create vote
    vote = VerificationVote(
        request_id=request_id,
        voter_id=current_user.id,
        choice=VoteChoice(data.choice.value),
        confidence=data.confidence,
        reasoning=data.reasoning,
        supporting_evidence=data.supporting_evidence,
    )

    db.add(vote)

    # Update vote counts and check consensus
    await update_vote_counts(request, db)

    await db.commit()
    await db.refresh(vote, ["voter"])

    return VerificationVoteResponse(
        id=vote.id,
        request_id=vote.request_id,
        voter=user_to_brief(vote.voter),
        choice=data.choice,
        confidence=vote.confidence,
        reasoning=vote.reasoning,
        created_at=vote.created_at,
    )


@router.patch("/{request_id}/vote", response_model=VerificationVoteResponse)
async def update_vote(
    request_id: UUID,
    data: VerificationVoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update your vote on a verification request."""
    result = await db.execute(
        select(VerificationRequest).where(VerificationRequest.id == request_id)
    )
    request = result.scalar_one_or_none()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification request not found",
        )

    # Cannot update vote on resolved requests
    if request.status not in (VerificationStatus.PENDING, VerificationStatus.NEEDS_INFO):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification request is already resolved",
        )

    # Get existing vote
    result = await db.execute(
        select(VerificationVote)
        .options(selectinload(VerificationVote.voter))
        .where(
            VerificationVote.request_id == request_id,
            VerificationVote.voter_id == current_user.id,
        )
    )
    vote = result.scalar_one_or_none()

    if not vote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You haven't voted on this request yet",
        )

    # Update vote
    vote.choice = VoteChoice(data.choice.value)
    vote.confidence = data.confidence
    vote.reasoning = data.reasoning
    vote.supporting_evidence = data.supporting_evidence

    # Update counts
    await update_vote_counts(request, db)

    await db.commit()
    await db.refresh(vote)

    return VerificationVoteResponse(
        id=vote.id,
        request_id=vote.request_id,
        voter=user_to_brief(vote.voter),
        choice=data.choice,
        confidence=vote.confidence,
        reasoning=vote.reasoning,
        created_at=vote.created_at,
    )


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_verification_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Delete a verification request (only creator can delete pending requests)."""
    result = await db.execute(
        select(VerificationRequest).where(VerificationRequest.id == request_id)
    )
    request = result.scalar_one_or_none()

    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Verification request not found",
        )

    # Only creator or dev can delete
    if request.requested_by_id != current_user.id and not current_user.is_dev():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own verification requests",
        )

    # Cannot delete resolved requests (unless dev)
    if request.status not in (VerificationStatus.PENDING, VerificationStatus.NEEDS_INFO):
        if not current_user.is_dev():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete resolved verification requests",
            )

    await db.delete(request)
    await db.commit()
