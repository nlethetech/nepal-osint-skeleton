"""Database models."""
from app.models.base import Base, TimestampMixin
from app.models.story import Story
from app.models.source import Source
from app.models.user import User, UserRole
from app.models.story_cluster import StoryCluster
from app.models.cluster_publication import ClusterPublication
from app.models.cluster_peer_review import ClusterPeerReview, PeerReviewVerdict
from app.models.story_embedding import StoryEmbedding
from app.models.story_feature import StoryFeature
from app.models.experience_record import ExperienceRecord, ExperienceType
from app.models.analysis_batch import AnalysisBatch, BatchStatus
from app.models.rl_model_version import RLModelVersion, ModelType
from app.models.disaster import (
    DisasterIncident,
    DisasterAlert,
    HazardType,
    AlertType,
    DisasterSeverity,
    BIPAD_HAZARD_MAP,
)
from app.models.river import RiverStation, RiverReading, RiverStatus, RiverTrend
from app.models.weather import WeatherForecast
from app.models.announcement import GovtAnnouncement, GOVT_SOURCES
from app.models.procurement import GovtContract
from app.models.procurement_company_link import ProcurementCompanyLink
from app.models.company import (
    CompanyRegistration,
    CompanyDirector,
    IRDEnrichment,
    AnalystPhoneClusterGroup,
)
from app.models.market_data import MarketData, MarketDataType, MARKET_SOURCES
from app.models.election import (
    Election,
    Constituency,
    Candidate,
    UserConstituencyWatchlist,
    ElectionType,
    ElectionStatus,
    ConstituencyStatus,
    AlertLevel,
)

# Collaboration models
from app.models.team import Team, TeamMembership, TeamRole
from app.models.case import (
    Case,
    CaseEvidence,
    CaseComment,
    CaseStatus,
    CasePriority,
    CaseVisibility,
    EvidenceType,
)
from app.models.verification import (
    VerificationRequest,
    VerificationVote,
    VerificationStatus,
    VerifiableType,
    VoteChoice,
)
from app.models.watchlist import (
    Watchlist,
    WatchlistItem,
    WatchlistMatch,
    WatchlistScope,
    WatchableType,
    AlertFrequency,
)
from app.models.analyst_metrics import (
    AnalystMetrics,
    AnalystActivity,
    ActivityType,
    BadgeType,
)
from app.models.annotation import (
    Annotation,
    AnalystNote,
    SourceReliability,
    AnnotationType,
    AnnotatableType,
    NoteVisibility,
)

# Political entity models
from app.models.political_entity import (
    PoliticalEntity,
    EntityType,
    EntityTrend,
)
from app.models.story_entity_link import StoryEntityLink
from app.models.curfew_alert import CurfewAlert
from app.models.tweet import Tweet, TwitterAccount, TwitterQuery
from app.models.tweet_cluster import TweetCluster

# Entity relationship models (Network analysis)
from app.models.entity_relationship import (
    EntityRelationship,
    EntityNetworkMetrics,
    EntityCommunity,
    RelationshipType,
    MetricWindowType,
)

# Satellite analysis models
from app.models.satellite_analysis import (
    SatelliteAnalysis,
    ChangeDetectionSubscription,
    ChangeDetectionAlert,
    AnalysisType,
    AnalysisStatus,
    DetectionType,
    AlertSeverity,
)

# Damage assessment models
from app.models.damage_assessment import (
    DamageAssessment,
    DamageZone,
    DamageEvidence,
    AssessmentNote,
    DamageType,
    SeverityLevel,
    AssessmentStatus,
    EvidenceSourceType,
    VerificationStatus as EvidenceVerificationStatus,
)

# Parliament models (MP Performance Index)
from app.models.parliament import (
    MPPerformance,
    ParliamentBill,
    BillSponsor,
    ParliamentCommittee,
    CommitteeMembership,
    ParliamentQuestion,
    SessionAttendance,
    VerbatimSession,
    ParliamentarySpeech,
    Chamber,
    ElectionTypeMP,
    BillType,
    BillStatus,
    CommitteeType,
    CommitteeRole,
    QuestionType,
    PerformanceTier,
)

# Ministerial position models (Executive branch tracking)
from app.models.ministerial_position import (
    MinisterialPosition,
    PositionType,
)

# Dev workstation models
from app.models.admin_audit import AdminAuditLog, AuditAction
from app.models.candidate_correction import CandidateCorrection, CorrectionStatus
from app.models.graph_correction import (
    GraphCorrection,
    GraphCorrectionStatus,
    GraphCorrectionAction,
)
from app.models.candidate_profile_override import CandidateProfileOverride
from app.models.notification import UserNotification, NotificationType
from app.models.training_run import TrainingRun, TrainingStatus
from app.models.election_sync_run import ElectionSyncRun
from app.models.analyst_enums import AnalystVerificationStatus, SourceClassification
from app.models.connected_analyst import (
    KBObject,
    KBLink,
    KBEvidenceRef,
    TradeReport,
    TradeFact,
    TradeAnomaly,
    DamageRun,
    DamageArtifact,
    DamageFinding,
    CaseHypothesis,
    HypothesisEvidenceLink,
    TradeDirection,
    DamageRunStatus,
    HypothesisStatus,
    HypothesisEvidenceRelation,
    ProvenanceOwnerType,
    AnalystAOI,
    AnalystReport,
    AnalystReportCitation,
)

# Unified graph models (NARADA graph foundation)
# Situation briefs (Narada Analyst Agent)
from app.models.situation_brief import (
    SituationBrief,
    ProvinceSitrep,
    FakeNewsFlag,
)

# Province Anomaly Agent
from app.models.province_anomaly import (
    ProvinceAnomalyRun,
    ProvinceAnomaly,
)

# Fact-check system (user-requested verification)
from app.models.fact_check import FactCheckRequest, FactCheckResult
from app.models.fact_check_review import FactCheckReview
from app.models.story_narrative import StoryNarrative, StoryNarrativeCluster
from app.models.automation_control import AutomationControl

# Email OTP (signup verification)
from app.models.email_otp import EmailOTP

# Tactical enrichments (tactical map agent)
from app.models.tactical_enrichment import TacticalEnrichment

# Live election results (ECN result.election.gov.np)
from app.models.election_result import ElectionCandidate, ElectionPartySummary, ElectionScrapeLog

from app.models.graph import (
    District,
    GraphNode,
    GraphEdge,
    GraphIngestionRun,
    GraphIngestionRunStep,
    GraphNodeMetrics,
    EntityResolution,
    NodeType,
    EdgePredicate,
    VerificationStatus as GraphVerificationStatus,
    ResolutionMethod,
    MetricWindow,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "Story",
    "Source",
    "User",
    "UserRole",
    "StoryCluster",
    "ClusterPublication",
    "ClusterPeerReview",
    "PeerReviewVerdict",
    "StoryEmbedding",
    "StoryFeature",
    "ExperienceRecord",
    "ExperienceType",
    "AnalysisBatch",
    "BatchStatus",
    "RLModelVersion",
    "ModelType",
    # Disaster models
    "DisasterIncident",
    "DisasterAlert",
    "HazardType",
    "AlertType",
    "DisasterSeverity",
    "BIPAD_HAZARD_MAP",
    # River models
    "RiverStation",
    "RiverReading",
    "RiverStatus",
    "RiverTrend",
    # Weather models
    "WeatherForecast",
    # Government announcement models
    "GovtAnnouncement",
    "GOVT_SOURCES",
    # Government procurement models
    "GovtContract",
    "ProcurementCompanyLink",
    # Company registration models
    "CompanyRegistration",
    "CompanyDirector",
    "IRDEnrichment",
    "AnalystPhoneClusterGroup",
    # Market data models
    "MarketData",
    "MarketDataType",
    "MARKET_SOURCES",
    # Election models
    "Election",
    "Constituency",
    "Candidate",
    "UserConstituencyWatchlist",
    "ElectionType",
    "ElectionStatus",
    "ConstituencyStatus",
    "AlertLevel",
    # Team models
    "Team",
    "TeamMembership",
    "TeamRole",
    # Case models
    "Case",
    "CaseEvidence",
    "CaseComment",
    "CaseStatus",
    "CasePriority",
    "CaseVisibility",
    "EvidenceType",
    # Verification models
    "VerificationRequest",
    "VerificationVote",
    "VerificationStatus",
    "VerifiableType",
    "VoteChoice",
    # Watchlist models
    "Watchlist",
    "WatchlistItem",
    "WatchlistMatch",
    "WatchlistScope",
    "WatchableType",
    "AlertFrequency",
    # Analyst metrics models
    "AnalystMetrics",
    "AnalystActivity",
    "ActivityType",
    "BadgeType",
    # Annotation models
    "Annotation",
    "AnalystNote",
    "SourceReliability",
    "AnnotationType",
    "AnnotatableType",
    "NoteVisibility",
    # Political entity models
    "PoliticalEntity",
    "EntityType",
    "EntityTrend",
    "StoryEntityLink",
    "CurfewAlert",
    "Tweet",
    "TwitterAccount",
    "TwitterQuery",
    "TweetCluster",
    # Entity relationship models (Network analysis)
    "EntityRelationship",
    "EntityNetworkMetrics",
    "EntityCommunity",
    "RelationshipType",
    "MetricWindowType",
    # Satellite analysis models
    "SatelliteAnalysis",
    "ChangeDetectionSubscription",
    "ChangeDetectionAlert",
    "AnalysisType",
    "AnalysisStatus",
    "DetectionType",
    "AlertSeverity",
    # Damage assessment models
    "DamageAssessment",
    "DamageZone",
    "DamageEvidence",
    "AssessmentNote",
    "DamageType",
    "SeverityLevel",
    "AssessmentStatus",
    "EvidenceSourceType",
    "EvidenceVerificationStatus",
    # Parliament models (MP Performance Index)
    "MPPerformance",
    "ParliamentBill",
    "BillSponsor",
    "ParliamentCommittee",
    "CommitteeMembership",
    "ParliamentQuestion",
    "SessionAttendance",
    "Chamber",
    "ElectionTypeMP",
    "BillType",
    "BillStatus",
    "CommitteeType",
    "CommitteeRole",
    "QuestionType",
    "PerformanceTier",
    "VerbatimSession",
    "ParliamentarySpeech",
    # Ministerial position models (Executive branch tracking)
    "MinisterialPosition",
    "PositionType",
    # Dev workstation models
    "AdminAuditLog",
    "AuditAction",
    "CandidateCorrection",
    "CorrectionStatus",
    "GraphCorrection",
    "GraphCorrectionStatus",
    "GraphCorrectionAction",
    "CandidateProfileOverride",
    "UserNotification",
    "NotificationType",
    "TrainingRun",
    "TrainingStatus",
    "ElectionSyncRun",
    # Connected analyst models
    "AnalystVerificationStatus",
    "SourceClassification",
    "KBObject",
    "KBLink",
    "KBEvidenceRef",
    "TradeReport",
    "TradeFact",
    "TradeAnomaly",
    "DamageRun",
    "DamageArtifact",
    "DamageFinding",
    "CaseHypothesis",
    "HypothesisEvidenceLink",
    "TradeDirection",
    "DamageRunStatus",
    "HypothesisStatus",
    "HypothesisEvidenceRelation",
    "ProvenanceOwnerType",
    "AnalystAOI",
    "AnalystReport",
    "AnalystReportCitation",
    # Situation briefs (Narada Analyst Agent)
    "SituationBrief",
    "ProvinceSitrep",
    "FakeNewsFlag",
    # Province Anomaly Agent
    "ProvinceAnomalyRun",
    "ProvinceAnomaly",
    # Unified graph models (NARADA graph foundation)
    "District",
    "GraphNode",
    "GraphEdge",
    "GraphIngestionRun",
    "GraphIngestionRunStep",
    "GraphNodeMetrics",
    "EntityResolution",
    "NodeType",
    "EdgePredicate",
    "GraphVerificationStatus",
    "ResolutionMethod",
    "MetricWindow",
    # Fact-check system
    "FactCheckRequest",
    "FactCheckResult",
    "FactCheckReview",
    "StoryNarrative",
    "StoryNarrativeCluster",
    "AutomationControl",
    # Email OTP
    "EmailOTP",
    # Tactical enrichments
    "TacticalEnrichment",
    # Live election results
    "ElectionCandidate",
    "ElectionPartySummary",
    "ElectionScrapeLog",
]
