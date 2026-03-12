"""Political Entities API endpoints with network analysis."""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.political_entity import PoliticalEntity, EntityType
from app.models.story_entity_link import StoryEntityLink
from app.models.story import Story
from app.models.entity_relationship import (
    EntityRelationship,
    EntityNetworkMetrics,
    EntityCommunity,
    RelationshipType,
    MetricWindowType,
)
from app.schemas.entities import (
    EntityResponse,
    EntityListResponse,
    EntityStoriesResponse,
    EntityStoryItem,
)
from app.services.entity_intelligence import (
    RelationshipDiscoveryService,
    NetworkAnalysisService,
    EntityProfileService,
    EntitySearchService,
)

router = APIRouter(prefix="/entities", tags=["entities"])


@router.get("", response_model=EntityListResponse)
async def list_entities(
    entity_type: Optional[str] = Query(None, description="Filter by type (person, party, organization, institution)"),
    search: Optional[str] = Query(None, description="Search by name"),
    has_mentions: bool = Query(True, description="Only entities with mentions"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    List all political entities with optional filtering.
    """
    query = select(PoliticalEntity).where(PoliticalEntity.is_active == True)

    if entity_type:
        try:
            et = EntityType(entity_type.lower())
            query = query.where(PoliticalEntity.entity_type == et)
        except ValueError:
            pass

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (PoliticalEntity.name_en.ilike(search_pattern)) |
            (PoliticalEntity.name_ne.ilike(search_pattern)) |
            (PoliticalEntity.canonical_id.ilike(search_pattern))
        )

    if has_mentions:
        query = query.where(PoliticalEntity.total_mentions > 0)

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination and sorting
    query = query.order_by(
        PoliticalEntity.mentions_24h.desc(),
        PoliticalEntity.total_mentions.desc(),
    ).offset(offset).limit(limit)

    result = await db.execute(query)
    entities = result.scalars().all()

    return EntityListResponse(
        entities=[EntityResponse.from_entity(e) for e in entities],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{entity_id}", response_model=EntityResponse)
async def get_entity(
    entity_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a single political entity by ID.
    """
    result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    return EntityResponse.from_entity(entity)


@router.get("/by-canonical/{canonical_id}", response_model=EntityResponse)
async def get_entity_by_canonical_id(
    canonical_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a political entity by its canonical ID (e.g., 'oli', 'karki').
    """
    result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.canonical_id == canonical_id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    return EntityResponse.from_entity(entity)


@router.get("/{entity_id}/stories", response_model=EntityStoriesResponse)
async def get_entity_stories(
    entity_id: UUID,
    hours: int = Query(168, ge=1, le=720, description="Time window in hours (default 7 days)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    category: Optional[str] = Query(None, description="Filter by story category"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all stories mentioning a specific political entity.

    This powers the entity detail view and EntityStoriesModal.
    """
    # Verify entity exists
    entity_result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    # Build stories query
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    query = (
        select(Story, StoryEntityLink.created_at.label("linked_at"))
        .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
        .where(StoryEntityLink.entity_id == entity_id)
        .where(Story.published_at >= cutoff)
    )

    if category:
        query = query.where(Story.category == category)

    # Count total
    count_query = (
        select(func.count(Story.id))
        .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
        .where(StoryEntityLink.entity_id == entity_id)
        .where(Story.published_at >= cutoff)
    )
    if category:
        count_query = count_query.where(Story.category == category)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Fetch stories with pagination
    query = query.order_by(Story.published_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    stories = [
        EntityStoryItem(
            id=row.Story.id,
            title=row.Story.title,
            summary=row.Story.summary,
            url=row.Story.url,
            source_id=row.Story.source_id,
            source_name=row.Story.source_name,
            category=row.Story.category,
            severity=row.Story.severity,
            nepal_relevance=row.Story.nepal_relevance,
            published_at=row.Story.published_at,
            linked_at=row.linked_at,
        )
        for row in rows
    ]

    return EntityStoriesResponse(
        entity_id=entity_id,
        entity_name=entity.name_en,
        entity_name_ne=entity.name_ne,
        entity_type=entity.entity_type.value,
        stories=stories,
        total=total,
        hours=hours,
        limit=limit,
        offset=offset,
    )


@router.get("/{entity_id}/timeline")
async def get_entity_timeline(
    entity_id: UUID,
    days: int = Query(30, ge=1, le=90, description="Number of days for timeline"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get mention timeline for an entity (daily counts).

    Useful for trend visualization.
    """
    # Verify entity exists
    entity_result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Get daily mention counts
    query = (
        select(
            func.date_trunc('day', Story.published_at).label('date'),
            func.count(StoryEntityLink.id).label('count'),
        )
        .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
        .where(StoryEntityLink.entity_id == entity_id)
        .where(Story.published_at >= cutoff)
        .group_by(func.date_trunc('day', Story.published_at))
        .order_by(func.date_trunc('day', Story.published_at))
    )

    result = await db.execute(query)
    timeline = [
        {"date": row.date.isoformat() if row.date else None, "count": row.count}
        for row in result.all()
    ]

    return {
        "entity_id": str(entity_id),
        "entity_name": entity.name_en,
        "days": days,
        "timeline": timeline,
    }


# ============================================================================
# Entity Intelligence Endpoints - Network Analysis & Profiles
# ============================================================================


@router.get("/{entity_id}/profile")
async def get_entity_profile(
    entity_id: UUID,
    include_stories: bool = Query(True, description="Include recent stories"),
    include_relationships: bool = Query(True, description="Include relationships"),
    include_metrics: bool = Query(True, description="Include network metrics"),
    include_parliament: bool = Query(True, description="Include parliament record"),
    story_limit: int = Query(20, ge=1, le=100),
    relationship_limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Get comprehensive entity profile (dossier).

    Returns all available information about an entity including:
    - Basic information and aliases
    - Mention statistics and trends
    - Recent stories
    - Network relationships
    - Centrality metrics
    - Parliament record (if applicable)
    """
    service = EntityProfileService(db)
    profile = await service.get_full_profile(
        entity_id=entity_id,
        include_stories=include_stories,
        include_relationships=include_relationships,
        include_metrics=include_metrics,
        include_parliament=include_parliament,
        story_limit=story_limit,
        relationship_limit=relationship_limit,
    )

    if not profile:
        raise HTTPException(status_code=404, detail="Entity not found")

    return profile


@router.get("/{entity_id}/relationships")
async def get_entity_relationships(
    entity_id: UUID,
    relationship_type: Optional[str] = Query(None, description="Filter by relationship type"),
    min_strength: float = Query(0.0, ge=0, le=1, description="Minimum relationship strength"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all relationships for an entity.

    Returns co-mention relationships, political alliances, and other
    relationship types with strength scores.
    """
    # Verify entity exists
    result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    # Parse relationship type filter
    rel_types = None
    if relationship_type:
        try:
            rel_types = [RelationshipType(relationship_type)]
        except ValueError:
            pass

    service = RelationshipDiscoveryService(db)
    relationships = await service.get_entity_relationships(
        entity_id=entity_id,
        relationship_types=rel_types,
        min_strength=min_strength,
        limit=limit,
    )

    # Get connected entity details
    entity_ids = set()
    for rel in relationships:
        entity_ids.add(rel.source_entity_id)
        entity_ids.add(rel.target_entity_id)
    entity_ids.discard(entity_id)

    entities_result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id.in_(entity_ids))
    )
    entities_map = {str(e.id): e for e in entities_result.scalars().all()}

    return {
        "entity_id": str(entity_id),
        "entity_name": entity.name_en,
        "relationships": [
            {
                "id": str(rel.id),
                "other_entity": _serialize_entity_brief(
                    entities_map.get(
                        str(rel.target_entity_id if rel.source_entity_id == entity_id else rel.source_entity_id)
                    )
                ),
                "relationship_type": rel.relationship_type.value,
                "strength": rel.strength_score,
                "co_mentions": rel.co_mention_count,
                "confidence": rel.confidence,
                "is_verified": rel.is_verified,
                "first_co_mention_at": rel.first_co_mention_at.isoformat() if rel.first_co_mention_at else None,
                "last_co_mention_at": rel.last_co_mention_at.isoformat() if rel.last_co_mention_at else None,
            }
            for rel in relationships
        ],
        "total": len(relationships),
    }


@router.get("/{entity_id}/network")
async def get_entity_network(
    entity_id: UUID,
    window: str = Query("7d", description="Time window: 24h, 7d, 30d, 90d, all_time"),
    depth: int = Query(1, ge=1, le=3, description="Network depth (1=direct, 2=friends-of-friends)"),
    min_strength: float = Query(0.1, ge=0, le=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """
    Get entity's network subgraph in Cytoscape format.

    Returns nodes and edges for visualization centered on this entity.
    """
    # Verify entity exists
    result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    # Parse window type
    try:
        window_type = MetricWindowType(window)
    except ValueError:
        window_type = MetricWindowType.WINDOW_7D

    # Get direct relationships
    service = RelationshipDiscoveryService(db)
    relationships = await service.get_entity_relationships(
        entity_id=entity_id,
        min_strength=min_strength,
        limit=limit,
    )

    # Collect all entity IDs in the network
    entity_ids = {entity_id}
    for rel in relationships:
        entity_ids.add(rel.source_entity_id)
        entity_ids.add(rel.target_entity_id)

    # Get entity details
    entities_result = await db.execute(
        select(PoliticalEntity).where(PoliticalEntity.id.in_(entity_ids))
    )
    entities = {e.id: e for e in entities_result.scalars().all()}

    # Get metrics for entities
    metrics_result = await db.execute(
        select(EntityNetworkMetrics).where(
            EntityNetworkMetrics.entity_id.in_(entity_ids),
            EntityNetworkMetrics.window_type == window_type,
        )
    )
    metrics = {m.entity_id: m for m in metrics_result.scalars().all()}

    # Build Cytoscape format
    nodes = []
    for eid, ent in entities.items():
        met = metrics.get(eid)
        nodes.append({
            "data": {
                "id": str(eid),
                "label": ent.name_en,
                "type": ent.entity_type.value,
                "party": ent.party,
                "isCenter": eid == entity_id,
                "pagerank": met.pagerank_score if met else None,
                "degree": met.degree_centrality if met else None,
                "cluster": met.cluster_id if met else None,
                "isHub": met.is_hub if met else False,
            }
        })

    edges = []
    for rel in relationships:
        edges.append({
            "data": {
                "id": str(rel.id),
                "source": str(rel.source_entity_id),
                "target": str(rel.target_entity_id),
                "weight": rel.strength_score,
                "coMentions": rel.co_mention_count,
                "type": rel.relationship_type.value,
            }
        })

    return {
        "elements": {
            "nodes": nodes,
            "edges": edges,
        },
        "center_entity": str(entity_id),
        "window_type": window_type.value,
    }


# ============================================================================
# Global Network Endpoints
# ============================================================================


@router.get("/network/graph")
async def get_full_network_graph(
    window: str = Query("7d", description="Time window"),
    min_strength: float = Query(0.1, ge=0, le=1),
    limit_nodes: int = Query(100, ge=10, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    Get full network graph in Cytoscape format.

    Returns the top entities by PageRank and their relationships.
    """
    try:
        window_type = MetricWindowType(window)
    except ValueError:
        window_type = MetricWindowType.WINDOW_7D

    service = NetworkAnalysisService(db)
    return await service.get_graph_data(
        window_type=window_type,
        min_strength=min_strength,
        limit_nodes=limit_nodes,
    )


@router.get("/network/metrics/leaderboard")
async def get_influence_leaderboard(
    window: str = Query("7d", description="Time window"),
    metric: str = Query("pagerank", description="Metric: pagerank, betweenness, degree, eigenvector"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Get top entities ranked by network influence metrics.

    Powers the InfluenceLeaderboard component.
    """
    try:
        window_type = MetricWindowType(window)
    except ValueError:
        window_type = MetricWindowType.WINDOW_7D

    service = NetworkAnalysisService(db)
    results = await service.get_leaderboard(
        window_type=window_type,
        metric=metric,
        limit=limit,
    )

    return {
        "window_type": window_type.value,
        "metric": metric,
        "leaderboard": [
            {
                "rank": idx + 1,
                "entity": {
                    "id": str(entity.id),
                    "name_en": entity.name_en,
                    "entity_type": entity.entity_type.value,
                    "party": entity.party,
                    "image_url": entity.image_url,
                },
                "metrics": {
                    "pagerank": metrics.pagerank_score,
                    "degree": metrics.degree_centrality,
                    "betweenness": metrics.betweenness_centrality,
                    "eigenvector": metrics.eigenvector_centrality,
                    "total_connections": metrics.total_connections,
                    "is_hub": metrics.is_hub,
                    "is_bridge": metrics.is_bridge,
                    "cluster_id": metrics.cluster_id,
                },
            }
            for idx, (metrics, entity) in enumerate(results)
        ],
    }


@router.get("/network/communities")
async def get_network_communities(
    window: str = Query("7d", description="Time window"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detected communities/clusters in the entity network.

    Returns community metadata including member counts and central entities.
    """
    try:
        window_type = MetricWindowType(window)
    except ValueError:
        window_type = MetricWindowType.WINDOW_7D

    service = NetworkAnalysisService(db)
    communities = await service.get_communities(window_type)

    # Get entity details for central entities
    all_entity_ids = []
    for comm in communities:
        if comm.central_entity_ids:
            all_entity_ids.extend(comm.central_entity_ids)

    entities_map = {}
    if all_entity_ids:
        result = await db.execute(
            select(PoliticalEntity).where(PoliticalEntity.id.in_(all_entity_ids))
        )
        entities_map = {str(e.id): e for e in result.scalars().all()}

    return {
        "window_type": window_type.value,
        "communities": [
            {
                "cluster_id": comm.cluster_id,
                "name": comm.name,
                "description": comm.description,
                "member_count": comm.member_count,
                "dominant_party": comm.dominant_party,
                "dominant_entity_type": comm.dominant_entity_type,
                "density": comm.density,
                "central_entities": [
                    _serialize_entity_brief(entities_map.get(str(eid)))
                    for eid in (comm.central_entity_ids or [])
                ],
                "computed_at": comm.computed_at.isoformat() if comm.computed_at else None,
            }
            for comm in communities
        ],
    }


# ============================================================================
# Search Endpoints
# ============================================================================


@router.get("/search/autocomplete")
async def autocomplete_entities(
    q: str = Query(..., min_length=2, description="Search prefix"),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Get autocomplete suggestions for entity search.

    Optimized for fast prefix matching.
    """
    service = EntitySearchService(db)
    return await service.autocomplete(q, limit)


@router.get("/search/fuzzy")
async def fuzzy_search_entities(
    q: str = Query(..., min_length=2, description="Search query"),
    entity_type: Optional[str] = Query(None, description="Filter by type"),
    party: Optional[str] = Query(None, description="Filter by party"),
    min_mentions: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Fuzzy search for entities by name with alias resolution.

    Supports Nepali names, aliases, and canonical IDs.
    """
    # Parse entity type filter
    entity_types = None
    if entity_type:
        try:
            entity_types = [EntityType(entity_type)]
        except ValueError:
            pass

    service = EntitySearchService(db)
    return await service.search(
        query=q,
        entity_types=entity_types,
        party=party,
        min_mentions=min_mentions,
        limit=limit,
    )


@router.get("/search/trending")
async def get_trending_entities(
    hours: int = Query(24, ge=1, le=168),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Get trending entities based on recent mentions.
    """
    entity_types = None
    if entity_type:
        try:
            entity_types = [EntityType(entity_type)]
        except ValueError:
            pass

    service = EntitySearchService(db)
    return await service.get_trending_entities(
        hours=hours,
        entity_types=entity_types,
        limit=limit,
    )


# ============================================================================
# Admin Endpoints - Trigger computations
# ============================================================================


@router.post("/network/compute")
async def trigger_network_computation(
    window: str = Query("7d", description="Time window to compute"),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger network metrics computation.

    This is an admin endpoint to manually trigger the computation of
    centrality metrics and community detection.
    """
    try:
        window_type = MetricWindowType(window)
    except ValueError:
        window_type = MetricWindowType.WINDOW_7D

    service = NetworkAnalysisService(db)
    stats = await service.compute_all_metrics(window_type)

    return {
        "status": "completed",
        "window_type": window_type.value,
        "stats": stats,
    }


@router.post("/relationships/discover")
async def trigger_relationship_discovery(
    hours: int = Query(720, ge=24, le=2160, description="Time window in hours"),
    min_confidence: float = Query(0.5, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger bulk co-mention relationship discovery.

    This is an admin endpoint to refresh the relationship graph.
    """
    service = RelationshipDiscoveryService(db)
    stats = await service.discover_all_co_mentions(
        hours=hours,
        min_confidence=min_confidence,
    )

    return {
        "status": "completed",
        "stats": stats,
    }


# ============================================================================
# Helper Functions
# ============================================================================


def _serialize_entity_brief(entity: Optional[PoliticalEntity]) -> Optional[dict]:
    """Serialize entity for relationship responses."""
    if not entity:
        return None
    return {
        "id": str(entity.id),
        "name_en": entity.name_en,
        "entity_type": entity.entity_type.value,
        "party": entity.party,
        "image_url": entity.image_url,
    }
