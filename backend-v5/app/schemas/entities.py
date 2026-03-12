"""Entity Pydantic schemas for political entities API."""
from datetime import datetime, date
from typing import Optional, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class EntityResponse(BaseModel):
    """Full entity response."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    canonical_id: str
    name_en: str
    name_ne: Optional[str] = None
    entity_type: str
    party: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    aliases: Optional[list[str]] = None

    # Enrichment fields
    biography: Optional[str] = None
    education: Optional[str] = None
    education_institution: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    former_parties: Optional[list[dict]] = None
    current_position: Optional[str] = None
    position_history: Optional[list[dict]] = None

    # Mention stats
    total_mentions: int
    mentions_24h: int
    mentions_7d: int
    trend: str
    last_mentioned_at: Optional[datetime] = None

    # Metadata
    is_active: bool
    is_watchable: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_entity(cls, entity) -> "EntityResponse":
        """Create from PoliticalEntity model."""
        return cls(
            id=entity.id,
            canonical_id=entity.canonical_id,
            name_en=entity.name_en,
            name_ne=entity.name_ne,
            entity_type=entity.entity_type.value,
            party=entity.party,
            role=entity.role,
            description=entity.description,
            image_url=entity.image_url,
            aliases=entity.aliases,
            biography=entity.biography,
            education=entity.education,
            education_institution=entity.education_institution,
            age=entity.age,
            gender=entity.gender,
            former_parties=entity.former_parties,
            current_position=entity.current_position,
            position_history=entity.position_history,
            total_mentions=entity.total_mentions,
            mentions_24h=entity.mentions_24h,
            mentions_7d=entity.mentions_7d,
            trend=entity.trend.value,
            last_mentioned_at=entity.last_mentioned_at,
            is_active=entity.is_active,
            is_watchable=entity.is_watchable,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )


class EntityListResponse(BaseModel):
    """Paginated list of entities."""
    entities: list[EntityResponse]
    total: int
    limit: int
    offset: int


class EntityStoryItem(BaseModel):
    """Story item in entity stories response."""
    id: UUID
    title: str
    summary: Optional[str] = None
    url: str
    source_id: str
    source_name: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    nepal_relevance: Optional[str] = None
    published_at: Optional[datetime] = None
    linked_at: Optional[datetime] = None


class EntityStoriesResponse(BaseModel):
    """Response for entity stories endpoint."""
    entity_id: UUID
    entity_name: str
    entity_name_ne: Optional[str] = None
    entity_type: str
    stories: list[EntityStoryItem]
    total: int
    hours: int
    limit: int
    offset: int


# --- Unified Profile sub-schemas ---

class ElectionHistoryItem(BaseModel):
    """Election participation record."""
    year_bs: int
    year_ad: int
    constituency: Optional[str] = None
    constituency_code: Optional[str] = None
    district: Optional[str] = None
    party: str
    votes: int = 0
    vote_pct: float = 0.0
    rank: int = 0
    is_winner: bool = False


class ParliamentRecordSummary(BaseModel):
    """Summary of parliament performance."""
    mp_id: Optional[str] = None
    chamber: Optional[str] = None
    term: Optional[str] = None
    constituency: Optional[str] = None
    performance_score: float = 0.0
    performance_percentile: Optional[int] = None
    performance_tier: Optional[str] = None
    bills_introduced: int = 0
    bills_passed: int = 0
    questions_asked: int = 0
    speeches_count: int = 0
    session_attendance_pct: Optional[float] = None
    committee_memberships: int = 0
    is_minister: bool = False
    ministry_portfolio: Optional[str] = None


class ExecutiveRecordItem(BaseModel):
    """Executive (ministerial) position record."""
    position_type: str
    ministry: Optional[str] = None
    position_title: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: bool = False
    government_name: Optional[str] = None
    party_at_appointment: Optional[str] = None


class BusinessConnectionItem(BaseModel):
    """Business/company connection."""
    company_name: Optional[str] = None
    role: Optional[str] = None
    source: str = "unknown"
    confidence: float = 1.0
    company_id: Optional[UUID] = None
