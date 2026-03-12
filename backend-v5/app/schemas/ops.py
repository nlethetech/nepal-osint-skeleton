"""Analyst Ops schemas (verify → publish workflow)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkflowStatus(str, Enum):
    """Analyst workflow status for event clusters."""

    UNREVIEWED = "unreviewed"
    MONITORING = "monitoring"
    VERIFIED = "verified"
    PUBLISHED = "published"
    REJECTED = "rejected"


class OpsStoryItem(BaseModel):
    """Story/evidence item inside an event cluster."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: str
    source_name: Optional[str] = None
    title: str
    summary: Optional[str] = None
    url: str
    published_at: Optional[datetime] = None


class OpsDuplicateGroup(BaseModel):
    """Group of near-identical stories (soft dedup) within an event."""

    canonical: OpsStoryItem
    duplicates: list[OpsStoryItem] = Field(default_factory=list)

    @property
    def duplicate_count(self) -> int:
        return len(self.duplicates)


class OpsRelatedEvent(BaseModel):
    """Related event suggestion (connect-the-dots)."""

    cluster_id: UUID
    headline: str
    category: Optional[str] = None
    severity: Optional[str] = None
    similarity: float = Field(..., ge=0.0, le=1.0)


class OpsEventInboxItem(BaseModel):
    """Event summary for analyst inbox."""

    id: UUID

    # Display (prefer analyst overrides if present)
    headline: str
    summary: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None

    # System values (for comparison / audit)
    system_headline: str
    system_category: Optional[str] = None
    system_severity: Optional[str] = None

    story_count: int
    source_count: int
    first_published: Optional[datetime] = None
    last_updated: Optional[datetime] = None

    workflow_status: WorkflowStatus
    is_published: bool
    published_at: Optional[datetime] = None
    verified_at: Optional[datetime] = None

    # Scoring
    age_minutes: Optional[int] = None
    impact_score: float = Field(..., ge=0.0, le=1.0)
    uncertainty_score: float = Field(..., ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    ready_for_publish: bool = False


class OpsEventInboxResponse(BaseModel):
    items: list[OpsEventInboxItem]
    total: int


class OpsEventDetailResponse(BaseModel):
    """Full event details for analyst verification/publishing."""

    id: UUID

    # Display (prefer analyst overrides if present)
    headline: str
    summary: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None

    # System values
    system_headline: str
    system_summary: Optional[str] = None
    system_category: Optional[str] = None
    system_severity: Optional[str] = None

    story_count: int
    source_count: int
    first_published: Optional[datetime] = None
    last_updated: Optional[datetime] = None

    workflow_status: WorkflowStatus
    analyst_notes: Optional[str] = None
    customer_brief: Optional[str] = None

    is_published: bool
    published_at: Optional[datetime] = None
    verified_at: Optional[datetime] = None

    # Evidence
    story_groups: list[OpsDuplicateGroup]
    all_stories: list[OpsStoryItem]

    # Connect-the-dots
    related_events: list[OpsRelatedEvent] = Field(default_factory=list)


class OpsUpdateEventRequest(BaseModel):
    """Patch analyst fields (does not publish)."""

    analyst_headline: Optional[str] = None
    analyst_summary: Optional[str] = None
    analyst_category: Optional[str] = None
    analyst_severity: Optional[str] = None
    analyst_notes: Optional[str] = None

    workflow_status: Optional[WorkflowStatus] = None


class OpsPublishEventRequest(BaseModel):
    """Publish an event to consumers."""

    customer_brief: Optional[str] = None
    analyst_headline: Optional[str] = None
    analyst_summary: Optional[str] = None
    analyst_category: Optional[str] = None
    analyst_severity: Optional[str] = None

