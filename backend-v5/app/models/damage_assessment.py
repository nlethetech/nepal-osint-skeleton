"""Damage Assessment models for Palantir-grade geospatial analysis.

Supports all-hazard damage assessment:
- Civil unrest (protests, arson, riots)
- Natural disasters (floods, earthquakes, landslides)
- Infrastructure damage (roads, bridges, utilities)
- Environmental impact (contamination, deforestation)
"""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Text, DateTime, Float, Integer, Boolean,
    ForeignKey, Index, func, CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class DamageType(str, Enum):
    """Type of damage event."""
    STRUCTURAL = "structural"           # Building damage
    INFRASTRUCTURE = "infrastructure"   # Roads, bridges, utilities
    ENVIRONMENTAL = "environmental"     # Contamination, flooding, deforestation
    CIVIL_UNREST = "civil_unrest"       # Protest damage, arson, riots
    NATURAL_DISASTER = "natural_disaster"  # Earthquake, flood, landslide
    FIRE = "fire"                       # Fire damage
    INDUSTRIAL = "industrial"           # Industrial accidents


class SeverityLevel(str, Enum):
    """Severity level for damage zones."""
    CRITICAL = "critical"    # >70% damage, immediate danger
    SEVERE = "severe"        # 40-70% damage, unsafe
    MODERATE = "moderate"    # 20-40% damage, needs repair
    MINOR = "minor"          # <20% damage, minimal impact
    SAFE = "safe"            # No damage


class AssessmentStatus(str, Enum):
    """Status of a damage assessment."""
    DRAFT = "draft"              # Initial creation
    IN_PROGRESS = "in_progress"  # Analysis underway
    COMPLETED = "completed"      # Analysis complete
    VERIFIED = "verified"        # Peer verified
    ARCHIVED = "archived"        # Historical record


class EvidenceSourceType(str, Enum):
    """Type of evidence source."""
    SATELLITE = "satellite"       # Satellite imagery analysis
    STORY = "story"               # OSINT news story
    SOCIAL_MEDIA = "social_media" # Social media post
    GOVERNMENT = "government"     # Government report
    GROUND_REPORT = "ground_report"  # Field report
    PHOTO = "photo"               # Geotagged photo
    VIDEO = "video"               # Video footage


class VerificationStatus(str, Enum):
    """Verification status for evidence."""
    UNVERIFIED = "unverified"
    VERIFIED = "verified"
    DISPUTED = "disputed"
    RETRACTED = "retracted"


class DamageAssessment(Base, TimestampMixin):
    """Core damage assessment record for any damage event.

    An assessment represents a comprehensive analysis of damage
    for a specific event (e.g., "2025 Parliament Protests", "Koshi Flood 2024").
    """

    __tablename__ = "damage_assessments"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # EVENT IDENTIFICATION
    # ═══════════════════════════════════════════════════════════════════════════
    event_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="Human-readable event name (e.g., '2025 Parliament Protests')",
    )
    event_description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Detailed description of the damage event",
    )
    event_type: Mapped[DamageType] = mapped_column(
        String(30),
        nullable=False,
        index=True,
        comment="Type of damage event",
    )
    event_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        comment="When the damage event occurred",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # GEOGRAPHIC SCOPE
    # ═══════════════════════════════════════════════════════════════════════════
    bbox: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        comment="Bounding box [min_lng, min_lat, max_lng, max_lat]",
    )
    districts: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="List of affected districts",
    )
    center_lat: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Center latitude for map focus",
    )
    center_lng: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Center longitude for map focus",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # SATELLITE ANALYSIS PARAMETERS
    # ═══════════════════════════════════════════════════════════════════════════
    baseline_start: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Pre-event imagery window start",
    )
    baseline_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Pre-event imagery window end",
    )
    post_event_start: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Post-event imagery window start",
    )
    post_event_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Post-event imagery window end",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # AGGREGATE RESULTS
    # ═══════════════════════════════════════════════════════════════════════════
    total_area_km2: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Total assessment area in km²",
    )
    damaged_area_km2: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Total damaged area in km²",
    )
    damage_percentage: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Percentage of area damaged",
    )

    # Severity breakdown (km²)
    critical_area_km2: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, default=0.0,
    )
    severe_area_km2: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, default=0.0,
    )
    moderate_area_km2: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, default=0.0,
    )
    minor_area_km2: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, default=0.0,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # POPULATION IMPACT
    # ═══════════════════════════════════════════════════════════════════════════
    affected_population: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=0,
        comment="Estimated affected population from census data",
    )
    displaced_estimate: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=0,
        comment="Estimated displaced persons",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # INFRASTRUCTURE IMPACT
    # ═══════════════════════════════════════════════════════════════════════════
    buildings_affected: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=0,
    )
    roads_damaged_km: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, default=0.0,
    )
    bridges_affected: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=0,
    )
    utilities_disrupted: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=0,
        comment="Count of utility disruptions (power, water, etc.)",
    )

    # Infrastructure details stored as JSONB
    infrastructure_details: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True,
        comment="Detailed infrastructure impact by type",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # TILE URLS FOR VISUALIZATION
    # ═══════════════════════════════════════════════════════════════════════════
    damage_tile_url: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Damage probability heatmap tiles",
    )
    before_tile_url: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Pre-event Sentinel-2 RGB tiles",
    )
    after_tile_url: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Post-event Sentinel-2 RGB tiles",
    )
    before_sar_tile_url: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Pre-event Sentinel-1 SAR tiles",
    )
    after_sar_tile_url: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Post-event Sentinel-1 SAR tiles",
    )
    t_stat_tile_url: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="T-statistic visualization tiles",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # METADATA
    # ═══════════════════════════════════════════════════════════════════════════
    status: Mapped[AssessmentStatus] = mapped_column(
        String(20),
        nullable=False,
        default=AssessmentStatus.DRAFT.value,
        index=True,
    )
    confidence_score: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True,
        comment="Overall confidence score 0-1",
    )
    baseline_images_count: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True,
        comment="Number of baseline satellite images used",
    )
    post_images_count: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True,
        comment="Number of post-event satellite images used",
    )

    # Key findings for executive summary
    key_findings: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
        comment="List of key findings strings",
    )

    # Tags for filtering
    tags: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
        comment="Tags for categorization",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # OWNERSHIP & VERIFICATION
    # ═══════════════════════════════════════════════════════════════════════════
    created_by_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[created_by_id],
    )

    verified_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    verified_by: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[verified_by_id],
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # RELATIONSHIPS
    # ═══════════════════════════════════════════════════════════════════════════
    zones: Mapped[list["DamageZone"]] = relationship(
        "DamageZone",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_assessment_event_date", "event_date", "event_type"),
        Index("idx_assessment_status_date", "status", "created_at"),
        CheckConstraint("confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)"),
    )

    def __repr__(self) -> str:
        return f"<DamageAssessment {self.id}: {self.event_name}>"


class DamageZone(Base, TimestampMixin):
    """Individual damage zone within an assessment.

    Represents a specific area with detected damage,
    storing geometry as GeoJSON for PostGIS-free compatibility.
    """

    __tablename__ = "damage_zones"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Parent assessment
    assessment_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assessment: Mapped["DamageAssessment"] = relationship(
        "DamageAssessment",
        back_populates="zones",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # ZONE IDENTIFICATION
    # ═══════════════════════════════════════════════════════════════════════════
    zone_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Human-readable zone name (e.g., 'Singha Durbar Complex')",
    )
    zone_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="area",
        comment="building | area | infrastructure | natural",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # GEOMETRY (GeoJSON format for flexibility)
    # ═══════════════════════════════════════════════════════════════════════════
    geometry: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="GeoJSON polygon geometry",
    )
    centroid_lat: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )
    centroid_lng: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )
    area_km2: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # DAMAGE METRICS
    # ═══════════════════════════════════════════════════════════════════════════
    severity: Mapped[SeverityLevel] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )
    damage_percentage: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Percentage of zone damaged (0-100)",
    )
    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5,
        comment="Confidence score 0-1",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # CLASSIFICATION
    # ═══════════════════════════════════════════════════════════════════════════
    land_use: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="residential | commercial | government | industrial | agricultural",
    )
    building_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Type of building if applicable",
    )

    # Population in this zone (from census overlay)
    estimated_population: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # VERIFICATION
    # ═══════════════════════════════════════════════════════════════════════════
    satellite_detected: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        comment="Was this zone detected via satellite analysis?",
    )
    ground_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        comment="Has this zone been verified by ground reports?",
    )
    verification_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # RELATIONSHIPS
    # ═══════════════════════════════════════════════════════════════════════════
    evidence: Mapped[list["DamageEvidence"]] = relationship(
        "DamageEvidence",
        back_populates="zone",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_zone_assessment_severity", "assessment_id", "severity"),
        Index("idx_zone_location", "centroid_lat", "centroid_lng"),
        CheckConstraint("confidence >= 0 AND confidence <= 1"),
        CheckConstraint("damage_percentage >= 0 AND damage_percentage <= 100"),
    )

    def __repr__(self) -> str:
        name = self.zone_name or f"Zone at {self.centroid_lat:.4f}, {self.centroid_lng:.4f}"
        return f"<DamageZone {self.id}: {name} ({self.severity})>"


class DamageEvidence(Base, TimestampMixin):
    """Evidence linking damage zones to source data.

    Provides full provenance tracking for all evidence,
    whether from satellite analysis, news stories, or ground reports.
    """

    __tablename__ = "damage_evidence"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Can link to zone or directly to assessment
    zone_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_zones.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    zone: Mapped[Optional["DamageZone"]] = relationship(
        "DamageZone",
        back_populates="evidence",
    )

    assessment_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # SOURCE REFERENCE
    # ═══════════════════════════════════════════════════════════════════════════
    source_type: Mapped[EvidenceSourceType] = mapped_column(
        String(30),
        nullable=False,
        index=True,
    )
    source_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
        comment="Story ID, Tweet ID, etc.",
    )
    source_url: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    source_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Name of source (e.g., 'Kathmandu Post')",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # EVIDENCE DETAILS
    # ═══════════════════════════════════════════════════════════════════════════
    evidence_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        comment="image | video | text | report | analysis",
    )
    title: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    excerpt: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Text excerpt or description",
    )
    media_url: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="URL to image/video if applicable",
    )
    timestamp: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        comment="When evidence was captured/published",
    )

    # Location if different from zone
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # ═══════════════════════════════════════════════════════════════════════════
    # CONFIDENCE & VERIFICATION
    # ═══════════════════════════════════════════════════════════════════════════
    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5,
        comment="Confidence score 0-1",
    )
    verification_status: Mapped[VerificationStatus] = mapped_column(
        String(20),
        nullable=False,
        default=VerificationStatus.UNVERIFIED.value,
        index=True,
    )
    verification_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Auto-linked vs manually added
    auto_linked: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        comment="Was this automatically linked by the system?",
    )
    link_confidence: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Confidence of auto-link (if auto_linked)",
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # METADATA
    # ═══════════════════════════════════════════════════════════════════════════
    added_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    added_by: Mapped[Optional["User"]] = relationship("User")

    # Additional metadata
    extra_data: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Additional source-specific metadata",
    )

    __table_args__ = (
        Index("idx_evidence_assessment", "assessment_id", "source_type"),
        Index("idx_evidence_timestamp", "timestamp"),
        CheckConstraint("confidence >= 0 AND confidence <= 1"),
    )

    def __repr__(self) -> str:
        return f"<DamageEvidence {self.id}: {self.source_type} - {self.evidence_type}>"


class AssessmentNote(Base, TimestampMixin):
    """Notes specific to damage assessments.

    While the general AnalystNote can be used, this provides
    assessment-specific fields for collaborative analysis.
    """

    __tablename__ = "assessment_notes"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Link to assessment (required) and optionally to zone
    assessment_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    zone_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_zones.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Note content
    note_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="observation",
        comment="observation | question | flag | insight | methodology",
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="open",
        comment="open | resolved | archived",
    )

    # Author
    author_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])

    # Resolution
    resolved_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[resolved_by_id])
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    resolution_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    __table_args__ = (
        Index("idx_assessment_note_status", "assessment_id", "status"),
        Index("idx_assessment_note_author", "author_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<AssessmentNote {self.id}: {self.note_type}>"
