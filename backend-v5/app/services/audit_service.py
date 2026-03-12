"""Audit logging service with 7-day retention."""
import csv
import io
import logging
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.audit_repository import AuditRepository

logger = logging.getLogger(__name__)


class AuditService:
    """Manages admin audit trail with 7-day retention."""

    RETENTION_DAYS = 7

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = AuditRepository(db)

    async def log_action(
        self,
        user_id: UUID,
        action: str,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        details: Optional[dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Record an auditable action."""
        try:
            await self.repo.create(
                user_id=user_id,
                action=action,
                target_type=target_type,
                target_id=target_id,
                details=details,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        except Exception as e:
            logger.error(f"Failed to create audit log: {e}")

    async def get_logs(
        self,
        action_type: Optional[str] = None,
        user_search: Optional[str] = None,
        start_date=None,
        end_date=None,
        page: int = 1,
        per_page: int = 50,
    ) -> tuple[list[dict], int]:
        """Get paginated audit logs."""
        return await self.repo.get_logs(
            action_type=action_type,
            user_search=user_search,
            start_date=start_date,
            end_date=end_date,
            page=page,
            per_page=per_page,
        )

    async def export_csv(
        self,
        action_type: Optional[str] = None,
        start_date=None,
        end_date=None,
    ) -> bytes:
        """Export audit logs as CSV bytes."""
        items = await self.repo.get_all_for_export(
            action_type=action_type,
            start_date=start_date,
            end_date=end_date,
        )

        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=["id", "user_email", "action", "target_type", "target_id", "details", "ip_address", "created_at"],
        )
        writer.writeheader()
        writer.writerows(items)
        return output.getvalue().encode("utf-8")

    async def cleanup_old_logs(self) -> int:
        """Delete logs older than retention period."""
        count = await self.repo.cleanup_old_logs(self.RETENTION_DAYS)
        logger.info(f"Cleaned up {count} audit logs older than {self.RETENTION_DAYS} days")
        return count
