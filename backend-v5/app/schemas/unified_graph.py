"""Pydantic schemas for Unified Graph API endpoints."""
from datetime import datetime
from typing import Optional, Dict, List, Any
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# Core Graph Element Schemas
# ============================================================

class GraphNodeResponse(BaseModel):
    """Full graph node detail from the database."""
    id: UUID
    node_type: str
    canonical_key: str
    title: str
    title_ne: Optional[str] = None
    subtitle: Optional[str] = None
    district: Optional[str] = None
    province: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0
    is_canonical: bool = True
    source_table: str


class GraphEdgeResponse(BaseModel):
    """Full graph edge detail from the database."""
    id: UUID
    source_node_id: UUID
    target_node_id: UUID
    predicate: str
    weight: float = 1.0
    confidence: float = 1.0
    is_current: bool = True
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None
    properties: Dict[str, Any] = Field(default_factory=dict)


# ============================================================
# Cytoscape.js Compatible Formats
# ============================================================

class CytoscapeNode(BaseModel):
    """Cytoscape.js compatible node format.

    data dict contains: id, label, node_type, district, province,
    latitude, longitude, confidence, member_count, and all
    type-specific properties from the graph_node.properties JSONB.
    """
    data: Dict[str, Any]


class CytoscapeEdge(BaseModel):
    """Cytoscape.js compatible edge format.

    data dict contains: id, source, target, predicate, weight,
    confidence, is_current, valid_from, valid_to, and all
    edge-specific properties from graph_edges.properties JSONB.
    """
    data: Dict[str, Any]


# ============================================================
# API Response Schemas
# ============================================================

class GraphOverviewResponse(BaseModel):
    """Response for GET /unified-graph/overview.

    Returns all 77 district + 7 province nodes with inter-district
    edges. Includes total graph counts for status bar display.
    """
    nodes: List[CytoscapeNode]
    edges: List[CytoscapeEdge]
    rendered_nodes: int = 0
    rendered_edges: int = 0
    total_graph_nodes: int
    total_graph_edges: int


class GraphExpandResponse(BaseModel):
    """Response for GET /unified-graph/expand/{node_id}.

    Returns direct neighbors of a node with pagination metadata.
    """
    nodes: List[CytoscapeNode]
    edges: List[CytoscapeEdge]
    total_neighbors: int
    has_more: bool
    offset: int = 0
    limit: int = 50


class GraphNeighborhoodResponse(BaseModel):
    """Response for GET /unified-graph/neighborhood/{node_id}.

    Returns all nodes and edges within `depth` hops of a node.
    """
    nodes: List[CytoscapeNode]
    edges: List[CytoscapeEdge]
    depth_reached: int


class GraphPathResponse(BaseModel):
    """Response for GET /unified-graph/path.

    Returns the shortest path between two nodes as ordered UUID lists.
    ``path`` contains node IDs in traversal order.
    ``edges`` contains edge IDs along the path.
    """
    found: bool
    path: List[str] = Field(default_factory=list)
    edges: List[str] = Field(default_factory=list)
    length: int = 0


class GraphSearchResponse(BaseModel):
    """Response for GET /unified-graph/search.

    Returns matching nodes from full-text search with total count.
    """
    nodes: List[CytoscapeNode]
    total: int


class GraphStatsResponse(BaseModel):
    """Response for GET /unified-graph/stats.

    Aggregated counts for dashboard / status bar display.
    """
    total_nodes: int
    total_edges: int
    by_type: Dict[str, int] = Field(default_factory=dict)
    by_predicate: Dict[str, int] = Field(default_factory=dict)
    by_district: Dict[str, int] = Field(default_factory=dict)


class GraphHealthDomainCoverage(BaseModel):
    source_table: str
    total_nodes: int
    connected_nodes: int
    coverage_ratio: float


class GraphHealthResponse(BaseModel):
    status: str
    total_nodes: int
    total_edges: int
    connected_node_ratio: float
    largest_component_ratio: float
    per_domain_coverage: List[GraphHealthDomainCoverage] = Field(default_factory=list)
    thresholds_breached: List[str] = Field(default_factory=list)


class GraphTimeseriesBucket(BaseModel):
    bucket_start: str
    total_edges: int
    by_predicate: Dict[str, int] = Field(default_factory=dict)
    by_domain: Dict[str, int] = Field(default_factory=dict)


class GraphTimeseriesResponse(BaseModel):
    window: str
    bucket: str
    from_ts: Optional[str] = None
    to_ts: Optional[str] = None
    series: List[GraphTimeseriesBucket] = Field(default_factory=list)


class NodeDetailResponse(BaseModel):
    """Response for GET /unified-graph/node/{node_id}.

    Full detail for a single node as a flat dict including its edges,
    metrics, and resolution history.
    """
    id: str
    node_type: str
    type: Optional[str] = None
    canonical_key: Optional[str] = None
    title: str
    title_ne: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    subtype: Optional[str] = None
    district: Optional[str] = None
    province: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    source_table: Optional[str] = None
    source_id: Optional[str] = None
    confidence: float = 1.0
    source_count: int = 1
    is_canonical: bool = True
    canonical_node_id: Optional[str] = None
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    created_at: Optional[str] = None
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    total_outgoing: int = 0
    total_incoming: int = 0
    temporal_profile: Dict[str, Any] = Field(default_factory=dict)
    metrics: List[Dict[str, Any]] = Field(default_factory=list)
    resolutions: List[Dict[str, Any]] = Field(default_factory=list)


class DistrictResponse(BaseModel):
    """District reference data for filter dropdowns."""
    id: UUID
    name_en: str
    name_ne: Optional[str] = None
    province_id: int
    province_name: str
    graph_node_id: Optional[UUID] = None
    node_count: int = 0
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class DistrictListResponse(BaseModel):
    """Response for GET /unified-graph/districts."""
    districts: List[DistrictResponse]
    total: int


class ResolveNodeRequest(BaseModel):
    """Request for POST /unified-graph/resolve-node."""
    source_table: str
    source_id: str
    canonical_key: Optional[str] = None


class ResolveNodeResponse(BaseModel):
    """Response for POST /unified-graph/resolve-node."""
    found: bool
    node: Optional[CytoscapeNode] = None


class UnifiedTimelineCenter(BaseModel):
    id: str
    title: str
    object_type: str


class UnifiedTimelineEvent(BaseModel):
    event_type: str
    timestamp: Optional[str] = None
    title: str
    object_id: Optional[str] = None
    link_id: Optional[str] = None
    confidence: Optional[float] = None
    source_count: Optional[int] = None
    verification_status: Optional[str] = None
    provenance_refs: List[Dict[str, Any]] = Field(default_factory=list)


class NodeTimelineResponse(BaseModel):
    """Response for GET /unified-graph/node/{node_id}/timeline."""
    center: UnifiedTimelineCenter
    events: List[UnifiedTimelineEvent] = Field(default_factory=list)
    total: int = 0


class NodeProfileNode(BaseModel):
    id: str
    title: str
    node_type: str
    type: Optional[str] = None
    subtype: Optional[str] = None
    district: Optional[str] = None
    province: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    description: Optional[str] = None
    source_table: Optional[str] = None
    source_id: Optional[str] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = 0.0


class NodeProfileQuality(BaseModel):
    quality_score: float = 0.0
    missing_fields: List[str] = Field(default_factory=list)
    provenance_count: int = 0
    last_updated: Optional[str] = None


class NodeProfileRelationships(BaseModel):
    total: int = 0
    by_predicate: Dict[str, int] = Field(default_factory=dict)
    top_neighbors: List[Dict[str, Any]] = Field(default_factory=list)


class NodeProfileResponse(BaseModel):
    """Response for GET /unified-graph/node/{node_id}/profile."""
    node: NodeProfileNode
    profile_type: str
    summary: Dict[str, Any] = Field(default_factory=dict)
    relationships: NodeProfileRelationships
    quality: NodeProfileQuality


class GraphCorrectionRequest(BaseModel):
    """Request body for POST /unified-graph/corrections."""
    action: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    reason: str
    node_id: Optional[str] = None
    edge_id: Optional[str] = None


class GraphCorrectionEntry(BaseModel):
    id: str
    action: str
    status: str
    node_id: Optional[str] = None
    edge_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    reason: str
    submitted_by: str
    submitted_by_email: str = ""
    submitted_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    applied_change: Optional[Dict[str, Any]] = None
    applied_at: Optional[str] = None
    rolled_back_by: Optional[str] = None
    rolled_back_at: Optional[str] = None
    rollback_reason: Optional[str] = None


class GraphCorrectionListResponse(BaseModel):
    items: List[GraphCorrectionEntry] = Field(default_factory=list)
    pending_count: int = 0
    page: int = 1
    total: int = 0
    total_pages: int = 0


class GraphCorrectionActionResponse(BaseModel):
    id: str
    status: str
    message: str


# ============================================================
# Ingestion / Pipeline Response Schemas
# ============================================================

class PipelineJobResponse(BaseModel):
    """Response for POST endpoints that trigger background pipelines."""
    status: str = "accepted"
    message: str
    phases_requested: List[str] = Field(default_factory=list)
    run_id: Optional[str] = None
    results: Dict[str, Any] = Field(default_factory=dict)


class EntityResolutionResponse(BaseModel):
    """Response for POST /unified-graph/resolve."""
    status: str = "accepted"
    message: str
    method: str


class MetricsRecomputeResponse(BaseModel):
    """Response for POST /unified-graph/metrics/recompute."""
    status: str = "accepted"
    message: str
    window_type: str
