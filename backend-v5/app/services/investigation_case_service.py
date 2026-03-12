"""Service layer for investigation case management."""
import logging
from datetime import datetime, timezone
from typing import Optional, List
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.investigation_case import (
    InvestigationCase,
    CaseEntity,
    CaseFinding,
    CaseNote,
)
from app.models.user import User

logger = logging.getLogger(__name__)


class InvestigationCaseService:
    """Service for investigation case CRUD and related operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Case CRUD
    # ------------------------------------------------------------------

    async def create_case(
        self,
        title: str,
        created_by_id: UUID,
        description: Optional[str] = None,
        priority: str = "medium",
        assigned_to_id: Optional[UUID] = None,
    ) -> InvestigationCase:
        """Create a new investigation case."""
        case = InvestigationCase(
            title=title,
            description=description,
            status="open",
            priority=priority,
            created_by_id=created_by_id,
            assigned_to_id=assigned_to_id,
        )
        self.db.add(case)
        await self.db.commit()
        await self.db.refresh(case, ["created_by", "assigned_to"])
        return case

    async def get_case(self, case_id: UUID) -> Optional[InvestigationCase]:
        """Get a case by ID with all relationships loaded."""
        result = await self.db.execute(
            select(InvestigationCase)
            .options(
                selectinload(InvestigationCase.created_by),
                selectinload(InvestigationCase.assigned_to),
                selectinload(InvestigationCase.entities).selectinload(CaseEntity.added_by),
                selectinload(InvestigationCase.findings).selectinload(CaseFinding.created_by),
                selectinload(InvestigationCase.notes).selectinload(CaseNote.created_by),
            )
            .where(InvestigationCase.id == case_id)
        )
        return result.scalar_one_or_none()

    async def list_cases(
        self,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[List[InvestigationCase], int]:
        """List cases with optional status filter and pagination."""
        query = select(InvestigationCase).options(
            selectinload(InvestigationCase.created_by),
            selectinload(InvestigationCase.assigned_to),
        )

        if status:
            query = query.where(InvestigationCase.status == status)

        # Total count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Paginated results
        query = query.order_by(InvestigationCase.updated_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        cases = list(result.scalars().all())

        return cases, total

    async def update_case(
        self,
        case_id: UUID,
        title: Optional[str] = None,
        description: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        assigned_to_id: Optional[UUID] = None,
    ) -> Optional[InvestigationCase]:
        """Update a case's fields."""
        case = await self.get_case(case_id)
        if not case:
            return None

        if title is not None:
            case.title = title
        if description is not None:
            case.description = description
        if status is not None:
            case.status = status
        if priority is not None:
            case.priority = priority
        if assigned_to_id is not None:
            case.assigned_to_id = assigned_to_id

        case.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(case, ["created_by", "assigned_to"])
        return case

    async def close_case(self, case_id: UUID) -> Optional[InvestigationCase]:
        """Close a case by setting status and closed_at timestamp."""
        case = await self.get_case(case_id)
        if not case:
            return None

        case.status = "closed"
        case.closed_at = datetime.now(timezone.utc)
        case.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(case, ["created_by", "assigned_to"])
        return case

    # ------------------------------------------------------------------
    # Entities
    # ------------------------------------------------------------------

    async def add_entity_to_case(
        self,
        case_id: UUID,
        entity_type: str,
        entity_id: str,
        entity_label: str,
        added_by_id: UUID,
        notes: Optional[str] = None,
    ) -> CaseEntity:
        """Add an entity to a case."""
        entity = CaseEntity(
            case_id=case_id,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            added_by_id=added_by_id,
            notes=notes,
        )
        self.db.add(entity)
        await self.db.commit()
        await self.db.refresh(entity, ["added_by"])
        return entity

    async def remove_entity_from_case(self, case_id: UUID, entity_id: UUID) -> bool:
        """Remove an entity from a case. Returns True if found and removed."""
        result = await self.db.execute(
            select(CaseEntity).where(
                CaseEntity.id == entity_id,
                CaseEntity.case_id == case_id,
            )
        )
        entity = result.scalar_one_or_none()
        if not entity:
            return False

        await self.db.delete(entity)
        await self.db.commit()
        return True

    async def list_case_entities(self, case_id: UUID) -> List[CaseEntity]:
        """List all entities for a case."""
        result = await self.db.execute(
            select(CaseEntity)
            .options(selectinload(CaseEntity.added_by))
            .where(CaseEntity.case_id == case_id)
            .order_by(CaseEntity.added_at.desc())
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Findings
    # ------------------------------------------------------------------

    async def add_finding(
        self,
        case_id: UUID,
        finding_type: str,
        title: str,
        created_by_id: UUID,
        description: Optional[str] = None,
        severity: str = "info",
        source_type: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> CaseFinding:
        """Add a finding to a case."""
        finding = CaseFinding(
            case_id=case_id,
            finding_type=finding_type,
            title=title,
            description=description,
            severity=severity,
            source_type=source_type,
            source_id=source_id,
            created_by_id=created_by_id,
        )
        self.db.add(finding)
        await self.db.commit()
        await self.db.refresh(finding, ["created_by"])
        return finding

    async def list_case_findings(self, case_id: UUID) -> List[CaseFinding]:
        """List all findings for a case."""
        result = await self.db.execute(
            select(CaseFinding)
            .options(selectinload(CaseFinding.created_by))
            .where(CaseFinding.case_id == case_id)
            .order_by(CaseFinding.created_at.desc())
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Notes
    # ------------------------------------------------------------------

    async def add_note(
        self,
        case_id: UUID,
        content: str,
        created_by_id: UUID,
    ) -> CaseNote:
        """Add a note to a case."""
        note = CaseNote(
            case_id=case_id,
            content=content,
            created_by_id=created_by_id,
        )
        self.db.add(note)
        await self.db.commit()
        await self.db.refresh(note, ["created_by"])
        return note

    async def list_case_notes(self, case_id: UUID) -> List[CaseNote]:
        """List all notes for a case."""
        result = await self.db.execute(
            select(CaseNote)
            .options(selectinload(CaseNote.created_by))
            .where(CaseNote.case_id == case_id)
            .order_by(CaseNote.created_at.desc())
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    async def get_case_summary(self, case_id: UUID) -> dict:
        """Get summary counts for a case."""
        entity_count = (await self.db.execute(
            select(func.count()).where(CaseEntity.case_id == case_id)
        )).scalar() or 0

        finding_count = (await self.db.execute(
            select(func.count()).where(CaseFinding.case_id == case_id)
        )).scalar() or 0

        note_count = (await self.db.execute(
            select(func.count()).where(CaseNote.case_id == case_id)
        )).scalar() or 0

        return {
            "entity_count": entity_count,
            "finding_count": finding_count,
            "note_count": note_count,
        }
