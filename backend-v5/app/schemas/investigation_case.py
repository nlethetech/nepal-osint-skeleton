"""Pydantic schemas for investigation case management."""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from enum import Enum

from pydantic import BaseModel, Field


# ============================================================
# Enums
# ============================================================

class InvestigationStatusEnum(str, Enum):
    OPEN = "open"
    ACTIVE = "active"
    CLOSED = "closed"
    ARCHIVED = "archived"


class InvestigationPriorityEnum(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EntityTypeEnum(str, Enum):
    COMPANY = "company"
    PERSON = "person"
    PAN = "pan"


class FindingTypeEnum(str, Enum):
    RISK_FLAG = "risk_flag"
    ANOMALY = "anomaly"
    OBSERVATION = "observation"
    EVIDENCE = "evidence"


class FindingSeverityEnum(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# ============================================================
# User brief (for responses)
# ============================================================

class UserBrief(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str] = None


# ============================================================
# Case schemas
# ============================================================

class CaseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    priority: InvestigationPriorityEnum = InvestigationPriorityEnum.MEDIUM
    assigned_to_id: Optional[UUID] = None


class CaseUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    status: Optional[InvestigationStatusEnum] = None
    priority: Optional[InvestigationPriorityEnum] = None
    assigned_to_id: Optional[UUID] = None


class CaseResponse(BaseModel):
    id: UUID
    title: str
    description: Optional[str] = None
    status: InvestigationStatusEnum
    priority: InvestigationPriorityEnum
    created_by: UserBrief
    assigned_to: Optional[UserBrief] = None
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime] = None
    entity_count: int = 0
    finding_count: int = 0
    note_count: int = 0

    model_config = {"from_attributes": True}


class CaseDetailResponse(CaseResponse):
    """Extended response that includes entities, findings, and notes."""
    entities: List["CaseEntityResponse"] = []
    findings: List["CaseFindingResponse"] = []
    notes: List["CaseNoteResponse"] = []


class CaseListResponse(BaseModel):
    items: List[CaseResponse]
    total: int
    skip: int
    limit: int


# ============================================================
# Entity schemas
# ============================================================

class CaseEntityCreate(BaseModel):
    entity_type: EntityTypeEnum
    entity_id: str = Field(..., min_length=1, max_length=200)
    entity_label: str = Field(..., min_length=1, max_length=500)
    notes: Optional[str] = None


class CaseEntityResponse(BaseModel):
    id: UUID
    case_id: UUID
    entity_type: EntityTypeEnum
    entity_id: str
    entity_label: str
    added_by: UserBrief
    added_at: datetime
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


# ============================================================
# Finding schemas
# ============================================================

class CaseFindingCreate(BaseModel):
    finding_type: FindingTypeEnum
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    severity: FindingSeverityEnum = FindingSeverityEnum.INFO
    source_type: Optional[str] = None
    source_id: Optional[str] = None


class CaseFindingResponse(BaseModel):
    id: UUID
    case_id: UUID
    finding_type: FindingTypeEnum
    title: str
    description: Optional[str] = None
    severity: FindingSeverityEnum
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    created_by: UserBrief
    created_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Note schemas
# ============================================================

class CaseNoteCreate(BaseModel):
    content: str = Field(..., min_length=1)


class CaseNoteResponse(BaseModel):
    id: UUID
    case_id: UUID
    content: str
    created_by: UserBrief
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Forward reference resolution
CaseDetailResponse.model_rebuild()
