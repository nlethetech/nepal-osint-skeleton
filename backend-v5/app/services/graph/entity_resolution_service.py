"""Entity resolution service for the NARADA unified graph.

Implements a three-phase resolution pipeline:
  - Phase 1 (deterministic): PAN match, linked_entity_id, canonical_key match
  - Phase 2 (probabilistic): Jaro-Winkler name similarity with district/party boosting
  - Phase 3: Manual merge/unmerge by analysts

All merges are auditable and reversible via the ``entity_resolutions`` table.
Merged nodes have ``is_canonical = False`` and point to their canonical node.
Edges are re-pointed from merged nodes to their canonical counterpart.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import delete, select, func, update, or_, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.graph import (
    GraphNode,
    GraphEdge,
    EntityResolution,
    NodeType,
    ResolutionMethod,
)

logger = logging.getLogger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Jaro-Winkler implementation (fallback if jellyfish is not installed)
# ---------------------------------------------------------------------------

try:
    from jellyfish import jaro_winkler_similarity as _jw_external

    def jaro_winkler_similarity(s1: str, s2: str) -> float:
        return _jw_external(s1, s2)

except ImportError:
    logger.info("jellyfish not available; using built-in Jaro-Winkler implementation")

    def _jaro_similarity(s1: str, s2: str) -> float:
        """Compute Jaro similarity between two strings."""
        if s1 == s2:
            return 1.0
        if not s1 or not s2:
            return 0.0

        len1, len2 = len(s1), len(s2)
        match_distance = max(len1, len2) // 2 - 1
        if match_distance < 0:
            match_distance = 0

        s1_matches = [False] * len1
        s2_matches = [False] * len2

        matches = 0
        transpositions = 0

        for i in range(len1):
            start = max(0, i - match_distance)
            end = min(i + match_distance + 1, len2)

            for j in range(start, end):
                if s2_matches[j] or s1[i] != s2[j]:
                    continue
                s1_matches[i] = True
                s2_matches[j] = True
                matches += 1
                break

        if matches == 0:
            return 0.0

        k = 0
        for i in range(len1):
            if not s1_matches[i]:
                continue
            while not s2_matches[k]:
                k += 1
            if s1[i] != s2[k]:
                transpositions += 1
            k += 1

        jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
        return jaro

    def jaro_winkler_similarity(s1: str, s2: str, p: float = 0.1) -> float:
        """Compute Jaro-Winkler similarity between two strings."""
        jaro = _jaro_similarity(s1, s2)

        # Common prefix (up to 4 characters)
        prefix_len = 0
        for i in range(min(len(s1), len(s2), 4)):
            if s1[i] == s2[i]:
                prefix_len += 1
            else:
                break

        return jaro + prefix_len * p * (1 - jaro)


class EntityResolutionService:
    """Async service for entity resolution in the NARADA unified graph."""

    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Phase 1: Deterministic resolution
    # ------------------------------------------------------------------

    async def run_deterministic_resolution(self) -> dict:
        """Phase 1: High-confidence exact matches.

        Resolution methods:
          - PAN match: company nodes sharing the same PAN
          - linked_entity_id: candidates/MPs/ministers already linked to political_entities
          - canonical_key: kb_objects matching political_entities.canonical_id

        Returns merge counts by method.
        """
        logger.info("Running deterministic entity resolution (Phase 1)")
        stats: dict[str, int] = {"merges_created": 0, "by_method": {}}

        # 1. PAN-based company dedup
        pan_merges = await self._resolve_by_pan()
        stats["by_method"]["pan_exact"] = pan_merges
        stats["merges_created"] += pan_merges

        # 2. linked_entity_id resolution (candidates -> political_entities)
        if settings.investigation_graph_v2_mode == "legacy":
            linked_merges = await self._resolve_by_linked_entity_id()
        else:
            # Dual-model mode preserves candidacy nodes; linkage handled by bridge edges.
            linked_merges = 0
        stats["by_method"]["linked_entity_id"] = linked_merges
        stats["merges_created"] += linked_merges

        # 3. canonical_key resolution (kb_objects -> political_entities)
        canonical_merges = await self._resolve_by_canonical_key()
        stats["by_method"]["canonical_key"] = canonical_merges
        stats["merges_created"] += canonical_merges

        await self.session.flush()
        logger.info("Deterministic resolution complete: %s", stats)
        return stats

    async def _resolve_by_pan(self) -> int:
        """Merge company nodes that share the same PAN number.

        The company with the earlier source_id (older record) becomes canonical.
        """
        merges = 0

        # Find PAN duplicates via raw SQL for efficiency
        sql = text("""
            SELECT
                gn1.id AS canonical_id,
                gn2.id AS merged_id
            FROM graph_nodes gn1
            JOIN graph_nodes gn2
                ON gn1.properties->>'pan' = gn2.properties->>'pan'
                AND gn1.id < gn2.id
            WHERE gn1.node_type = 'organization'
              AND gn2.node_type = 'organization'
              AND gn1.is_canonical = true
              AND gn2.is_canonical = true
              AND gn1.properties->>'pan' IS NOT NULL
              AND gn1.properties->>'pan' != ''
              AND gn1.properties->>'pan' = gn2.properties->>'pan'
            LIMIT 10000
        """)
        result = await self.session.execute(sql)
        rows = result.all()

        for canonical_id, merged_id in rows:
            try:
                await self.merge_nodes(
                    canonical_id=canonical_id,
                    merged_id=merged_id,
                    method=ResolutionMethod.PAN_EXACT.value,
                    confidence=1.0,
                    auto=True,
                )
                merges += 1
            except Exception as e:
                logger.warning("PAN merge failed (%s, %s): %s", canonical_id, merged_id, e)

        return merges

    async def _resolve_by_linked_entity_id(self) -> int:
        """Merge candidate graph nodes with their linked political_entity graph nodes.

        When a candidate has linked_entity_id populated, the political_entity
        node becomes canonical and the candidate node is merged into it.
        """
        merges = 0

        # Find candidate nodes that have a corresponding political_entity node
        sql = text("""
            SELECT
                pe_node.id AS canonical_id,
                cand_node.id AS merged_id
            FROM graph_nodes cand_node
            JOIN candidates c ON c.id::text = cand_node.source_id
            JOIN graph_nodes pe_node ON pe_node.source_id = c.linked_entity_id::text
                AND pe_node.source_table = 'political_entities'
            WHERE cand_node.source_table = 'candidates'
              AND cand_node.is_canonical = true
              AND pe_node.is_canonical = true
              AND c.linked_entity_id IS NOT NULL
              AND cand_node.id != pe_node.id
            LIMIT 10000
        """)
        result = await self.session.execute(sql)
        rows = result.all()

        for canonical_id, merged_id in rows:
            try:
                await self.merge_nodes(
                    canonical_id=canonical_id,
                    merged_id=merged_id,
                    method=ResolutionMethod.CANONICAL_KEY.value,
                    confidence=0.95,
                    auto=True,
                )
                merges += 1
            except Exception as e:
                logger.warning("linked_entity merge failed (%s, %s): %s", canonical_id, merged_id, e)

        return merges

    async def _resolve_by_canonical_key(self) -> int:
        """Merge kb_object graph nodes with matching political_entity graph nodes.

        Match on: kb_objects.canonical_key = political_entities.canonical_id
        """
        merges = 0

        sql = text("""
            SELECT
                pe_node.id AS canonical_id,
                kb_node.id AS merged_id
            FROM graph_nodes kb_node
            JOIN kb_objects kb ON kb.id::text = kb_node.source_id
            JOIN political_entities pe ON pe.canonical_id = kb.canonical_key
            JOIN graph_nodes pe_node ON pe_node.source_id = pe.id::text
                AND pe_node.source_table = 'political_entities'
            WHERE kb_node.source_table = 'kb_objects'
              AND kb_node.is_canonical = true
              AND pe_node.is_canonical = true
              AND kb_node.id != pe_node.id
            LIMIT 10000
        """)
        try:
            result = await self.session.execute(sql)
            rows = result.all()

            for canonical_id, merged_id in rows:
                try:
                    await self.merge_nodes(
                        canonical_id=canonical_id,
                        merged_id=merged_id,
                        method=ResolutionMethod.CANONICAL_KEY.value,
                        confidence=0.95,
                        auto=True,
                    )
                    merges += 1
                except Exception as e:
                    logger.warning("canonical_key merge failed (%s, %s): %s", canonical_id, merged_id, e)
        except Exception as e:
            logger.warning("canonical_key resolution query failed (tables may not exist): %s", e)

        return merges

    # ------------------------------------------------------------------
    # Phase 2: Probabilistic resolution
    # ------------------------------------------------------------------

    async def run_probabilistic_resolution(self, min_confidence: float = 0.85) -> dict:
        """Phase 2: Name similarity matching.

        Compares person and organization nodes using Jaro-Winkler similarity
        on their titles.  Same-district and same-party matches receive a
        confidence boost.

        Only auto-merges at confidence >= min_confidence.  Lower-confidence
        matches are flagged for analyst review.
        """
        logger.info("Running probabilistic entity resolution (Phase 2, min_conf=%.2f)", min_confidence)
        stats: dict[str, int] = {"candidates_found": 0, "auto_merged": 0, "flagged_for_review": 0}

        # Process person nodes
        person_merges = await self._probabilistic_resolve_type(
            node_type=NodeType.PERSON.value,
            min_confidence=min_confidence,
        )
        stats["candidates_found"] += person_merges["candidates_found"]
        stats["auto_merged"] += person_merges["auto_merged"]
        stats["flagged_for_review"] += person_merges["flagged_for_review"]

        # Process organization nodes (exact name match only)
        org_merges = await self._probabilistic_resolve_type(
            node_type=NodeType.ORGANIZATION.value,
            min_confidence=0.95,  # Stricter for orgs
        )
        stats["candidates_found"] += org_merges["candidates_found"]
        stats["auto_merged"] += org_merges["auto_merged"]
        stats["flagged_for_review"] += org_merges["flagged_for_review"]

        await self.session.flush()
        logger.info("Probabilistic resolution complete: %s", stats)
        return stats

    async def _probabilistic_resolve_type(
        self,
        node_type: str,
        min_confidence: float,
    ) -> dict:
        """Run probabilistic resolution for a specific node type.

        Uses district as a blocking key to process nodes in batches (HIGH-6),
        reducing peak memory from O(N) to O(N/77) per batch. Nodes within
        the same district are compared pairwise using Jaro-Winkler similarity.
        Nodes without a district are compared against every district batch.
        """
        stats = {"candidates_found": 0, "auto_merged": 0, "flagged_for_review": 0}

        # Get distinct districts for this node type (blocking key) (HIGH-6)
        subtype_condition = True
        if settings.investigation_graph_v2_mode != "legacy" and node_type == NodeType.PERSON.value:
            subtype_condition = GraphNode.subtype != "candidacy"

        district_stmt = (
            select(GraphNode.district)
            .where(
                GraphNode.node_type == node_type,
                GraphNode.is_canonical.is_(True),
                subtype_condition,
            )
            .distinct()
        )
        district_result = await self.session.execute(district_stmt)
        all_districts = [row[0] for row in district_result.all()]

        # Separate None district (no-district nodes)
        has_none = None in all_districts
        named_districts = [d for d in all_districts if d is not None]

        # Pre-load no-district nodes (they get compared against every district batch)
        no_district_nodes: list[GraphNode] = []
        if has_none:
            nd_stmt = (
                select(GraphNode)
                .where(
                    GraphNode.node_type == node_type,
                    GraphNode.is_canonical.is_(True),
                    GraphNode.district.is_(None),
                    subtype_condition,
                )
                .order_by(GraphNode.title)
            )
            nd_result = await self.session.execute(nd_stmt)
            no_district_nodes = list(nd_result.scalars().all())

        processed_pairs: set[tuple[UUID, UUID]] = set()

        # Process one district at a time to limit memory usage (HIGH-6)
        for district in named_districts:
            d_stmt = (
                select(GraphNode)
                .where(
                    GraphNode.node_type == node_type,
                    GraphNode.is_canonical.is_(True),
                    GraphNode.district == district,
                    subtype_condition,
                )
                .order_by(GraphNode.title)
            )
            d_result = await self.session.execute(d_stmt)
            group = list(d_result.scalars().all())

            # Add no-district nodes for cross-comparison
            compare_set = group + no_district_nodes

            await self._compare_and_merge_pairs(
                compare_set, node_type, min_confidence, processed_pairs, stats,
            )
            # Flush after each district batch to free ORM objects
            await self.session.flush()

        # Compare no-district nodes among themselves (if any)
        if len(no_district_nodes) >= 2:
            await self._compare_and_merge_pairs(
                no_district_nodes, node_type, min_confidence, processed_pairs, stats,
            )
            await self.session.flush()

        return stats

    async def _compare_and_merge_pairs(
        self,
        nodes: list[GraphNode],
        node_type: str,
        min_confidence: float,
        processed_pairs: set[tuple[UUID, UUID]],
        stats: dict,
    ) -> None:
        """Compare nodes pairwise by name similarity and execute merges.

        This is a per-district-batch helper that both compares and merges in
        one pass, keeping the async merge calls in the same context.
        """
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                n1, n2 = nodes[i], nodes[j]
                pair = (min(n1.id, n2.id), max(n1.id, n2.id))
                if pair in processed_pairs:
                    continue
                processed_pairs.add(pair)

                title1 = n1.title.strip().lower()
                title2 = n2.title.strip().lower()

                if len(title1) < 3 or len(title2) < 3:
                    continue

                sim = jaro_winkler_similarity(title1, title2)
                if sim < 0.85:
                    continue

                confidence = sim
                rationale_parts = [f"name_sim={sim:.3f}"]

                if n1.district and n2.district and n1.district == n2.district:
                    confidence = min(1.0, confidence + 0.05)
                    rationale_parts.append("same_district_boost")

                if node_type == NodeType.PERSON.value:
                    party1 = (n1.properties or {}).get("party", "")
                    party2 = (n2.properties or {}).get("party", "")
                    if party1 and party2 and party1.lower() == party2.lower():
                        confidence = min(1.0, confidence + 0.05)
                        rationale_parts.append("same_party_boost")

                stats["candidates_found"] += 1
                rationale = "; ".join(rationale_parts)

                if confidence >= min_confidence:
                    canonical = n1 if n1.source_count >= n2.source_count else n2
                    merged = n2 if canonical.id == n1.id else n1

                    try:
                        await self.merge_nodes(
                            canonical_id=canonical.id,
                            merged_id=merged.id,
                            method=ResolutionMethod.NAME_JARO_WINKLER.value,
                            confidence=confidence,
                            auto=True,
                            rationale=rationale,
                        )
                        stats["auto_merged"] += 1
                    except Exception as e:
                        logger.warning("Probabilistic merge failed: %s", e)
                else:
                    stats["flagged_for_review"] += 1
                    logger.debug(
                        "Flagged for review: '%s' vs '%s' (conf=%.3f)",
                        n1.title, n2.title, confidence,
                    )

    # ------------------------------------------------------------------
    # Combined runner
    # ------------------------------------------------------------------

    async def run_full_resolution(self) -> dict:
        """Run both deterministic and probabilistic phases in sequence."""
        logger.info("Running full entity resolution pipeline")

        phase1 = await self.run_deterministic_resolution()
        phase2 = await self.run_probabilistic_resolution()

        await self.session.commit()

        return {
            "deterministic": phase1,
            "probabilistic": phase2,
            "total_merges": phase1["merges_created"] + phase2["auto_merged"],
        }

    # ------------------------------------------------------------------
    # Core merge / unmerge operations
    # ------------------------------------------------------------------

    async def merge_nodes(
        self,
        canonical_id: UUID,
        merged_id: UUID,
        method: str,
        confidence: float,
        auto: bool = True,
        rationale: str | None = None,
        resolved_by: UUID | None = None,
    ) -> EntityResolution:
        """Merge two nodes: mark merged as non-canonical, re-point edges, record resolution.

        Steps:
          1. Set merged.is_canonical = False, merged.canonical_node_id = canonical
          2. Create EntityResolution record
          3. Re-point all edges from merged to canonical (dedup on conflict) (HIGH-8)
          4. Increment canonical.source_count

        All steps are wrapped in a savepoint so a partial failure rolls back
        atomically without corrupting the graph (HIGH-4).
        """
        if canonical_id == merged_id:
            raise ValueError("Cannot merge a node with itself")

        # Check if merge already exists
        existing = await self.session.execute(
            select(EntityResolution).where(
                EntityResolution.canonical_node_id == canonical_id,
                EntityResolution.merged_node_id == merged_id,
                EntityResolution.is_active.is_(True),
            )
        )
        if existing.scalar():
            raise ValueError("Merge already exists and is active")

        now = datetime.now(timezone.utc)

        # Wrap all merge operations in a savepoint for atomic rollback (HIGH-4).
        # If any step fails after the merged node is marked non-canonical, the
        # savepoint ensures we don't leave orphaned edges or inconsistent state.
        async with self.session.begin_nested():
            # 1. Update merged node
            await self.session.execute(
                update(GraphNode)
                .where(GraphNode.id == merged_id)
                .values(
                    is_canonical=False,
                    canonical_node_id=canonical_id,
                    updated_at=now,
                )
            )

            # 2. Create resolution record
            resolution = EntityResolution(
                id=uuid4(),
                canonical_node_id=canonical_id,
                merged_node_id=merged_id,
                match_method=method,
                confidence=confidence,
                is_auto=auto,
                rationale=rationale,
                resolved_by=resolved_by,
                resolved_at=now,
                is_active=True,
            )
            self.session.add(resolution)

            # 3. Collect edges that will be re-pointed (for precise unmerge)
            out_edge_result = await self.session.execute(
                select(GraphEdge).where(GraphEdge.source_node_id == merged_id)
            )
            in_edge_result = await self.session.execute(
                select(GraphEdge).where(GraphEdge.target_node_id == merged_id)
            )
            outgoing_edges = out_edge_result.scalars().all()
            incoming_edges = in_edge_result.scalars().all()

            moved_outgoing: list[str] = []
            moved_incoming: list[str] = []
            deleted_edge_ids: list[str] = []

            # Re-point outgoing edges, handling duplicates (HIGH-8).
            # Before re-pointing each edge, check if the canonical already has an
            # edge to the same target with the same predicate+valid_from. If so,
            # merge weights/counts and delete the duplicate instead of re-pointing.
            for edge in outgoing_edges:
                dup_result = await self.session.execute(
                    select(GraphEdge).where(
                        GraphEdge.source_node_id == canonical_id,
                        GraphEdge.target_node_id == edge.target_node_id,
                        GraphEdge.predicate == edge.predicate,
                        GraphEdge.valid_from == edge.valid_from,
                    )
                )
                existing_edge = dup_result.scalar()
                if existing_edge:
                    # Duplicate detected — merge weights and delete the merged edge
                    await self.session.execute(
                        update(GraphEdge)
                        .where(GraphEdge.id == existing_edge.id)
                        .values(
                            weight=GraphEdge.weight + edge.weight,
                            source_count=GraphEdge.source_count + edge.source_count,
                            updated_at=now,
                        )
                    )
                    await self.session.execute(
                        delete(GraphEdge).where(GraphEdge.id == edge.id)
                    )
                    deleted_edge_ids.append(str(edge.id))
                else:
                    # Safe to re-point
                    edge.source_node_id = canonical_id
                    edge.updated_at = now
                    moved_outgoing.append(str(edge.id))

            # Re-point incoming edges, handling duplicates (HIGH-8)
            for edge in incoming_edges:
                dup_result = await self.session.execute(
                    select(GraphEdge).where(
                        GraphEdge.source_node_id == edge.source_node_id,
                        GraphEdge.target_node_id == canonical_id,
                        GraphEdge.predicate == edge.predicate,
                        GraphEdge.valid_from == edge.valid_from,
                    )
                )
                existing_edge = dup_result.scalar()
                if existing_edge:
                    # Duplicate detected — merge weights and delete the merged edge
                    await self.session.execute(
                        update(GraphEdge)
                        .where(GraphEdge.id == existing_edge.id)
                        .values(
                            weight=GraphEdge.weight + edge.weight,
                            source_count=GraphEdge.source_count + edge.source_count,
                            updated_at=now,
                        )
                    )
                    await self.session.execute(
                        delete(GraphEdge).where(GraphEdge.id == edge.id)
                    )
                    deleted_edge_ids.append(str(edge.id))
                else:
                    # Safe to re-point
                    edge.target_node_id = canonical_id
                    edge.updated_at = now
                    moved_incoming.append(str(edge.id))

            # Store moved edge IDs on the resolution record for precise unmerge
            resolution.moved_edge_ids = {
                "outgoing": moved_outgoing,
                "incoming": moved_incoming,
                "deleted": deleted_edge_ids,
            }

            # 4. Increment canonical source_count
            await self.session.execute(
                update(GraphNode)
                .where(GraphNode.id == canonical_id)
                .values(
                    source_count=GraphNode.source_count + 1,
                    updated_at=now,
                )
            )

        await self.session.flush()
        logger.info(
            "Merged node %s into %s (method=%s, conf=%.3f, edges_moved=%d+%d, edges_deduped=%d)",
            merged_id, canonical_id, method, confidence,
            len(moved_outgoing), len(moved_incoming), len(deleted_edge_ids),
        )
        return resolution

    async def unmerge_nodes(
        self,
        resolution_id: UUID,
        user_id: UUID | None = None,
    ) -> None:
        """Reverse a merge operation.

        Steps:
          1. Restore merged node's is_canonical = True
          2. Re-point edges back to the merged node
          3. Mark the resolution as inactive
          4. Decrement canonical's source_count

        All steps are wrapped in a savepoint for atomic rollback (HIGH-4).
        """
        # Fetch the resolution
        resolution = await self.session.get(EntityResolution, resolution_id)
        if not resolution:
            raise ValueError(f"Resolution {resolution_id} not found")
        if not resolution.is_active:
            raise ValueError(f"Resolution {resolution_id} is already inactive")

        now = datetime.now(timezone.utc)
        canonical_id = resolution.canonical_node_id
        merged_id = resolution.merged_node_id

        # Wrap all unmerge operations in a savepoint for atomic rollback (HIGH-4)
        async with self.session.begin_nested():
            # 1. Restore merged node
            await self.session.execute(
                update(GraphNode)
                .where(GraphNode.id == merged_id)
                .values(
                    is_canonical=True,
                    canonical_node_id=None,
                    updated_at=now,
                )
            )

            # 2. Re-point edges back to the merged node using stored edge IDs
            moved = resolution.moved_edge_ids or {}
            moved_outgoing = moved.get("outgoing", [])
            moved_incoming = moved.get("incoming", [])

            if moved_outgoing:
                # These edges had source_node_id changed from merged -> canonical during merge.
                # Reverse: set source_node_id back to merged_id.
                await self.session.execute(
                    update(GraphEdge)
                    .where(GraphEdge.id.in_(moved_outgoing))
                    .values(source_node_id=merged_id, updated_at=now)
                )
            if moved_incoming:
                # These edges had target_node_id changed from merged -> canonical during merge.
                # Reverse: set target_node_id back to merged_id.
                await self.session.execute(
                    update(GraphEdge)
                    .where(GraphEdge.id.in_(moved_incoming))
                    .values(target_node_id=merged_id, updated_at=now)
                )

            if not moved_outgoing and not moved_incoming:
                # Legacy resolution without stored edge IDs -- log warning
                logger.warning(
                    "Resolution %s has no stored moved_edge_ids; edges cannot be "
                    "precisely reversed. Manual edge correction may be needed.",
                    resolution_id,
                )

            # 3. Mark resolution inactive
            resolution.is_active = False
            resolution.unresolved_by = user_id
            resolution.unresolved_at = now

            # 4. Decrement canonical source_count
            await self.session.execute(
                update(GraphNode)
                .where(GraphNode.id == canonical_id)
                .values(
                    source_count=func.greatest(GraphNode.source_count - 1, 1),
                    updated_at=now,
                )
            )

        await self.session.flush()
        logger.info("Unmerged node %s from %s (resolution=%s)", merged_id, canonical_id, resolution_id)
