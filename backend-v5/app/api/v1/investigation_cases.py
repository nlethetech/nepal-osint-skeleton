"""Investigation Case Management API endpoints."""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_analyst
from app.models.user import User
from app.schemas.investigation_case import (
    CaseCreate,
    CaseUpdate,
    CaseResponse,
    CaseDetailResponse,
    CaseListResponse,
    CaseEntityCreate,
    CaseEntityResponse,
    CaseFindingCreate,
    CaseFindingResponse,
    CaseNoteCreate,
    CaseNoteResponse,
    InvestigationStatusEnum,
    UserBrief,
)
from app.services.investigation_case_service import InvestigationCaseService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/investigation-cases", tags=["investigation-cases"])


# ============================================================
# Helpers
# ============================================================

def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


def _case_to_response(case, summary: dict) -> CaseResponse:
    """Convert case model + summary counts to response."""
    return CaseResponse(
        id=case.id,
        title=case.title,
        description=case.description,
        status=case.status,
        priority=case.priority,
        created_by=user_to_brief(case.created_by),
        assigned_to=user_to_brief(case.assigned_to) if case.assigned_to else None,
        created_at=case.created_at,
        updated_at=case.updated_at,
        closed_at=case.closed_at,
        entity_count=summary.get("entity_count", 0),
        finding_count=summary.get("finding_count", 0),
        note_count=summary.get("note_count", 0),
    )


def _entity_to_response(entity) -> CaseEntityResponse:
    """Convert entity model to response."""
    return CaseEntityResponse(
        id=entity.id,
        case_id=entity.case_id,
        entity_type=entity.entity_type,
        entity_id=entity.entity_id,
        entity_label=entity.entity_label,
        added_by=user_to_brief(entity.added_by),
        added_at=entity.added_at,
        notes=entity.notes,
    )


def _finding_to_response(finding) -> CaseFindingResponse:
    """Convert finding model to response."""
    return CaseFindingResponse(
        id=finding.id,
        case_id=finding.case_id,
        finding_type=finding.finding_type,
        title=finding.title,
        description=finding.description,
        severity=finding.severity,
        source_type=finding.source_type,
        source_id=finding.source_id,
        created_by=user_to_brief(finding.created_by),
        created_at=finding.created_at,
    )


def _note_to_response(note) -> CaseNoteResponse:
    """Convert note model to response."""
    return CaseNoteResponse(
        id=note.id,
        case_id=note.case_id,
        content=note.content,
        created_by=user_to_brief(note.created_by),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


# ============================================================
# Case CRUD
# ============================================================

@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def create_case(
    data: CaseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new investigation case."""
    svc = InvestigationCaseService(db)
    case = await svc.create_case(
        title=data.title,
        description=data.description,
        priority=data.priority.value,
        created_by_id=current_user.id,
        assigned_to_id=data.assigned_to_id,
    )
    summary = await svc.get_case_summary(case.id)
    return _case_to_response(case, summary)


@router.get("", response_model=CaseListResponse)
async def list_cases(
    status_filter: Optional[InvestigationStatusEnum] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List investigation cases with optional status filter and pagination."""
    svc = InvestigationCaseService(db)
    cases, total = await svc.list_cases(
        status=status_filter.value if status_filter else None,
        skip=skip,
        limit=limit,
    )

    items = []
    for case in cases:
        summary = await svc.get_case_summary(case.id)
        items.append(_case_to_response(case, summary))

    return CaseListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/{case_id}", response_model=CaseDetailResponse)
async def get_case(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get a single investigation case with all entities, findings, and notes."""
    svc = InvestigationCaseService(db)
    case = await svc.get_case(case_id)

    if not case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investigation case not found",
        )

    summary = await svc.get_case_summary(case.id)
    base = _case_to_response(case, summary)

    return CaseDetailResponse(
        **base.model_dump(),
        entities=[_entity_to_response(e) for e in case.entities],
        findings=[_finding_to_response(f) for f in case.findings],
        notes=[_note_to_response(n) for n in case.notes],
    )


@router.patch("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: UUID,
    data: CaseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update an investigation case."""
    svc = InvestigationCaseService(db)

    update_data = data.model_dump(exclude_unset=True)
    # Convert enum values to strings
    if "status" in update_data and update_data["status"] is not None:
        update_data["status"] = update_data["status"].value
    if "priority" in update_data and update_data["priority"] is not None:
        update_data["priority"] = update_data["priority"].value

    case = await svc.update_case(case_id, **update_data)

    if not case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investigation case not found",
        )

    summary = await svc.get_case_summary(case.id)
    return _case_to_response(case, summary)


# ============================================================
# Case Entities
# ============================================================

@router.post("/{case_id}/entities", response_model=CaseEntityResponse, status_code=status.HTTP_201_CREATED)
async def add_entity(
    case_id: UUID,
    data: CaseEntityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add an entity to an investigation case."""
    svc = InvestigationCaseService(db)

    # Verify case exists
    case = await svc.get_case(case_id)
    if not case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investigation case not found",
        )

    entity = await svc.add_entity_to_case(
        case_id=case_id,
        entity_type=data.entity_type.value,
        entity_id=data.entity_id,
        entity_label=data.entity_label,
        added_by_id=current_user.id,
        notes=data.notes,
    )
    return _entity_to_response(entity)


@router.delete("/{case_id}/entities/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_entity(
    case_id: UUID,
    entity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Remove an entity from an investigation case."""
    svc = InvestigationCaseService(db)
    removed = await svc.remove_entity_from_case(case_id, entity_id)

    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entity not found in this case",
        )


# ============================================================
# Case Findings
# ============================================================

@router.post("/{case_id}/findings", response_model=CaseFindingResponse, status_code=status.HTTP_201_CREATED)
async def add_finding(
    case_id: UUID,
    data: CaseFindingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add a finding to an investigation case."""
    svc = InvestigationCaseService(db)

    # Verify case exists
    case = await svc.get_case(case_id)
    if not case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investigation case not found",
        )

    finding = await svc.add_finding(
        case_id=case_id,
        finding_type=data.finding_type.value,
        title=data.title,
        description=data.description,
        severity=data.severity.value,
        source_type=data.source_type,
        source_id=data.source_id,
        created_by_id=current_user.id,
    )
    return _finding_to_response(finding)


# ============================================================
# Case Notes
# ============================================================

@router.post("/{case_id}/notes", response_model=CaseNoteResponse, status_code=status.HTTP_201_CREATED)
async def add_note(
    case_id: UUID,
    data: CaseNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add a note to an investigation case."""
    svc = InvestigationCaseService(db)

    # Verify case exists
    case = await svc.get_case(case_id)
    if not case:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investigation case not found",
        )

    note = await svc.add_note(
        case_id=case_id,
        content=data.content,
        created_by_id=current_user.id,
    )
    return _note_to_response(note)
