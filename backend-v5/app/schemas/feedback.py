"""Feedback and ML status Pydantic schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ============================================================
# Feedback Submission Schemas
# ============================================================

class ClassificationFeedback(BaseModel):
    """Feedback for category classification."""
    story_id: UUID
    correct_category: str = Field(
        ...,
        description="Correct category: political|economic|security|disaster|social",
    )
    system_category: Optional[str] = Field(
        None,
        description="What the system predicted (optional, will be looked up)",
    )


class PriorityFeedback(BaseModel):
    """Feedback for priority/severity."""
    story_id: UUID
    correct_priority: str = Field(
        ...,
        description="Correct priority: critical|high|medium|low",
    )
    system_priority: Optional[str] = Field(
        None,
        description="What the system predicted (optional, will be looked up)",
    )


class SourceFeedback(BaseModel):
    """Feedback for source reliability."""
    source_id: str
    is_reliable: bool
    story_id: Optional[UUID] = Field(
        None,
        description="Optional story that prompted this feedback",
    )
    reason: Optional[str] = None


class ClusteringFeedback(BaseModel):
    """Feedback for clustering quality."""
    cluster_id: UUID
    story_id: UUID
    should_be_in_cluster: bool = Field(
        ...,
        description="True if story belongs in cluster, False if wrongly clustered",
    )
    suggested_cluster_id: Optional[UUID] = Field(
        None,
        description="If story should be in a different cluster",
    )


class FeedbackCreate(BaseModel):
    """Generic feedback submission."""
    feedback_type: str = Field(
        ...,
        description="classification|priority|source|clustering",
    )
    classification: Optional[ClassificationFeedback] = None
    priority: Optional[PriorityFeedback] = None
    source: Optional[SourceFeedback] = None
    clustering: Optional[ClusteringFeedback] = None


class FeedbackResponse(BaseModel):
    """Response from feedback submission."""
    success: bool
    feedback_id: UUID
    feedback_type: str
    message: str


# ============================================================
# ML Status Schemas
# ============================================================

class ModelStatus(BaseModel):
    """Status of a single ML model."""
    model_type: str
    is_loaded: bool
    version: Optional[str] = None
    accuracy: Optional[float] = None
    last_trained: Optional[datetime] = None
    training_samples: Optional[int] = None


class MLStatusResponse(BaseModel):
    """Response for ML system status."""
    initialized: bool
    models: Dict[str, ModelStatus]
    device: str = "cpu"


# ============================================================
# Experience Buffer Schemas
# ============================================================

class ExperienceTypeCounts(BaseModel):
    """Counts by experience type."""
    CLASSIFICATION: int = 0
    PRIORITY: int = 0
    SOURCE: int = 0
    ANOMALY: int = 0
    TEMPORAL: int = 0
    CLUSTERING: int = 0


class ExperienceStatsResponse(BaseModel):
    """Response for experience buffer statistics."""
    total_records: int
    by_type: Dict[str, int]
    unused_by_type: Dict[str, int]
    recent_24h: int
    average_rewards: Dict[str, float]
    ready_for_training: Dict[str, bool]


class RecentExperienceItem(BaseModel):
    """Single experience record for display."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    experience_type: str
    story_id: Optional[UUID] = None
    system_action: Optional[str] = None
    human_action: Optional[str] = None
    reward: Optional[float] = None
    used_in_training: bool
    created_at: datetime


class RecentExperienceResponse(BaseModel):
    """Response listing recent experience records."""
    records: List[RecentExperienceItem]
    total: int


# ============================================================
# Training Schemas
# ============================================================

class TrainingRequest(BaseModel):
    """Request to trigger model training."""
    model_types: Optional[List[str]] = Field(
        None,
        description="Specific models to train, or None for all",
    )


class TrainingResultItem(BaseModel):
    """Result of training a single model."""
    model_type: str
    success: bool
    samples_used: int
    new_accuracy: Optional[float] = None
    previous_accuracy: Optional[float] = None
    new_metrics: Optional[Dict[str, Any]] = None
    previous_metrics: Optional[Dict[str, Any]] = None
    promoted: bool
    error: Optional[str] = None


class TrainingResponse(BaseModel):
    """Response from training run."""
    timestamp: datetime
    total_samples: int
    models_promoted: int
    results: Dict[str, TrainingResultItem]


# ============================================================
# Source Confidence Schemas
# ============================================================

class SourceConfidenceItem(BaseModel):
    """Confidence information for a source."""
    source_id: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    uncertainty: float
    credible_interval: tuple[float, float]
    sample_size: int


class SourceRankingResponse(BaseModel):
    """Response listing sources ranked by confidence."""
    sources: List[SourceConfidenceItem]
    total_sources: int
