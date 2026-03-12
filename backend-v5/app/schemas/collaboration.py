"""Pydantic schemas for collaboration system."""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from enum import Enum

from pydantic import BaseModel, Field


# ============================================================
# Enums (match database)
# ============================================================

class CaseStatusEnum(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    REVIEW = "review"
    CLOSED = "closed"
    ARCHIVED = "archived"


class CasePriorityEnum(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class CaseVisibilityEnum(str, Enum):
    PUBLIC = "public"
    TEAM = "team"
    PRIVATE = "private"


class EvidenceTypeEnum(str, Enum):
    STORY = "story"
    ENTITY = "entity"
    DOCUMENT = "document"
    LINK = "link"
    NOTE = "note"


class TeamRoleEnum(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class VerificationStatusEnum(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    NEEDS_INFO = "needs_info"
    EXPIRED = "expired"


class VerifiableTypeEnum(str, Enum):
    STORY = "story"
    ENTITY = "entity"
    ENTITY_LINK = "entity_link"
    CASE_EVIDENCE = "case_evidence"
    CLASSIFICATION = "classification"
    LOCATION = "location"


class VoteChoiceEnum(str, Enum):
    AGREE = "agree"
    DISAGREE = "disagree"
    ABSTAIN = "abstain"
    NEEDS_INFO = "needs_info"


class WatchlistScopeEnum(str, Enum):
    PERSONAL = "personal"
    TEAM = "team"
    PUBLIC = "public"


class WatchableTypeEnum(str, Enum):
    ENTITY = "entity"
    KEYWORD = "keyword"
    LOCATION = "location"
    ORGANIZATION = "organization"
    PERSON = "person"
    TOPIC = "topic"


class AlertFrequencyEnum(str, Enum):
    REALTIME = "realtime"
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"


class NoteVisibilityEnum(str, Enum):
    PRIVATE = "private"
    TEAM = "team"
    PUBLIC = "public"


# ============================================================
# User Reference (for embedding in responses)
# ============================================================

class UserBrief(BaseModel):
    """Brief user info for embedding in other responses."""
    id: UUID
    email: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================
# Team Schemas
# ============================================================

class TeamBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    specialization: Optional[str] = None
    is_public: bool = False


class TeamCreate(TeamBase):
    pass


class TeamUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    specialization: Optional[str] = None
    is_public: Optional[bool] = None
    is_active: Optional[bool] = None


class TeamMemberResponse(BaseModel):
    id: UUID
    user: UserBrief
    role: TeamRoleEnum
    is_active: bool
    joined_at: datetime

    class Config:
        from_attributes = True


class TeamResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    slug: str
    specialization: Optional[str]
    is_public: bool
    is_active: bool
    member_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TeamDetailResponse(TeamResponse):
    members: List[TeamMemberResponse] = []


class TeamMemberAdd(BaseModel):
    user_id: UUID
    role: TeamRoleEnum = TeamRoleEnum.MEMBER


class TeamMemberUpdate(BaseModel):
    role: TeamRoleEnum


# ============================================================
# Case Schemas
# ============================================================

class CaseBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    priority: CasePriorityEnum = CasePriorityEnum.MEDIUM
    visibility: CaseVisibilityEnum = CaseVisibilityEnum.PUBLIC
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    hypothesis: Optional[str] = None


class CaseCreate(CaseBase):
    team_id: Optional[UUID] = None
    assigned_to_id: Optional[UUID] = None
    linked_cluster_id: Optional[UUID] = None


class CaseUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    status: Optional[CaseStatusEnum] = None
    priority: Optional[CasePriorityEnum] = None
    visibility: Optional[CaseVisibilityEnum] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    hypothesis: Optional[str] = None
    conclusion: Optional[str] = None
    assigned_to_id: Optional[UUID] = None
    linked_cluster_id: Optional[UUID] = None


class CaseResponse(BaseModel):
    id: UUID
    title: str
    description: Optional[str]
    status: CaseStatusEnum
    priority: CasePriorityEnum
    visibility: CaseVisibilityEnum
    category: Optional[str]
    tags: Optional[List[str]]
    created_by: UserBrief
    assigned_to: Optional[UserBrief]
    team_id: Optional[UUID]
    linked_cluster_id: Optional[UUID] = None
    hypothesis: Optional[str]
    conclusion: Optional[str]
    evidence_count: int = 0
    comment_count: int = 0
    started_at: Optional[datetime]
    closed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CaseListResponse(BaseModel):
    items: List[CaseResponse]
    total: int
    skip: int
    limit: int


# ============================================================
# Case Evidence Schemas
# ============================================================

class EvidenceBase(BaseModel):
    evidence_type: EvidenceTypeEnum
    reference_id: Optional[str] = None
    reference_url: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=500)
    summary: Optional[str] = None
    relevance_notes: Optional[str] = None
    is_key_evidence: bool = False
    confidence: Optional[str] = None


class EvidenceCreate(EvidenceBase):
    pass


class EvidenceUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    relevance_notes: Optional[str] = None
    is_key_evidence: Optional[bool] = None
    confidence: Optional[str] = None


class EvidenceResponse(BaseModel):
    id: UUID
    case_id: UUID
    evidence_type: EvidenceTypeEnum
    reference_id: Optional[str]
    reference_url: Optional[str]
    title: str
    summary: Optional[str]
    relevance_notes: Optional[str]
    is_key_evidence: bool
    confidence: Optional[str]
    added_by: UserBrief
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================
# Case Comment Schemas
# ============================================================

class CommentBase(BaseModel):
    content: str = Field(..., min_length=1)
    parent_comment_id: Optional[UUID] = None


class CommentCreate(CommentBase):
    pass


class CommentUpdate(BaseModel):
    content: str = Field(..., min_length=1)


class CommentResponse(BaseModel):
    id: UUID
    case_id: UUID
    parent_comment_id: Optional[UUID]
    content: str
    author: UserBrief
    mentions: Optional[List[UUID]]
    is_edited: bool
    edited_at: Optional[datetime]
    created_at: datetime
    replies: List["CommentResponse"] = []

    class Config:
        from_attributes = True


# ============================================================
# Verification Schemas
# ============================================================

class VerificationRequestCreate(BaseModel):
    item_type: VerifiableTypeEnum
    item_id: str
    claim: str = Field(..., min_length=1)
    context: Optional[str] = None
    evidence: Optional[dict] = None
    source_urls: Optional[List[str]] = None
    priority: Optional[str] = "normal"


class VerificationRequestResponse(BaseModel):
    id: UUID
    item_type: VerifiableTypeEnum
    item_id: str
    claim: str
    context: Optional[str]
    evidence: Optional[dict]
    source_urls: Optional[List[str]]
    status: VerificationStatusEnum
    priority: Optional[str]
    required_votes: int
    consensus_threshold: float
    requested_by: UserBrief
    agree_count: int
    disagree_count: int
    abstain_count: int
    needs_info_count: int
    final_verdict: Optional[str]
    resolution_notes: Optional[str]
    expires_at: Optional[datetime]
    resolved_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class VerificationVoteCreate(BaseModel):
    choice: VoteChoiceEnum
    confidence: Optional[int] = Field(None, ge=1, le=5)
    reasoning: Optional[str] = None
    supporting_evidence: Optional[dict] = None


class VerificationVoteResponse(BaseModel):
    id: UUID
    request_id: UUID
    voter: UserBrief
    choice: VoteChoiceEnum
    confidence: Optional[int]
    reasoning: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class VerificationListResponse(BaseModel):
    items: List[VerificationRequestResponse]
    total: int
    skip: int
    limit: int


# ============================================================
# Watchlist Schemas
# ============================================================

class WatchlistBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    scope: WatchlistScopeEnum = WatchlistScopeEnum.PERSONAL
    alert_frequency: AlertFrequencyEnum = AlertFrequencyEnum.DAILY
    min_relevance_score: Optional[float] = Field(None, ge=0, le=1)
    categories_filter: Optional[List[str]] = None


class WatchlistCreate(WatchlistBase):
    team_id: Optional[UUID] = None


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[WatchlistScopeEnum] = None
    alert_frequency: Optional[AlertFrequencyEnum] = None
    is_active: Optional[bool] = None
    min_relevance_score: Optional[float] = None
    categories_filter: Optional[List[str]] = None


class WatchlistResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    scope: WatchlistScopeEnum
    alert_frequency: AlertFrequencyEnum
    is_active: bool
    min_relevance_score: Optional[float]
    categories_filter: Optional[List[str]]
    owner: UserBrief
    team_id: Optional[UUID]
    item_count: int = 0
    total_matches: int
    last_match_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class WatchlistItemBase(BaseModel):
    item_type: WatchableTypeEnum
    value: str = Field(..., min_length=1, max_length=500)
    reference_id: Optional[str] = None
    aliases: Optional[List[str]] = None
    case_sensitive: bool = False
    exact_match: bool = False
    notes: Optional[str] = None


class WatchlistItemCreate(WatchlistItemBase):
    pass


class WatchlistItemResponse(BaseModel):
    id: UUID
    watchlist_id: UUID
    item_type: WatchableTypeEnum
    value: str
    reference_id: Optional[str]
    aliases: Optional[List[str]]
    case_sensitive: bool
    exact_match: bool
    notes: Optional[str]
    is_active: bool
    match_count: int
    last_match_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class WatchlistMatchResponse(BaseModel):
    id: UUID
    watchlist_id: UUID
    item_id: UUID
    matched_story_id: Optional[UUID]
    matched_text: Optional[str]
    match_context: Optional[str]
    relevance_score: Optional[float]
    is_alerted: bool
    is_dismissed: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================
# Activity Feed Schemas
# ============================================================

class ActivityResponse(BaseModel):
    id: UUID
    user: UserBrief
    activity_type: str
    target_type: Optional[str]
    target_id: Optional[str]
    description: Optional[str]
    extra_data: Optional[dict]
    team_id: Optional[UUID]
    created_at: datetime

    class Config:
        from_attributes = True


class ActivityFeedResponse(BaseModel):
    items: List[ActivityResponse]
    total: int
    has_more: bool


# ============================================================
# Analyst Metrics Schemas
# ============================================================

class AnalystMetricsResponse(BaseModel):
    user: UserBrief
    total_cases: int
    cases_closed: int
    evidence_added: int
    comments_posted: int
    verifications_requested: int
    verifications_voted: int
    verifications_correct: int
    verification_accuracy: Optional[float]
    entities_created: int
    stories_annotated: int
    notes_created: int
    active_days: int
    current_streak: int
    longest_streak: int
    last_active_at: Optional[datetime]
    badges: Optional[List[str]]
    reputation_score: int
    threat_score: int
    economic_score: int
    political_score: int

    class Config:
        from_attributes = True


class LeaderboardEntry(BaseModel):
    rank: int
    user: UserBrief
    reputation_score: int
    verification_accuracy: Optional[float]
    total_cases: int
    badges: List[str] = []


class LeaderboardResponse(BaseModel):
    entries: List[LeaderboardEntry]
    total_analysts: int


# ============================================================
# Analyst Note Schemas
# ============================================================

class NoteBase(BaseModel):
    title: Optional[str] = None
    content: str = Field(..., min_length=1)
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    visibility: NoteVisibilityEnum = NoteVisibilityEnum.PRIVATE


class NoteCreate(NoteBase):
    case_id: Optional[UUID] = None
    linked_items: Optional[List[dict]] = None
    team_id: Optional[UUID] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    visibility: Optional[NoteVisibilityEnum] = None
    is_pinned: Optional[bool] = None
    is_archived: Optional[bool] = None


class NoteResponse(BaseModel):
    id: UUID
    title: Optional[str]
    content: str
    category: Optional[str]
    tags: Optional[List[str]]
    linked_items: Optional[List[dict]]
    case_id: Optional[UUID]
    author: UserBrief
    visibility: NoteVisibilityEnum
    team_id: Optional[UUID]
    is_pinned: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================
# Source Reliability Schemas
# ============================================================

class SourceReliabilityResponse(BaseModel):
    source_id: str
    source_name: str
    source_type: str
    reliability_rating: str
    credibility_rating: int
    confidence_score: int
    admiralty_code: str
    total_stories: int
    verified_true: int
    verified_false: int
    total_ratings: int
    average_user_rating: Optional[float]
    notes: Optional[str]

    class Config:
        from_attributes = True


class SourceRatingCreate(BaseModel):
    reliability_rating: str = Field(..., min_length=1, max_length=1)
    credibility_rating: int = Field(..., ge=1, le=6)
    notes: Optional[str] = None


# Fix forward reference
CommentResponse.model_rebuild()
