"""Correction repository for data access."""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.candidate_correction import CandidateCorrection, CorrectionStatus
from app.models.user import User


class CorrectionRepository:
    """Data access for candidate corrections."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(
        self,
        candidate_external_id: str,
        field: str,
        old_value: str | None,
        new_value: str,
        reason: str,
        submitted_by: UUID,
        batch_id: UUID | None = None,
    ) -> CandidateCorrection:
        """Create a new correction."""
        correction = CandidateCorrection(
            candidate_external_id=candidate_external_id,
            field=field,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            submitted_by=submitted_by,
            batch_id=batch_id,
        )
        self.db.add(correction)
        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def get_by_id(self, correction_id: UUID) -> Optional[CandidateCorrection]:
        """Get correction by ID."""
        result = await self.db.execute(
            select(CandidateCorrection).where(CandidateCorrection.id == correction_id)
        )
        return result.scalar_one_or_none()

    async def get_corrections(
        self,
        status_filter: str | None = None,
        page: int = 1,
        per_page: int = 20,
    ) -> tuple[list[dict], int, int]:
        """Get corrections with optional status filter.

        Returns (items, total, pending_count).
        """
        base_query = (
            select(CandidateCorrection, User.email.label("submitted_by_email"))
            .join(User, CandidateCorrection.submitted_by == User.id, isouter=True)
        )

        if status_filter:
            base_query = base_query.where(CandidateCorrection.status == status_filter)

        # Count total matching
        count_q = select(func.count()).select_from(base_query.subquery())
        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        # Count pending separately
        pending_q = select(func.count()).where(
            CandidateCorrection.status == CorrectionStatus.PENDING.value
        )
        pending_result = await self.db.execute(pending_q)
        pending_count = pending_result.scalar() or 0

        # Paginated query
        query = (
            base_query
            .order_by(CandidateCorrection.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        result = await self.db.execute(query)
        rows = result.all()

        items = []
        for row in rows:
            c = row[0]
            email = row[1]
            items.append({
                "id": str(c.id),
                "candidate_external_id": c.candidate_external_id,
                "candidate_name": "",  # Populated by service layer
                "field": c.field,
                "old_value": c.old_value,
                "new_value": c.new_value,
                "reason": c.reason,
                "status": c.status,
                "submitted_by": str(c.submitted_by),
                "submitted_by_email": email or "",
                "submitted_at": c.submitted_at,
                "reviewed_by": str(c.reviewed_by) if c.reviewed_by else None,
                "reviewed_at": c.reviewed_at,
                "review_notes": c.review_notes,
                "rejection_reason": c.rejection_reason,
                "rolled_back_at": c.rolled_back_at,
                "rollback_reason": c.rollback_reason,
                "batch_id": str(c.batch_id) if c.batch_id else None,
                "created_at": c.created_at,
            })

        return items, total, pending_count

    async def update_status(
        self,
        correction_id: UUID,
        status: str,
        reviewed_by: UUID | None = None,
        review_notes: str | None = None,
        rejection_reason: str | None = None,
    ) -> Optional[CandidateCorrection]:
        """Update correction status (approve/reject)."""
        correction = await self.get_by_id(correction_id)
        if not correction:
            return None

        correction.status = status
        if reviewed_by:
            correction.reviewed_by = reviewed_by
            correction.reviewed_at = datetime.now(timezone.utc)
        if review_notes:
            correction.review_notes = review_notes
        if rejection_reason:
            correction.rejection_reason = rejection_reason

        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def approve(
        self,
        correction_id: UUID,
        reviewed_by: UUID,
        review_notes: str | None = None,
    ) -> Optional[CandidateCorrection]:
        """Approve a pending correction."""
        correction = await self.get_by_id(correction_id)
        if not correction or correction.status != CorrectionStatus.PENDING.value:
            return None
        return await self.update_status(
            correction_id=correction_id,
            status=CorrectionStatus.APPROVED.value,
            reviewed_by=reviewed_by,
            review_notes=review_notes,
        )

    async def reject(
        self,
        correction_id: UUID,
        reviewed_by: UUID,
        rejection_reason: str,
    ) -> Optional[CandidateCorrection]:
        """Reject a pending correction."""
        correction = await self.get_by_id(correction_id)
        if not correction or correction.status != CorrectionStatus.PENDING.value:
            return None
        return await self.update_status(
            correction_id=correction_id,
            status=CorrectionStatus.REJECTED.value,
            reviewed_by=reviewed_by,
            rejection_reason=rejection_reason,
        )

    async def rollback(
        self,
        correction_id: UUID,
        rolled_back_by: UUID,
        reason: str,
    ) -> Optional[CandidateCorrection]:
        """Rollback an approved correction."""
        correction = await self.get_by_id(correction_id)
        if not correction or correction.status != CorrectionStatus.APPROVED.value:
            return None
        return await self.rollback_correction(
            correction_id=correction_id,
            rolled_back_by=rolled_back_by,
            reason=reason,
        )

    async def rollback_correction(
        self,
        correction_id: UUID,
        rolled_back_by: UUID,
        reason: str,
    ) -> Optional[CandidateCorrection]:
        """Mark correction as rolled back."""
        correction = await self.get_by_id(correction_id)
        if not correction:
            return None

        correction.status = CorrectionStatus.ROLLED_BACK.value
        correction.rolled_back_by = rolled_back_by
        correction.rolled_back_at = datetime.now(timezone.utc)
        correction.rollback_reason = reason

        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def get_pending_count(self) -> int:
        """Get count of pending corrections."""
        result = await self.db.execute(
            select(func.count()).where(
                CandidateCorrection.status == CorrectionStatus.PENDING.value
            )
        )
        return result.scalar() or 0
