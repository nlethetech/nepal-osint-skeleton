"""Connected analyst models for graph provenance, trade intelligence, and PWTT evidence."""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    String,
    Text,
    Float,
    Integer,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.analyst_enums import AnalystVerificationStatus, SourceClassification

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.case import Case
    from app.models.damage_assessment import DamageAssessment


class TradeDirection(str, Enum):
    """Trade flow direction for trade facts."""

    IMPORT = "import"
    EXPORT = "export"
    TOTAL = "total"


class DamageRunStatus(str, Enum):
    """Execution state for PWTT runs."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class HypothesisStatus(str, Enum):
    """Status for analyst hypotheses."""

    OPEN = "open"
    SUPPORTED = "supported"
    CONTRADICTED = "contradicted"
    INCONCLUSIVE = "inconclusive"


class HypothesisEvidenceRelation(str, Enum):
    """Evidence relation type to a hypothesis."""

    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    CONTEXT = "context"


class ProvenanceOwnerType(str, Enum):
    """Owner type for evidence references."""

    OBJECT = "object"
    LINK = "link"
    TRADE_ANOMALY = "trade_anomaly"
    DAMAGE_FINDING = "damage_finding"
    HYPOTHESIS = "hypothesis"


class _EnumMixin:
    @staticmethod
    def values(enum_cls):
        return [member.value for member in enum_cls]


class KBObject(Base, TimestampMixin):
    """Canonical object node for connected analyst graph."""

    __tablename__ = "kb_objects"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    object_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    canonical_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attributes: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verification_status: Mapped[AnalystVerificationStatus] = mapped_column(
        SAEnum(
            AnalystVerificationStatus,
            name="analyst_verification_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=AnalystVerificationStatus.CANDIDATE,
        index=True,
    )
    created_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    outgoing_links: Mapped[list["KBLink"]] = relationship(
        "KBLink",
        back_populates="source_object",
        cascade="all, delete-orphan",
        foreign_keys="KBLink.source_object_id",
    )
    incoming_links: Mapped[list["KBLink"]] = relationship(
        "KBLink",
        back_populates="target_object",
        cascade="all, delete-orphan",
        foreign_keys="KBLink.target_object_id",
    )


class KBLink(Base, TimestampMixin):
    """Typed edge between graph objects with provenance and confidence."""

    __tablename__ = "kb_links"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    source_object_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kb_objects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_object_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kb_objects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    predicate: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verification_status: Mapped[AnalystVerificationStatus] = mapped_column(
        SAEnum(
            AnalystVerificationStatus,
            name="analyst_verification_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=AnalystVerificationStatus.CANDIDATE,
        index=True,
    )
    link_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)
    first_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    source_object: Mapped[KBObject] = relationship(
        "KBObject",
        back_populates="outgoing_links",
        foreign_keys=[source_object_id],
    )
    target_object: Mapped[KBObject] = relationship(
        "KBObject",
        back_populates="incoming_links",
        foreign_keys=[target_object_id],
    )

    __table_args__ = (
        UniqueConstraint("source_object_id", "target_object_id", "predicate", name="uq_kb_links_pair_predicate"),
    )


class KBEvidenceRef(Base, TimestampMixin):
    """Provenance reference records for objects, links, anomalies, findings, and hypotheses."""

    __tablename__ = "kb_evidence_refs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    owner_type: Mapped[ProvenanceOwnerType] = mapped_column(
        SAEnum(
            ProvenanceOwnerType,
            name="provenance_owner_type",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        index=True,
    )
    owner_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    evidence_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    evidence_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    source_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source_classification: Mapped[SourceClassification] = mapped_column(
        SAEnum(
            SourceClassification,
            name="analyst_source_classification",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=SourceClassification.UNKNOWN,
        index=True,
    )

    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class TradeReport(Base, TimestampMixin):
    """Source workbook metadata for trade ingestion runs."""

    __tablename__ = "trade_reports"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    fiscal_year_bs: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    upto_month: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    month_ordinal: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    report_title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    coverage_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    coverage_start_ad: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    coverage_end_ad: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    source_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    facts: Mapped[list["TradeFact"]] = relationship(
        "TradeFact",
        back_populates="report",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("fiscal_year_bs", "month_ordinal", "file_path", name="uq_trade_report_file_window"),
        UniqueConstraint("source_hash", name="uq_trade_report_source_hash"),
    )


class TradeFact(Base, TimestampMixin):
    """Normalized trade fact from customs, commodity, and country sheets."""

    __tablename__ = "trade_facts"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("trade_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    table_name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    direction: Mapped[TradeDirection] = mapped_column(
        SAEnum(
            TradeDirection,
            name="trade_direction",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        index=True,
    )

    hs_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    commodity_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    partner_country: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    customs_office: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    unit: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    value_npr_thousands: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    revenue_npr_thousands: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cumulative_value_npr_thousands: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delta_value_npr_thousands: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    record_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    fact_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)

    report: Mapped[TradeReport] = relationship("TradeReport", back_populates="facts")
    anomalies: Mapped[list["TradeAnomaly"]] = relationship(
        "TradeAnomaly",
        back_populates="trade_fact",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("report_id", "table_name", "record_key", "direction", name="uq_trade_fact_report_record"),
    )


class TradeAnomaly(Base, TimestampMixin):
    """Anomaly signals derived from monthly trade deltas."""

    __tablename__ = "trade_anomalies"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    trade_fact_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("trade_facts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    dimension: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    dimension_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    fiscal_year_bs: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    month_ordinal: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    anomaly_score: Mapped[float] = mapped_column(Float, nullable=False)
    observed_value: Mapped[float] = mapped_column(Float, nullable=False)
    expected_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    baseline_mean: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    baseline_std: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    deviation_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")

    verification_status: Mapped[AnalystVerificationStatus] = mapped_column(
        SAEnum(
            AnalystVerificationStatus,
            name="analyst_verification_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=AnalystVerificationStatus.CANDIDATE,
        index=True,
    )
    rationale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    trade_fact: Mapped[Optional[TradeFact]] = relationship("TradeFact", back_populates="anomalies")

    __table_args__ = (
        Index("idx_trade_anomaly_dimension_window", "dimension", "dimension_key", "fiscal_year_bs", "month_ordinal"),
    )


class DamageRun(Base, TimestampMixin):
    """Persisted PWTT run metadata for reproducible evidence workflows."""

    __tablename__ = "damage_runs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    assessment_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_assessments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    case_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    algorithm_name: Mapped[str] = mapped_column(String(120), nullable=False)
    algorithm_version: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[DamageRunStatus] = mapped_column(
        SAEnum(
            DamageRunStatus,
            name="damage_run_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=DamageRunStatus.QUEUED,
        index=True,
    )

    aoi_geojson: Mapped[dict] = mapped_column(JSONB, nullable=False)
    event_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    run_params: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    initiated_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    summary: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    verification_status: Mapped[AnalystVerificationStatus] = mapped_column(
        SAEnum(
            AnalystVerificationStatus,
            name="analyst_verification_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=AnalystVerificationStatus.CANDIDATE,
    )

    artifacts: Mapped[list["DamageArtifact"]] = relationship(
        "DamageArtifact",
        back_populates="run",
        cascade="all, delete-orphan",
    )
    findings: Mapped[list["DamageFinding"]] = relationship(
        "DamageFinding",
        back_populates="run",
        cascade="all, delete-orphan",
    )


class DamageArtifact(Base, TimestampMixin):
    """Artifact metadata produced by PWTT runs (three-panel, tiles, overlays)."""

    __tablename__ = "damage_artifacts"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    artifact_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    checksum_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    artifact_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)
    source_classification: Mapped[SourceClassification] = mapped_column(
        SAEnum(
            SourceClassification,
            name="analyst_source_classification",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=SourceClassification.UNKNOWN,
        index=True,
    )

    run: Mapped[DamageRun] = relationship("DamageRun", back_populates="artifacts")


class DamageFinding(Base, TimestampMixin):
    """Structured finding from a PWTT run for cross-domain linking."""

    __tablename__ = "damage_findings"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("damage_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    finding_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    geometry: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    metrics: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    district: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    customs_office: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    route_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)

    verification_status: Mapped[AnalystVerificationStatus] = mapped_column(
        SAEnum(
            AnalystVerificationStatus,
            name="analyst_verification_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=AnalystVerificationStatus.CANDIDATE,
        index=True,
    )

    run: Mapped[DamageRun] = relationship("DamageRun", back_populates="findings")


class CaseHypothesis(Base, TimestampMixin):
    """Hypothesis record attached to investigation cases."""

    __tablename__ = "case_hypotheses"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[HypothesisStatus] = mapped_column(
        SAEnum(
            HypothesisStatus,
            name="hypothesis_status",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=HypothesisStatus.OPEN,
        index=True,
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    rationale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    updated_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    evidence_links: Mapped[list["HypothesisEvidenceLink"]] = relationship(
        "HypothesisEvidenceLink",
        back_populates="hypothesis",
        cascade="all, delete-orphan",
    )


class HypothesisEvidenceLink(Base, TimestampMixin):
    """Associates provenance references with hypotheses."""

    __tablename__ = "hypothesis_evidence_links"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    hypothesis_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("case_hypotheses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    evidence_ref_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kb_evidence_refs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relation_type: Mapped[HypothesisEvidenceRelation] = mapped_column(
        SAEnum(
            HypothesisEvidenceRelation,
            name="hypothesis_evidence_relation",
            create_type=False,
            values_callable=_EnumMixin.values,
        ),
        nullable=False,
        default=HypothesisEvidenceRelation.CONTEXT,
        index=True,
    )
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    hypothesis: Mapped[CaseHypothesis] = relationship("CaseHypothesis", back_populates="evidence_links")
    evidence_ref: Mapped[KBEvidenceRef] = relationship("KBEvidenceRef")

    __table_args__ = (
        UniqueConstraint("hypothesis_id", "evidence_ref_id", name="uq_hypothesis_evidence_ref"),
    )


class AnalystAOI(Base, TimestampMixin):
    """Saved analyst area-of-interest for repeat PWTT and spatial analysis operations."""

    __tablename__ = "analyst_aois"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    center_lat: Mapped[float] = mapped_column(Float, nullable=False)
    center_lng: Mapped[float] = mapped_column(Float, nullable=False)
    radius_km: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    geometry: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    tags: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)


class AnalystReport(Base, TimestampMixin):
    """Persisted autonomous analyst paper output."""

    __tablename__ = "analyst_reports"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    time_window_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=168)
    aoi_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("analyst_aois.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    generated_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    generated_with_llm: Mapped[bool] = mapped_column(default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="completed", index=True)
    markdown: Mapped[str] = mapped_column(Text, nullable=False)
    metrics_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    citations: Mapped[list["AnalystReportCitation"]] = relationship(
        "AnalystReportCitation",
        back_populates="report",
        cascade="all, delete-orphan",
    )


class AnalystReportCitation(Base, TimestampMixin):
    """Citation row that maps report claims to provenance references."""

    __tablename__ = "analyst_report_citations"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("analyst_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    evidence_ref_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kb_evidence_refs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    claim_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    citation_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    report: Mapped[AnalystReport] = relationship("AnalystReport", back_populates="citations")
    evidence_ref: Mapped[KBEvidenceRef] = relationship("KBEvidenceRef")

    __table_args__ = (
        UniqueConstraint("report_id", "claim_hash", "citation_order", name="uq_report_claim_citation_order"),
    )
