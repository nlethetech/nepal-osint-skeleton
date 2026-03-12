"""Analytics Pydantic schemas for dashboard widgets."""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.publishing import PeerReviewSummary


class ConsolidatedStoryResponse(BaseModel):
    """Story response for consolidated-stories endpoint (StoriesWidget)."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: str
    source_name: Optional[str] = None

    # Display fields - mapping to frontend expectations
    canonical_headline: str  # Alias for title
    canonical_headline_ne: Optional[str] = None
    summary: Optional[str] = None
    summary_ne: Optional[str] = None
    url: str  # Original article URL

    # Classification
    story_type: Optional[str] = None  # category field
    severity: Optional[str] = None  # severity field
    nepal_relevance: Optional[str] = None

    # Metadata
    source_count: int = 1
    first_reported_at: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None
    districts_affected: list[str] = []
    is_verified: bool = False
    confidence_score: Optional[float] = None
    cluster_id: Optional[UUID] = None

    @classmethod
    def from_story(cls, story) -> "ConsolidatedStoryResponse":
        """Create from Story model."""
        # Use persisted category if available, otherwise derive from categories
        story_type = story.category
        if not story_type and story.categories:
            cat_lower = [c.lower() for c in story.categories if c]
            if any(k in cat_lower for k in ["politics", "election", "government"]):
                story_type = "political"
            elif any(k in cat_lower for k in ["crime", "police", "arrest"]):
                story_type = "security"
            elif any(k in cat_lower for k in ["flood", "earthquake", "disaster", "landslide"]):
                story_type = "disaster"
            elif any(k in cat_lower for k in ["economy", "business", "market"]):
                story_type = "economic"
            elif any(k in cat_lower for k in ["protest", "strike", "health", "education"]):
                story_type = "social"

        # Use persisted severity if available, otherwise derive
        severity = story.severity
        if not severity:
            severity = "low"
            if story.nepal_relevance == "NEPAL_DOMESTIC":
                severity = "medium"
                if story.relevance_score and story.relevance_score > 0.8:
                    severity = "high"

        return cls(
            id=story.id,
            source_id=story.source_id,
            source_name=story.source_name,
            canonical_headline=story.title,
            summary=story.summary,
            url=story.url,
            story_type=story_type,
            severity=severity,
            nepal_relevance=story.nepal_relevance,
            source_count=1,
            first_reported_at=story.published_at,
            last_updated_at=story.created_at,
            districts_affected=[],
            is_verified=False,
            confidence_score=float(story.relevance_score) if story.relevance_score else None,
            cluster_id=story.cluster_id,
        )


class HourlyTrend(BaseModel):
    """Hourly story count."""
    hour: str
    count: int


class AnalyticsSummaryResponse(BaseModel):
    """Analytics summary for KPI widget."""
    stories: int  # Renamed from story_count for frontend compatibility
    events: int  # Renamed from event_count
    entities: int = 0  # Placeholder
    active_alerts: int = 0  # Placeholder
    sources_breakdown: dict[str, int]
    hourly_trend: list[HourlyTrend]
    time_range_hours: int


class ThreatCategoryItem(BaseModel):
    """Single threat category in the matrix."""
    category: str
    level: str  # critical | elevated | guarded | low
    trend: str = "stable"  # escalating | stable | deescalating
    event_count: int
    top_event: Optional[str] = None
    severity_breakdown: dict[str, int]


class ThreatMatrixResponse(BaseModel):
    """Threat matrix for ThreatsWidget."""
    matrix: list[ThreatCategoryItem]
    overall_threat_level: str = "GUARDED"
    last_updated: datetime


class ClusterStoryItem(BaseModel):
    """Individual story within a cluster."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: str
    source_name: Optional[str] = None
    title: str
    summary: Optional[str] = None
    url: str
    published_at: Optional[datetime] = None


class ClusterStoryGroupItem(BaseModel):
    """Near-identical stories collapsed into a single canonical item."""

    canonical: ClusterStoryItem
    duplicates: list[ClusterStoryItem] = Field(default_factory=list)
    duplicate_count: int = 0


class AggregatedCluster(BaseModel):
    """Aggregated news cluster."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    headline: str
    summary: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    story_count: int
    source_count: int
    sources: list[str]  # List of source names
    first_published: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    stories: list[ClusterStoryItem]
    story_groups: Optional[list[ClusterStoryGroupItem]] = None
    published_at: Optional[datetime] = None
    latest_version: Optional[int] = None
    latest_publication_at: Optional[datetime] = None
    citations_count: Optional[int] = None
    official_confirmation: Optional[bool] = None
    peer_review: Optional[PeerReviewSummary] = None

    @classmethod
    def from_cluster(
        cls,
        cluster,
        prefer_analyst: bool = False,
        story_groups: Optional[list[ClusterStoryGroupItem]] = None,
        *,
        published_at: Optional[datetime] = None,
        latest_version: Optional[int] = None,
        latest_publication_at: Optional[datetime] = None,
        citations_count: Optional[int] = None,
        official_confirmation: Optional[bool] = None,
        peer_review: Optional[PeerReviewSummary] = None,
    ) -> "AggregatedCluster":
        """Create from StoryCluster model with stories loaded."""
        sources = list(set(
            s.source_name or s.source_id
            for s in cluster.stories
        ))

        if prefer_analyst:
            headline = cluster.analyst_headline or cluster.headline
            # Prefer customer_brief when published
            summary = (
                cluster.customer_brief
                or cluster.analyst_summary
                or cluster.summary
            )
            category = cluster.analyst_category or cluster.category
            severity = cluster.analyst_severity or cluster.severity
        else:
            headline = cluster.headline
            summary = cluster.summary
            category = cluster.category
            severity = cluster.severity

        stories = [
            ClusterStoryItem(
                id=s.id,
                source_id=s.source_id,
                source_name=s.source_name,
                title=s.title,
                summary=s.summary,
                url=s.url,
                published_at=s.published_at,
            )
            for s in sorted(
                cluster.stories,
                key=lambda x: x.published_at or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
        ]

        return cls(
            id=cluster.id,
            headline=headline,
            summary=summary,
            category=category,
            severity=severity,
            story_count=cluster.story_count,
            source_count=cluster.source_count,
            sources=sources,
            first_published=cluster.first_published,
            last_updated=cluster.last_updated,
            stories=stories,
            story_groups=story_groups,
            published_at=published_at,
            latest_version=latest_version,
            latest_publication_at=latest_publication_at,
            citations_count=citations_count,
            official_confirmation=official_confirmation,
            peer_review=peer_review,
        )


class AggregatedNewsResponse(BaseModel):
    """Response for aggregated-news endpoint."""
    clusters: list[AggregatedCluster]
    unclustered_count: int
    total_stories: int


# ============================================================
# Key Actors (Political Entities) Schemas
# ============================================================

class StoryBrief(BaseModel):
    """Brief story info for entity detail view."""
    id: UUID
    title: str
    source_name: Optional[str] = None
    published_at: Optional[datetime] = None
    url: str


class KeyActorResponse(BaseModel):
    """Key actor (political entity) response for dashboard."""
    model_config = ConfigDict(from_attributes=True)

    entity_id: UUID
    canonical_id: str
    name: str
    name_ne: Optional[str] = None
    entity_type: str  # person, party, organization, institution
    party: Optional[str] = None
    role: Optional[str] = None
    image_url: Optional[str] = None

    # Mention stats
    mention_count: int  # Total mentions
    mention_count_24h: int  # Last 24 hours
    mention_count_7d: int  # Last 7 days
    trend: str  # rising, stable, falling
    last_mentioned_at: Optional[datetime] = None

    # Top stories mentioning this entity
    top_stories: list[StoryBrief] = []

    @classmethod
    def from_entity(
        cls,
        entity,
        top_stories: list = None,
    ) -> "KeyActorResponse":
        """Create from PoliticalEntity model."""
        stories = []
        if top_stories:
            stories = [
                StoryBrief(
                    id=s.id,
                    title=s.title,
                    source_name=s.source_name,
                    published_at=s.published_at,
                    url=s.url,
                )
                for s in top_stories[:5]
            ]

        return cls(
            entity_id=entity.id,
            canonical_id=entity.canonical_id,
            name=entity.name_en,
            name_ne=entity.name_ne,
            entity_type=entity.entity_type.value,
            party=entity.party,
            role=entity.role,
            image_url=entity.image_url,
            mention_count=entity.total_mentions,
            mention_count_24h=entity.mentions_24h,
            mention_count_7d=entity.mentions_7d,
            trend=entity.trend.value,
            last_mentioned_at=entity.last_mentioned_at,
            top_stories=stories,
        )


# ============================================================
# Executive Summary (AI-Generated)
# ============================================================

class PriorityDevelopment(BaseModel):
    """Priority development item in executive summary."""
    headline: str
    significance: str
    districts: list[str] = []


class ExecutiveSummaryResponse(BaseModel):
    """AI-generated executive summary response."""
    key_judgment: str
    situation_overview: str
    priority_developments: list[PriorityDevelopment]
    geographic_focus: list[str]
    threat_level: str  # CRITICAL | ELEVATED | GUARDED | LOW
    threat_trajectory: str  # ESCALATING | STABLE | DE-ESCALATING
    watch_items: list[str]
    story_count: int
    time_range_hours: int
    generated_at: datetime


# ============================================================
# AI-Enhanced Threat Matrix
# ============================================================

class CategoryInsight(BaseModel):
    """AI-generated insight for a threat category."""
    narrative: str
    key_development: str
    watch_for: str


class ThreatMatrixAIResponse(BaseModel):
    """AI-enhanced threat matrix response."""
    matrix: list[ThreatCategoryItem]
    overall_threat_level: str
    last_updated: datetime
    overall_assessment: str
    category_insights: dict[str, CategoryInsight]
    priority_watch_items: list[str]
    escalation_risk: str  # LOW | MODERATE | HIGH
    ai_generated: bool = True


# ============================================================
# Cluster Timeline (Situation Monitor)
# ============================================================

class ClusterTimelineStory(BaseModel):
    """Single story within a cluster timeline."""
    source_name: Optional[str] = None
    title: str
    published_at: Optional[datetime] = None
    url: Optional[str] = None


class ClusterTimelineEntry(BaseModel):
    """A story cluster with chronological source timeline."""
    cluster_id: UUID
    headline: str
    category: Optional[str] = None
    severity: Optional[str] = None
    story_count: int
    source_count: int
    first_published: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    diversity_score: Optional[float] = None
    confidence_level: Optional[str] = None
    bluf: Optional[str] = None
    development_stage: Optional[str] = None  # emerging | developing | mature | resolved
    timeline: list[ClusterTimelineStory]


class DevelopingStoryEntry(BaseModel):
    """Event-level developing story feed item."""
    cluster_id: UUID
    headline: str
    category: Optional[str] = None
    severity: Optional[str] = None
    story_count: int
    source_count: int
    first_published: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    diversity_score: Optional[float] = None
    confidence_level: Optional[str] = None
    bluf: Optional[str] = None
    development_stage: Optional[str] = None
    timeline: list[ClusterTimelineStory]
    new_sources_6h: int = 0
    update_velocity: int = 0
    urgency_score: float = 0.0
    cross_lingual: bool = False


class StoryTrackerClusterRef(BaseModel):
    """Cluster within a higher-level narrative."""
    cluster_id: UUID
    headline: str
    category: Optional[str] = None
    severity: Optional[str] = None
    story_count: int
    source_count: int
    last_updated: Optional[datetime] = None
    bluf: Optional[str] = None
    similarity_score: Optional[float] = None


class StoryTrackerEntry(BaseModel):
    """Narrative-level tracker item spanning multiple clusters."""
    narrative_id: UUID
    label: str
    thesis: Optional[str] = None
    category: Optional[str] = None
    direction: Optional[str] = None
    momentum_score: float
    confidence: Optional[float] = None
    cluster_count: int
    lead_regions: list[str] = []
    lead_entities: list[str] = []
    first_seen_at: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    clusters: list[StoryTrackerClusterRef]
