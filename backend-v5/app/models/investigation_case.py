"""Investigation case management models for corporate/OSINT investigations."""
from datetime import datetime
from enum import Enum
from typing import Optional, List, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class InvestigationStatus(str, Enum):
    """Investigation case status."""
    OPEN = "open"
    ACTIVE = "active"
    CLOSED = "closed"
    ARCHIVED = "archived"


class InvestigationPriority(str, Enum):
    """Investigation case priority."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EntityType(str, Enum):
    """Type of entity linked to a case."""
    COMPANY = "company"
    PERSON = "person"
    PAN = "pan"


class FindingType(str, Enum):
    """Type of case finding."""
    RISK_FLAG = "risk_flag"
    ANOMALY = "anomaly"
    OBSERVATION = "observation"
    EVIDENCE = "evidence"


class FindingSeverity(str, Enum):
    """Finding severity level."""
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class InvestigationCase(Base):
    """Investigation case for corporate/OSINT analysis."""

    __tablename__ = "investigation_cases"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="open",
    )
    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="medium",
    )
    created_by_id: Mapped[UUID] = mapped_column(
        "created_by",
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    assigned_to_id: Mapped[Optional[UUID]] = mapped_column(
        "assigned_to",
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(__import__("datetime").timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(__import__("datetime").timezone.utc),
        onupdate=lambda: datetime.now(__import__("datetime").timezone.utc),
        server_default=func.now(),
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    created_by: Mapped["User"] = relationship(
        "User",
        foreign_keys=[created_by_id],
    )
    assigned_to: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[assigned_to_id],
    )
    entities: Mapped[List["CaseEntity"]] = relationship(
        "CaseEntity",
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="CaseEntity.added_at.desc()",
    )
    findings: Mapped[List["CaseFinding"]] = relationship(
        "CaseFinding",
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="CaseFinding.created_at.desc()",
    )
    notes: Mapped[List["CaseNote"]] = relationship(
        "CaseNote",
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="CaseNote.created_at.desc()",
    )

    __table_args__ = (
        Index("idx_inv_cases_status_priority", "status", "priority"),
    )

    def __repr__(self) -> str:
        return f"<InvestigationCase {self.id}: {self.title[:50]}>"


class CaseEntity(Base):
    """Entity linked to an investigation case."""

    __tablename__ = "case_entities"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("investigation_cases.id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    entity_id: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    entity_label: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    added_by_id: Mapped[UUID] = mapped_column(
        "added_by",
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(__import__("datetime").timezone.utc),
        server_default=func.now(),
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Relationships
    case: Mapped["InvestigationCase"] = relationship(
        "InvestigationCase",
        back_populates="entities",
    )
    added_by: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return f"<CaseEntity {self.id}: {self.entity_type} {self.entity_label[:30]}>"


class CaseFinding(Base):
    """Finding/observation recorded during an investigation."""

    __tablename__ = "case_findings"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("investigation_cases.id", ondelete="CASCADE"),
        nullable=False,
    )
    finding_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="info",
    )
    source_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    source_id: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
    )
    created_by_id: Mapped[UUID] = mapped_column(
        "created_by",
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(__import__("datetime").timezone.utc),
        server_default=func.now(),
    )

    # Relationships
    case: Mapped["InvestigationCase"] = relationship(
        "InvestigationCase",
        back_populates="findings",
    )
    created_by: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return f"<CaseFinding {self.id}: {self.finding_type} - {self.title[:30]}>"


class CaseNote(Base):
    """Note/annotation on an investigation case."""

    __tablename__ = "case_notes"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("investigation_cases.id", ondelete="CASCADE"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    created_by_id: Mapped[UUID] = mapped_column(
        "created_by",
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(__import__("datetime").timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(__import__("datetime").timezone.utc),
        onupdate=lambda: datetime.now(__import__("datetime").timezone.utc),
        server_default=func.now(),
    )

    # Relationships
    case: Mapped["InvestigationCase"] = relationship(
        "InvestigationCase",
        back_populates="notes",
    )
    created_by: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return f"<CaseNote {self.id} on case {self.case_id}>"
