"""Admin audit log model for tracking all significant actions."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB, INET
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditAction(str, Enum):
    """Auditable action types."""
    LOGIN = "login"
    LOGOUT = "logout"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    APPROVE = "approve"
    REJECT = "reject"
    ROLLBACK = "rollback"
    EXPORT = "export"
    TRAIN = "train"
    PROMOTE = "promote"
    FLUSH = "flush"
    BULK_UPLOAD = "bulk_upload"


class AdminAuditLog(Base):
    """Immutable audit log with 7-day retention.

    Records all significant actions performed by users in the system.
    Entries are append-only — no update or delete endpoints exposed.
    """

    __tablename__ = "admin_audit_log"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )
    target_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    target_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    details: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45),  # IPv6 max length
        nullable=True,
    )
    user_agent: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} by {self.user_id} on {self.target_type}:{self.target_id}>"
