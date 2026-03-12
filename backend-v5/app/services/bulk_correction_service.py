"""Bulk CSV correction upload service."""
import csv
import io
import logging
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate
from app.repositories.correction_repository import CorrectionRepository

logger = logging.getLogger(__name__)


VALID_FIELDS = {"name_en_roman", "biography", "education", "previous_positions", "education_institution"}


class BulkCorrectionService:
    """Handles CSV upload for bulk candidate corrections."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = CorrectionRepository(db)

    async def process_csv(self, csv_content: bytes, uploaded_by: UUID) -> dict:
        """Parse and validate CSV, create correction records."""
        batch_id = uuid4()
        errors = []
        valid_count = 0
        total_rows = 0

        try:
            reader = csv.DictReader(io.StringIO(csv_content.decode("utf-8")))
        except Exception as e:
            return {
                "total_rows": 0,
                "valid": 0,
                "invalid": 1,
                "errors": [{"row": 0, "error": f"Invalid CSV format: {e}"}],
                "corrections_created": 0,
                "batch_id": str(batch_id),
                "status": "failed",
            }

        required_fields = {"candidate_external_id", "field", "new_value", "reason"}

        for i, row in enumerate(reader, start=1):
            total_rows += 1

            # Check required fields
            missing = required_fields - set(row.keys())
            if missing:
                errors.append({"row": i, "error": f"Missing columns: {', '.join(missing)}"})
                continue

            ext_id = row.get("candidate_external_id", "").strip()
            field = row.get("field", "").strip()
            new_value = row.get("new_value", "").strip()
            reason = row.get("reason", "").strip()

            if not ext_id or not field or not new_value or not reason:
                errors.append({"row": i, "error": "Empty required field"})
                continue

            if field not in VALID_FIELDS:
                errors.append({"row": i, "error": f"Invalid field '{field}'"})
                continue

            # Verify candidate exists
            result = await self.db.execute(
                select(Candidate).where(Candidate.external_id == ext_id)
            )
            candidate = result.scalar_one_or_none()
            if not candidate:
                errors.append({"row": i, "error": f"Candidate {ext_id} not found"})
                continue

            # Get old value
            old_value = getattr(candidate, field, None)
            if isinstance(old_value, list):
                old_value = ", ".join(str(v) for v in old_value)
            elif old_value is not None:
                old_value = str(old_value)

            # Create correction
            await self.repo.create(
                candidate_external_id=ext_id,
                field=field,
                old_value=old_value,
                new_value=new_value,
                reason=reason,
                submitted_by=uploaded_by,
                batch_id=batch_id,
            )
            valid_count += 1

        return {
            "total_rows": total_rows,
            "valid": valid_count,
            "invalid": len(errors),
            "errors": errors,
            "corrections_created": valid_count,
            "batch_id": str(batch_id),
            "status": "pending_review" if valid_count > 0 else "failed",
        }
