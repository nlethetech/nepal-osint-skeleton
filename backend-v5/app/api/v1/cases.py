"""Cases API endpoints for collaborative intelligence investigations."""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_analyst
from app.models.user import User
from app.models.case import Case, CaseEvidence, CaseComment, CaseStatus, CaseVisibility
from app.models.story_cluster import StoryCluster
from app.models.team import TeamMembership
from app.schemas.collaboration import (
    CaseCreate,
    CaseUpdate,
    CaseResponse,
    CaseListResponse,
    EvidenceCreate,
    EvidenceUpdate,
    EvidenceResponse,
    CommentCreate,
    CommentUpdate,
    CommentResponse,
    UserBrief,
    CaseStatusEnum,
    CasePriorityEnum,
    CaseVisibilityEnum,
)
from app.schemas.publishing import CasePublishRequest, CasePublishResponse, ClusterPublicationResponse
from app.services.publishing_service import build_citations_from_case, publish_cluster

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cases", tags=["cases"])


# ============================================================
# Helper Functions
# ============================================================

def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


async def check_case_access(
    case: Case,
    user: User,
    db: AsyncSession,
    require_write: bool = False,
) -> bool:
    """Check if user has access to a case."""
    # Owner/creator always has access
    if case.created_by_id == user.id:
        return True

    # Assigned user has access
    if case.assigned_to_id == user.id:
        return True

    # Dev role has full access
    if user.is_dev():
        return True

    # Public cases - read access for all analysts
    if case.visibility == CaseVisibility.PUBLIC:
        if require_write:
            # Only creator/assigned can write to public cases
            return False
        return user.is_analyst_or_above()

    # Team-scoped cases - check membership
    if case.visibility == CaseVisibility.TEAM and case.team_id:
        membership = await db.execute(
            select(TeamMembership).where(
                TeamMembership.team_id == case.team_id,
                TeamMembership.user_id == user.id,
                TeamMembership.is_active == True,
            )
        )
        member = membership.scalar_one_or_none()
        if member:
            if require_write:
                # Members can write, viewers cannot
                return member.role.value != "viewer"
            return True

    # Private cases - only creator has access
    return False


async def get_case_with_access(
    case_id: UUID,
    user: User,
    db: AsyncSession,
    require_write: bool = False,
) -> Case:
    """Get a case and verify access."""
    result = await db.execute(
        select(Case)
        .options(selectinload(Case.created_by), selectinload(Case.assigned_to))
        .where(Case.id == case_id)
    )
    case = result.scalar_one_or_none()

    if not case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )

    if not await check_case_access(case, user, db, require_write):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this case",
        )

    return case


# ============================================================
# Case CRUD Endpoints
# ============================================================

@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def create_case(
    data: CaseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new investigation case."""
    if data.linked_cluster_id:
        cluster_exists = await db.scalar(select(StoryCluster.id).where(StoryCluster.id == data.linked_cluster_id))
        if not cluster_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="linked_cluster_id does not exist",
            )

    case = Case(
        title=data.title,
        description=data.description,
        priority=data.priority.value,
        visibility=data.visibility.value,
        category=data.category,
        tags=data.tags,
        hypothesis=data.hypothesis,
        created_by_id=current_user.id,
        assigned_to_id=data.assigned_to_id,
        team_id=data.team_id,
        linked_cluster_id=data.linked_cluster_id,
    )

    db.add(case)
    await db.commit()
    await db.refresh(case, ["created_by", "assigned_to"])

    # Get counts
    evidence_count = 0
    comment_count = 0

    return CaseResponse(
        id=case.id,
        title=case.title,
        description=case.description,
        status=CaseStatusEnum(case.status.value),
        priority=CasePriorityEnum(case.priority.value),
        visibility=CaseVisibilityEnum(case.visibility.value),
        category=case.category,
        tags=case.tags,
        created_by=user_to_brief(case.created_by),
        assigned_to=user_to_brief(case.assigned_to) if case.assigned_to else None,
        team_id=case.team_id,
        linked_cluster_id=case.linked_cluster_id,
        hypothesis=case.hypothesis,
        conclusion=case.conclusion,
        evidence_count=evidence_count,
        comment_count=comment_count,
        started_at=case.started_at,
        closed_at=case.closed_at,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


@router.get("", response_model=CaseListResponse)
async def list_cases(
    status: Optional[CaseStatusEnum] = Query(None),
    priority: Optional[CasePriorityEnum] = Query(None),
    category: Optional[str] = Query(None),
    team_id: Optional[UUID] = Query(None),
    assigned_to_me: bool = Query(False),
    created_by_me: bool = Query(False),
    search: Optional[str] = Query(None, min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List cases the user has access to."""
    # Build base query with visibility filter
    query = select(Case).options(
        selectinload(Case.created_by),
        selectinload(Case.assigned_to),
    )

    # Get user's team IDs
    team_memberships = await db.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.user_id == current_user.id,
            TeamMembership.is_active == True,
        )
    )
    user_team_ids = [tm for tm in team_memberships.scalars().all()]

    # Visibility filter
    visibility_conditions = [
        Case.visibility == CaseVisibility.PUBLIC,
        Case.created_by_id == current_user.id,
        Case.assigned_to_id == current_user.id,
    ]
    if user_team_ids:
        visibility_conditions.append(
            and_(
                Case.visibility == CaseVisibility.TEAM,
                Case.team_id.in_(user_team_ids),
            )
        )

    query = query.where(or_(*visibility_conditions))

    # Apply filters
    if status:
        query = query.where(Case.status == status.value)
    if priority:
        query = query.where(Case.priority == priority.value)
    if category:
        query = query.where(Case.category == category)
    if team_id:
        query = query.where(Case.team_id == team_id)
    if assigned_to_me:
        query = query.where(Case.assigned_to_id == current_user.id)
    if created_by_me:
        query = query.where(Case.created_by_id == current_user.id)
    if search:
        query = query.where(Case.title.ilike(f"%{search}%"))

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Apply pagination and ordering
    query = query.order_by(Case.updated_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    cases = result.scalars().all()

    # Get counts for each case
    items = []
    for case in cases:
        evidence_count = (await db.execute(
            select(func.count()).where(CaseEvidence.case_id == case.id)
        )).scalar() or 0
        comment_count = (await db.execute(
            select(func.count()).where(CaseComment.case_id == case.id)
        )).scalar() or 0

        items.append(CaseResponse(
            id=case.id,
            title=case.title,
            description=case.description,
            status=CaseStatusEnum(case.status.value),
            priority=CasePriorityEnum(case.priority.value),
            visibility=CaseVisibilityEnum(case.visibility.value),
            category=case.category,
            tags=case.tags,
            created_by=user_to_brief(case.created_by),
            assigned_to=user_to_brief(case.assigned_to) if case.assigned_to else None,
            team_id=case.team_id,
            linked_cluster_id=case.linked_cluster_id,
            hypothesis=case.hypothesis,
            conclusion=case.conclusion,
            evidence_count=evidence_count,
            comment_count=comment_count,
            started_at=case.started_at,
            closed_at=case.closed_at,
            created_at=case.created_at,
            updated_at=case.updated_at,
        ))

    return CaseListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/{case_id}", response_model=CaseResponse)
async def get_case(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get a single case by ID."""
    case = await get_case_with_access(case_id, current_user, db)

    evidence_count = (await db.execute(
        select(func.count()).where(CaseEvidence.case_id == case.id)
    )).scalar() or 0
    comment_count = (await db.execute(
        select(func.count()).where(CaseComment.case_id == case.id)
    )).scalar() or 0

    return CaseResponse(
        id=case.id,
        title=case.title,
        description=case.description,
        status=CaseStatusEnum(case.status.value),
        priority=CasePriorityEnum(case.priority.value),
        visibility=CaseVisibilityEnum(case.visibility.value),
        category=case.category,
        tags=case.tags,
        created_by=user_to_brief(case.created_by),
        assigned_to=user_to_brief(case.assigned_to) if case.assigned_to else None,
        team_id=case.team_id,
        linked_cluster_id=case.linked_cluster_id,
        hypothesis=case.hypothesis,
        conclusion=case.conclusion,
        evidence_count=evidence_count,
        comment_count=comment_count,
        started_at=case.started_at,
        closed_at=case.closed_at,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


@router.patch("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: UUID,
    data: CaseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update a case."""
    case = await get_case_with_access(case_id, current_user, db, require_write=True)

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    if "linked_cluster_id" in update_data and update_data["linked_cluster_id"]:
        cluster_exists = await db.scalar(select(StoryCluster.id).where(StoryCluster.id == update_data["linked_cluster_id"]))
        if not cluster_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="linked_cluster_id does not exist",
            )
    for field, value in update_data.items():
        if field == "status" and value:
            value = value.value
        elif field == "priority" and value:
            value = value.value
        elif field == "visibility" and value:
            value = value.value
        setattr(case, field, value)

    # Handle status changes
    if data.status == CaseStatusEnum.ACTIVE and not case.started_at:
        from datetime import datetime, timezone
        case.started_at = datetime.now(timezone.utc)
    elif data.status == CaseStatusEnum.CLOSED and not case.closed_at:
        from datetime import datetime, timezone
        case.closed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(case, ["created_by", "assigned_to"])

    evidence_count = (await db.execute(
        select(func.count()).where(CaseEvidence.case_id == case.id)
    )).scalar() or 0
    comment_count = (await db.execute(
        select(func.count()).where(CaseComment.case_id == case.id)
    )).scalar() or 0

    return CaseResponse(
        id=case.id,
        title=case.title,
        description=case.description,
        status=CaseStatusEnum(case.status.value),
        priority=CasePriorityEnum(case.priority.value),
        visibility=CaseVisibilityEnum(case.visibility.value),
        category=case.category,
        tags=case.tags,
        created_by=user_to_brief(case.created_by),
        assigned_to=user_to_brief(case.assigned_to) if case.assigned_to else None,
        team_id=case.team_id,
        linked_cluster_id=case.linked_cluster_id,
        hypothesis=case.hypothesis,
        conclusion=case.conclusion,
        evidence_count=evidence_count,
        comment_count=comment_count,
        started_at=case.started_at,
        closed_at=case.closed_at,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


@router.post("/{case_id}/publish", response_model=CasePublishResponse)
async def publish_case_to_feed(
    case_id: UUID,
    data: CasePublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Publish a case's findings into its linked StoryCluster (consumer feed)."""
    case = await get_case_with_access(case_id, current_user, db, require_write=True)
    if not case.linked_cluster_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Case is not linked to an event cluster (linked_cluster_id is missing)",
        )

    result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == case.linked_cluster_id)
    )
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Linked cluster not found")

    citations = await build_citations_from_case(db, case)
    headline = data.headline or case.title
    category = data.category or case.category
    severity = data.severity or (case.priority.value if hasattr(case.priority, "value") else str(case.priority))

    try:
        publication = await publish_cluster(
            db,
            cluster=cluster,
            publisher=current_user,
            headline=headline,
            category=category,
            severity=severity,
            customer_brief=data.customer_brief,
            citations=citations,
            change_note=data.change_note,
            enforce_policy=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return CasePublishResponse(
        publication=ClusterPublicationResponse(
            id=publication.id,
            cluster_id=publication.cluster_id,
            version=publication.version,
            created_by=user_to_brief(current_user),
            created_at=publication.created_at,
            headline=publication.headline,
            category=publication.category,
            severity=publication.severity,
            customer_brief=publication.customer_brief,
            citations=publication.citations,
            policy_check=publication.policy_check,
            change_note=publication.change_note,
        )
    )


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Delete a case (only creator or dev can delete)."""
    case = await get_case_with_access(case_id, current_user, db, require_write=True)

    # Only creator or dev can delete
    if case.created_by_id != current_user.id and not current_user.is_dev():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the case creator can delete this case",
        )

    await db.delete(case)
    await db.commit()


# ============================================================
# Case Evidence Endpoints
# ============================================================

@router.post("/{case_id}/evidence", response_model=EvidenceResponse, status_code=status.HTTP_201_CREATED)
async def add_evidence(
    case_id: UUID,
    data: EvidenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add evidence to a case."""
    case = await get_case_with_access(case_id, current_user, db, require_write=True)

    evidence = CaseEvidence(
        case_id=case.id,
        evidence_type=data.evidence_type.value,
        reference_id=data.reference_id,
        reference_url=data.reference_url,
        title=data.title,
        summary=data.summary,
        relevance_notes=data.relevance_notes,
        is_key_evidence=data.is_key_evidence,
        confidence=data.confidence,
        added_by_id=current_user.id,
    )

    db.add(evidence)
    await db.commit()
    await db.refresh(evidence, ["added_by"])

    return EvidenceResponse(
        id=evidence.id,
        case_id=evidence.case_id,
        evidence_type=data.evidence_type,
        reference_id=evidence.reference_id,
        reference_url=evidence.reference_url,
        title=evidence.title,
        summary=evidence.summary,
        relevance_notes=evidence.relevance_notes,
        is_key_evidence=evidence.is_key_evidence,
        confidence=evidence.confidence,
        added_by=user_to_brief(evidence.added_by),
        created_at=evidence.created_at,
    )


@router.get("/{case_id}/evidence", response_model=list[EvidenceResponse])
async def list_evidence(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List all evidence for a case."""
    case = await get_case_with_access(case_id, current_user, db)

    result = await db.execute(
        select(CaseEvidence)
        .options(selectinload(CaseEvidence.added_by))
        .where(CaseEvidence.case_id == case.id)
        .order_by(CaseEvidence.created_at.desc())
    )
    items = result.scalars().all()

    return [
        EvidenceResponse(
            id=e.id,
            case_id=e.case_id,
            evidence_type=e.evidence_type,
            reference_id=e.reference_id,
            reference_url=e.reference_url,
            title=e.title,
            summary=e.summary,
            relevance_notes=e.relevance_notes,
            is_key_evidence=e.is_key_evidence,
            confidence=e.confidence,
            added_by=user_to_brief(e.added_by),
            created_at=e.created_at,
        )
        for e in items
    ]


@router.delete("/{case_id}/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_evidence(
    case_id: UUID,
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Remove evidence from a case."""
    case = await get_case_with_access(case_id, current_user, db, require_write=True)

    result = await db.execute(
        select(CaseEvidence).where(
            CaseEvidence.id == evidence_id,
            CaseEvidence.case_id == case.id,
        )
    )
    evidence = result.scalar_one_or_none()

    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found",
        )

    # Only the person who added it or case creator/dev can delete
    if (evidence.added_by_id != current_user.id and
        case.created_by_id != current_user.id and
        not current_user.is_dev()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot remove this evidence",
        )

    await db.delete(evidence)
    await db.commit()


# ============================================================
# Case Comment Endpoints
# ============================================================

@router.post("/{case_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def add_comment(
    case_id: UUID,
    data: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add a comment to a case."""
    case = await get_case_with_access(case_id, current_user, db, require_write=True)

    # Validate parent comment if provided
    if data.parent_comment_id:
        parent = await db.execute(
            select(CaseComment).where(
                CaseComment.id == data.parent_comment_id,
                CaseComment.case_id == case.id,
            )
        )
        if not parent.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Parent comment not found",
            )

    comment = CaseComment(
        case_id=case.id,
        parent_comment_id=data.parent_comment_id,
        content=data.content,
        author_id=current_user.id,
    )

    db.add(comment)
    await db.commit()
    await db.refresh(comment, ["author"])

    return CommentResponse(
        id=comment.id,
        case_id=comment.case_id,
        parent_comment_id=comment.parent_comment_id,
        content=comment.content,
        author=user_to_brief(comment.author),
        mentions=comment.mentions,
        is_edited=comment.is_edited,
        edited_at=comment.edited_at,
        created_at=comment.created_at,
        replies=[],
    )


@router.get("/{case_id}/comments", response_model=list[CommentResponse])
async def list_comments(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List all comments for a case (threaded)."""
    case = await get_case_with_access(case_id, current_user, db)

    # Get all comments
    result = await db.execute(
        select(CaseComment)
        .options(selectinload(CaseComment.author))
        .where(CaseComment.case_id == case.id)
        .order_by(CaseComment.created_at)
    )
    all_comments = result.scalars().all()

    # Build threaded structure
    comment_map = {}
    root_comments = []

    for c in all_comments:
        response = CommentResponse(
            id=c.id,
            case_id=c.case_id,
            parent_comment_id=c.parent_comment_id,
            content=c.content,
            author=user_to_brief(c.author),
            mentions=c.mentions,
            is_edited=c.is_edited,
            edited_at=c.edited_at,
            created_at=c.created_at,
            replies=[],
        )
        comment_map[c.id] = response

        if c.parent_comment_id is None:
            root_comments.append(response)
        elif c.parent_comment_id in comment_map:
            comment_map[c.parent_comment_id].replies.append(response)

    return root_comments


@router.patch("/{case_id}/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    case_id: UUID,
    comment_id: UUID,
    data: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update a comment (only author can edit)."""
    case = await get_case_with_access(case_id, current_user, db)

    result = await db.execute(
        select(CaseComment)
        .options(selectinload(CaseComment.author))
        .where(
            CaseComment.id == comment_id,
            CaseComment.case_id == case.id,
        )
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    if comment.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own comments",
        )

    from datetime import datetime, timezone
    comment.content = data.content
    comment.is_edited = True
    comment.edited_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(comment)

    return CommentResponse(
        id=comment.id,
        case_id=comment.case_id,
        parent_comment_id=comment.parent_comment_id,
        content=comment.content,
        author=user_to_brief(comment.author),
        mentions=comment.mentions,
        is_edited=comment.is_edited,
        edited_at=comment.edited_at,
        created_at=comment.created_at,
        replies=[],
    )


@router.delete("/{case_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    case_id: UUID,
    comment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Delete a comment (only author or case creator can delete)."""
    case = await get_case_with_access(case_id, current_user, db)

    result = await db.execute(
        select(CaseComment).where(
            CaseComment.id == comment_id,
            CaseComment.case_id == case.id,
        )
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    if (comment.author_id != current_user.id and
        case.created_by_id != current_user.id and
        not current_user.is_dev()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete this comment",
        )

    await db.delete(comment)
    await db.commit()
