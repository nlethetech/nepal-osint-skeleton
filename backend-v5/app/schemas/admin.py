"""Pydantic schemas for admin, audit, and correction endpoints."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Audit Log Schemas ──

class AuditLogResponse(BaseModel):
    """Single audit log entry."""
    id: str
    user_id: str
    user_email: str = ""
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    details: Optional[dict] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    """Paginated audit log list."""
    items: list[AuditLogResponse]
    page: int
    per_page: int
    total: int
    total_pages: int


class AuditFilters(BaseModel):
    """Audit log filter parameters."""
    action_type: Optional[str] = None
    user_search: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    page: int = 1
    per_page: int = 50


# ── User Management Schemas ──

class UserResponse(BaseModel):
    """User info for admin panel."""
    id: str
    email: str
    full_name: Optional[str] = None
    auth_provider: str = "local"
    auth_provider_label: str = "Email"
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None


class UserListResponse(BaseModel):
    """List of users."""
    items: list[UserResponse]


# ── Correction Schemas ──

class CorrectionSubmitRequest(BaseModel):
    """Analyst submitting a correction."""
    field: str = Field(..., min_length=1, max_length=100)
    new_value: str = Field(..., min_length=1, max_length=5000)
    reason: str = Field(..., min_length=10, max_length=2000)


class CorrectionSubmitResponse(BaseModel):
    """Response after submitting correction."""
    id: str
    status: str
    message: str


class CorrectionResponse(BaseModel):
    """Single correction entry."""
    id: str
    candidate_external_id: str
    candidate_name: str = ""
    field: str
    old_value: Optional[str] = None
    new_value: str
    reason: str
    status: str
    submitted_by: str
    submitted_by_email: str = ""
    submitted_at: datetime
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    rolled_back_at: Optional[datetime] = None
    rollback_reason: Optional[str] = None
    batch_id: Optional[str] = None
    created_at: datetime


class CorrectionListResponse(BaseModel):
    """Paginated correction list."""
    items: list[CorrectionResponse]
    pending_count: int = 0
    page: int = 1
    total: int = 0
    total_pages: int = 0


class CorrectionApproveRequest(BaseModel):
    """Dev approving a correction."""
    notes: Optional[str] = None


class CorrectionRejectRequest(BaseModel):
    """Dev rejecting a correction."""
    reason: str = Field(..., min_length=1)


class CorrectionRollbackRequest(BaseModel):
    """Dev rolling back an approved correction."""
    reason: str = Field(..., min_length=1)


class CorrectionActionResponse(BaseModel):
    """Response after approve/reject/rollback."""
    id: str
    status: str
    message: str


# ── Bulk Upload Schemas ──

class BulkUploadError(BaseModel):
    """Single row error in bulk upload."""
    row: int
    error: str


class BulkUploadResponse(BaseModel):
    """Response after bulk CSV upload."""
    total_rows: int
    valid: int
    invalid: int
    errors: list[BulkUploadError]
    corrections_created: int
    batch_id: Optional[str] = None
    status: str = "pending_review"
