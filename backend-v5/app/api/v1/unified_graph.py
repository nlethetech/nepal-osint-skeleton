"""Unified Graph API endpoints for NARADA's Palantir-grade graph exploration.

Provides progressive graph exploration over ~180K+ nodes and ~500K-1M edges
using a 5-level data funnel (backend filtering, server aggregation, compound
nodes, level-of-detail, layout). The frontend never receives more than ~1,000
nodes in a single response.

Endpoints:
    GET  /overview              - District/province overview (~84 nodes)
    GET  /expand/{node_id}      - Expand a node's direct neighbors
    GET  /neighborhood/{node_id}- N-hop ego network
    GET  /path                  - Shortest path between two nodes
    GET  /search                - Full-text search across graph nodes
    GET  /stats                 - Aggregate counts by type/predicate/district
    GET  /health                - Connectivity and coverage health metrics
    GET  /timeseries            - Temporal edge counts by predicate/domain
    GET  /node/{node_id}        - Full node detail with edges and metrics
    GET  /districts             - All 77 districts for filter dropdowns
    POST /ingest                - Trigger graph ingestion pipeline (dev-only)
    POST /resolve               - Trigger entity resolution (dev-only)
    POST /metrics/recompute     - Recompute centrality metrics (dev-only)
"""
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user, require_dev
from app.config import get_settings
from app.schemas.unified_graph import (
    GraphOverviewResponse,
    GraphExpandResponse,
    GraphNeighborhoodResponse,
    GraphPathResponse,
    GraphSearchResponse,
    GraphStatsResponse,
    GraphHealthResponse,
    GraphTimeseriesResponse,
    NodeDetailResponse,
    DistrictListResponse,
    ResolveNodeRequest,
    ResolveNodeResponse,
    NodeTimelineResponse,
    NodeProfileResponse,
    GraphCorrectionRequest,
    GraphCorrectionListResponse,
    GraphCorrectionActionResponse,
    PipelineJobResponse,
    EntityResolutionResponse,
    MetricsRecomputeResponse,
)
from app.services.graph.graph_query_service import GraphQueryService
from app.services.graph.graph_ingestion_service import GraphIngestionService
from app.services.graph.entity_resolution_service import EntityResolutionService
from app.services.graph.graph_metrics_service import GraphMetricsService
from app.services.graph.graph_correction_service import GraphCorrectionService

logger = logging.getLogger(__name__)

# Dedicated audit logger for graph read operations — can be directed to a
# separate file/sink for forensic analysis of who accessed what intelligence.
audit_logger = logging.getLogger("graph.audit")
settings = get_settings()

router = APIRouter(prefix="/unified-graph", tags=["Unified Graph"])


# ============================================================
# Read Endpoints (analyst+ via router-level dependency in router.py)
# ============================================================


@router.get("/overview", response_model=GraphOverviewResponse)
async def get_graph_overview(
    as_of: datetime | None = Query(default=None, description="Snapshot timestamp (ISO-8601)"),
    from_ts: datetime | None = Query(default=None, description="Range start timestamp (ISO-8601)"),
    to_ts: datetime | None = Query(default=None, description="Range end timestamp (ISO-8601)"),
    window: str = Query(default="all_time", description="Window: 24h|7d|30d|all_time"),
    include_inferred: bool = Query(default=False, description="Include inferred edges"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return all district + province nodes with member counts.

    ~84 nodes (77 districts + 7 provinces), ~77 edges (province→district).
    Includes total_graph_nodes and total_graph_edges for status bar display.
    This is the initial view when the graph loads.
    """
    audit_logger.info(
        "graph_overview",
        extra={"user_id": str(current_user.id)},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.get_overview(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
            include_inferred=include_inferred,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Failed to fetch graph overview")
        raise HTTPException(status_code=500, detail="Failed to fetch graph overview")


@router.get("/expand/{node_id}", response_model=GraphExpandResponse)
async def expand_node(
    node_id: UUID,
    limit: int = Query(default=50, ge=1, le=200, description="Max neighbors to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    predicates: str | None = Query(
        default=None,
        description="Comma-separated predicates to filter (e.g. 'located_in,director_of')",
    ),
    min_confidence: float = Query(
        default=0.0, ge=0.0, le=1.0, description="Minimum edge confidence threshold"
    ),
    as_of: datetime | None = Query(default=None, description="Snapshot timestamp (ISO-8601)"),
    from_ts: datetime | None = Query(default=None, description="Range start timestamp (ISO-8601)"),
    to_ts: datetime | None = Query(default=None, description="Range end timestamp (ISO-8601)"),
    window: str = Query(default="all_time", description="Window: 24h|7d|30d|all_time"),
    include_inferred: bool = Query(default=False, description="Include inferred edges"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Expand a node to show its direct neighbors.

    For district nodes: shows companies, people, events in that district.
    For company nodes: shows directors, phone clusters, trade links.
    For person nodes: shows companies, parties, stories.

    Paginated with limit/offset. Returns `has_more=true` when more
    neighbors exist beyond the current page.
    """
    audit_logger.info(
        "graph_expand",
        extra={"user_id": str(current_user.id), "node_id": str(node_id), "limit": limit, "predicates": predicates},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    predicate_list = (
        [p.strip() for p in predicates.split(",") if p.strip()]
        if predicates
        else None
    )
    service = GraphQueryService(db)
    try:
        result = await service.expand_node(
            node_id=node_id,
            offset=offset,
            limit=limit,
            predicates=predicate_list,
            min_confidence=min_confidence,
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
            include_inferred=include_inferred,
        )
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to expand node %s", node_id)
        raise HTTPException(status_code=500, detail="Failed to expand node")


@router.get("/neighborhood/{node_id}", response_model=GraphNeighborhoodResponse)
async def get_neighborhood(
    node_id: UUID,
    # Max depth reduced from 4 to 3 to prevent exponential blowup on hub nodes (HIGH-1)
    depth: int = Query(default=2, ge=1, le=3, description="Number of hops (1-3)"),
    limit: int = Query(default=100, ge=1, le=500, description="Max total nodes to return"),
    min_confidence: float = Query(
        default=0.0, ge=0.0, le=1.0, description="Minimum edge confidence threshold"
    ),
    node_types: str | None = Query(
        default=None,
        description="Comma-separated node types to include (e.g. 'person,organization')",
    ),
    as_of: datetime | None = Query(default=None, description="Snapshot timestamp (ISO-8601)"),
    from_ts: datetime | None = Query(default=None, description="Range start timestamp (ISO-8601)"),
    to_ts: datetime | None = Query(default=None, description="Range end timestamp (ISO-8601)"),
    window: str = Query(default="all_time", description="Window: 24h|7d|30d|all_time"),
    include_inferred: bool = Query(default=False, description="Include inferred edges"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """N-hop ego network around a node.

    Returns all nodes and edges within `depth` hops of the specified node.
    Filtered by minimum confidence and optional node type whitelist.
    Limited to `limit` total nodes to prevent over-rendering.
    """
    audit_logger.info(
        "graph_neighborhood",
        extra={"user_id": str(current_user.id), "node_id": str(node_id), "depth": depth, "limit": limit, "node_types": node_types},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    type_list = (
        [t.strip() for t in node_types.split(",") if t.strip()]
        if node_types
        else None
    )
    service = GraphQueryService(db)
    try:
        result = await service.get_neighborhood(
            node_id=node_id,
            depth=depth,
            limit=limit,
            min_confidence=min_confidence,
            node_types=type_list,
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
            include_inferred=include_inferred,
        )
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to fetch neighborhood for %s", node_id)
        raise HTTPException(status_code=500, detail="Failed to fetch neighborhood")


@router.get("/path", response_model=GraphPathResponse)
async def find_shortest_path(
    from_node: UUID = Query(..., description="Source node UUID"),
    to_node: UUID = Query(..., description="Target node UUID"),
    max_depth: int = Query(
        default=5, ge=1, le=8, description="Maximum path length (hops)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Find shortest path between two nodes.

    Uses bidirectional BFS via recursive CTE. Returns the path as ordered
    node/edge lists. Returns `found=false` if no path exists within
    `max_depth` hops.
    """
    if from_node == to_node:
        raise HTTPException(
            status_code=422, detail="from_node and to_node must be different"
        )
    audit_logger.info(
        "graph_path",
        extra={"user_id": str(current_user.id), "from_node": str(from_node), "to_node": str(to_node), "max_depth": max_depth},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.find_shortest_path(
            from_id=from_node,
            to_id=to_node,
            max_depth=max_depth,
        )
        return result
    except Exception:
        logger.exception("Failed to find path from %s to %s", from_node, to_node)
        raise HTTPException(status_code=500, detail="Failed to find path")


@router.get("/search", response_model=GraphSearchResponse)
async def search_graph(
    q: str = Query(..., min_length=2, description="Search query (min 2 chars)"),
    node_types: str | None = Query(
        default=None,
        description="Comma-separated node types to search (e.g. 'person,organization')",
    ),
    districts: str | None = Query(
        default=None,
        description="Comma-separated district names to filter",
    ),
    limit: int = Query(default=50, ge=1, le=200, description="Max results to return"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Full-text search across graph nodes.

    Searches title, title_ne, canonical_key, and properties JSONB.
    Optionally filtered by node types and districts.
    Returns matching nodes with edge counts in properties.
    """
    audit_logger.info(
        "graph_search",
        extra={"user_id": str(current_user.id), "query": q, "node_types": node_types, "districts": districts},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    type_list = (
        [t.strip() for t in node_types.split(",") if t.strip()]
        if node_types
        else None
    )
    district_list = (
        [d.strip() for d in districts.split(",") if d.strip()]
        if districts
        else None
    )
    service = GraphQueryService(db)
    try:
        result = await service.search_nodes(
            query=q,
            node_types=type_list,
            districts=district_list,
            limit=limit,
        )
        return result
    except Exception:
        logger.exception("Graph search failed for q=%r", q)
        raise HTTPException(status_code=500, detail="Graph search failed")


@router.get("/stats", response_model=GraphStatsResponse)
async def get_graph_stats(
    as_of: datetime | None = Query(default=None, description="Snapshot timestamp (ISO-8601)"),
    from_ts: datetime | None = Query(default=None, description="Range start timestamp (ISO-8601)"),
    to_ts: datetime | None = Query(default=None, description="Range end timestamp (ISO-8601)"),
    window: str = Query(default="all_time", description="Window: 24h|7d|30d|all_time"),
    include_inferred: bool = Query(default=False, description="Include inferred edges"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return total counts by node type, predicate, and district.

    Used for dashboard KPI cards and status bar display.
    Cached in the service layer for fast repeated access.
    """
    audit_logger.info(
        "graph_stats",
        extra={"user_id": str(current_user.id)},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.get_stats(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
            include_inferred=include_inferred,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Failed to fetch graph stats")
        raise HTTPException(status_code=500, detail="Failed to fetch graph stats")


@router.get("/health", response_model=GraphHealthResponse)
async def get_graph_health(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return graph connectivity and coverage health metrics."""
    audit_logger.info(
        "graph_health",
        extra={"user_id": str(current_user.id)},
    )
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        return await service.get_health()
    except Exception:
        logger.exception("Failed to fetch graph health")
        raise HTTPException(status_code=500, detail="Failed to fetch graph health")


@router.get("/timeseries", response_model=GraphTimeseriesResponse)
async def get_graph_timeseries(
    bucket: str = Query(default="day", description="Bucket: hour|day|week"),
    as_of: datetime | None = Query(default=None, description="Snapshot timestamp (ISO-8601)"),
    from_ts: datetime | None = Query(default=None, description="Range start timestamp (ISO-8601)"),
    to_ts: datetime | None = Query(default=None, description="Range end timestamp (ISO-8601)"),
    window: str = Query(default="30d", description="Window: 24h|7d|30d|all_time"),
    include_inferred: bool = Query(default=False, description="Include inferred edges"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return temporal edge activity by predicate/domain buckets."""
    audit_logger.info(
        "graph_timeseries",
        extra={
            "user_id": str(current_user.id),
            "bucket": bucket,
            "window": window,
            "include_inferred": include_inferred,
        },
    )
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        return await service.get_timeseries(
            bucket=bucket,
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
            include_inferred=include_inferred,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Failed to fetch graph timeseries")
        raise HTTPException(status_code=500, detail="Failed to fetch graph timeseries")


@router.get("/node/{node_id}", response_model=NodeDetailResponse)
async def get_node_detail(
    node_id: UUID,
    as_of: datetime | None = Query(default=None, description="Snapshot timestamp (ISO-8601)"),
    from_ts: datetime | None = Query(default=None, description="Range start timestamp (ISO-8601)"),
    to_ts: datetime | None = Query(default=None, description="Range end timestamp (ISO-8601)"),
    window: str = Query(default="all_time", description="Window: 24h|7d|30d|all_time"),
    include_inferred: bool = Query(default=False, description="Include inferred edges"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Full detail for a single node.

    Returns the node's properties, all connected edges, precomputed
    metrics (degree, pagerank, betweenness), and entity resolution
    history (merged records, match methods, confidence scores).
    """
    audit_logger.info(
        "graph_node_detail",
        extra={"user_id": str(current_user.id), "node_id": str(node_id)},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.get_node_detail(
            node_id=node_id,
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
            include_inferred=include_inferred,
        )
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to fetch node detail for %s", node_id)
        raise HTTPException(status_code=500, detail="Failed to fetch node detail")


@router.post("/resolve-node", response_model=ResolveNodeResponse)
async def resolve_graph_node(
    request: ResolveNodeRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Resolve a source table/id record to a canonical unified graph node."""
    audit_logger.info(
        "graph_resolve_node",
        extra={
            "user_id": str(current_user.id),
            "source_table": request.source_table,
            "source_id": request.source_id,
        },
    )
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        node = await service.resolve_node(
            source_table=request.source_table,
            source_id=request.source_id,
            canonical_key=request.canonical_key,
        )
        return ResolveNodeResponse(found=node is not None, node=node)
    except Exception:
        logger.exception(
            "Failed to resolve graph node for %s/%s",
            request.source_table,
            request.source_id,
        )
        raise HTTPException(status_code=500, detail="Failed to resolve graph node")


@router.get("/node/{node_id}/timeline", response_model=NodeTimelineResponse)
async def get_node_timeline(
    node_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Unified timeline for a graph node ID (investigation-safe ID domain)."""
    if not settings.unified_timeline_enabled:
        raise HTTPException(status_code=404, detail="Unified timeline is disabled")
    audit_logger.info(
        "graph_node_timeline",
        extra={"user_id": str(current_user.id), "node_id": str(node_id), "limit": limit},
    )
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.get_node_timeline(node_id=node_id, limit=limit)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to fetch node timeline for %s", node_id)
        raise HTTPException(status_code=500, detail="Failed to fetch node timeline")


@router.get("/node/{node_id}/profile", response_model=NodeProfileResponse)
async def get_node_profile(
    node_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Type-aware profile payload for investigation right panel."""
    audit_logger.info(
        "graph_node_profile",
        extra={"user_id": str(current_user.id), "node_id": str(node_id)},
    )
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.get_node_profile(node_id=node_id)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to fetch node profile for %s", node_id)
        raise HTTPException(status_code=500, detail="Failed to fetch node profile")


@router.post("/corrections", response_model=GraphCorrectionActionResponse)
async def submit_graph_correction(
    request: GraphCorrectionRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Analyst submits graph correction proposal for reviewer queue."""
    if not settings.graph_corrections_enabled:
        raise HTTPException(status_code=404, detail="Graph corrections are disabled")
    service = GraphCorrectionService(db)
    try:
        correction = await service.submit(
            action=request.action,
            payload=request.payload,
            reason=request.reason,
            submitted_by=current_user.id,
            node_id=UUID(request.node_id) if request.node_id else None,
            edge_id=UUID(request.edge_id) if request.edge_id else None,
        )
        return GraphCorrectionActionResponse(
            id=str(correction.id),
            status=correction.status,
            message="Graph correction submitted for review",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Failed to submit graph correction")
        raise HTTPException(status_code=500, detail="Failed to submit graph correction")


@router.get("/corrections", response_model=GraphCorrectionListResponse)
async def list_graph_corrections(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List graph corrections for analyst/dev visibility and reviewer queue."""
    if not settings.graph_corrections_enabled:
        raise HTTPException(status_code=404, detail="Graph corrections are disabled")
    service = GraphCorrectionService(db)
    try:
        return await service.list(status=status, page=page, per_page=per_page)
    except Exception:
        logger.exception("Failed to list graph corrections")
        raise HTTPException(status_code=500, detail="Failed to list graph corrections")


@router.post("/corrections/{correction_id}/approve", response_model=GraphCorrectionActionResponse)
async def approve_graph_correction(
    correction_id: UUID,
    notes: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_dev),
):
    """Reviewer/dev approves and applies a graph correction."""
    if not settings.graph_corrections_enabled:
        raise HTTPException(status_code=404, detail="Graph corrections are disabled")
    service = GraphCorrectionService(db)
    try:
        correction = await service.approve(correction_id=correction_id, reviewer_id=current_user.id, notes=notes)
        return GraphCorrectionActionResponse(
            id=str(correction.id),
            status=correction.status,
            message="Graph correction approved and applied",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Failed to approve graph correction %s", correction_id)
        raise HTTPException(status_code=500, detail="Failed to approve graph correction")


@router.post("/corrections/{correction_id}/reject", response_model=GraphCorrectionActionResponse)
async def reject_graph_correction(
    correction_id: UUID,
    reason: str = Query(..., min_length=5),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_dev),
):
    """Reviewer/dev rejects a graph correction proposal."""
    if not settings.graph_corrections_enabled:
        raise HTTPException(status_code=404, detail="Graph corrections are disabled")
    service = GraphCorrectionService(db)
    try:
        correction = await service.reject(correction_id=correction_id, reviewer_id=current_user.id, reason=reason)
        return GraphCorrectionActionResponse(
            id=str(correction.id),
            status=correction.status,
            message="Graph correction rejected",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Failed to reject graph correction %s", correction_id)
        raise HTTPException(status_code=500, detail="Failed to reject graph correction")


@router.post("/corrections/{correction_id}/rollback", response_model=GraphCorrectionActionResponse)
async def rollback_graph_correction(
    correction_id: UUID,
    reason: str = Query(..., min_length=5),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_dev),
):
    """Reviewer/dev rolls back an approved graph correction."""
    if not settings.graph_corrections_enabled:
        raise HTTPException(status_code=404, detail="Graph corrections are disabled")
    service = GraphCorrectionService(db)
    try:
        correction = await service.rollback(correction_id=correction_id, reviewer_id=current_user.id, reason=reason)
        return GraphCorrectionActionResponse(
            id=str(correction.id),
            status=correction.status,
            message="Graph correction rolled back",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Failed to rollback graph correction %s", correction_id)
        raise HTTPException(status_code=500, detail="Failed to rollback graph correction")


@router.get("/districts", response_model=DistrictListResponse)
async def list_districts(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return all 77 districts with their graph node IDs and member counts.

    Used for district filter dropdowns and geographic layer initialization.
    Each district includes its province, centroid coordinates, and the
    count of graph nodes located in that district.
    """
    audit_logger.info(
        "graph_districts",
        extra={"user_id": str(current_user.id)},
    )
    # Prevent runaway queries — 10s timeout protects the DB from DoS (HIGH-1)
    await db.execute(text("SET LOCAL statement_timeout = '10s'"))
    service = GraphQueryService(db)
    try:
        result = await service.list_districts()
        return result
    except Exception:
        logger.exception("Failed to fetch district list")
        raise HTTPException(status_code=500, detail="Failed to fetch district list")


# ============================================================
# Write Endpoints (dev-only, enforced per-endpoint)
# ============================================================


@router.post("/ingest", response_model=PipelineJobResponse)
async def run_graph_ingestion(
    phases: str = Query(
        default="all",
        description=(
            "Comma-separated ingestion phases to run: "
            "districts, companies, company_directorships, company_address_clusters, "
            "building_zones, political_entities, candidates, stories, disasters, "
            "trade_network, phone_clusters, dfims_organizations "
            "(aliases: entities, trade, phones, dfims). "
            "Use 'all' to run the full pipeline."
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_dev),
):
    """Trigger graph ingestion pipeline.

    Populates graph_nodes and graph_edges from source tables.
    Can run specific phases or the full pipeline.
    Long-running: returns immediately with job status.

    Requires dev role.
    """
    raw_phase_list = [p.strip() for p in phases.split(",") if p.strip()]
    phase_list = raw_phase_list if phases != "all" else ["all"]
    logger.info(
        "Graph ingestion requested by user %s: phases=%s",
        current_user.id, phase_list,
    )
    service = GraphIngestionService(db)
    try:
        result = (
            await service.run_ingestion(phase_list)
            if phases != "all"
            else await service.run_full_ingestion()
        )
        phases_requested = (
            phase_list if phases != "all" else result.get("phases_executed", [])
        )
        return PipelineJobResponse(
            status="accepted",
            message=f"Graph ingestion executed for {len(result.get('phases_executed', []))} phase(s)",
            phases_requested=phases_requested,
            run_id=result.get("run_id"),
            results=result.get("steps", {}),
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Failed to start graph ingestion")
        raise HTTPException(status_code=500, detail="Failed to start graph ingestion")


@router.post("/resolve", response_model=EntityResolutionResponse)
async def run_entity_resolution(
    method: str = Query(
        default="all",
        description="Resolution method: deterministic, probabilistic, or all",
    ),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_dev),
):
    """Trigger entity resolution pipeline.

    Phase 1 (deterministic): PAN match, linked_entity_id propagation,
    canonical_key matching. Confidence = 1.0.
    Phase 2 (probabilistic): Jaro-Winkler name similarity with district
    and party boosting. Confidence = 0.7-0.95.

    Requires dev role.
    """
    valid_methods = {"deterministic", "probabilistic", "all"}
    if method not in valid_methods:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid method '{method}'. Must be one of: {', '.join(sorted(valid_methods))}",
        )
    logger.info(
        "Entity resolution requested by user %s: method=%s",
        current_user.id, method,
    )
    service = EntityResolutionService(db)
    try:
        if method == "deterministic":
            await service.run_deterministic_resolution()
        elif method == "probabilistic":
            await service.run_probabilistic_resolution()
        else:
            await service.run_full_resolution()
        return EntityResolutionResponse(
            status="accepted",
            message=f"Entity resolution started (method={method})",
            method=method,
        )
    except Exception:
        logger.exception("Failed to start entity resolution")
        raise HTTPException(status_code=500, detail="Failed to start entity resolution")


@router.post("/metrics/recompute", response_model=MetricsRecomputeResponse)
async def recompute_metrics(
    window_type: str = Query(
        default="all_time",
        description="Time window for metrics: all_time, last_30d, last_90d, last_365d",
    ),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_dev),
):
    """Recompute graph node metrics.

    Computes degree centrality, PageRank, betweenness centrality,
    hub/bridge detection, and clustering coefficient for the specified
    time window. Results are stored in graph_node_metrics.

    Requires dev role.
    """
    valid_windows = {"all_time", "last_30d", "last_90d", "last_365d"}
    if window_type not in valid_windows:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid window_type '{window_type}'. Must be one of: {', '.join(sorted(valid_windows))}",
        )
    logger.info(
        "Metrics recompute requested by user %s: window=%s",
        current_user.id, window_type,
    )
    service = GraphMetricsService(db)
    try:
        await service.compute_all_metrics()
        return MetricsRecomputeResponse(
            status="accepted",
            message=f"Metrics recompute started (window={window_type})",
            window_type=window_type,
        )
    except Exception:
        logger.exception("Failed to start metrics recompute")
        raise HTTPException(status_code=500, detail="Failed to start metrics recompute")
