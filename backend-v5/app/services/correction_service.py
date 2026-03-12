"""Candidate correction workflow service."""
import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate
from app.models.candidate_correction import CorrectionStatus
from app.repositories.correction_repository import CorrectionRepository
from app.services.candidate_profile_resolver import CandidateProfileResolver

logger = logging.getLogger(__name__)


class CorrectionService:
    """Manages candidate correction workflow: submit -> review -> approve/reject/rollback."""

    EDITABLE_FIELDS = {
        "name_en_roman",
        "aliases",
        "biography",
        "biography_source",
        "education",
        "education_institution",
        "age",
        "gender",
        "previous_positions",
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = CorrectionRepository(db)
        self.resolver = CandidateProfileResolver(db)

    async def submit_correction(
        self,
        candidate_external_id: str,
        field: str,
        new_value: str,
        reason: str,
        submitted_by: UUID,
    ) -> dict:
        """Analyst submits a correction suggestion."""
        if field not in self.EDITABLE_FIELDS:
            raise ValueError(f"Field '{field}' is not editable. Allowed: {self.EDITABLE_FIELDS}")

        # Get old value from candidate
        candidate = await self._get_candidate(candidate_external_id)
        if not candidate:
            raise ValueError(f"Candidate {candidate_external_id} not found")

        old_value = getattr(candidate, field, None)
        if isinstance(old_value, list):
            old_value = ", ".join(str(v) for v in old_value)
        elif old_value is not None:
            old_value = str(old_value)

        correction = await self.repo.create(
            candidate_external_id=candidate_external_id,
            field=field,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            submitted_by=submitted_by,
        )
        return {
            "id": str(correction.id),
            "status": correction.status,
            "message": "Correction submitted for review",
        }

    async def get_corrections(
        self,
        status: Optional[str] = None,
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """Get corrections list for dev review."""
        items, total, pending_count = await self.repo.get_corrections(
            status_filter=status, page=page, per_page=per_page,
        )

        # Enrich with candidate names
        for item in items:
            candidate = await self._get_candidate(item["candidate_external_id"])
            if candidate:
                item["candidate_name"] = candidate.name_en or candidate.external_id

        total_pages = (total + per_page - 1) // per_page if per_page else 0
        return {
            "items": items,
            "pending_count": pending_count,
            "page": page,
            "total": total,
            "total_pages": total_pages,
        }

    async def approve_correction(
        self,
        correction_id: UUID,
        approved_by: UUID,
        notes: Optional[str] = None,
    ) -> dict:
        """Dev approves and applies a correction."""
        correction = await self.repo.approve(correction_id, approved_by, notes)
        if not correction:
            raise ValueError("Correction not found or not in pending status")

        # Apply the edit to the actual candidate record
        await self._apply_correction(correction)
        await self.resolver.upsert_from_correction(correction, updated_by=approved_by)
        await self.db.commit()

        return {
            "id": str(correction.id),
            "status": correction.status,
            "message": "Correction applied successfully",
        }

    async def reject_correction(
        self,
        correction_id: UUID,
        rejected_by: UUID,
        reason: str,
    ) -> dict:
        """Dev rejects a correction."""
        correction = await self.repo.reject(correction_id, rejected_by, reason)
        if not correction:
            raise ValueError("Correction not found or not in pending status")

        return {
            "id": str(correction.id),
            "status": correction.status,
            "message": "Correction rejected",
        }

    async def rollback_correction(
        self,
        correction_id: UUID,
        rolled_back_by: UUID,
        reason: str,
    ) -> dict:
        """Dev rolls back an approved correction, restoring old value."""
        from app.repositories.correction_repository import CorrectionRepository
        repo = CorrectionRepository(self.db)
        correction = await repo.get_by_id(correction_id)
        if not correction or correction.status != CorrectionStatus.APPROVED.value:
            raise ValueError("Correction not found or not in approved status")

        # Restore old value
        candidate = await self._get_candidate(correction.candidate_external_id)
        if candidate and correction.old_value is not None:
            if correction.field in {"previous_positions", "aliases"}:
                setattr(candidate, correction.field, [v.strip() for v in correction.old_value.split(",") if v.strip()])
            elif correction.field == "age":
                try:
                    setattr(candidate, correction.field, int(correction.old_value))
                except Exception:
                    setattr(candidate, correction.field, None)
            else:
                setattr(candidate, correction.field, correction.old_value)
            await self.db.commit()

        rolled_back = await repo.rollback(correction_id, rolled_back_by, reason)
        await self.resolver.rebuild_projection_from_corrections(updated_by=rolled_back_by)
        await self.db.commit()
        return {
            "id": str(rolled_back.id),
            "status": rolled_back.status,
            "message": "Correction rolled back, original value restored",
        }

    async def _get_candidate(self, external_id: str) -> Optional[Candidate]:
        """Look up candidate by external_id."""
        result = await self.db.execute(
            select(Candidate)
            .where(Candidate.external_id == external_id)
            .order_by(Candidate.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _apply_correction(self, correction) -> None:
        """Apply an approved correction to the candidate record."""
        candidate = await self._get_candidate(correction.candidate_external_id)
        if not candidate:
            logger.warning(f"Candidate {correction.candidate_external_id} not found for correction {correction.id}")
            return

        if correction.field in {"previous_positions", "aliases"}:
            setattr(candidate, correction.field, [v.strip() for v in correction.new_value.split(",") if v.strip()])
        elif correction.field == "age":
            try:
                setattr(candidate, correction.field, int(correction.new_value))
            except Exception:
                setattr(candidate, correction.field, None)
        else:
            setattr(candidate, correction.field, correction.new_value)

        logger.info(f"Applied correction {correction.id} to candidate {correction.candidate_external_id}.{correction.field}")
