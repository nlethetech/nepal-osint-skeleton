"""Schemas for production publishing + peer review (analyst → consumer feed)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional, Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.collaboration import UserBrief


class PeerReviewVerdictEnum(str, Enum):
    AGREE = "agree"
    NEEDS_CORRECTION = "needs_correction"
    DISPUTE = "dispute"


class PeerReviewCreate(BaseModel):
    verdict: PeerReviewVerdictEnum
    notes: Optional[str] = None


class PeerReviewResponse(BaseModel):
    id: UUID
    cluster_id: UUID
    reviewer: UserBrief
    verdict: PeerReviewVerdictEnum
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PeerReviewSummary(BaseModel):
    peer_state: str
    agree_count: int = 0
    needs_correction_count: int = 0
    dispute_count: int = 0
    last_reviewed_at: Optional[datetime] = None
    last_contested_at: Optional[datetime] = None

    # From latest publication metadata (optional)
    latest_version: Optional[int] = None
    latest_publication_at: Optional[datetime] = None
    official_confirmation: Optional[bool] = None
    citations_count: Optional[int] = None


class CasePublishRequest(BaseModel):
    headline: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    customer_brief: str = Field(..., min_length=1)
    change_note: Optional[str] = None


class ClusterPublicationResponse(BaseModel):
    id: UUID
    cluster_id: UUID
    version: int
    created_by: Optional[UserBrief]
    created_at: datetime
    headline: str
    category: Optional[str]
    severity: Optional[str]
    customer_brief: Optional[str]
    citations: Optional[list[dict]] = None
    policy_check: Optional[dict[str, Any]] = None
    change_note: Optional[str] = None

    class Config:
        from_attributes = True


class CasePublishResponse(BaseModel):
    publication: ClusterPublicationResponse


class PublicEventDetailResponse(BaseModel):
    cluster_id: UUID
    headline: str
    category: Optional[str]
    severity: Optional[str]
    published_at: Optional[datetime]
    publication: ClusterPublicationResponse
    peer_review: PeerReviewSummary

