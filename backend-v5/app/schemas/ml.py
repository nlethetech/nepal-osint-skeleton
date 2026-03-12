"""Pydantic schemas for ML training and management endpoints."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Model Info ──

class ModelInfoResponse(BaseModel):
    """Information about a single ML model."""
    name: str
    status: str  # ready, training, failed, outdated
    version: str = "v0.0.0"
    accuracy: Optional[float] = None
    last_trained_at: Optional[datetime] = None
    training_duration_sec: Optional[int] = None
    training_samples: Optional[int] = None
    is_deployed: bool = False


class ModelListResponse(BaseModel):
    """List of all ML models."""
    models: list[ModelInfoResponse]


# ── Training ──

class TrainRequest(BaseModel):
    """Request to start model training."""
    parameters: dict = Field(default_factory=dict)
    reason: str = Field(default="Manual training", max_length=500)


class TrainResponse(BaseModel):
    """Response after starting training."""
    training_run_id: str
    status: str = "started"
    estimated_duration_sec: Optional[int] = None


class TrainingProgressResponse(BaseModel):
    """Real-time training progress."""
    run_id: str
    model: str
    status: str
    progress_pct: int = 0
    current_epoch: int = 0
    total_epochs: int = 0
    current_loss: Optional[float] = None
    best_loss: Optional[float] = None
    elapsed_sec: Optional[int] = None
    estimated_remaining_sec: Optional[int] = None


class TrainingHistoryResponse(BaseModel):
    """List of past training runs."""
    items: list[TrainingProgressResponse]
    total: int = 0


# ── Model Promote/Rollback ──

class PromoteRequest(BaseModel):
    """Promote a trained model to production."""
    version: str
    notes: str = ""


class RollbackModelRequest(BaseModel):
    """Rollback model to previous version."""
    to_version: str
    reason: str


class ModelActionResponse(BaseModel):
    """Generic response for model actions."""
    model: str
    action: str
    status: str
    message: str


# ── Embeddings ──

class EmbeddingStatsResponse(BaseModel):
    """Embedding statistics."""
    total: int = 0
    pending: int = 0
    failed: int = 0
    storage_mb: float = 0
    avg_dimension: int = 768
    model: str = "e5-large"


class RegenerateRequest(BaseModel):
    """Request to regenerate embeddings."""
    scope: str = "failed"  # all, failed, date_range
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    batch_size: int = 100


class RegenerateResponse(BaseModel):
    """Response after starting embedding regeneration."""
    job_id: str
    stories_queued: int
    estimated_duration_sec: Optional[int] = None


# ── Clustering ──

class ClusteringConfigResponse(BaseModel):
    """Current clustering configuration."""
    algorithm: str = "hdbscan"
    min_cluster_size: int = 5
    similarity_threshold: float = 0.7
    max_cluster_size: int = 100
    temporal_weight: float = 0.3
    geographic_weight: float = 0.2


class ClusteringConfigUpdateRequest(BaseModel):
    """Update clustering configuration."""
    algorithm: Optional[str] = None
    min_cluster_size: Optional[int] = Field(default=None, ge=2, le=50)
    similarity_threshold: Optional[float] = Field(default=None, ge=0.5, le=0.95)
    max_cluster_size: Optional[int] = Field(default=None, ge=10, le=500)
    temporal_weight: Optional[float] = Field(default=None, ge=0, le=1)
    geographic_weight: Optional[float] = Field(default=None, ge=0, le=1)


class ClusteringStatsResponse(BaseModel):
    """Clustering statistics."""
    total_clusters: int = 0
    avg_cluster_size: float = 0
    singleton_clusters: int = 0
    largest_cluster: int = 0
    last_run_at: Optional[datetime] = None
    merge_proposals_pending: int = 0


class RetrainClusteringRequest(BaseModel):
    """Request to retrain clustering."""
    reason: str = "Manual retrain"


class RetrainClusteringResponse(BaseModel):
    """Response after starting clustering retrain."""
    job_id: str
    status: str = "started"


# ── Experience Buffer ──

class ExperienceBufferStatsResponse(BaseModel):
    """Experience buffer statistics."""
    total_experiences: int = 0
    capacity: int = 100000
    utilization_pct: float = 0
    by_model: dict = {}
    by_feedback: dict = {}
    oldest_entry: Optional[datetime] = None
    newest_entry: Optional[datetime] = None


class FlushBufferRequest(BaseModel):
    """Request to flush experience buffer."""
    older_than_days: int = Field(default=90, ge=1)
    model: Optional[str] = None


class FlushBufferResponse(BaseModel):
    """Response after flushing buffer."""
    flushed: int = 0
    remaining: int = 0
