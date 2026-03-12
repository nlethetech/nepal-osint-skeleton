"""Analyst Notes API endpoints for personal/shared notepads."""
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
from app.models.annotation import AnalystNote, NoteVisibility
from app.schemas.collaboration import (
    NoteCreate,
    NoteUpdate,
    NoteResponse,
    UserBrief,
    NoteVisibilityEnum,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notes", tags=["notes"])


def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


# ============================================================
# Note CRUD Endpoints
# ============================================================

@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    data: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new analyst note."""
    note = AnalystNote(
        title=data.title,
        content=data.content,
        category=data.category,
        tags=data.tags,
        visibility=data.visibility.value,
        linked_items=data.linked_items,
        case_id=data.case_id,
        author_id=current_user.id,
        team_id=data.team_id,
    )

    db.add(note)
    await db.commit()
    await db.refresh(note, ["author"])

    return NoteResponse(
        id=note.id,
        title=note.title,
        content=note.content,
        category=note.category,
        tags=note.tags,
        linked_items=note.linked_items,
        case_id=note.case_id,
        author=user_to_brief(note.author),
        visibility=NoteVisibilityEnum(note.visibility.value),
        team_id=note.team_id,
        is_pinned=note.is_pinned,
        is_archived=note.is_archived,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.get("", response_model=list[NoteResponse])
async def list_notes(
    category: Optional[str] = Query(None),
    case_id: Optional[UUID] = Query(None),
    pinned_only: bool = Query(False),
    include_archived: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List analyst notes the user has access to."""
    # Get user's team IDs
    team_memberships = await db.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.user_id == current_user.id,
            TeamMembership.is_active == True,
        )
    )
    user_team_ids = [tm for tm in team_memberships.scalars().all()]

    # Build query
    query = select(AnalystNote).options(selectinload(AnalystNote.author))

    # Visibility filter: own notes, public notes, or team notes
    visibility_conditions = [
        AnalystNote.author_id == current_user.id,
        AnalystNote.visibility == NoteVisibility.PUBLIC,
    ]
    if user_team_ids:
        visibility_conditions.append(
            (AnalystNote.visibility == NoteVisibility.TEAM) &
            (AnalystNote.team_id.in_(user_team_ids))
        )

    query = query.where(or_(*visibility_conditions))

    # Apply filters
    if category:
        query = query.where(AnalystNote.category == category)
    if case_id:
        query = query.where(AnalystNote.case_id == case_id)
    if pinned_only:
        query = query.where(AnalystNote.is_pinned == True)
    if not include_archived:
        query = query.where(AnalystNote.is_archived == False)

    # Order: pinned first, then by update time
    query = query.order_by(
        AnalystNote.is_pinned.desc(),
        AnalystNote.updated_at.desc()
    ).offset(skip).limit(limit)

    result = await db.execute(query)
    notes = result.scalars().all()

    return [
        NoteResponse(
            id=n.id,
            title=n.title,
            content=n.content,
            category=n.category,
            tags=n.tags,
            linked_items=n.linked_items,
            case_id=n.case_id,
            author=user_to_brief(n.author),
            visibility=NoteVisibilityEnum(n.visibility.value),
            team_id=n.team_id,
            is_pinned=n.is_pinned,
            is_archived=n.is_archived,
            created_at=n.created_at,
            updated_at=n.updated_at,
        )
        for n in notes
    ]


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get a note by ID."""
    result = await db.execute(
        select(AnalystNote)
        .options(selectinload(AnalystNote.author))
        .where(AnalystNote.id == note_id)
    )
    note = result.scalar_one_or_none()

    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    # Check access
    if note.visibility == NoteVisibility.PRIVATE and note.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this note",
        )

    if note.visibility == NoteVisibility.TEAM and note.team_id:
        membership = await db.execute(
            select(TeamMembership).where(
                TeamMembership.team_id == note.team_id,
                TeamMembership.user_id == current_user.id,
                TeamMembership.is_active == True,
            )
        )
        if not membership.scalar_one_or_none() and note.author_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this note",
            )

    return NoteResponse(
        id=note.id,
        title=note.title,
        content=note.content,
        category=note.category,
        tags=note.tags,
        linked_items=note.linked_items,
        case_id=note.case_id,
        author=user_to_brief(note.author),
        visibility=NoteVisibilityEnum(note.visibility.value),
        team_id=note.team_id,
        is_pinned=note.is_pinned,
        is_archived=note.is_archived,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: UUID,
    data: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update a note (author only)."""
    result = await db.execute(
        select(AnalystNote)
        .options(selectinload(AnalystNote.author))
        .where(AnalystNote.id == note_id)
    )
    note = result.scalar_one_or_none()

    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    # Only author can update
    if note.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can update this note",
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "visibility" and value:
            value = value.value
        setattr(note, field, value)

    await db.commit()
    await db.refresh(note)

    return NoteResponse(
        id=note.id,
        title=note.title,
        content=note.content,
        category=note.category,
        tags=note.tags,
        linked_items=note.linked_items,
        case_id=note.case_id,
        author=user_to_brief(note.author),
        visibility=NoteVisibilityEnum(note.visibility.value),
        team_id=note.team_id,
        is_pinned=note.is_pinned,
        is_archived=note.is_archived,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Delete a note (author only)."""
    result = await db.execute(
        select(AnalystNote).where(AnalystNote.id == note_id)
    )
    note = result.scalar_one_or_none()

    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    if note.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can delete this note",
        )

    await db.delete(note)
    await db.commit()


@router.post("/{note_id}/pin", response_model=NoteResponse)
async def toggle_pin_note(
    note_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Toggle pin status on a note."""
    result = await db.execute(
        select(AnalystNote)
        .options(selectinload(AnalystNote.author))
        .where(AnalystNote.id == note_id)
    )
    note = result.scalar_one_or_none()

    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    if note.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can pin this note",
        )

    note.is_pinned = not note.is_pinned
    await db.commit()
    await db.refresh(note)

    return NoteResponse(
        id=note.id,
        title=note.title,
        content=note.content,
        category=note.category,
        tags=note.tags,
        linked_items=note.linked_items,
        case_id=note.case_id,
        author=user_to_brief(note.author),
        visibility=NoteVisibilityEnum(note.visibility.value),
        team_id=note.team_id,
        is_pinned=note.is_pinned,
        is_archived=note.is_archived,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.post("/{note_id}/archive", response_model=NoteResponse)
async def toggle_archive_note(
    note_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Toggle archive status on a note."""
    result = await db.execute(
        select(AnalystNote)
        .options(selectinload(AnalystNote.author))
        .where(AnalystNote.id == note_id)
    )
    note = result.scalar_one_or_none()

    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    if note.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can archive this note",
        )

    note.is_archived = not note.is_archived
    await db.commit()
    await db.refresh(note)

    return NoteResponse(
        id=note.id,
        title=note.title,
        content=note.content,
        category=note.category,
        tags=note.tags,
        linked_items=note.linked_items,
        case_id=note.case_id,
        author=user_to_brief(note.author),
        visibility=NoteVisibilityEnum(note.visibility.value),
        team_id=note.team_id,
        is_pinned=note.is_pinned,
        is_archived=note.is_archived,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )
