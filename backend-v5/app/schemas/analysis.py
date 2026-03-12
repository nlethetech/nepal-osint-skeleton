"""Analysis and ML-related Pydantic schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ============================================================
# Threat Assessment Schemas
# ============================================================

class ThreatAssessment(BaseModel):
    """Threat assessment for aggregated news."""
    level: str = Field(..., description="CRITICAL|ELEVATED|GUARDED|LOW")
    trajectory: str = Field(..., description="ESCALATING|STABLE|DE-ESCALATING")
    rationale: Optional[str] = None


class EntityExtraction(BaseModel):
    """Extracted entities from analysis."""
    people: List[str] = []
    organizations: List[str] = []
    locations: List[str] = []


class CategoryConfidence(BaseModel):
    """Category classification confidence."""
    category: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class ClusterAnalysis(BaseModel):
    """Full analysis of an aggregated news cluster."""
    bluf: str = Field(..., description="Bottom Line Up Front summary")
    key_judgment: str = Field(..., description="Analytical assessment with confidence")
    threat_assessment: ThreatAssessment
    sources_summary: List[str] = Field(default_factory=list)
    recommended_actions: List[str] = Field(default_factory=list)
    entities: Optional[EntityExtraction] = None
    category_confidence: Optional[CategoryConfidence] = None


# ============================================================
# API Response Schemas
# ============================================================

class ClusterSourceItem(BaseModel):
    """Source information in cluster analysis response."""
    source_id: str
    source_name: Optional[str] = None
    title: str
    url: str
    published_at: Optional[datetime] = None


class ClusterAnalysisResponse(BaseModel):
    """Response for GET /clusters/{id}/analysis."""
    model_config = ConfigDict(from_attributes=True)

    cluster_id: UUID
    headline: str
    category: Optional[str] = None
    severity: Optional[str] = None
    story_count: int
    source_count: int

    # Analysis fields
    bluf: Optional[str] = None
    analysis: Optional[ClusterAnalysis] = None
    analyzed_at: Optional[datetime] = None
    analysis_model: Optional[str] = None

    # Source details
    sources: List[ClusterSourceItem] = []

    @classmethod
    def from_cluster(cls, cluster) -> "ClusterAnalysisResponse":
        """Create from StoryCluster model."""
        sources = [
            ClusterSourceItem(
                source_id=s.source_id,
                source_name=s.source_name,
                title=s.title,
                url=s.url,
                published_at=s.published_at,
            )
            for s in cluster.stories
        ]

        # Parse analysis JSON if present
        analysis = None
        if cluster.analysis:
            try:
                analysis = ClusterAnalysis(**cluster.analysis)
            except Exception:
                pass

        return cls(
            cluster_id=cluster.id,
            headline=cluster.headline,
            category=cluster.category,
            severity=cluster.severity,
            story_count=cluster.story_count,
            source_count=cluster.source_count,
            bluf=cluster.bluf,
            analysis=analysis,
            analyzed_at=cluster.analyzed_at,
            analysis_model=cluster.analysis_model,
            sources=sources,
        )


# ============================================================
# Batch Analysis Schemas
# ============================================================

class BatchAnalysisRequest(BaseModel):
    """Request to submit clusters for batch analysis."""
    cluster_ids: Optional[List[UUID]] = None
    hours: int = Field(default=72, description="Time window for unanalyzed clusters")
    limit: int = Field(default=50, description="Maximum clusters to analyze")


class BatchAnalysisResponse(BaseModel):
    """Response from batch analysis submission."""
    batch_id: str
    anthropic_batch_id: str
    clusters_queued: int
    estimated_completion: Optional[str] = None


class BatchStatusResponse(BaseModel):
    """Response for batch status check."""
    batch_id: str
    status: str = Field(..., description="pending|processing|completed|failed")
    progress_percent: float
    total_clusters: int
    completed_clusters: int
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


# ============================================================
# Embedding Schemas
# ============================================================

class EmbeddingStatsResponse(BaseModel):
    """Response for embedding statistics."""
    total_embeddings: int
    recent_24h: int
    model: str
    embedding_dim: int


class GenerateEmbeddingsRequest(BaseModel):
    """Request to generate embeddings."""
    hours: int = Field(default=72, description="Process stories from last N hours")
    limit: int = Field(default=500, description="Maximum stories to process")
    nepal_only: bool = Field(default=True, description="Only process Nepal-relevant stories")


class GenerateEmbeddingsResponse(BaseModel):
    """Response from embedding generation."""
    processed: int
    created: int
    skipped: int
    failed: int


# ============================================================
# Similarity Search Schemas
# ============================================================

class SimilarStoryItem(BaseModel):
    """Item in similarity search results."""
    story_id: UUID
    title: str
    source_name: Optional[str] = None
    similarity: float
    published_at: Optional[datetime] = None


class SimilaritySearchRequest(BaseModel):
    """Request for similarity search."""
    query: str = Field(..., description="Text to find similar stories for")
    hours: int = Field(default=24, description="Time window")
    top_k: int = Field(default=20, description="Maximum results")
    min_similarity: float = Field(default=0.5, ge=0.0, le=1.0)


class SimilaritySearchResponse(BaseModel):
    """Response from similarity search."""
    query: str
    results: List[SimilarStoryItem]
    total_found: int
