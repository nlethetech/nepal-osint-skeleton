"""Unified graph models for NARADA — nodes, edges, metrics, districts, entity resolution.

This module implements the Palantir-inspired unified graph layer that sits on top of all
existing domain tables (companies, politicians, disasters, trade, stories, etc.) and provides
a single schema for cross-domain traversal, entity resolution, and progressive graph exploration.

Design reference: docs/discuss.md — Round 10 Consensus Design.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    ForeignKey,
    Index,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


# ---------------------------------------------------------------------------
# Enumerations (validated in Python; stored as VARCHAR for flexibility)
# ---------------------------------------------------------------------------


class NodeType(str, Enum):
    """Canonical node types for the unified graph."""

    PERSON = "person"
    ORGANIZATION = "organization"
    PLACE = "place"
    EVENT = "event"
    STORY = "story"
    COMMODITY = "commodity"
    COUNTRY = "country"
    DOCUMENT = "document"
    CLUSTER = "cluster"
    ASSESSMENT = "assessment"
    CASE = "case"
    HYPOTHESIS = "hypothesis"


class EdgePredicate(str, Enum):
    """Canonical edge predicates for the unified graph."""

    # Geographic
    LOCATED_IN = "located_in"
    PARENT_OF = "parent_of"
    WITHIN = "within"
    HEADQUARTERS_OF = "headquarters_of"

    # Corporate
    DIRECTOR_OF = "director_of"
    REGISTERED_IN = "registered_in"
    SHARES_PHONE_WITH = "shares_phone_with"
    SHARES_ADDRESS_WITH = "shares_address_with"

    # Political
    MEMBER_OF = "member_of"
    ELECTED_FROM = "elected_from"
    MINISTER_OF = "minister_of"
    CANDIDATE_IN = "candidate_in"
    OPPOSES = "opposes"
    IDENTITY_OF_CANDIDACY = "identity_of_candidacy"

    # News
    MENTIONED_IN = "mentioned_in"
    CO_MENTIONED_WITH = "co_mentioned_with"
    ABOUT_EVENT = "about_event"
    STORY_IN_CLUSTER = "story_in_cluster"

    # Trade
    IMPORTS_FROM = "imports_from"
    EXPORTS_TO = "exports_to"
    TRADES_COMMODITY = "trades_commodity"
    TRADES_THROUGH = "trades_through"

    # Disaster
    OCCURRED_IN = "occurred_in"
    AFFECTED_BY = "affected_by"
    DAMAGED_AREA_IN = "damaged_area_in"

    # Governance
    WON_CONTRACT = "won_contract"
    SPONSORED_BILL = "sponsored_bill"
    COMMITTEE_MEMBER = "committee_member"

    # Development finance
    FUNDS = "funds"
    IMPLEMENTS = "implements"

    # Investigation
    EVIDENCE_FOR = "evidence_for"
    HYPOTHESIS_ABOUT = "hypothesis_about"
    CASE_INVOLVES = "case_involves"


class VerificationStatus(str, Enum):
    """Verification status for graph edges."""

    CANDIDATE = "candidate"
    VERIFIED = "verified"
    REJECTED = "rejected"


class ResolutionMethod(str, Enum):
    """Methods used for entity resolution."""

    PAN_EXACT = "pan_exact"
    NAME_JARO_WINKLER = "name_jaro_winkler"
    CANONICAL_KEY = "canonical_key"
    GRAPH_TOPOLOGY = "graph_topology"
    PHONE_HASH = "phone_hash"
    MANUAL = "manual"


class MetricWindow(str, Enum):
    """Time windows for precomputed graph metrics."""

    H24 = "24h"
    D7 = "7d"
    D30 = "30d"
    ALL_TIME = "all_time"


# ---------------------------------------------------------------------------
# District — canonical reference table for Nepal's 77 districts
# ---------------------------------------------------------------------------


class District(Base, TimestampMixin):
    """Canonical reference table for Nepal's 77 districts.

    Provides a single source of truth for geographic normalization.  Every domain
    that stores a district as a free-text string can be resolved against this table
    via the ``aliases`` JSONB list or exact ``name_en`` match.
    """

    __tablename__ = "districts"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    name_en: Mapped[str] = mapped_column(
        String(100), nullable=False, unique=True, index=True
    )
    name_ne: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    province_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    province_name: Mapped[str] = mapped_column(String(100), nullable=False)
    headquarters: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    area_sq_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    population_2021: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    boundary_geojson: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    aliases: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True, server_default="'[]'::jsonb"
    )
    graph_node_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_districts_province_id", "province_id"),
        Index("idx_districts_name_en", "name_en"),
    )


# ---------------------------------------------------------------------------
# GraphNode — unified node table for all entity types
# ---------------------------------------------------------------------------


class GraphNode(Base, TimestampMixin):
    """Unified node table for the NARADA graph.

    Every real-world entity (company, person, district, story, disaster, commodity,
    etc.) is represented as a single row.  The ``source_table`` + ``source_id`` pair
    provides a back-reference to the original domain table without modifying it.
    """

    __tablename__ = "graph_nodes"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    node_type: Mapped[str] = mapped_column(String(40), nullable=False)
    canonical_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    title_ne: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    subtitle: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    subtype: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    tags: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True, server_default="'[]'::jsonb"
    )
    district: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    province: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    properties: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, server_default="'{}'::jsonb"
    )
    source_table: Mapped[str] = mapped_column(String(80), nullable=False)
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    source_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    confidence: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0.0"
    )

    # Entity resolution — self-referential FK for merged duplicates
    canonical_node_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_canonical: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    resolution_metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Temporal tracking
    first_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    canonical_node: Mapped[Optional["GraphNode"]] = relationship(
        "GraphNode",
        remote_side="GraphNode.id",
        foreign_keys=[canonical_node_id],
    )
    outgoing_edges: Mapped[list["GraphEdge"]] = relationship(
        "GraphEdge",
        back_populates="source_node",
        foreign_keys="GraphEdge.source_node_id",
        cascade="all, delete-orphan",
    )
    incoming_edges: Mapped[list["GraphEdge"]] = relationship(
        "GraphEdge",
        back_populates="target_node",
        foreign_keys="GraphEdge.target_node_id",
        cascade="all, delete-orphan",
    )
    metrics: Mapped[list["GraphNodeMetrics"]] = relationship(
        "GraphNodeMetrics",
        back_populates="node",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Core lookups
        Index("idx_gn_node_type", "node_type"),
        Index("idx_gn_district", "district"),
        Index("idx_gn_province", "province"),
        Index("idx_gn_source", "source_table", "source_id"),
        Index("idx_gn_canonical_key", "canonical_key"),
        # Entity resolution
        Index(
            "idx_gn_canonical_node_id",
            "canonical_node_id",
            postgresql_where="NOT is_canonical",
        ),
        # Full-text / JSONB
        Index("idx_gn_properties_gin", "properties", postgresql_using="gin"),
        Index("idx_gn_tags_gin", "tags", postgresql_using="gin"),
        # Spatial (only index rows with coordinates)
        Index(
            "idx_gn_lat_lng",
            "latitude",
            "longitude",
            postgresql_where="latitude IS NOT NULL",
        ),
        # Temporal
        Index("idx_gn_last_seen_at", "last_seen_at"),
    )


# ---------------------------------------------------------------------------
# GraphEdge — unified edge table for all relationships
# ---------------------------------------------------------------------------


class GraphEdge(Base, TimestampMixin):
    """Unified edge table for the NARADA graph.

    Every relationship between two graph nodes is represented as a single row.
    Temporal bounds (``valid_from`` / ``valid_to``) support historical relationships
    (e.g. "was director from 2020 to 2023").  The ``evidence_ids`` array tracks
    provenance references for auditability.
    """

    __tablename__ = "graph_edges"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    source_node_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_node_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    predicate: Mapped[str] = mapped_column(String(80), nullable=False)
    weight: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="1.0"
    )
    confidence: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0.0"
    )

    # Temporal bounds
    valid_from: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    valid_to: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_current: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    # Evidence and provenance
    source_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    evidence_ids: Mapped[Optional[list[UUID]]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)), nullable=True
    )
    properties: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, server_default="'{}'::jsonb"
    )

    # Source tracking (which table/row produced this edge)
    source_table: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    # Verification
    verification_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="'candidate'"
    )
    verified_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Temporal tracking
    first_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    source_node: Mapped["GraphNode"] = relationship(
        "GraphNode",
        back_populates="outgoing_edges",
        foreign_keys=[source_node_id],
    )
    target_node: Mapped["GraphNode"] = relationship(
        "GraphNode",
        back_populates="incoming_edges",
        foreign_keys=[target_node_id],
    )

    __table_args__ = (
        # Deduplication constraint
        UniqueConstraint(
            "source_node_id",
            "target_node_id",
            "predicate",
            "valid_from",
            name="uq_ge_source_target_predicate_valid_from",
        ),
        # Core lookups
        Index("idx_ge_source_node_id", "source_node_id"),
        Index("idx_ge_target_node_id", "target_node_id"),
        Index("idx_ge_predicate", "predicate"),
        # Forward hop traversal: given source, filter by predicate, get targets
        Index(
            "idx_ge_hop_fwd",
            "source_node_id",
            "predicate",
            "target_node_id",
        ),
        Index(
            "idx_ge_hop_fwd_current",
            "source_node_id",
            "predicate",
            "target_node_id",
            "is_current",
        ),
        # Reverse hop traversal: given target, filter by predicate, get sources
        Index(
            "idx_ge_hop_rev",
            "target_node_id",
            "predicate",
            "source_node_id",
        ),
        Index(
            "idx_ge_hop_rev_current",
            "target_node_id",
            "predicate",
            "source_node_id",
            "is_current",
        ),
        # Temporal range queries
        Index("idx_ge_valid_range", "valid_from", "valid_to"),
        Index("idx_ge_valid_from", "valid_from"),
        Index("idx_ge_valid_to", "valid_to"),
        Index("idx_ge_last_seen_at", "last_seen_at"),
        # Active-only partial index
        Index(
            "idx_ge_current",
            "source_node_id",
            "predicate",
            postgresql_where="is_current = true",
        ),
        # Confidence-based filtering
        Index("idx_ge_confidence", "confidence"),
        # JSONB properties
        Index("idx_ge_properties_gin", "properties", postgresql_using="gin"),
    )


# ---------------------------------------------------------------------------
# GraphIngestionRun / GraphIngestionRunStep — resumable ingestion checkpoints
# ---------------------------------------------------------------------------


class GraphIngestionRun(Base, TimestampMixin):
    """Tracks top-level graph ingestion runs for resumability and observability."""

    __tablename__ = "graph_ingestion_runs"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    phases: Mapped[Optional[list[str]]] = mapped_column(
        JSONB, nullable=True, server_default="'[]'::jsonb"
    )
    rows_processed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    errors: Mapped[Optional[list[dict]]] = mapped_column(
        JSONB, nullable=True, server_default="'[]'::jsonb"
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    steps: Mapped[list["GraphIngestionRunStep"]] = relationship(
        "GraphIngestionRunStep",
        back_populates="run",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_gir_started_at", "started_at"),
        Index("idx_gir_status", "status"),
    )


class GraphIngestionRunStep(Base, TimestampMixin):
    """Tracks per-phase ingestion status for a given ingestion run."""

    __tablename__ = "graph_ingestion_run_steps"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_ingestion_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    rows_processed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    errors: Mapped[Optional[list[dict]]] = mapped_column(
        JSONB, nullable=True, server_default="'[]'::jsonb"
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped["GraphIngestionRun"] = relationship(
        "GraphIngestionRun",
        back_populates="steps",
    )

    __table_args__ = (
        UniqueConstraint("run_id", "phase", name="uq_graph_ingestion_run_step"),
        Index("idx_girs_phase", "phase"),
        Index("idx_girs_status", "status"),
    )


# ---------------------------------------------------------------------------
# GraphNodeMetrics — precomputed centrality and clustering metrics
# ---------------------------------------------------------------------------


class GraphNodeMetrics(Base):
    """Precomputed graph metrics per node per time window.

    Metrics are recomputed periodically (e.g. hourly) by a background job and stored
    here for fast retrieval.  The ``window_type`` column supports multiple time horizons
    (24h, 7d, 30d, all_time) so the UI can show trend-aware analytics.
    """

    __tablename__ = "graph_node_metrics"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    node_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    window_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Degree metrics
    degree: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    in_degree: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    out_degree: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    # Centrality metrics
    betweenness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    closeness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pagerank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Clustering
    cluster_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    clustering_coeff: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Structural roles
    is_hub: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    is_bridge: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    influence_rank: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Computation timestamp
    computed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )

    # Relationships
    node: Mapped["GraphNode"] = relationship(
        "GraphNode", back_populates="metrics"
    )

    __table_args__ = (
        UniqueConstraint("node_id", "window_type", name="uq_gnm_node_window"),
        Index("idx_gnm_node_id", "node_id"),
        # Leaderboard query: top nodes by pagerank for all_time window
        Index(
            "idx_gnm_pagerank_alltime",
            pagerank.desc(),
            postgresql_where="window_type = 'all_time'",
        ),
    )


# ---------------------------------------------------------------------------
# EntityResolution — auditable, reversible merge tracking
# ---------------------------------------------------------------------------


class EntityResolution(Base):
    """Tracks entity resolution (merge) decisions for auditability and reversibility.

    When two graph nodes are determined to represent the same real-world entity,
    one becomes the canonical node and the other is marked as merged.  This table
    records the merge decision, the method used, confidence, and who approved it.
    Merges can be reversed by setting ``is_active = False``.
    """

    __tablename__ = "entity_resolutions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    canonical_node_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    merged_node_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    match_method: Mapped[str] = mapped_column(String(40), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Who resolved it
    resolved_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )
    is_auto: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    rationale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Reversibility
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    # Edge IDs re-pointed during merge: {"outgoing": [uuid,...], "incoming": [uuid,...]}
    # Stored so unmerge can precisely reverse the edge re-pointing.
    moved_edge_ids: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, server_default="'{}'::jsonb"
    )
    unresolved_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    unresolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "canonical_node_id",
            "merged_node_id",
            name="uq_er_canonical_merged",
        ),
        Index("idx_er_canonical_node_id", "canonical_node_id"),
        Index("idx_er_merged_node_id", "merged_node_id"),
        Index("idx_er_match_method", "match_method"),
        Index(
            "idx_er_active",
            "canonical_node_id",
            postgresql_where="is_active = true",
        ),
    )
