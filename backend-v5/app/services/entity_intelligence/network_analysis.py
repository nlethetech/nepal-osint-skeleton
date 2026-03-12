"""NetworkAnalysisService - Compute centrality metrics and community detection."""
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Tuple, Any
from uuid import UUID, uuid4
import logging

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

try:
    import networkx as nx
    from community import community_louvain
    NETWORKX_AVAILABLE = True
except ImportError:
    NETWORKX_AVAILABLE = False
    nx = None
    community_louvain = None

from app.models.political_entity import PoliticalEntity
from app.models.entity_relationship import (
    EntityRelationship,
    EntityNetworkMetrics,
    EntityCommunity,
    RelationshipType,
    MetricWindowType,
)

logger = logging.getLogger(__name__)


class NetworkAnalysisService:
    """
    Computes network metrics for the entity relationship graph.

    Uses NetworkX for graph algorithms and community detection.
    Metrics are precomputed and cached in entity_network_metrics table.
    """

    COMPUTATION_VERSION = "1.0.0"

    def __init__(self, db: AsyncSession):
        self.db = db
        if not NETWORKX_AVAILABLE:
            logger.warning("NetworkX not available. Install with: pip install networkx python-louvain")

    async def compute_all_metrics(
        self,
        window_type: MetricWindowType = MetricWindowType.WINDOW_7D,
    ) -> Dict[str, Any]:
        """
        Compute all network metrics for the given time window.

        This is the main entry point for periodic metric computation.
        """
        if not NETWORKX_AVAILABLE:
            return {"error": "NetworkX not installed"}

        logger.info(f"Computing network metrics for window: {window_type.value}")

        # Build the graph
        G = await self._build_graph(window_type)

        if G.number_of_nodes() == 0:
            logger.warning("No nodes in graph, skipping metrics computation")
            return {"nodes": 0, "edges": 0}

        stats = {
            "nodes": G.number_of_nodes(),
            "edges": G.number_of_edges(),
            "window_type": window_type.value,
        }

        # Compute centrality metrics
        centrality = self._compute_centrality_metrics(G)

        # Detect communities
        communities = self._detect_communities(G)

        # Identify hubs, authorities, and bridges
        special_nodes = self._identify_special_nodes(G, centrality)

        # Store metrics in database
        await self._store_metrics(
            window_type=window_type,
            centrality=centrality,
            communities=communities,
            special_nodes=special_nodes,
            graph=G,
        )

        # Store community metadata
        await self._store_community_metadata(
            window_type=window_type,
            communities=communities,
            graph=G,
        )

        await self.db.commit()

        stats["communities_detected"] = len(set(communities.values())) if communities else 0
        stats["hubs_identified"] = len(special_nodes.get("hubs", []))
        stats["bridges_identified"] = len(special_nodes.get("bridges", []))

        logger.info(f"Metrics computation complete: {stats}")
        return stats

    async def _build_graph(
        self,
        window_type: MetricWindowType,
    ) -> "nx.Graph":
        """Build NetworkX graph from entity relationships."""
        G = nx.Graph()

        # Determine time cutoff based on window
        cutoff = self._get_window_cutoff(window_type)

        # Query relationships
        query = select(EntityRelationship).where(
            EntityRelationship.relationship_type == RelationshipType.CO_MENTION,
            EntityRelationship.co_mention_count >= 1,
        )

        if cutoff:
            query = query.where(EntityRelationship.last_co_mention_at >= cutoff)

        result = await self.db.execute(query)
        relationships = result.scalars().all()

        # Add edges with weights
        for rel in relationships:
            source = str(rel.source_entity_id)
            target = str(rel.target_entity_id)

            G.add_edge(
                source,
                target,
                weight=rel.strength_score or 0.1,
                co_mentions=rel.co_mention_count,
            )

        # Add entity metadata as node attributes
        entity_ids = list(G.nodes())
        if entity_ids:
            uuid_ids = [UUID(eid) for eid in entity_ids]
            result = await self.db.execute(
                select(PoliticalEntity).where(PoliticalEntity.id.in_(uuid_ids))
            )
            entities = {str(e.id): e for e in result.scalars().all()}

            for node_id in G.nodes():
                entity = entities.get(node_id)
                if entity:
                    G.nodes[node_id]["name"] = entity.name_en
                    G.nodes[node_id]["entity_type"] = entity.entity_type.value
                    G.nodes[node_id]["party"] = entity.party

        return G

    def _get_window_cutoff(self, window_type: MetricWindowType) -> Optional[datetime]:
        """Get datetime cutoff for the given window type."""
        now = datetime.now(timezone.utc)
        mapping = {
            MetricWindowType.WINDOW_24H: timedelta(hours=24),
            MetricWindowType.WINDOW_7D: timedelta(days=7),
            MetricWindowType.WINDOW_30D: timedelta(days=30),
            MetricWindowType.WINDOW_90D: timedelta(days=90),
            MetricWindowType.ALL_TIME: None,
        }
        delta = mapping.get(window_type)
        return now - delta if delta else None

    def _compute_centrality_metrics(self, G: "nx.Graph") -> Dict[str, Dict[str, float]]:
        """Compute various centrality metrics for all nodes."""
        metrics = {}

        # Degree centrality
        try:
            metrics["degree"] = nx.degree_centrality(G)
        except Exception as e:
            logger.warning(f"Error computing degree centrality: {e}")
            metrics["degree"] = {}

        # Betweenness centrality (expensive for large graphs)
        try:
            if G.number_of_nodes() <= 1000:
                metrics["betweenness"] = nx.betweenness_centrality(G, weight="weight")
            else:
                # Approximate for large graphs
                metrics["betweenness"] = nx.betweenness_centrality(
                    G, weight="weight", k=min(100, G.number_of_nodes())
                )
        except Exception as e:
            logger.warning(f"Error computing betweenness centrality: {e}")
            metrics["betweenness"] = {}

        # Closeness centrality
        try:
            metrics["closeness"] = nx.closeness_centrality(G)
        except Exception as e:
            logger.warning(f"Error computing closeness centrality: {e}")
            metrics["closeness"] = {}

        # Eigenvector centrality
        try:
            metrics["eigenvector"] = nx.eigenvector_centrality(G, max_iter=1000, weight="weight")
        except Exception as e:
            logger.warning(f"Error computing eigenvector centrality: {e}")
            metrics["eigenvector"] = {}

        # PageRank
        try:
            metrics["pagerank"] = nx.pagerank(G, weight="weight")
        except Exception as e:
            logger.warning(f"Error computing PageRank: {e}")
            metrics["pagerank"] = {}

        # Clustering coefficient
        try:
            metrics["clustering"] = nx.clustering(G, weight="weight")
        except Exception as e:
            logger.warning(f"Error computing clustering coefficient: {e}")
            metrics["clustering"] = {}

        return metrics

    def _detect_communities(self, G: "nx.Graph") -> Dict[str, int]:
        """Detect communities using Louvain algorithm."""
        if not community_louvain or G.number_of_nodes() == 0:
            return {}

        try:
            # Louvain community detection
            partition = community_louvain.best_partition(G, weight="weight")
            return partition
        except Exception as e:
            logger.warning(f"Error detecting communities: {e}")
            return {}

    def _identify_special_nodes(
        self,
        G: "nx.Graph",
        centrality: Dict[str, Dict[str, float]],
    ) -> Dict[str, List[str]]:
        """Identify hubs, authorities, and bridge nodes."""
        special = {"hubs": [], "authorities": [], "bridges": []}

        if G.number_of_nodes() == 0:
            return special

        # Hubs: High degree centrality
        degree = centrality.get("degree", {})
        if degree:
            threshold = sorted(degree.values(), reverse=True)[min(10, len(degree) - 1)]
            special["hubs"] = [n for n, v in degree.items() if v >= threshold]

        # Authorities: High PageRank
        pagerank = centrality.get("pagerank", {})
        if pagerank:
            threshold = sorted(pagerank.values(), reverse=True)[min(10, len(pagerank) - 1)]
            special["authorities"] = [n for n, v in pagerank.items() if v >= threshold]

        # Bridges: High betweenness but low degree (connecting different groups)
        betweenness = centrality.get("betweenness", {})
        if betweenness and degree:
            avg_degree = sum(degree.values()) / len(degree) if degree else 0
            special["bridges"] = [
                n for n, b in betweenness.items()
                if b > 0.1 and degree.get(n, 0) < avg_degree * 1.5
            ][:10]

        return special

    async def _store_metrics(
        self,
        window_type: MetricWindowType,
        centrality: Dict[str, Dict[str, float]],
        communities: Dict[str, int],
        special_nodes: Dict[str, List[str]],
        graph: "nx.Graph",
    ) -> None:
        """Store computed metrics in the database."""
        now = datetime.now(timezone.utc)

        # Clear existing metrics for this window
        await self.db.execute(
            delete(EntityNetworkMetrics).where(
                EntityNetworkMetrics.window_type == window_type
            )
        )

        # Compute influence rank based on PageRank
        pagerank = centrality.get("pagerank", {})
        ranked_nodes = sorted(pagerank.items(), key=lambda x: x[1], reverse=True)
        influence_ranks = {node: rank + 1 for rank, (node, _) in enumerate(ranked_nodes)}

        # Create metrics for each node
        for node_id in graph.nodes():
            entity_id = UUID(node_id)

            metrics = EntityNetworkMetrics(
                id=uuid4(),
                entity_id=entity_id,
                window_type=window_type,
                degree_centrality=centrality.get("degree", {}).get(node_id),
                betweenness_centrality=centrality.get("betweenness", {}).get(node_id),
                closeness_centrality=centrality.get("closeness", {}).get(node_id),
                eigenvector_centrality=centrality.get("eigenvector", {}).get(node_id),
                pagerank_score=pagerank.get(node_id),
                clustering_coefficient=centrality.get("clustering", {}).get(node_id),
                cluster_id=communities.get(node_id),
                is_hub=node_id in special_nodes.get("hubs", []),
                is_authority=node_id in special_nodes.get("authorities", []),
                is_bridge=node_id in special_nodes.get("bridges", []),
                influence_rank=influence_ranks.get(node_id),
                total_connections=graph.degree(node_id),
                computed_at=now,
                computation_version=self.COMPUTATION_VERSION,
            )
            self.db.add(metrics)

    async def _store_community_metadata(
        self,
        window_type: MetricWindowType,
        communities: Dict[str, int],
        graph: "nx.Graph",
    ) -> None:
        """Store community metadata in the database."""
        if not communities:
            return

        now = datetime.now(timezone.utc)

        # Clear existing communities for this window
        await self.db.execute(
            delete(EntityCommunity).where(EntityCommunity.window_type == window_type)
        )

        # Group nodes by community
        community_nodes: Dict[int, List[str]] = {}
        for node_id, cluster_id in communities.items():
            if cluster_id not in community_nodes:
                community_nodes[cluster_id] = []
            community_nodes[cluster_id].append(node_id)

        # Get entity metadata for naming
        all_node_ids = list(graph.nodes())
        uuid_ids = [UUID(nid) for nid in all_node_ids]
        result = await self.db.execute(
            select(PoliticalEntity).where(PoliticalEntity.id.in_(uuid_ids))
        )
        entities = {str(e.id): e for e in result.scalars().all()}

        # Create community records
        for cluster_id, node_ids in community_nodes.items():
            # Find dominant characteristics
            parties: Dict[str, int] = {}
            entity_types: Dict[str, int] = {}

            for node_id in node_ids:
                entity = entities.get(node_id)
                if entity:
                    if entity.party:
                        parties[entity.party] = parties.get(entity.party, 0) + 1
                    entity_types[entity.entity_type.value] = entity_types.get(
                        entity.entity_type.value, 0
                    ) + 1

            dominant_party = max(parties, key=parties.get) if parties else None
            dominant_type = max(entity_types, key=entity_types.get) if entity_types else None

            # Get central entities (highest degree within community)
            community_subgraph = graph.subgraph(node_ids)
            degrees = dict(community_subgraph.degree())
            central_nodes = sorted(degrees, key=degrees.get, reverse=True)[:3]
            central_entity_ids = [UUID(n) for n in central_nodes]

            # Generate name
            name = self._generate_community_name(dominant_party, dominant_type, len(node_ids))

            community = EntityCommunity(
                id=uuid4(),
                cluster_id=cluster_id,
                window_type=window_type,
                name=name,
                member_count=len(node_ids),
                central_entity_ids=central_entity_ids,
                dominant_party=dominant_party,
                dominant_entity_type=dominant_type,
                computed_at=now,
            )
            self.db.add(community)

    def _generate_community_name(
        self,
        dominant_party: Optional[str],
        dominant_type: Optional[str],
        member_count: int,
    ) -> str:
        """Generate a human-readable name for a community."""
        parts = []

        if dominant_party:
            parts.append(dominant_party)

        if dominant_type:
            type_names = {
                "person": "Politicians",
                "party": "Parties",
                "organization": "Organizations",
                "institution": "Institutions",
            }
            parts.append(type_names.get(dominant_type, dominant_type.title()))

        if parts:
            return f"{' - '.join(parts)} ({member_count} members)"
        return f"Community ({member_count} members)"

    async def get_entity_metrics(
        self,
        entity_id: UUID,
        window_type: MetricWindowType = MetricWindowType.WINDOW_7D,
    ) -> Optional[EntityNetworkMetrics]:
        """Get network metrics for a specific entity."""
        result = await self.db.execute(
            select(EntityNetworkMetrics).where(
                EntityNetworkMetrics.entity_id == entity_id,
                EntityNetworkMetrics.window_type == window_type,
            )
        )
        return result.scalar_one_or_none()

    async def get_leaderboard(
        self,
        window_type: MetricWindowType = MetricWindowType.WINDOW_7D,
        metric: str = "pagerank",
        limit: int = 20,
    ) -> List[Tuple[EntityNetworkMetrics, PoliticalEntity]]:
        """Get top entities by a specific metric."""
        metric_column = {
            "pagerank": EntityNetworkMetrics.pagerank_score,
            "betweenness": EntityNetworkMetrics.betweenness_centrality,
            "degree": EntityNetworkMetrics.degree_centrality,
            "eigenvector": EntityNetworkMetrics.eigenvector_centrality,
        }.get(metric, EntityNetworkMetrics.pagerank_score)

        result = await self.db.execute(
            select(EntityNetworkMetrics, PoliticalEntity)
            .join(PoliticalEntity, EntityNetworkMetrics.entity_id == PoliticalEntity.id)
            .where(EntityNetworkMetrics.window_type == window_type)
            .where(metric_column.isnot(None))
            .order_by(metric_column.desc())
            .limit(limit)
        )

        return list(result.all())

    async def get_communities(
        self,
        window_type: MetricWindowType = MetricWindowType.WINDOW_7D,
    ) -> List[EntityCommunity]:
        """Get all detected communities for a time window."""
        result = await self.db.execute(
            select(EntityCommunity)
            .where(EntityCommunity.window_type == window_type)
            .order_by(EntityCommunity.member_count.desc())
        )
        return list(result.scalars().all())

    async def get_graph_data(
        self,
        window_type: MetricWindowType = MetricWindowType.WINDOW_7D,
        min_strength: float = 0.1,
        limit_nodes: int = 200,
    ) -> Dict[str, Any]:
        """
        Get graph data in Cytoscape-compatible format.

        Returns nodes with their metrics and edges with weights.
        """
        # Get top nodes by PageRank
        leaderboard = await self.get_leaderboard(window_type, "pagerank", limit_nodes)

        entity_ids = [str(m.entity_id) for m, _ in leaderboard]

        # Get relationships between these entities
        uuid_ids = [UUID(eid) for eid in entity_ids]
        cutoff = self._get_window_cutoff(window_type)

        query = select(EntityRelationship).where(
            EntityRelationship.source_entity_id.in_(uuid_ids),
            EntityRelationship.target_entity_id.in_(uuid_ids),
            EntityRelationship.strength_score >= min_strength,
        )
        if cutoff:
            query = query.where(EntityRelationship.last_co_mention_at >= cutoff)

        result = await self.db.execute(query)
        relationships = result.scalars().all()

        # Format for Cytoscape
        nodes = []
        for metrics, entity in leaderboard:
            nodes.append({
                "data": {
                    "id": str(entity.id),
                    "label": entity.name_en,
                    "type": entity.entity_type.value,
                    "party": entity.party,
                    "pagerank": metrics.pagerank_score,
                    "degree": metrics.degree_centrality,
                    "cluster": metrics.cluster_id,
                    "isHub": metrics.is_hub,
                    "isBridge": metrics.is_bridge,
                    "influenceRank": metrics.influence_rank,
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
                }
            })

        return {
            "elements": {
                "nodes": nodes,
                "edges": edges,
            },
            "stats": {
                "nodeCount": len(nodes),
                "edgeCount": len(edges),
                "windowType": window_type.value,
            },
        }
