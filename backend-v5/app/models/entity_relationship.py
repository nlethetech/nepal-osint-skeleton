"""EntityRelationship and EntityNetworkMetrics models for network analysis."""
from datetime import datetime
from enum import Enum
from typing import Optional, List, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, Boolean, Integer, Float, func, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB, ENUM, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.political_entity import PoliticalEntity


class RelationshipType(str, Enum):
    """Types of relationships between entities."""
    CO_MENTION = "co_mention"
    PARTY_AFFILIATION = "party_affiliation"
    COMMITTEE_MEMBER = "committee_member"
    FAMILY = "family"
    BUSINESS_PARTNER = "business_partner"
    POLITICAL_ALLY = "political_ally"
    POLITICAL_OPPONENT = "political_opponent"
    PREDECESSOR_SUCCESSOR = "predecessor_successor"
    FUNDS = "funds"
    IMPLEMENTS = "implements"


class MetricWindowType(str, Enum):
    """Time windows for network metrics."""
    WINDOW_24H = "24h"
    WINDOW_7D = "7d"
    WINDOW_30D = "30d"
    WINDOW_90D = "90d"
    ALL_TIME = "all_time"


class EntityRelationship(Base):
    """
    Relationship between two political entities.

    Tracks co-mentions, political alliances, and other relationship types.
    Used for network analysis and visualization.
    """

    __tablename__ = "entity_relationships"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Related entities (directed relationship)
    source_entity_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("political_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_entity_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("political_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Relationship type
    relationship_type: Mapped[RelationshipType] = mapped_column(
        ENUM(
            RelationshipType,
            name="relationship_type",
            create_type=False,
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=RelationshipType.CO_MENTION,
    )

    # Co-mention metrics
    co_mention_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
    )
    strength_score: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )
    confidence: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )

    # Temporal tracking
    first_co_mention_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_co_mention_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Evidence and notes
    evidence_story_ids: Mapped[Optional[List[UUID]]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)),
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Verification status
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="false",
    )
    verified_by: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    source_entity: Mapped["PoliticalEntity"] = relationship(
        "PoliticalEntity",
        foreign_keys=[source_entity_id],
        backref="outgoing_relationships",
    )
    target_entity: Mapped["PoliticalEntity"] = relationship(
        "PoliticalEntity",
        foreign_keys=[target_entity_id],
        backref="incoming_relationships",
    )

    def __repr__(self) -> str:
        return f"<EntityRelationship {self.source_entity_id} -> {self.target_entity_id} ({self.relationship_type.value})>"


class EntityNetworkMetrics(Base):
    """
    Precomputed network metrics for an entity.

    Includes centrality measures, PageRank, and cluster assignments.
    Computed periodically by the NetworkAnalysisService.
    """

    __tablename__ = "entity_network_metrics"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Entity reference
    entity_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("political_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Time window
    window_type: Mapped[MetricWindowType] = mapped_column(
        ENUM(
            MetricWindowType,
            name="metric_window_type",
            create_type=False,
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
    )

    # Centrality metrics
    degree_centrality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    in_degree_centrality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    out_degree_centrality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    betweenness_centrality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    closeness_centrality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    eigenvector_centrality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pagerank_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Clustering
    cluster_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    clustering_coefficient: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Influence indicators
    is_hub: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_authority: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_bridge: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    influence_rank: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Connection stats
    total_connections: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    incoming_connections: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    outgoing_connections: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # Computation metadata
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    computation_version: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
    )

    # Relationship
    entity: Mapped["PoliticalEntity"] = relationship(
        "PoliticalEntity",
        foreign_keys=[entity_id],
        backref="network_metrics",
    )

    def __repr__(self) -> str:
        return f"<EntityNetworkMetrics {self.entity_id} ({self.window_type.value})>"


class EntityCommunity(Base):
    """
    Community/cluster detected in the entity network.

    Provides metadata about detected clusters from community detection algorithms.
    """

    __tablename__ = "entity_communities"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Cluster identification
    cluster_id: Mapped[int] = mapped_column(Integer, nullable=False)
    window_type: Mapped[MetricWindowType] = mapped_column(
        ENUM(
            MetricWindowType,
            name="metric_window_type",
            create_type=False,
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
    )

    # Naming
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Community characteristics
    member_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    density: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    modularity_contribution: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Representative entities
    central_entity_ids: Mapped[Optional[List[UUID]]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)),
        nullable=True,
    )
    dominant_party: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dominant_entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Timestamp
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<EntityCommunity cluster={self.cluster_id} ({self.window_type.value})>"
