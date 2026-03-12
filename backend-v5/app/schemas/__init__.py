"""Pydantic schemas for request/response validation."""
from app.schemas.story import StoryResponse, StoryListResponse, StoryCreate
from app.schemas.analytics import (
    AnalyticsSummaryResponse,
    ConsolidatedStoryResponse,
    ThreatMatrixResponse,
    AggregatedNewsResponse,
)
from app.schemas.analysis import (
    ClusterAnalysisResponse,
    BatchAnalysisRequest,
    BatchAnalysisResponse,
    BatchStatusResponse,
    EmbeddingStatsResponse,
    GenerateEmbeddingsRequest,
    GenerateEmbeddingsResponse,
)
from app.schemas.feedback import (
    FeedbackCreate,
    FeedbackResponse,
    MLStatusResponse,
    ExperienceStatsResponse,
    TrainingResponse,
)
from app.schemas.disaster import (
    DisasterIncidentResponse,
    DisasterIncidentListResponse,
    DisasterAlertResponse,
    DisasterAlertListResponse,
    DisasterSummaryResponse,
    SignificantIncidentResponse,
    IngestionStatsResponse,
    MapEventsResponse,
)
from app.schemas.kpi import (
    KPISnapshot,
    ActiveAlertsKPI,
    EventsKPI,
    ThreatLevelKPI,
    DistrictsKPI,
    SourceCoverageKPI,
    TrendVelocityKPI,
    CasualtiesKPI,
    EntityMention,
    AlertDetail,
    HourlyTrend,
)
from app.schemas.weather import (
    WeatherForecastResponse,
    WeatherSummaryResponse,
    WeatherCondition,
    WeatherHistoryResponse,
    BilingualText,
)
from app.schemas.announcement import (
    AnnouncementResponse,
    AnnouncementListResponse,
    AnnouncementSummary,
    IngestionStats as AnnouncementIngestionStats,
    SourceInfo,
    AttachmentSchema,
)

__all__ = [
    # Story
    "StoryResponse",
    "StoryListResponse",
    "StoryCreate",
    # Analytics
    "AnalyticsSummaryResponse",
    "ConsolidatedStoryResponse",
    "ThreatMatrixResponse",
    "AggregatedNewsResponse",
    # Analysis
    "ClusterAnalysisResponse",
    "BatchAnalysisRequest",
    "BatchAnalysisResponse",
    "BatchStatusResponse",
    "EmbeddingStatsResponse",
    "GenerateEmbeddingsRequest",
    "GenerateEmbeddingsResponse",
    # Feedback/ML
    "FeedbackCreate",
    "FeedbackResponse",
    "MLStatusResponse",
    "ExperienceStatsResponse",
    "TrainingResponse",
    # Disasters (Phase 4)
    "DisasterIncidentResponse",
    "DisasterIncidentListResponse",
    "DisasterAlertResponse",
    "DisasterAlertListResponse",
    "DisasterSummaryResponse",
    "SignificantIncidentResponse",
    "IngestionStatsResponse",
    "MapEventsResponse",
    # KPI (Palantir-grade metrics)
    "KPISnapshot",
    "ActiveAlertsKPI",
    "EventsKPI",
    "ThreatLevelKPI",
    "DistrictsKPI",
    "SourceCoverageKPI",
    "TrendVelocityKPI",
    "CasualtiesKPI",
    "EntityMention",
    "AlertDetail",
    "HourlyTrend",
    # Weather (DHM Nepal)
    "WeatherForecastResponse",
    "WeatherSummaryResponse",
    "WeatherCondition",
    "WeatherHistoryResponse",
    "BilingualText",
    # Government Announcements
    "AnnouncementResponse",
    "AnnouncementListResponse",
    "AnnouncementSummary",
    "AnnouncementIngestionStats",
    "SourceInfo",
    "AttachmentSchema",
]
