"""Graph query service for progressive exploration of the NARADA unified graph.

Provides:
  - Overview (district + province super-nodes)
  - Single-node expansion
  - N-hop ego network via recursive CTE
  - Shortest path via bidirectional BFS
  - Full-text search across graph_nodes
  - Aggregate stats by type / predicate / district
  - Full detail for a single node

All queries filter ``is_canonical = TRUE`` to skip merged duplicates and
``is_current = TRUE`` on edges by default.  Results are capped server-side
and returned in Cytoscape-compatible format.
"""
from __future__ import annotations

from collections import Counter
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text, and_, or_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import (
    District,
    GraphNode,
    GraphEdge,
    GraphNodeMetrics,
    EntityResolution,
    NodeType,
    EdgePredicate,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# PII fields that must never be exposed in API responses (HIGH-3).
# The full properties remain in the database for internal queries, but the
# API response strips these before returning to any client.
# ---------------------------------------------------------------------------
PII_FIELDS: frozenset[str] = frozenset({
    "pan", "phone_hash", "mobile_hash", "raw_phone", "raw_mobile",
    "address", "ward_no",
})


# ---------------------------------------------------------------------------
# Cytoscape formatters
# ---------------------------------------------------------------------------

def _strip_pii(properties: dict | None) -> dict:
    """Return a copy of properties with PII fields removed."""
    if not properties:
        return {}
    return {k: v for k, v in properties.items() if k not in PII_FIELDS}


def _cy_node(row: dict) -> dict:
    """Format a node dict as a Cytoscape-compatible element."""
    node_type = row.get("node_type") or row.get("type", "")
    data: dict[str, Any] = {
        "id": str(row["id"]),
        "label": row.get("title", ""),
        # Compatibility contract: expose both fields during transition.
        "node_type": node_type,
        "type": node_type,
    }
    # Optional fields
    for key in (
        "district", "province", "latitude", "longitude", "subtype",
        "source_table", "source_id", "confidence",
        "member_count", "edge_count", "is_canonical",
    ):
        if key in row and row[key] is not None:
            data[key] = row[key]
    # Strip PII from properties before including in Cytoscape response (HIGH-3)
    if "properties" in row and row["properties"] is not None:
        data["properties"] = _strip_pii(row["properties"])
    return {"data": data}


def _cy_edge(row: dict) -> dict:
    """Format an edge dict as a Cytoscape-compatible element."""
    data: dict[str, Any] = {
        "id": str(row["id"]),
        "source": str(row["source_node_id"]),
        "target": str(row["target_node_id"]),
        "predicate": row.get("predicate", ""),
    }
    for key in ("weight", "confidence", "is_current", "properties"):
        if key in row and row[key] is not None:
            data[key] = row[key]
    return {"data": data}


def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy Row / RowMapping to a plain dict."""
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class GraphQueryService:
    """Async query service for the NARADA unified graph."""

    def __init__(self, session: AsyncSession):
        self.session = session

    _WINDOW_MAP: dict[str, timedelta | None] = {
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "all_time": None,
    }

    @classmethod
    def _normalize_window(cls, window: str | None) -> str:
        normalized = (window or "all_time").strip().lower()
        if normalized not in cls._WINDOW_MAP:
            raise ValueError(
                f"Invalid window '{window}'. Must be one of: {', '.join(sorted(cls._WINDOW_MAP.keys()))}"
            )
        return normalized

    @classmethod
    def _resolve_time_range(
        cls,
        *,
        as_of: datetime | None,
        from_ts: datetime | None,
        to_ts: datetime | None,
        window: str,
    ) -> tuple[datetime | None, datetime | None]:
        normalized_window = cls._normalize_window(window)
        effective_to = to_ts or as_of or datetime.now(timezone.utc)
        effective_from = from_ts
        delta = cls._WINDOW_MAP[normalized_window]
        if effective_from is None and delta is not None:
            effective_from = effective_to - delta
        return effective_from, effective_to

    @staticmethod
    def _edge_time_conditions(
        *,
        include_inferred: bool = False,
        min_confidence: float | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
    ) -> list[Any]:
        edge_start = func.coalesce(GraphEdge.valid_from, GraphEdge.first_seen_at, GraphEdge.created_at)
        edge_end = func.coalesce(GraphEdge.valid_to, GraphEdge.last_seen_at)
        conditions: list[Any] = [GraphEdge.is_current.is_(True)]
        if min_confidence is not None:
            conditions.append(GraphEdge.confidence >= min_confidence)
        if not include_inferred:
            conditions.append(func.coalesce(GraphEdge.properties["inferred"].astext, "false") != "true")
        if from_ts is not None:
            conditions.append(or_(edge_end.is_(None), edge_end >= from_ts))
        if to_ts is not None:
            conditions.append(edge_start <= to_ts)
        return conditions

    # ------------------------------------------------------------------
    # 1. Overview
    # ------------------------------------------------------------------

    async def get_overview(
        self,
        *,
        as_of: datetime | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        window: str = "all_time",
        include_inferred: bool = False,
    ) -> dict:
        """Return all district + province place nodes with edge / member counts.

        Returns approximately 84 nodes (77 districts + 7 provinces) plus the
        ``parent_of`` edges between them.  Each district node carries an
        ``member_count`` (entities whose ``district`` matches) and ``edge_count``
        (edges touching those entities).  Also returns the total graph size.
        """
        logger.info("Fetching graph overview (districts + provinces)")
        resolved_from, resolved_to = self._resolve_time_range(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
        )

        # Fetch district/province place nodes
        stmt = (
            select(GraphNode)
            .where(
                GraphNode.node_type == NodeType.PLACE.value,
                GraphNode.is_canonical.is_(True),
                GraphNode.source_table.in_(["countries", "districts", "provinces"]),
            )
        )
        result = await self.session.execute(stmt)
        place_nodes = result.scalars().all()

        if not place_nodes:
            # Fallback: fetch any place nodes
            stmt = (
                select(GraphNode)
                .where(
                    GraphNode.node_type == NodeType.PLACE.value,
                    GraphNode.is_canonical.is_(True),
                )
                .limit(200)
            )
            result = await self.session.execute(stmt)
            place_nodes = result.scalars().all()

        node_ids = [n.id for n in place_nodes]
        node_id_set = set(node_ids)

        # Fetch edges between these place nodes
        if node_ids:
            edge_conditions = self._edge_time_conditions(
                include_inferred=include_inferred,
                from_ts=resolved_from,
                to_ts=resolved_to,
            )
            edge_stmt = (
                select(GraphEdge)
                .where(
                    GraphEdge.source_node_id.in_(node_ids),
                    GraphEdge.target_node_id.in_(node_ids),
                    *edge_conditions,
                )
            )
            edge_result = await self.session.execute(edge_stmt)
            edges = edge_result.scalars().all()
        else:
            edges = []

        # Count entities per district
        district_counts: dict[str, int] = {}
        if place_nodes:
            district_names = [n.title for n in place_nodes if n.source_table == "districts"]
            if district_names:
                count_stmt = (
                    select(
                        GraphNode.district,
                        func.count(GraphNode.id).label("cnt"),
                    )
                    .where(
                        GraphNode.is_canonical.is_(True),
                        GraphNode.district.in_(district_names),
                        GraphNode.node_type != NodeType.PLACE.value,
                    )
                    .group_by(GraphNode.district)
                )
                count_result = await self.session.execute(count_stmt)
                for row in count_result.all():
                    district_counts[row[0]] = row[1]

        # Total graph size
        total_nodes = (await self.session.execute(
            select(func.count(GraphNode.id)).where(GraphNode.is_canonical.is_(True))
        )).scalar() or 0
        total_edge_conditions = self._edge_time_conditions(
            include_inferred=include_inferred,
            from_ts=resolved_from,
            to_ts=resolved_to,
        )
        total_edges = (await self.session.execute(
            select(func.count(GraphEdge.id)).where(*total_edge_conditions)
        )).scalar() or 0

        # Build Cytoscape-format response
        cy_nodes = []
        for n in place_nodes:
            node_dict: dict[str, Any] = {
                "id": n.id,
                "title": n.title,
                "node_type": n.node_type,
                "district": n.district,
                "province": n.province,
                "latitude": n.latitude,
                "longitude": n.longitude,
                "subtype": n.subtype,
                "source_table": n.source_table,
                "confidence": n.confidence,
                "member_count": district_counts.get(n.title, 0),
            }
            cy_nodes.append(_cy_node(node_dict))

        cy_edges = []
        for e in edges:
            edge_dict = {
                "id": e.id,
                "source_node_id": e.source_node_id,
                "target_node_id": e.target_node_id,
                "predicate": e.predicate,
                "weight": e.weight,
                "confidence": e.confidence,
            }
            cy_edges.append(_cy_edge(edge_dict))

        return {
            "nodes": cy_nodes,
            "edges": cy_edges,
            "rendered_nodes": len(cy_nodes),
            "rendered_edges": len(cy_edges),
            "total_graph_nodes": total_nodes,
            "total_graph_edges": total_edges,
        }

    # ------------------------------------------------------------------
    # 2. Expand node
    # ------------------------------------------------------------------

    async def expand_node(
        self,
        node_id: UUID,
        offset: int = 0,
        limit: int = 50,
        predicates: list[str] | None = None,
        min_confidence: float = 0.0,
        as_of: datetime | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        window: str = "all_time",
        include_inferred: bool = False,
    ) -> dict:
        """Return direct neighbors of a node, paginated.

        For place nodes, returns entities located in that place.
        For person/org nodes, returns connected entities via edges.
        """
        logger.info(
            "Expanding node %s (offset=%d, limit=%d, min_confidence=%.2f)",
            node_id, offset, limit, min_confidence,
        )
        resolved_from, resolved_to = self._resolve_time_range(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
        )

        # Build edge filter conditions
        conditions = self._edge_time_conditions(
            include_inferred=include_inferred,
            min_confidence=min_confidence,
            from_ts=resolved_from,
            to_ts=resolved_to,
        )
        conditions.append(
            or_(
                GraphEdge.source_node_id == node_id,
                GraphEdge.target_node_id == node_id,
            )
        )
        if predicates:
            conditions.append(GraphEdge.predicate.in_(predicates))

        # Count total neighbors first
        count_stmt = (
            select(func.count(GraphEdge.id))
            .where(*conditions)
        )
        total_neighbors = (await self.session.execute(count_stmt)).scalar() or 0

        # Fetch edges with limit
        edge_stmt = (
            select(GraphEdge)
            .where(*conditions)
            .order_by(GraphEdge.weight.desc(), GraphEdge.confidence.desc())
            .offset(offset)
            .limit(limit)
        )
        edge_result = await self.session.execute(edge_stmt)
        edges = edge_result.scalars().all()

        # Collect neighbor IDs
        neighbor_ids: set[UUID] = set()
        for e in edges:
            if e.source_node_id != node_id:
                neighbor_ids.add(e.source_node_id)
            if e.target_node_id != node_id:
                neighbor_ids.add(e.target_node_id)

        # Fetch neighbor nodes (canonical only)
        nodes: list[GraphNode] = []
        if neighbor_ids:
            node_stmt = (
                select(GraphNode)
                .where(
                    GraphNode.id.in_(list(neighbor_ids)),
                    GraphNode.is_canonical.is_(True),
                )
            )
            node_result = await self.session.execute(node_stmt)
            nodes = list(node_result.scalars().all())

        # Also include the center node
        center = await self.session.get(GraphNode, node_id)

        cy_nodes = []
        if center:
            cy_nodes.append(_cy_node({
                "id": center.id,
                "title": center.title,
                "node_type": center.node_type,
                "district": center.district,
                "province": center.province,
                "latitude": center.latitude,
                "longitude": center.longitude,
                "subtype": center.subtype,
                "source_table": center.source_table,
                "confidence": center.confidence,
            }))
        for n in nodes:
            cy_nodes.append(_cy_node({
                "id": n.id,
                "title": n.title,
                "node_type": n.node_type,
                "district": n.district,
                "province": n.province,
                "latitude": n.latitude,
                "longitude": n.longitude,
                "subtype": n.subtype,
                "source_table": n.source_table,
                "confidence": n.confidence,
            }))

        cy_edges = []
        for e in edges:
            cy_edges.append(_cy_edge({
                "id": e.id,
                "source_node_id": e.source_node_id,
                "target_node_id": e.target_node_id,
                "predicate": e.predicate,
                "weight": e.weight,
                "confidence": e.confidence,
                "properties": e.properties,
            }))

        return {
            "nodes": cy_nodes,
            "edges": cy_edges,
            "offset": offset,
            "limit": limit,
            "has_more": total_neighbors > (offset + len(edges)),
            "total_neighbors": total_neighbors,
        }

    # ------------------------------------------------------------------
    # 2b. Resolve source record -> canonical graph node
    # ------------------------------------------------------------------

    async def resolve_node(
        self,
        source_table: str,
        source_id: str,
        canonical_key: str | None = None,
    ) -> dict | None:
        """Resolve an external source record to a canonical graph node."""
        conditions = [
            GraphNode.is_canonical.is_(True),
            GraphNode.source_table == source_table,
            GraphNode.source_id == source_id,
        ]
        if canonical_key:
            conditions.append(GraphNode.canonical_key == canonical_key)

        stmt = (
            select(GraphNode)
            .where(*conditions)
            .order_by(GraphNode.confidence.desc(), GraphNode.updated_at.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        node = result.scalar_one_or_none()
        if not node:
            return None

        return _cy_node({
            "id": node.id,
            "title": node.title,
            "node_type": node.node_type,
            "district": node.district,
            "province": node.province,
            "latitude": node.latitude,
            "longitude": node.longitude,
            "subtype": node.subtype,
            "source_table": node.source_table,
            "source_id": node.source_id,
            "confidence": node.confidence,
            "properties": node.properties,
            "is_canonical": node.is_canonical,
        })

    # ------------------------------------------------------------------
    # 2c. Unified timeline by graph node id
    # ------------------------------------------------------------------

    async def get_node_timeline(self, node_id: UUID, limit: int = 100) -> dict | None:
        """Return timeline events for a unified graph node."""
        center = await self.session.get(GraphNode, node_id)
        if not center or not center.is_canonical:
            return None

        edge_stmt = (
            select(GraphEdge, GraphNode)
            .join(
                GraphNode,
                case(
                    (GraphEdge.source_node_id == node_id, GraphEdge.target_node_id),
                    else_=GraphEdge.source_node_id,
                ) == GraphNode.id,
            )
            .where(
                or_(
                    GraphEdge.source_node_id == node_id,
                    GraphEdge.target_node_id == node_id,
                ),
                GraphEdge.is_current.is_(True),
                GraphNode.is_canonical.is_(True),
            )
            .order_by(
                func.coalesce(
                    GraphEdge.valid_from,
                    GraphEdge.last_seen_at,
                    GraphEdge.first_seen_at,
                    GraphEdge.created_at,
                ).desc()
            )
            .limit(limit)
        )
        result = await self.session.execute(edge_stmt)
        rows = result.all()

        events: list[dict[str, Any]] = []
        for edge, peer in rows:
            timestamp = (
                edge.valid_from
                or edge.last_seen_at
                or edge.first_seen_at
                or edge.created_at
            )
            relation = edge.predicate.replace("_", " ").title()
            direction = "to" if edge.source_node_id == node_id else "from"
            title = f"{relation} {direction} {peer.title}"
            events.append({
                "event_type": peer.node_type or "relationship",
                "timestamp": timestamp.isoformat() if timestamp else None,
                "title": title,
                "object_id": str(peer.id),
                "link_id": str(edge.id),
                "confidence": edge.confidence,
                "source_count": edge.source_count,
                "verification_status": edge.verification_status,
                "provenance_refs": [],
            })

        return {
            "center": {
                "id": str(center.id),
                "title": center.title,
                "object_type": center.node_type,
            },
            "events": events,
            "total": len(events),
        }

    # ------------------------------------------------------------------
    # 2d. Type-aware profile panel payload
    # ------------------------------------------------------------------

    async def get_node_profile(self, node_id: UUID) -> dict | None:
        """Return type-aware profile payload with quality metadata."""
        detail = await self.get_node_detail(node_id)
        if not detail:
            return None

        node_type = detail.get("node_type") or "unknown"
        subtype = (detail.get("properties") or {}).get("subtype") or detail.get("subtype")
        source_table = detail.get("source_table")

        # Determine profile type
        if source_table == "candidates" or subtype == "candidate":
            profile_type = "candidacy"
        elif source_table == "company_registrations" or subtype == "company":
            profile_type = "company"
        elif source_table == "damage_zones" or subtype == "building":
            profile_type = "building"
        elif node_type == NodeType.PERSON.value:
            profile_type = "political_person"
        elif node_type == NodeType.ORGANIZATION.value:
            profile_type = "organization"
        else:
            profile_type = "generic"

        edges = detail.get("edges", []) or []
        by_predicate = Counter([e.get("predicate", "unknown") for e in edges])
        top_neighbors = [
            {
                "peer_id": e.get("peer_id"),
                "peer_title": e.get("peer_title"),
                "peer_type": e.get("peer_type"),
                "predicate": e.get("predicate"),
                "confidence": e.get("confidence", 0.0),
            }
            for e in sorted(edges, key=lambda x: float(x.get("confidence") or 0.0), reverse=True)[:10]
        ]

        properties = detail.get("properties") or {}
        summary: dict[str, Any] = {}
        if profile_type == "company":
            directors = [n for n in top_neighbors if n["predicate"] == EdgePredicate.DIRECTOR_OF.value]
            summary = {
                "pan": properties.get("pan"),
                "registration_number": properties.get("registration_number"),
                "company_type_category": properties.get("company_type_category"),
                "directors": directors,
            }
        elif profile_type == "candidacy":
            summary = {
                "party": properties.get("party"),
                "votes": properties.get("votes"),
                "vote_pct": properties.get("vote_pct"),
                "rank": properties.get("rank"),
                "is_winner": properties.get("is_winner"),
            }
        elif profile_type == "building":
            summary = {
                "severity": properties.get("severity"),
                "damage_percentage": properties.get("damage_percentage"),
                "zone_type": properties.get("zone_type"),
                "confidence": properties.get("confidence", detail.get("confidence")),
            }
        else:
            summary = {
                "party": properties.get("party"),
                "role": properties.get("role"),
                "aliases": properties.get("aliases"),
            }

        required_fields_by_profile = {
            "political_person": ["description", "district", "source_table"],
            "organization": ["district", "source_table"],
            "company": ["source_table", "district", "properties.registration_number"],
            "candidacy": ["source_table", "properties.party"],
            "building": ["source_table", "latitude", "longitude", "properties.severity"],
            "generic": ["source_table"],
        }
        required = required_fields_by_profile.get(profile_type, ["source_table"])
        missing_fields: list[str] = []
        for field in required:
            if field.startswith("properties."):
                p_key = field.split(".", 1)[1]
                if not properties.get(p_key):
                    missing_fields.append(field)
            elif not detail.get(field):
                missing_fields.append(field)

        quality_score = max(0.0, min(1.0, 1.0 - (len(missing_fields) / max(len(required), 1))))
        provenance_count = len({
            e.get("properties", {}).get("source_table")
            for e in edges
            if isinstance(e.get("properties"), dict) and e.get("properties", {}).get("source_table")
        }) + int(detail.get("source_count") or 0)

        return {
            "node": {
                "id": detail["id"],
                "title": detail["title"],
                "node_type": node_type,
                "type": node_type,
                "subtype": detail.get("subtype"),
                "district": detail.get("district"),
                "province": detail.get("province"),
                "latitude": detail.get("latitude"),
                "longitude": detail.get("longitude"),
                "description": detail.get("description"),
                "source_table": source_table,
                "source_id": detail.get("source_id"),
                "properties": properties,
                "confidence": detail.get("confidence", 0.0),
            },
            "profile_type": profile_type,
            "summary": summary,
            "relationships": {
                "total": len(edges),
                "by_predicate": dict(by_predicate),
                "top_neighbors": top_neighbors,
            },
            "quality": {
                "quality_score": round(quality_score, 3),
                "missing_fields": missing_fields,
                "provenance_count": provenance_count,
                "last_updated": detail.get("last_seen_at") or detail.get("created_at"),
            },
        }

    # ------------------------------------------------------------------
    # 3. N-hop neighborhood (recursive CTE)
    # ------------------------------------------------------------------

    async def get_neighborhood(
        self,
        node_id: UUID,
        depth: int = 2,
        limit: int = 100,
        min_confidence: float = 0.0,
        node_types: list[str] | None = None,
        as_of: datetime | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        window: str = "all_time",
        include_inferred: bool = False,
    ) -> dict:
        """N-hop ego network using recursive CTE with cycle prevention.

        Uses ``WITH RECURSIVE`` to traverse edges up to *depth* hops from
        the seed node.  A ``path UUID[]`` column prevents revisiting nodes.
        Only canonical nodes and current edges are included.
        """
        logger.info("Neighborhood for %s (depth=%d, limit=%d)", node_id, depth, limit)
        resolved_from, resolved_to = self._resolve_time_range(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
        )

        # The recursive CTE uses a per-depth expansion cap (:per_depth_cap) to
        # prevent the working set from growing unbounded on hub nodes (HIGH-2).
        # Without this, a depth-3 traversal from Kathmandu (~30K edges at depth 1)
        # could generate millions of intermediate rows before the final LIMIT.
        # The cap is applied via ROW_NUMBER() OVER (PARTITION BY depth) in a
        # wrapping subquery, limiting each depth level to at most per_depth_cap rows.
        per_depth_cap = min(limit * 5, 5000)  # generous but bounded

        sql = text("""
            WITH RECURSIVE traversal AS (
                -- Seed: the starting node
                SELECT
                    :seed_id::uuid AS node_id,
                    ARRAY[:seed_id::uuid] AS path,
                    0 AS depth

                UNION ALL

                -- Expand: follow edges in both directions, capped per depth level (HIGH-2)
                SELECT sub.node_id, sub.path, sub.depth
                FROM (
                    SELECT
                        CASE
                            WHEN ge.source_node_id = t.node_id THEN ge.target_node_id
                            ELSE ge.source_node_id
                        END AS node_id,
                        t.path || CASE
                            WHEN ge.source_node_id = t.node_id THEN ge.target_node_id
                            ELSE ge.source_node_id
                        END AS path,
                        t.depth + 1 AS depth,
                        ROW_NUMBER() OVER (ORDER BY ge.weight DESC) AS rn
                    FROM traversal t
                    JOIN graph_edges ge ON (
                        ge.source_node_id = t.node_id
                        OR ge.target_node_id = t.node_id
                    )
                    JOIN graph_nodes gn ON gn.id = CASE
                        WHEN ge.source_node_id = t.node_id THEN ge.target_node_id
                        ELSE ge.source_node_id
                    END
                    WHERE t.depth < :max_depth
                      AND ge.is_current = true
                      AND ge.confidence >= :min_conf
                      AND (:include_inferred OR COALESCE(ge.properties->>'inferred', 'false') <> 'true')
                      AND (:from_ts IS NULL OR COALESCE(ge.valid_to, ge.last_seen_at) IS NULL OR COALESCE(ge.valid_to, ge.last_seen_at) >= :from_ts)
                      AND (:to_ts IS NULL OR COALESCE(ge.valid_from, ge.first_seen_at, ge.created_at) <= :to_ts)
                      AND gn.is_canonical = true
                      AND (:node_types_is_null OR gn.node_type = ANY(CAST(:node_types AS text[])))
                      AND NOT (
                        CASE
                            WHEN ge.source_node_id = t.node_id THEN ge.target_node_id
                            ELSE ge.source_node_id
                        END = ANY(t.path)
                      )
                ) sub
                WHERE sub.rn <= :per_depth_cap
            )
            SELECT DISTINCT node_id, MIN(depth) AS min_depth
            FROM traversal
            GROUP BY node_id
            ORDER BY min_depth, node_id
            LIMIT :lim
        """)

        result = await self.session.execute(sql, {
            "seed_id": str(node_id),
            "max_depth": depth,
            "min_conf": min_confidence,
            "lim": limit,
            "per_depth_cap": per_depth_cap,
            "include_inferred": include_inferred,
            "from_ts": resolved_from,
            "to_ts": resolved_to,
            "node_types": node_types or [],
            "node_types_is_null": not bool(node_types),
        })
        rows = result.all()

        visited_ids = [UUID(str(r[0])) for r in rows]
        depth_reached = max((r[1] for r in rows), default=0)

        if not visited_ids:
            return {"nodes": [], "edges": [], "depth_reached": 0}

        # Fetch nodes
        node_stmt = (
            select(GraphNode)
            .where(GraphNode.id.in_(visited_ids), GraphNode.is_canonical.is_(True))
        )
        node_result = await self.session.execute(node_stmt)
        nodes = node_result.scalars().all()

        # Fetch edges between visited nodes
        edge_stmt = (
            select(GraphEdge)
            .where(
                GraphEdge.source_node_id.in_(visited_ids),
                GraphEdge.target_node_id.in_(visited_ids),
                *self._edge_time_conditions(
                    include_inferred=include_inferred,
                    min_confidence=min_confidence,
                    from_ts=resolved_from,
                    to_ts=resolved_to,
                ),
            )
        )
        edge_result = await self.session.execute(edge_stmt)
        edges = edge_result.scalars().all()

        cy_nodes = [
            _cy_node({
                "id": n.id, "title": n.title, "node_type": n.node_type,
                "district": n.district, "province": n.province,
                "latitude": n.latitude, "longitude": n.longitude,
                "subtype": n.subtype, "source_table": n.source_table,
                "confidence": n.confidence,
            })
            for n in nodes
        ]
        cy_edges = [
            _cy_edge({
                "id": e.id, "source_node_id": e.source_node_id,
                "target_node_id": e.target_node_id, "predicate": e.predicate,
                "weight": e.weight, "confidence": e.confidence,
                "properties": e.properties,
            })
            for e in edges
        ]

        return {
            "nodes": cy_nodes,
            "edges": cy_edges,
            "depth_reached": depth_reached,
        }

    # ------------------------------------------------------------------
    # 4. Shortest path (bidirectional BFS)
    # ------------------------------------------------------------------

    async def find_shortest_path(
        self,
        from_id: UUID,
        to_id: UUID,
        max_depth: int = 5,
    ) -> dict:
        """Bidirectional BFS shortest path using recursive CTE.

        Expands from the source node and checks at each depth whether the
        target has been reached.  Returns the path as ordered node/edge IDs.
        """
        logger.info("Finding shortest path from %s to %s (max_depth=%d)", from_id, to_id, max_depth)

        # Forward BFS from source
        sql = text("""
            WITH RECURSIVE fwd AS (
                SELECT
                    :from_id::uuid AS node_id,
                    ARRAY[:from_id::uuid] AS path,
                    ARRAY[]::uuid[] AS edge_path,
                    0 AS depth

                UNION ALL

                SELECT
                    CASE
                        WHEN ge.source_node_id = f.node_id THEN ge.target_node_id
                        ELSE ge.source_node_id
                    END,
                    f.path || CASE
                        WHEN ge.source_node_id = f.node_id THEN ge.target_node_id
                        ELSE ge.source_node_id
                    END,
                    f.edge_path || ge.id,
                    f.depth + 1
                FROM fwd f
                JOIN graph_edges ge ON (
                    ge.source_node_id = f.node_id
                    OR ge.target_node_id = f.node_id
                )
                JOIN graph_nodes gn ON gn.id = CASE
                    WHEN ge.source_node_id = f.node_id THEN ge.target_node_id
                    ELSE ge.source_node_id
                END
                WHERE f.depth < :max_depth
                  AND ge.is_current = true
                  AND gn.is_canonical = true
                  AND NOT (
                    CASE
                        WHEN ge.source_node_id = f.node_id THEN ge.target_node_id
                        ELSE ge.source_node_id
                    END = ANY(f.path)
                  )
            )
            SELECT path, edge_path, depth
            FROM fwd
            WHERE node_id = :to_id
            ORDER BY depth
            LIMIT 1
        """)

        result = await self.session.execute(sql, {
            "from_id": str(from_id),
            "to_id": str(to_id),
            "max_depth": max_depth,
        })
        row = result.first()

        if row is None:
            return {"path": [], "edges": [], "length": -1, "found": False}

        path_uuids = [str(uid) for uid in row[0]]
        edge_uuids = [str(uid) for uid in row[1]]

        return {
            "path": path_uuids,
            "edges": edge_uuids,
            "length": row[2],
            "found": True,
        }

    # ------------------------------------------------------------------
    # 5. Search nodes
    # ------------------------------------------------------------------

    async def search_nodes(
        self,
        query: str,
        node_types: list[str] | None = None,
        districts: list[str] | None = None,
        limit: int = 50,
    ) -> dict:
        """Full-text search across graph_nodes.title using ILIKE.

        Filters by node_type and district.  Includes basic edge counts.
        """
        logger.info("Searching graph nodes: q=%s, types=%s, districts=%s", query, node_types, districts)

        # Escape LIKE metacharacters to prevent injection via % or _ in user input
        safe_query = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{safe_query}%"
        conditions = [
            GraphNode.is_canonical.is_(True),
            or_(
                GraphNode.title.ilike(pattern),
                GraphNode.canonical_key.ilike(pattern),
            ),
        ]
        if node_types:
            conditions.append(GraphNode.node_type.in_(node_types))
        if districts:
            conditions.append(GraphNode.district.in_(districts))

        # Count total matching
        count_stmt = select(func.count(GraphNode.id)).where(*conditions)
        total = (await self.session.execute(count_stmt)).scalar() or 0

        # Fetch nodes
        stmt = (
            select(GraphNode)
            .where(*conditions)
            .order_by(GraphNode.confidence.desc(), GraphNode.title)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        nodes = result.scalars().all()

        # Fetch edge counts for these nodes
        node_ids = [n.id for n in nodes]
        edge_counts: dict[UUID, int] = {}
        if node_ids:
            edge_count_stmt = (
                select(
                    GraphEdge.source_node_id,
                    func.count(GraphEdge.id).label("cnt"),
                )
                .where(
                    GraphEdge.source_node_id.in_(node_ids),
                    GraphEdge.is_current.is_(True),
                )
                .group_by(GraphEdge.source_node_id)
            )
            ec_result = await self.session.execute(edge_count_stmt)
            for row in ec_result.all():
                edge_counts[row[0]] = row[1]

            # Also count incoming edges
            edge_count_in = (
                select(
                    GraphEdge.target_node_id,
                    func.count(GraphEdge.id).label("cnt"),
                )
                .where(
                    GraphEdge.target_node_id.in_(node_ids),
                    GraphEdge.is_current.is_(True),
                )
                .group_by(GraphEdge.target_node_id)
            )
            ec_in_result = await self.session.execute(edge_count_in)
            for row in ec_in_result.all():
                edge_counts[row[0]] = edge_counts.get(row[0], 0) + row[1]

        cy_nodes = []
        for n in nodes:
            node_dict: dict[str, Any] = {
                "id": n.id,
                "title": n.title,
                "node_type": n.node_type,
                "district": n.district,
                "province": n.province,
                "latitude": n.latitude,
                "longitude": n.longitude,
                "subtype": n.subtype,
                "source_table": n.source_table,
                "confidence": n.confidence,
                "edge_count": edge_counts.get(n.id, 0),
            }
            cy_nodes.append(_cy_node(node_dict))

        return {"nodes": cy_nodes, "total": total}

    # ------------------------------------------------------------------
    # 6. Stats
    # ------------------------------------------------------------------

    async def get_stats(
        self,
        *,
        as_of: datetime | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        window: str = "all_time",
        include_inferred: bool = False,
    ) -> dict:
        """Return total counts by node_type, edge predicate, and district."""
        logger.info("Computing graph stats")
        resolved_from, resolved_to = self._resolve_time_range(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
        )
        edge_conditions = self._edge_time_conditions(
            include_inferred=include_inferred,
            from_ts=resolved_from,
            to_ts=resolved_to,
        )

        # Total counts
        total_nodes = (await self.session.execute(
            select(func.count(GraphNode.id)).where(GraphNode.is_canonical.is_(True))
        )).scalar() or 0
        total_edges = (await self.session.execute(
            select(func.count(GraphEdge.id)).where(*edge_conditions)
        )).scalar() or 0

        # By node type
        by_type_stmt = (
            select(GraphNode.node_type, func.count(GraphNode.id))
            .where(GraphNode.is_canonical.is_(True))
            .group_by(GraphNode.node_type)
            .order_by(func.count(GraphNode.id).desc())
        )
        by_type_result = await self.session.execute(by_type_stmt)
        by_type = {row[0]: row[1] for row in by_type_result.all()}

        # By predicate
        by_pred_stmt = (
            select(GraphEdge.predicate, func.count(GraphEdge.id))
            .where(*edge_conditions)
            .group_by(GraphEdge.predicate)
            .order_by(func.count(GraphEdge.id).desc())
        )
        by_pred_result = await self.session.execute(by_pred_stmt)
        by_predicate = {row[0]: row[1] for row in by_pred_result.all()}

        # By district (top 20)
        by_dist_stmt = (
            select(GraphNode.district, func.count(GraphNode.id))
            .where(
                GraphNode.is_canonical.is_(True),
                GraphNode.district.isnot(None),
            )
            .group_by(GraphNode.district)
            .order_by(func.count(GraphNode.id).desc())
            .limit(20)
        )
        by_dist_result = await self.session.execute(by_dist_stmt)
        by_district = {row[0]: row[1] for row in by_dist_result.all()}

        return {
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "by_type": by_type,
            "by_predicate": by_predicate,
            "by_district": by_district,
        }

    async def get_health(self) -> dict:
        """Graph connectivity and domain coverage health metrics."""
        total_nodes = (
            await self.session.execute(
                select(func.count(GraphNode.id)).where(GraphNode.is_canonical.is_(True))
            )
        ).scalar() or 0
        total_edges = (
            await self.session.execute(
                select(func.count(GraphEdge.id)).where(GraphEdge.is_current.is_(True))
            )
        ).scalar() or 0

        connected_nodes_sql = text(
            """
            SELECT COUNT(*) AS connected_nodes
            FROM graph_nodes gn
            WHERE gn.is_canonical = true
              AND EXISTS (
                SELECT 1
                FROM graph_edges ge
                WHERE ge.is_current = true
                  AND COALESCE(ge.properties->>'inferred', 'false') <> 'true'
                  AND (ge.source_node_id = gn.id OR ge.target_node_id = gn.id)
              )
            """
        )
        connected_nodes = (await self.session.execute(connected_nodes_sql)).scalar() or 0
        connected_node_ratio = (connected_nodes / total_nodes) if total_nodes else 0.0

        # Approximate largest component ratio using bidirectional closure from top-degree seeds.
        largest_component_nodes = 0
        seed_rows = await self.session.execute(
            text(
                """
                WITH degrees AS (
                    SELECT node_id, COUNT(*) AS degree
                    FROM (
                        SELECT source_node_id AS node_id
                        FROM graph_edges
                        WHERE is_current = true
                          AND COALESCE(properties->>'inferred', 'false') <> 'true'
                        UNION ALL
                        SELECT target_node_id AS node_id
                        FROM graph_edges
                        WHERE is_current = true
                          AND COALESCE(properties->>'inferred', 'false') <> 'true'
                    ) d
                    GROUP BY node_id
                )
                SELECT node_id
                FROM degrees
                ORDER BY degree DESC
                LIMIT 10
                """
            )
        )
        seed_ids = [str(r[0]) for r in seed_rows.all()]
        for seed_id in seed_ids:
            comp_result = await self.session.execute(
                text(
                    """
                    WITH RECURSIVE cc AS (
                        SELECT :seed::uuid AS node_id
                        UNION
                        SELECT
                            CASE
                                WHEN ge.source_node_id = cc.node_id THEN ge.target_node_id
                                ELSE ge.source_node_id
                            END AS node_id
                        FROM cc
                        JOIN graph_edges ge
                          ON ge.is_current = true
                         AND COALESCE(ge.properties->>'inferred', 'false') <> 'true'
                         AND (ge.source_node_id = cc.node_id OR ge.target_node_id = cc.node_id)
                    )
                    SELECT COUNT(DISTINCT node_id) FROM cc
                    """
                ),
                {"seed": seed_id},
            )
            comp_size = int(comp_result.scalar() or 0)
            if comp_size > largest_component_nodes:
                largest_component_nodes = comp_size
        largest_component_ratio = (largest_component_nodes / total_nodes) if total_nodes else 0.0

        # Domain coverage from materialized view, fallback to direct query if MV absent.
        domain_rows: list[dict[str, Any]] = []
        try:
            mv_rows = await self.session.execute(
                text(
                    """
                    SELECT source_table, total_nodes, connected_nodes, coverage_ratio
                    FROM graph_domain_connectivity_mv
                    ORDER BY total_nodes DESC
                    """
                )
            )
            domain_rows = [
                {
                    "source_table": row[0],
                    "total_nodes": int(row[1] or 0),
                    "connected_nodes": int(row[2] or 0),
                    "coverage_ratio": float(row[3] or 0.0),
                }
                for row in mv_rows.all()
            ]
        except Exception:
            fallback_rows = await self.session.execute(
                text(
                    """
                    WITH connected_nodes AS (
                        SELECT source_node_id AS node_id
                        FROM graph_edges
                        WHERE is_current = true
                          AND COALESCE(properties->>'inferred', 'false') <> 'true'
                        UNION
                        SELECT target_node_id AS node_id
                        FROM graph_edges
                        WHERE is_current = true
                          AND COALESCE(properties->>'inferred', 'false') <> 'true'
                    ),
                    domain_counts AS (
                        SELECT source_table, COUNT(*) AS total_nodes
                        FROM graph_nodes
                        WHERE is_canonical = true
                        GROUP BY source_table
                    ),
                    connected_counts AS (
                        SELECT gn.source_table, COUNT(*) AS connected_nodes
                        FROM graph_nodes gn
                        JOIN connected_nodes cn ON cn.node_id = gn.id
                        WHERE gn.is_canonical = true
                        GROUP BY gn.source_table
                    )
                    SELECT
                        dc.source_table,
                        dc.total_nodes,
                        COALESCE(cc.connected_nodes, 0) AS connected_nodes,
                        CASE
                            WHEN dc.total_nodes = 0 THEN 0
                            ELSE ROUND((COALESCE(cc.connected_nodes, 0)::numeric / dc.total_nodes::numeric), 6)
                        END AS coverage_ratio
                    FROM domain_counts dc
                    LEFT JOIN connected_counts cc USING (source_table)
                    ORDER BY dc.total_nodes DESC
                    """
                )
            )
            domain_rows = [
                {
                    "source_table": row[0],
                    "total_nodes": int(row[1] or 0),
                    "connected_nodes": int(row[2] or 0),
                    "coverage_ratio": float(row[3] or 0.0),
                }
                for row in fallback_rows.all()
            ]

        thresholds_breached: list[str] = []
        if connected_node_ratio < 0.75:
            thresholds_breached.append("connected_node_ratio<0.75")
        if largest_component_ratio < 0.40:
            thresholds_breached.append("largest_component_ratio<0.40")
        low_coverage_domains = [d for d in domain_rows if d["total_nodes"] >= 100 and d["coverage_ratio"] < 0.30]
        if low_coverage_domains:
            thresholds_breached.append("domain_coverage<0.30_for_large_domains")

        return {
            "status": "healthy" if not thresholds_breached else "degraded",
            "total_nodes": int(total_nodes),
            "total_edges": int(total_edges),
            "connected_node_ratio": round(float(connected_node_ratio), 6),
            "largest_component_ratio": round(float(largest_component_ratio), 6),
            "per_domain_coverage": domain_rows,
            "thresholds_breached": thresholds_breached,
        }

    async def get_timeseries(
        self,
        *,
        bucket: str = "day",
        as_of: datetime | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        window: str = "30d",
        include_inferred: bool = False,
    ) -> dict:
        """Temporal edge counts by predicate and source domain."""
        normalized_bucket = bucket.strip().lower()
        if normalized_bucket not in {"hour", "day", "week"}:
            raise ValueError("Invalid bucket. Must be one of: hour, day, week")
        resolved_from, resolved_to = self._resolve_time_range(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
        )

        sql = text(
            f"""
            SELECT
                date_trunc('{normalized_bucket}', COALESCE(ge.valid_from, ge.first_seen_at, ge.created_at)) AS bucket_start,
                ge.predicate,
                gn.source_table,
                COUNT(*) AS edge_count
            FROM graph_edges ge
            JOIN graph_nodes gn ON gn.id = ge.source_node_id
            WHERE ge.is_current = true
              AND gn.is_canonical = true
              AND (:include_inferred OR COALESCE(ge.properties->>'inferred', 'false') <> 'true')
              AND (:from_ts IS NULL OR COALESCE(ge.valid_to, ge.last_seen_at) IS NULL OR COALESCE(ge.valid_to, ge.last_seen_at) >= :from_ts)
              AND (:to_ts IS NULL OR COALESCE(ge.valid_from, ge.first_seen_at, ge.created_at) <= :to_ts)
            GROUP BY 1, 2, 3
            ORDER BY 1 ASC
            """
        )
        rows = await self.session.execute(
            sql,
            {
                "include_inferred": include_inferred,
                "from_ts": resolved_from,
                "to_ts": resolved_to,
            },
        )

        grouped: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"total_edges": 0, "by_predicate": defaultdict(int), "by_domain": defaultdict(int)}
        )
        for bucket_start, predicate, source_table, edge_count in rows.all():
            bucket_key = bucket_start.isoformat() if bucket_start else "unknown"
            grouped[bucket_key]["total_edges"] += int(edge_count or 0)
            grouped[bucket_key]["by_predicate"][predicate] += int(edge_count or 0)
            grouped[bucket_key]["by_domain"][source_table] += int(edge_count or 0)

        series = [
            {
                "bucket_start": bucket_start,
                "total_edges": payload["total_edges"],
                "by_predicate": dict(payload["by_predicate"]),
                "by_domain": dict(payload["by_domain"]),
            }
            for bucket_start, payload in sorted(grouped.items(), key=lambda item: item[0])
        ]
        return {
            "window": self._normalize_window(window),
            "bucket": normalized_bucket,
            "from_ts": resolved_from.isoformat() if resolved_from else None,
            "to_ts": resolved_to.isoformat() if resolved_to else None,
            "series": series,
        }

    # ------------------------------------------------------------------
    # 7. Node detail
    # ------------------------------------------------------------------

    async def get_node_detail(
        self,
        node_id: UUID,
        *,
        as_of: datetime | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        window: str = "all_time",
        include_inferred: bool = False,
    ) -> dict | None:
        """Full detail for a single node including edges, metrics, resolution history."""
        logger.info("Getting node detail for %s", node_id)
        resolved_from, resolved_to = self._resolve_time_range(
            as_of=as_of,
            from_ts=from_ts,
            to_ts=to_ts,
            window=window,
        )
        edge_conditions = self._edge_time_conditions(
            include_inferred=include_inferred,
            from_ts=resolved_from,
            to_ts=resolved_to,
        )

        node = await self.session.get(GraphNode, node_id)
        if not node:
            return None

        # Fetch all edges (limited)
        out_edges_stmt = (
            select(GraphEdge)
            .where(GraphEdge.source_node_id == node_id, *edge_conditions)
            .order_by(GraphEdge.weight.desc())
            .limit(100)
        )
        in_edges_stmt = (
            select(GraphEdge)
            .where(GraphEdge.target_node_id == node_id, *edge_conditions)
            .order_by(GraphEdge.weight.desc())
            .limit(100)
        )
        out_result = await self.session.execute(out_edges_stmt)
        in_result = await self.session.execute(in_edges_stmt)
        out_edges = out_result.scalars().all()
        in_edges = in_result.scalars().all()

        # Collect neighbor IDs
        neighbor_ids: set[UUID] = set()
        for e in out_edges:
            neighbor_ids.add(e.target_node_id)
        for e in in_edges:
            neighbor_ids.add(e.source_node_id)

        # Fetch neighbor nodes
        neighbors: dict[UUID, GraphNode] = {}
        if neighbor_ids:
            n_stmt = select(GraphNode).where(GraphNode.id.in_(list(neighbor_ids)))
            n_result = await self.session.execute(n_stmt)
            neighbors = {n.id: n for n in n_result.scalars().all()}

        # Fetch metrics
        metrics_stmt = select(GraphNodeMetrics).where(GraphNodeMetrics.node_id == node_id)
        metrics_result = await self.session.execute(metrics_stmt)
        metrics_rows = metrics_result.scalars().all()

        # Fetch resolution history
        resolutions_stmt = (
            select(EntityResolution)
            .where(
                or_(
                    EntityResolution.canonical_node_id == node_id,
                    EntityResolution.merged_node_id == node_id,
                )
            )
            .order_by(EntityResolution.resolved_at.desc().nullslast())
        )
        res_result = await self.session.execute(resolutions_stmt)
        resolutions = res_result.scalars().all()

        current_relation_count = len(out_edges) + len(in_edges)
        temporal_profile: dict[str, Any] = {
            "window": self._normalize_window(window),
            "first_seen_at": node.first_seen_at.isoformat() if node.first_seen_at else None,
            "last_seen_at": node.last_seen_at.isoformat() if node.last_seen_at else None,
            "active_relation_count": current_relation_count,
            "delta_vs_previous_window": None,
        }
        if temporal_profile["window"] != "all_time" and resolved_from and resolved_to:
            previous_from = resolved_from - (resolved_to - resolved_from)
            previous_to = resolved_from
            previous_conditions = self._edge_time_conditions(
                include_inferred=include_inferred,
                from_ts=previous_from,
                to_ts=previous_to,
            )
            previous_count = (
                await self.session.execute(
                    select(func.count(GraphEdge.id)).where(
                        or_(
                            GraphEdge.source_node_id == node_id,
                            GraphEdge.target_node_id == node_id,
                        ),
                        *previous_conditions,
                    )
                )
            ).scalar() or 0
            temporal_profile["delta_vs_previous_window"] = current_relation_count - int(previous_count)

        # Build response
        def _edge_detail(e: GraphEdge, is_outgoing: bool) -> dict:
            peer_id = e.target_node_id if is_outgoing else e.source_node_id
            peer = neighbors.get(peer_id)
            return {
                "id": str(e.id),
                "predicate": e.predicate,
                "direction": "outgoing" if is_outgoing else "incoming",
                "peer_id": str(peer_id),
                "peer_title": peer.title if peer else None,
                "peer_type": peer.node_type if peer else None,
                "weight": e.weight,
                "confidence": e.confidence,
                "valid_from": e.valid_from.isoformat() if e.valid_from else None,
                "valid_to": e.valid_to.isoformat() if e.valid_to else None,
                "properties": e.properties or {},
            }

        return {
            "id": str(node.id),
            "node_type": node.node_type,
            "type": node.node_type,
            "canonical_key": node.canonical_key,
            "title": node.title,
            "title_ne": node.title_ne,
            "subtitle": node.subtitle,
            "description": node.description,
            "subtype": node.subtype,
            "district": node.district,
            "province": node.province,
            "latitude": node.latitude,
            "longitude": node.longitude,
            "properties": _strip_pii(node.properties),
            "source_table": node.source_table,
            "source_id": node.source_id,
            "confidence": node.confidence,
            "source_count": node.source_count,
            "is_canonical": node.is_canonical,
            "canonical_node_id": str(node.canonical_node_id) if node.canonical_node_id else None,
            "first_seen_at": node.first_seen_at.isoformat() if node.first_seen_at else None,
            "last_seen_at": node.last_seen_at.isoformat() if node.last_seen_at else None,
            "created_at": node.created_at.isoformat() if node.created_at else None,
            "edges": (
                [_edge_detail(e, True) for e in out_edges]
                + [_edge_detail(e, False) for e in in_edges]
            ),
            "total_outgoing": len(out_edges),
            "total_incoming": len(in_edges),
            "temporal_profile": temporal_profile,
            "metrics": [
                {
                    "window_type": m.window_type,
                    "degree": m.degree,
                    "in_degree": m.in_degree,
                    "out_degree": m.out_degree,
                    "pagerank": m.pagerank,
                    "betweenness": m.betweenness,
                    "is_hub": m.is_hub,
                    "is_bridge": m.is_bridge,
                    "influence_rank": m.influence_rank,
                    "computed_at": m.computed_at.isoformat() if m.computed_at else None,
                }
                for m in metrics_rows
            ],
            "resolutions": [
                {
                    "id": str(r.id),
                    "canonical_node_id": str(r.canonical_node_id),
                    "merged_node_id": str(r.merged_node_id),
                    "match_method": r.match_method,
                    "confidence": r.confidence,
                    "is_auto": r.is_auto,
                    "is_active": r.is_active,
                    "rationale": r.rationale,
                    "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
                }
                for r in resolutions
            ],
        }

    # ------------------------------------------------------------------
    # 8. List districts
    # ------------------------------------------------------------------

    async def list_districts(self) -> dict:
        """Return all districts with their graph node IDs and member counts.

        Used for district filter dropdowns and geographic layer initialization.
        """
        logger.info("Fetching district list")

        # Fetch all districts from reference table
        stmt = select(District).order_by(District.province_id, District.name_en)
        result = await self.session.execute(stmt)
        districts_rows = result.scalars().all()

        # Count entities per district
        count_stmt = (
            select(
                GraphNode.district,
                func.count(GraphNode.id).label("cnt"),
            )
            .where(
                GraphNode.is_canonical.is_(True),
                GraphNode.district.isnot(None),
                GraphNode.node_type != NodeType.PLACE.value,
            )
            .group_by(GraphNode.district)
        )
        count_result = await self.session.execute(count_stmt)
        district_counts = {row[0]: row[1] for row in count_result.all()}

        districts_list = []
        for d in districts_rows:
            districts_list.append({
                "id": str(d.id),
                "name_en": d.name_en,
                "name_ne": d.name_ne,
                "province_id": d.province_id,
                "province_name": d.province_name,
                "graph_node_id": str(d.graph_node_id) if d.graph_node_id else None,
                "node_count": district_counts.get(d.name_en, 0),
                "latitude": d.latitude,
                "longitude": d.longitude,
            })

        return {"districts": districts_list, "total": len(districts_list)}
