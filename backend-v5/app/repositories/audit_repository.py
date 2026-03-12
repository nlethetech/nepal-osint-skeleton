"""Audit log repository for data access."""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, delete, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_audit import AdminAuditLog
from app.models.user import User


class AuditRepository:
    """Data access for admin audit logs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(
        self,
        user_id: UUID,
        action: str,
        target_type: str | None = None,
        target_id: str | None = None,
        details: dict | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AdminAuditLog:
        """Create a new audit log entry."""
        entry = AdminAuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        self.db.add(entry)
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def get_logs(
        self,
        action_type: str | None = None,
        user_search: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> tuple[list[dict], int]:
        """Get audit logs with filtering. Returns (items, total_count).

        Joins with users table to get email.
        """
        base_query = (
            select(AdminAuditLog, User.email.label("user_email"))
            .join(User, AdminAuditLog.user_id == User.id, isouter=True)
        )

        conditions = []
        if action_type:
            conditions.append(AdminAuditLog.action == action_type)
        if user_search:
            conditions.append(User.email.ilike(f"%{user_search}%"))
        if start_date:
            conditions.append(AdminAuditLog.created_at >= start_date)
        if end_date:
            conditions.append(AdminAuditLog.created_at <= end_date)

        if conditions:
            base_query = base_query.where(and_(*conditions))

        # Count
        count_q = select(func.count()).select_from(
            base_query.subquery()
        )
        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        # Paginated results
        query = (
            base_query
            .order_by(AdminAuditLog.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        result = await self.db.execute(query)
        rows = result.all()

        items = []
        for row in rows:
            log = row[0]  # AdminAuditLog object
            user_email = row[1]  # email from join
            items.append({
                "id": str(log.id),
                "user_id": str(log.user_id),
                "user_email": user_email or "",
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "details": log.details,
                "ip_address": log.ip_address,
                "user_agent": log.user_agent,
                "created_at": log.created_at,
            })

        return items, total

    async def get_all_for_export(
        self,
        action_type: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> list[dict]:
        """Get all matching logs for CSV export (no pagination)."""
        query = (
            select(AdminAuditLog, User.email.label("user_email"))
            .join(User, AdminAuditLog.user_id == User.id, isouter=True)
        )

        conditions = []
        if action_type:
            conditions.append(AdminAuditLog.action == action_type)
        if start_date:
            conditions.append(AdminAuditLog.created_at >= start_date)
        if end_date:
            conditions.append(AdminAuditLog.created_at <= end_date)
        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(AdminAuditLog.created_at.desc())
        result = await self.db.execute(query)

        items = []
        for row in result.all():
            log = row[0]
            user_email = row[1] or ""
            items.append({
                "id": str(log.id),
                "user_email": user_email,
                "action": log.action,
                "target_type": log.target_type or "",
                "target_id": log.target_id or "",
                "details": str(log.details) if log.details else "",
                "ip_address": log.ip_address or "",
                "created_at": log.created_at.isoformat() if log.created_at else "",
            })
        return items

    async def cleanup_old_logs(self, retention_days: int = 7) -> int:
        """Delete logs older than retention period."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        result = await self.db.execute(
            delete(AdminAuditLog).where(AdminAuditLog.created_at < cutoff)
        )
        await self.db.commit()
        return result.rowcount
