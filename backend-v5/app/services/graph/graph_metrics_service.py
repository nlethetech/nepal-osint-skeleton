"""Graph metrics service for the NARADA unified graph.

Computes and stores precomputed network analytics metrics:
  - Degree (in/out/total) for all canonical nodes
  - PageRank using NetworkX
  - Hub and bridge detection (top 5% by degree / betweenness)

Metrics are stored in ``graph_node_metrics`` table, keyed by ``(node_id, window_type)``.
Designed to be run periodically as a background job.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import (
    GraphNode,
    GraphEdge,
    GraphNodeMetrics,
    MetricWindow,
)

logger = logging.getLogger(__name__)

try:
    import networkx as nx

    NETWORKX_AVAILABLE = True
except ImportError:
    NETWORKX_AVAILABLE = False
    nx = None  # type: ignore[assignment]
    logger.warning("networkx not available; PageRank and betweenness will be skipped")


class GraphMetricsService:
    """Async service for computing graph metrics on the NARADA unified graph."""

    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # 1. Degree metrics
    # ------------------------------------------------------------------

    async def compute_degree_metrics(self, window_type: str = MetricWindow.ALL_TIME.value) -> dict:
        """Compute in/out/total degree for all canonical nodes.

        Uses two aggregate queries (outgoing and incoming edge counts) then
        upserts into ``graph_node_metrics``.
        """
        logger.info("Computing degree metrics for window=%s", window_type)
        now = datetime.now(timezone.utc)

        # Outgoing degree
        out_stmt = (
            select(
                GraphEdge.source_node_id.label("node_id"),
                func.count(GraphEdge.id).label("out_degree"),
            )
            .where(GraphEdge.is_current.is_(True))
            .group_by(GraphEdge.source_node_id)
        )
        out_result = await self.session.execute(out_stmt)
        out_degrees: dict[UUID, int] = {row[0]: row[1] for row in out_result.all()}

        # Incoming degree
        in_stmt = (
            select(
                GraphEdge.target_node_id.label("node_id"),
                func.count(GraphEdge.id).label("in_degree"),
            )
            .where(GraphEdge.is_current.is_(True))
            .group_by(GraphEdge.target_node_id)
        )
        in_result = await self.session.execute(in_stmt)
        in_degrees: dict[UUID, int] = {row[0]: row[1] for row in in_result.all()}

        # Union of all node IDs
        all_node_ids = set(out_degrees.keys()) | set(in_degrees.keys())

        # Filter to canonical nodes only
        if all_node_ids:
            canonical_stmt = (
                select(GraphNode.id)
                .where(
                    GraphNode.id.in_(list(all_node_ids)),
                    GraphNode.is_canonical.is_(True),
                )
            )
            canonical_result = await self.session.execute(canonical_stmt)
            canonical_ids = {row[0] for row in canonical_result.all()}
        else:
            canonical_ids = set()

        # Upsert metrics
        upserted = 0
        for node_id in canonical_ids:
            out_deg = out_degrees.get(node_id, 0)
            in_deg = in_degrees.get(node_id, 0)
            total_deg = out_deg + in_deg

            stmt = pg_insert(GraphNodeMetrics).values(
                id=uuid4(),
                node_id=node_id,
                window_type=window_type,
                degree=total_deg,
                in_degree=in_deg,
                out_degree=out_deg,
                computed_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_gnm_node_window",
                set_={
                    "degree": total_deg,
                    "in_degree": in_deg,
                    "out_degree": out_deg,
                    "computed_at": now,
                },
            )
            await self.session.execute(stmt)
            upserted += 1

        await self.session.flush()
        logger.info("Degree metrics computed: %d nodes updated", upserted)
        return {"nodes_updated": upserted, "window_type": window_type}

    # ------------------------------------------------------------------
    # 2. PageRank
    # ------------------------------------------------------------------

    async def compute_pagerank(
        self,
        window_type: str = MetricWindow.ALL_TIME.value,
        damping: float = 0.85,
        iterations: int = 50,
    ) -> dict:
        """Compute PageRank using NetworkX on the full canonical graph.

        For ~180K nodes, NetworkX is feasible (~2-5 sec).  The graph is loaded
        as a DiGraph with edge weights, then PageRank is computed and bulk-updated
        into ``graph_node_metrics``.
        """
        if not NETWORKX_AVAILABLE:
            logger.warning("NetworkX not available; skipping PageRank computation")
            return {"error": "networkx not installed"}

        logger.info("Computing PageRank (damping=%.2f, iterations=%d, window=%s)", damping, iterations, window_type)
        now = datetime.now(timezone.utc)

        # Load graph into NetworkX
        G = await self._build_networkx_graph()

        if G.number_of_nodes() == 0:
            logger.warning("Empty graph; skipping PageRank")
            return {"nodes": 0, "edges": 0}

        logger.info("NetworkX graph built: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())

        # Compute PageRank
        try:
            pr = nx.pagerank(G, alpha=damping, max_iter=iterations, weight="weight")
        except Exception as e:
            logger.error("PageRank computation failed: %s", e)
            return {"error": str(e)}

        # Bulk update metrics
        updated = 0
        for node_id_str, score in pr.items():
            try:
                node_id = UUID(node_id_str)
                stmt = pg_insert(GraphNodeMetrics).values(
                    id=uuid4(),
                    node_id=node_id,
                    window_type=window_type,
                    pagerank=score,
                    computed_at=now,
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_gnm_node_window",
                    set_={
                        "pagerank": score,
                        "computed_at": now,
                    },
                )
                await self.session.execute(stmt)
                updated += 1
            except Exception as e:
                logger.warning("Error updating PageRank for node %s: %s", node_id_str, e)

        await self.session.flush()
        logger.info("PageRank computed: %d nodes updated", updated)
        return {"nodes_updated": updated, "window_type": window_type}

    # ------------------------------------------------------------------
    # 3. Hubs and bridges
    # ------------------------------------------------------------------

    async def detect_hubs_and_bridges(self, window_type: str = MetricWindow.ALL_TIME.value) -> dict:
        """Mark top 5% by degree as hubs and top 5% by betweenness as bridges.

        Uses NetworkX for betweenness centrality (with sampling for large graphs).
        """
        if not NETWORKX_AVAILABLE:
            logger.warning("NetworkX not available; skipping hub/bridge detection")
            return {"error": "networkx not installed"}

        logger.info("Detecting hubs and bridges (window=%s)", window_type)
        now = datetime.now(timezone.utc)

        G = await self._build_networkx_graph()

        if G.number_of_nodes() == 0:
            return {"hubs": 0, "bridges": 0}

        # Degree for hub detection
        degrees = dict(G.degree(weight="weight"))
        total_nodes = len(degrees)
        top_5pct_count = max(1, total_nodes // 20)

        # Top 5% by degree -> hubs
        sorted_by_degree = sorted(degrees.items(), key=lambda x: x[1], reverse=True)
        hub_threshold = sorted_by_degree[min(top_5pct_count - 1, len(sorted_by_degree) - 1)][1]
        hub_ids = {nid for nid, deg in degrees.items() if deg >= hub_threshold}

        # Betweenness for bridge detection (sample for large graphs)
        try:
            k = min(200, G.number_of_nodes())
            betweenness = nx.betweenness_centrality(G, weight="weight", k=k)
        except Exception as e:
            logger.warning("Betweenness computation failed: %s", e)
            betweenness = {}

        bridge_ids: set[str] = set()
        if betweenness:
            sorted_by_betweenness = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)
            bridge_threshold = sorted_by_betweenness[min(top_5pct_count - 1, len(sorted_by_betweenness) - 1)][1]
            bridge_ids = {nid for nid, b in betweenness.items() if b >= bridge_threshold}

        # Update metrics table
        hubs_updated = 0
        bridges_updated = 0

        # First, reset all hubs/bridges for this window
        await self.session.execute(
            text("""
                UPDATE graph_node_metrics
                SET is_hub = false, is_bridge = false, betweenness = NULL
                WHERE window_type = :wt
            """),
            {"wt": window_type},
        )

        for node_id_str in hub_ids | bridge_ids:
            try:
                node_id = UUID(node_id_str)
                is_hub = node_id_str in hub_ids
                is_bridge = node_id_str in bridge_ids
                btw = betweenness.get(node_id_str)

                stmt = pg_insert(GraphNodeMetrics).values(
                    id=uuid4(),
                    node_id=node_id,
                    window_type=window_type,
                    is_hub=is_hub,
                    is_bridge=is_bridge,
                    betweenness=btw,
                    computed_at=now,
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_gnm_node_window",
                    set_={
                        "is_hub": is_hub,
                        "is_bridge": is_bridge,
                        "betweenness": btw,
                        "computed_at": now,
                    },
                )
                await self.session.execute(stmt)

                if is_hub:
                    hubs_updated += 1
                if is_bridge:
                    bridges_updated += 1
            except Exception as e:
                logger.warning("Error updating hub/bridge for node %s: %s", node_id_str, e)

        await self.session.flush()
        logger.info("Hub/bridge detection complete: %d hubs, %d bridges", hubs_updated, bridges_updated)
        return {
            "hubs": hubs_updated,
            "bridges": bridges_updated,
            "total_nodes": total_nodes,
            "window_type": window_type,
        }

    # ------------------------------------------------------------------
    # 4. Compute all metrics
    # ------------------------------------------------------------------

    async def compute_all_metrics(self) -> dict:
        """Run all metric computations for the ``all_time`` window."""
        logger.info("Computing all graph metrics")
        window = MetricWindow.ALL_TIME.value

        degree_stats = await self.compute_degree_metrics(window)
        pagerank_stats = await self.compute_pagerank(window)
        hub_bridge_stats = await self.detect_hubs_and_bridges(window)

        # Compute influence rank based on PageRank
        await self._compute_influence_rank(window)

        await self.session.commit()

        return {
            "degree": degree_stats,
            "pagerank": pagerank_stats,
            "hubs_bridges": hub_bridge_stats,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _build_networkx_graph(self) -> "nx.DiGraph":
        """Load the canonical graph into a NetworkX DiGraph.

        Only includes canonical nodes and current edges.
        """
        G = nx.DiGraph()

        # Load edges (which implicitly create nodes)
        edge_stmt = (
            select(
                GraphEdge.source_node_id,
                GraphEdge.target_node_id,
                GraphEdge.weight,
                GraphEdge.predicate,
            )
            .where(GraphEdge.is_current.is_(True))
        )
        result = await self.session.execute(edge_stmt)

        # Batch load canonical node IDs for filtering
        canonical_stmt = (
            select(GraphNode.id)
            .where(GraphNode.is_canonical.is_(True))
        )
        canonical_result = await self.session.execute(canonical_stmt)
        canonical_ids = {str(row[0]) for row in canonical_result.all()}

        for row in result.all():
            source = str(row[0])
            target = str(row[1])
            weight = row[2] or 1.0

            # Only include edges between canonical nodes
            if source in canonical_ids and target in canonical_ids:
                G.add_edge(source, target, weight=weight, predicate=row[3])

        return G

    async def _compute_influence_rank(self, window_type: str) -> None:
        """Compute influence rank based on PageRank score for a given window.

        Rank 1 = highest PageRank.
        """
        sql = text("""
            WITH ranked AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (ORDER BY COALESCE(pagerank, 0) DESC) AS rnk
                FROM graph_node_metrics
                WHERE window_type = :wt
            )
            UPDATE graph_node_metrics m
            SET influence_rank = r.rnk
            FROM ranked r
            WHERE m.id = r.id
        """)
        await self.session.execute(sql, {"wt": window_type})
        await self.session.flush()
        logger.info("Influence rank computed for window=%s", window_type)
