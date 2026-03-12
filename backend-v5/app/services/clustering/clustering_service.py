"""Story clustering service using Union-Find algorithm."""
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List, Set, Tuple
from uuid import UUID, uuid4

import numpy as np
from sqlalchemy import select, and_, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.story_feature import StoryFeature
from app.models.story_embedding import StoryEmbedding
from app.services.clustering.similarity_engine import SimilarityEngine, HybridSimilarityScore
from app.services.clustering.blocking import BlockingRules, HierarchicalBlocker
from app.services.clustering.feature_extractor import (
    StoryFeatures,
    get_feature_extractor,
)
from app.services.clustering.llm_validator import get_llm_validator
from app.services.severity_service import SeverityService
from app.services.embeddings.text_embedder import get_multilingual_embedder, bytes_to_embedding
from app.services.openai_runtime import get_openai_runtime
from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class ClusterCandidate:
    """Candidate story for clustering."""
    id: UUID
    title: str
    summary: Optional[str]
    content: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    source_id: str = ""
    published_at: Optional[datetime] = None
    language: Optional[str] = None  # For cross-lingual tracking
    # Extracted features
    features: Optional[StoryFeatures] = None
    # E5-Large embedding for hybrid similarity (Palantir-grade)
    embedding: Optional[List[float]] = None


class UnionFind:
    """Union-Find (Disjoint Set Union) data structure."""

    def __init__(self):
        self.parent: dict[UUID, UUID] = {}
        self.rank: dict[UUID, int] = {}

    def find(self, x: UUID) -> UUID:
        """Find root with path compression."""
        if x not in self.parent:
            self.parent[x] = x
            self.rank[x] = 0
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, x: UUID, y: UUID) -> bool:
        """Union by rank. Returns True if merged, False if already same set."""
        root_x = self.find(x)
        root_y = self.find(y)

        if root_x == root_y:
            return False

        if self.rank[root_x] < self.rank[root_y]:
            root_x, root_y = root_y, root_x

        self.parent[root_y] = root_x
        if self.rank[root_x] == self.rank[root_y]:
            self.rank[root_x] += 1

        return True

    def get_clusters(self) -> dict[UUID, list[UUID]]:
        """Get all clusters as dict of root -> members."""
        clusters: dict[UUID, list[UUID]] = defaultdict(list)
        for item in self.parent:
            root = self.find(item)
            clusters[root].append(item)
        return dict(clusters)


class ClusteringService:
    """
    Service for clustering related news stories.

    Uses:
    - SimilarityEngine for computing story similarity (v3 4-component formula)
    - BlockingRules for hard clustering constraints
    - HierarchicalBlocker for efficient candidate generation
    - FeatureExtractor for MinHash and geographic features
    - Union-Find for efficient cluster formation

    Palantir-grade v4 features:
    - Hybrid semantic clustering with E5-Large embeddings
    - 3-component formula: 45% semantic + 30% lexical + 25% structural
    - Cross-lingual story grouping (English + Nepali)
    - Corroboration tracking ("Story backed by N sources")
    """

    # Similarity threshold for clustering
    SIMILARITY_THRESHOLD = 0.6

    # Smart clustering threshold - INCREASED for much tighter clusters
    # Only stories that are clearly about the same event should cluster
    SMART_THRESHOLD = 0.70

    # Hybrid clustering threshold (Palantir-grade)
    # 0.72 catches same-event stories with different wording (especially Nepali)
    # LLM validation at threshold 2 acts as safety net
    HYBRID_THRESHOLD = 0.72

    # Minimum semantic similarity (embedding cosine) required
    # 0.55 allows Nepali cross-referential titles (city vs district naming)
    MIN_SEMANTIC_SIMILARITY = 0.55

    # LLM validation threshold - validate clusters larger than this
    # Lowered to 2 so Haiku validates almost all clusters for accuracy
    LLM_VALIDATION_THRESHOLD = 2

    # Maximum cluster size - hard limit to prevent mega-clusters
    MAX_CLUSTER_SIZE = 30

    def __init__(
        self,
        db: AsyncSession,
        similarity_threshold: float = SIMILARITY_THRESHOLD,
        use_smart_clustering: bool = True,
        use_llm_validation: bool = True,
        use_hybrid_semantic: bool = True,  # Palantir-grade hybrid clustering
    ):
        """
        Initialize clustering service.

        Args:
            db: Database session
            similarity_threshold: Minimum similarity to cluster (0.0-1.0)
            use_smart_clustering: Use v3 smart clustering with features
            use_hybrid_semantic: Use Palantir-grade hybrid semantic clustering with E5
        """
        self.db = db
        self.similarity_threshold = similarity_threshold
        self.use_smart_clustering = use_smart_clustering
        self.use_llm_validation = use_llm_validation
        self.use_hybrid_semantic = use_hybrid_semantic
        self.similarity_engine = SimilarityEngine()
        self.blocking_rules = BlockingRules()
        self.hierarchical_blocker = HierarchicalBlocker()
        self.feature_extractor = get_feature_extractor()
        self.severity_service = SeverityService()
        self.llm_validator = get_llm_validator() if use_llm_validation else None
        self._embedder = None  # Lazy-loaded E5-Large embedder
        self.settings = get_settings()
        self.openai_runtime = get_openai_runtime()
        self.smart_threshold = float(getattr(self.settings, "clustering_smart_threshold", self.SMART_THRESHOLD))
        self.hybrid_threshold = float(getattr(self.settings, "clustering_hybrid_threshold", self.HYBRID_THRESHOLD))
        self.gray_zone_low = float(getattr(self.settings, "openai_cluster_gray_zone_low", 0.68))
        self.gray_zone_high = float(getattr(self.settings, "openai_cluster_gray_zone_high", 0.82))

    async def cluster_stories(
        self,
        hours: int = 72,
        min_cluster_size: int = 2,
    ) -> dict[str, int]:
        """
        Run clustering on recent stories.

        Args:
            hours: Process stories from last N hours
            min_cluster_size: Minimum stories to form a cluster

        Returns:
            Stats dict with counts
        """
        stats = {
            "stories_processed": 0,
            "clusters_created": 0,
            "clusters_updated": 0,
            "stories_clustered": 0,
            "stories_unclustered": 0,
            "candidate_pairs": 0,
            "edges_created": 0,
            "hybrid_mode": self.use_hybrid_semantic,
            "cross_lingual_pairs": 0,
        }

        # Fetch candidate stories
        candidates = await self._fetch_candidates(hours)
        stats["stories_processed"] = len(candidates)

        if len(candidates) < 2:
            logger.info(f"Only {len(candidates)} stories, skipping clustering")
            return stats

        # Extract features for all candidates
        await self._extract_all_features(candidates)

        # Load embeddings if using hybrid semantic clustering (Palantir-grade)
        if self.use_hybrid_semantic:
            await self._load_embeddings(candidates)
            embedding_count = sum(1 for c in candidates if c.embedding is not None)
            logger.info(f"Loaded embeddings for {embedding_count}/{len(candidates)} candidates")
            stats["embeddings_loaded"] = embedding_count

        # Use Palantir-grade hybrid clustering if enabled
        if self.use_hybrid_semantic:
            return await self._hybrid_cluster(candidates, min_cluster_size, stats)
        elif self.use_smart_clustering:
            return await self._smart_cluster(candidates, min_cluster_size, stats)
        else:
            return await self._legacy_cluster(candidates, min_cluster_size, stats)

    async def _smart_cluster(
        self,
        candidates: List[ClusterCandidate],
        min_cluster_size: int,
        stats: dict,
    ) -> dict:
        """
        Smart clustering using hierarchical blocking and v3 features.
        """
        # Build index for feature lookup
        story_map: Dict[UUID, ClusterCandidate] = {c.id: c for c in candidates}

        # Generate candidate pairs using hierarchical blocking
        blocking_input = [
            (c.id, c.features, c.category, c.published_at)
            for c in candidates
            if c.features is not None
        ]

        candidate_pairs = self.hierarchical_blocker.get_candidate_pairs(blocking_input)
        stats["candidate_pairs"] = len(candidate_pairs)

        logger.info(f"Hierarchical blocking generated {len(candidate_pairs)} candidate pairs")

        # Build similarity graph
        uf = UnionFind()
        edges_created = 0

        for id1, id2 in candidate_pairs:
            story1 = story_map.get(id1)
            story2 = story_map.get(id2)

            if not story1 or not story2 or not story1.features or not story2.features:
                continue

            # Check hard blocking rules with features
            blocked, reason = self.blocking_rules.should_block_with_features(
                story1.features,
                story2.features,
                story1.category,
                story2.category,
                story1.published_at,
                story2.published_at,
            )

            if blocked:
                continue

            # Compute similarity using v3 4-component formula
            time_diff = self.blocking_rules.get_time_diff_hours(
                story1.published_at, story2.published_at
            )

            similarity = self.similarity_engine.compute_similarity_with_features(
                story1.features,
                story2.features,
                story1.category,
                story2.category,
                time_diff,
            )

            # If similar enough, union
            if similarity.overall >= self.smart_threshold:
                uf.union(story1.id, story2.id)
                edges_created += 1

        stats["edges_created"] = edges_created
        logger.info(f"Created {edges_created} similarity edges")

        # Get clusters
        cluster_groups = uf.get_clusters()

        # Filter to clusters with min size
        valid_clusters = {
            root: members
            for root, members in cluster_groups.items()
            if len(members) >= min_cluster_size
        }

        logger.info(f"Found {len(valid_clusters)} clusters with >={min_cluster_size} stories")

        # LLM validation for large clusters
        if self.use_llm_validation and self.llm_validator:
            validated_clusters = await self._validate_clusters_with_llm(
                valid_clusters, story_map
            )
            stats["llm_validated"] = len(validated_clusters)
            stats["llm_split"] = len(validated_clusters) - len(valid_clusters)
        else:
            validated_clusters = valid_clusters

        # Create/update cluster records
        for root_id, member_ids in validated_clusters.items():
            cluster_stories = [story_map[sid] for sid in member_ids]
            is_new, cluster = await self._create_or_update_cluster(cluster_stories)

            if cluster:
                if is_new:
                    stats["clusters_created"] += 1
                else:
                    stats["clusters_updated"] += 1
                stats["stories_clustered"] += len(member_ids)
                await self._assign_stories_to_cluster(member_ids, cluster.id)

        # Count unclustered
        clustered_ids: Set[UUID] = set()
        for members in valid_clusters.values():
            clustered_ids.update(members)

        stats["stories_unclustered"] = len(candidates) - len(clustered_ids)

        await self.db.commit()
        return stats

    # ============================================================
    # Palantir-Grade Hybrid Semantic Clustering
    # ============================================================

    async def _load_embeddings(self, candidates: List[ClusterCandidate]) -> None:
        """
        Load E5-Large embeddings for all candidates from database.

        Missing embeddings are left empty and handled by lexical/structural scoring.
        Embeddings are generated by the scheduled embedding job to keep OpenAI
        usage predictable and capped.
        """
        story_ids = [c.id for c in candidates]

        # Fetch existing embeddings from database
        result = await self.db.execute(
            select(StoryEmbedding)
            .where(StoryEmbedding.story_id.in_(story_ids))
        )
        embeddings_map: Dict[UUID, StoryEmbedding] = {
            e.story_id: e for e in result.scalars().all()
        }

        # Build map of candidates needing embeddings
        need_embedding: List[ClusterCandidate] = []

        for candidate in candidates:
            emb_record = embeddings_map.get(candidate.id)
            if emb_record and emb_record.embedding_vector is not None:
                try:
                    candidate.embedding = list(emb_record.embedding_vector)
                    continue
                except Exception as e:
                    logger.warning(f"Failed to read vector embedding for {candidate.id}: {e}")
            if emb_record and emb_record.embedding is not None:
                try:
                    candidate.embedding = bytes_to_embedding(emb_record.embedding)
                    continue
                except Exception as e:
                    logger.warning(f"Failed to decode embedding for {candidate.id}: {e}")
            need_embedding.append(candidate)

        if need_embedding:
            logger.info(
                "Skipping on-the-fly embeddings for %s stories; scheduled embedding job will backfill them",
                len(need_embedding),
            )

    async def _hybrid_cluster(
        self,
        candidates: List[ClusterCandidate],
        min_cluster_size: int,
        stats: dict,
    ) -> dict:
        """
        Palantir-grade hybrid clustering using E5-Large semantic similarity.

        Formula: 0.45*semantic + 0.30*lexical + 0.25*structural

        Benefits over smart clustering:
        - Cross-lingual: Groups English and Nepali stories about same event
        - Semantic: Understands meaning, not just surface-level text
        - Robust: MinHash catches exact quotes, structural catches entities
        """
        # Build index for feature lookup
        story_map: Dict[UUID, ClusterCandidate] = {c.id: c for c in candidates}

        # Generate candidate pairs using hierarchical blocking
        blocking_input = [
            (c.id, c.features, c.category, c.published_at)
            for c in candidates
            if c.features is not None
        ]

        candidate_pairs = self.hierarchical_blocker.get_candidate_pairs(blocking_input)
        stats["candidate_pairs"] = len(candidate_pairs)

        logger.info(f"Hierarchical blocking generated {len(candidate_pairs)} candidate pairs for hybrid clustering")

        # Build similarity graph
        uf = UnionFind()
        edges_created = 0
        cross_lingual_pairs = 0

        for id1, id2 in candidate_pairs:
            story1 = story_map.get(id1)
            story2 = story_map.get(id2)

            if not story1 or not story2 or not story1.features or not story2.features:
                continue

            # Compute time difference
            time_diff = self.blocking_rules.get_time_diff_hours(
                story1.published_at, story2.published_at
            )

            # Compute hybrid similarity with blocking rules
            similarity = self.similarity_engine.compute_hybrid_similarity_with_blocking(
                story1.features,
                story2.features,
                story1.embedding,
                story2.embedding,
                time_diff,
                story1.category,
                story2.category,
            )

            # Skip blocked pairs
            if similarity.blocked:
                continue

            # CRITICAL: Require minimum semantic similarity to prevent lexical-only matches
            # This prevents stories that share keywords but are about different topics
            if similarity.semantic < self.MIN_SEMANTIC_SIMILARITY:
                continue

            # Track cross-lingual matches
            is_cross_lingual = (
                story1.language and story2.language and
                story1.language != story2.language
            )
            if is_cross_lingual and similarity.overall >= self.hybrid_threshold:
                cross_lingual_pairs += 1
                logger.debug(
                    f"Cross-lingual match ({story1.language}<->{story2.language}): "
                    f"similarity={similarity.overall:.3f}, semantic={similarity.semantic:.3f}"
                )

            # If similar enough, union
            should_merge = similarity.overall >= self.hybrid_threshold
            if (
                not should_merge and
                self._should_run_openai_pair_check(story1, story2, similarity)
            ):
                should_merge = await self._openai_same_event_judgment(story1, story2, similarity)

            if should_merge:
                uf.union(story1.id, story2.id)
                edges_created += 1

        stats["edges_created"] = edges_created
        stats["cross_lingual_pairs"] = cross_lingual_pairs
        logger.info(f"Created {edges_created} similarity edges ({cross_lingual_pairs} cross-lingual)")

        # Get clusters
        cluster_groups = uf.get_clusters()

        # Filter to clusters with min size AND enforce max size
        valid_clusters = {}
        oversized_count = 0

        for root, members in cluster_groups.items():
            if len(members) < min_cluster_size:
                continue

            if len(members) > self.MAX_CLUSTER_SIZE:
                # CRITICAL: Discard oversized clusters - they're caused by transitive chaining
                # A cluster with 100+ stories about "elections" + "gold prices" + "accidents" is wrong
                oversized_count += 1
                logger.warning(
                    f"Oversized cluster detected: {len(members)} stories. "
                    f"This indicates transitive chaining - discarding cluster."
                )
                continue

            valid_clusters[root] = members

        logger.info(
            f"Found {len(valid_clusters)} valid clusters with {min_cluster_size}-{self.MAX_CLUSTER_SIZE} stories "
            f"({oversized_count} oversized clusters discarded)"
        )

        # LLM validation for large clusters
        if self.use_llm_validation and self.llm_validator:
            validated_clusters = await self._validate_clusters_with_llm(
                valid_clusters, story_map
            )
            stats["llm_validated"] = len(validated_clusters)
            stats["llm_split"] = len(validated_clusters) - len(valid_clusters)
        else:
            validated_clusters = valid_clusters

        # Create/update cluster records with corroboration tracking
        for root_id, member_ids in validated_clusters.items():
            cluster_stories = [story_map[sid] for sid in member_ids]
            is_new, cluster = await self._create_or_update_cluster_with_corroboration(cluster_stories)

            if cluster:
                if is_new:
                    stats["clusters_created"] += 1
                else:
                    stats["clusters_updated"] += 1
                stats["stories_clustered"] += len(member_ids)
                await self._assign_stories_to_cluster(member_ids, cluster.id)

        # Count unclustered
        clustered_ids: Set[UUID] = set()
        for members in valid_clusters.values():
            clustered_ids.update(members)

        stats["stories_unclustered"] = len(candidates) - len(clustered_ids)

        await self.db.commit()
        return stats

    def _should_run_openai_pair_check(
        self,
        story1: ClusterCandidate,
        story2: ClusterCandidate,
        similarity: HybridSimilarityScore,
    ) -> bool:
        """Only spend GPT-5 mini on ambiguous, high-value candidate pairs."""
        if not self.openai_runtime.clustering_enabled:
            return False
        if similarity.blocked:
            return False
        if similarity.semantic < self.MIN_SEMANTIC_SIMILARITY:
            return False
        if similarity.overall < self.gray_zone_low or similarity.overall > self.gray_zone_high:
            return False

        cross_lingual = bool(story1.language and story2.language and story1.language != story2.language)
        semantic_lexical_gap = similarity.semantic >= 0.72 and similarity.lexical <= 0.35
        low_structural = similarity.structural <= 0.45
        return cross_lingual or semantic_lexical_gap or low_structural

    async def _openai_same_event_judgment(
        self,
        story1: ClusterCandidate,
        story2: ClusterCandidate,
        similarity: HybridSimilarityScore,
    ) -> bool:
        """Resolve gray-zone event matches with strict JSON output."""
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "same_event": {"type": "boolean"},
                "confidence": {"type": "number"},
                "reason": {"type": "string"},
                "canonical_headline": {"type": ["string", "null"]},
            },
            "required": ["same_event", "confidence", "reason", "canonical_headline"],
        }
        districts1 = sorted(set((story1.features.districts if story1.features else []) + ([story1.features.title_district] if story1.features and story1.features.title_district else [])))
        districts2 = sorted(set((story2.features.districts if story2.features else []) + ([story2.features.title_district] if story2.features and story2.features.title_district else [])))
        user_prompt = (
            "Decide whether these two Nepal-relevant news stories describe the same specific event.\n"
            "Be strict: same broad topic is not enough.\n\n"
            f"Story A\n"
            f"- Title: {story1.title}\n"
            f"- Summary: {(story1.summary or '')[:280]}\n"
            f"- Category: {story1.category or 'unknown'}\n"
            f"- Language: {story1.language or 'unknown'}\n"
            f"- Districts: {', '.join(districts1) or 'none'}\n\n"
            f"Story B\n"
            f"- Title: {story2.title}\n"
            f"- Summary: {(story2.summary or '')[:280]}\n"
            f"- Category: {story2.category or 'unknown'}\n"
            f"- Language: {story2.language or 'unknown'}\n"
            f"- Districts: {', '.join(districts2) or 'none'}\n\n"
            f"Signals\n"
            f"- semantic_similarity: {similarity.semantic:.3f}\n"
            f"- lexical_similarity: {similarity.lexical:.3f}\n"
            f"- structural_similarity: {similarity.structural:.3f}\n"
            f"- overall_similarity: {similarity.overall:.3f}"
        )
        try:
            result = await self.openai_runtime.json_completion(
                system_prompt=(
                    "You are a strict event clustering judge for a Nepal OSINT system. "
                    "Only merge when two stories describe the same concrete event or development window."
                ),
                user_prompt=user_prompt,
                schema_name="cluster_same_event_judgment",
                schema=schema,
                model=self.settings.openai_clustering_model,
                max_completion_tokens=180,
                temperature=0.0,
                cache_scope="cluster-pair:" + ":".join(sorted([str(story1.id), str(story2.id)])),
            )
            return bool(result.get("same_event")) and float(result.get("confidence", 0.0)) >= 0.60
        except Exception:
            logger.warning(
                "OpenAI gray-zone clustering judgment failed for stories %s/%s",
                story1.id,
                story2.id,
                exc_info=True,
            )
            return False

    async def _create_or_update_cluster_with_corroboration(
        self,
        stories: List[ClusterCandidate],
    ) -> Tuple[bool, Optional[StoryCluster]]:
        """
        Create or update a cluster with corroboration tracking.

        Computes:
        - source_count: Number of unique sources
        - Unique sources list
        - Languages in cluster (for cross-lingual tracking)

        Returns:
            Tuple of (is_new, cluster)
        """
        if not stories:
            return False, None

        # Check if any stories are already in a cluster
        story_ids = [s.id for s in stories]
        existing_cluster = await self._find_existing_cluster(story_ids)

        # Sort by published_at to get most recent
        sorted_stories = sorted(
            stories,
            key=lambda s: s.published_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )

        # Representative headline is most recent
        headline = sorted_stories[0].title

        # Aggregate summary
        summaries = [s.summary for s in stories if s.summary]
        summary = summaries[0] if summaries else None

        # Dominant category (most common)
        categories = [s.category for s in stories if s.category]
        category = max(set(categories), key=categories.count) if categories else None

        # Highest severity
        severities = [s.severity for s in stories if s.severity]
        severity = self._get_highest_severity(severities) if severities else None

        # Unique sources (Palantir-grade corroboration)
        unique_sources = list(set(s.source_id for s in stories if s.source_id))
        source_count = len(unique_sources)

        # Languages in cluster (cross-lingual tracking)
        languages = list(set(s.language for s in stories if s.language))

        # Time range
        times = [s.published_at for s in stories if s.published_at]
        first_published = min(times) if times else None
        last_updated = max(times) if times else None

        # Check for cross-lingual match
        cross_lingual = len(languages) > 1

        if existing_cluster:
            # Update existing cluster
            existing_cluster.headline = headline
            existing_cluster.summary = summary
            existing_cluster.category = category
            existing_cluster.severity = severity
            existing_cluster.story_count = len(stories)
            existing_cluster.source_count = source_count
            existing_cluster.first_published = first_published
            existing_cluster.last_updated = last_updated
            # Corroboration fields will be updated if model has them
            return False, existing_cluster
        else:
            # Create new cluster
            cluster = StoryCluster(
                id=uuid4(),
                headline=headline,
                summary=summary,
                category=category,
                severity=severity,
                story_count=len(stories),
                source_count=source_count,
                first_published=first_published,
                last_updated=last_updated,
            )
            self.db.add(cluster)
            return True, cluster

    async def _legacy_cluster(
        self,
        candidates: List[ClusterCandidate],
        min_cluster_size: int,
        stats: dict,
    ) -> dict:
        """
        Legacy O(n^2) clustering without hierarchical blocking.
        """
        uf = UnionFind()
        edges_created = 0

        # Compare all pairs
        for i, story1 in enumerate(candidates):
            for j in range(i + 1, len(candidates)):
                story2 = candidates[j]

                # Check blocking rules first
                blocked, reason = self.blocking_rules.should_block(
                    story1.category, story2.category,
                    story1.published_at, story2.published_at,
                    story1.source_id, story2.source_id,
                )
                if blocked:
                    continue

                # Compute similarity
                time_diff = self.blocking_rules.get_time_diff_hours(
                    story1.published_at, story2.published_at
                )

                similarity = self.similarity_engine.compute_similarity(
                    story1.title, story2.title,
                    story1.summary, story2.summary,
                    story1.category, story2.category,
                    time_diff,
                )

                if similarity.overall >= self.similarity_threshold:
                    uf.union(story1.id, story2.id)
                    edges_created += 1

        stats["edges_created"] = edges_created
        logger.info(f"Created {edges_created} similarity edges")

        # Get clusters
        cluster_groups = uf.get_clusters()
        valid_clusters = {
            root: members
            for root, members in cluster_groups.items()
            if len(members) >= min_cluster_size
        }

        logger.info(f"Found {len(valid_clusters)} clusters with >={min_cluster_size} stories")

        story_id_map = {c.id: c for c in candidates}

        for root_id, member_ids in valid_clusters.items():
            cluster_stories = [story_id_map[sid] for sid in member_ids]
            is_new, cluster = await self._create_or_update_cluster(cluster_stories)

            if cluster:
                if is_new:
                    stats["clusters_created"] += 1
                else:
                    stats["clusters_updated"] += 1
                stats["stories_clustered"] += len(member_ids)
                await self._assign_stories_to_cluster(member_ids, cluster.id)

        clustered_ids: Set[UUID] = set()
        for members in valid_clusters.values():
            clustered_ids.update(members)

        stats["stories_unclustered"] = len(candidates) - len(clustered_ids)

        await self.db.commit()
        return stats

    async def _validate_clusters_with_llm(
        self,
        clusters: Dict[UUID, List[UUID]],
        story_map: Dict[UUID, ClusterCandidate],
    ) -> Dict[UUID, List[UUID]]:
        """
        Validate clusters using LLM and split invalid ones.

        Args:
            clusters: Dict of root_id -> member_ids
            story_map: Dict of story_id -> ClusterCandidate

        Returns:
            Validated clusters (may be more clusters if splits occurred)
        """
        validated = {}
        cluster_idx = 0

        for root_id, member_ids in clusters.items():
            # Skip small clusters - they don't need LLM validation
            if len(member_ids) <= self.LLM_VALIDATION_THRESHOLD:
                validated[root_id] = member_ids
                continue

            # Get titles for LLM validation
            titles = [story_map[mid].title for mid in member_ids]
            story_ids = [str(mid) for mid in member_ids]

            logger.info(f"LLM validating cluster with {len(titles)} stories")

            # Validate with LLM
            validation = await self.llm_validator.validate_cluster(titles)

            # If confidence is 0, LLM is disabled - keep the cluster
            if validation.confidence == 0.0:
                validated[root_id] = member_ids
                logger.info(f"LLM disabled, keeping cluster: {validation.reason}")
            elif validation.is_valid and validation.confidence >= 0.7:
                # Cluster is valid
                validated[root_id] = member_ids
                logger.info(f"Cluster validated: {validation.reason}")
            elif validation.suggested_groups:
                # Split into suggested groups
                for i, group_indices in enumerate(validation.suggested_groups):
                    if len(group_indices) >= 2:
                        group_ids = [member_ids[idx] for idx in group_indices if idx < len(member_ids)]
                        if len(group_ids) >= 2:
                            # Use first member ID as new root
                            validated[group_ids[0]] = group_ids
                            cluster_idx += 1
                            logger.info(f"Split cluster: group {i+1} has {len(group_ids)} stories")
            else:
                # LLM says not valid but no suggestions - skip this cluster
                logger.info(f"Cluster rejected: {validation.reason}")

        return validated

    async def _fetch_candidates(self, hours: int) -> List[ClusterCandidate]:
        """Fetch candidate stories for clustering.

        Filters by published_at (when the story was published) not created_at
        (when it was added to database). This prevents old stories from being
        clustered just because they were recently ingested.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(Story)
            .where(
                and_(
                    # Filter by PUBLISHED date, not ingestion date
                    Story.published_at >= cutoff,
                    Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
                )
            )
            .order_by(Story.published_at.desc().nullslast())
        )

        stories = result.scalars().all()

        candidates = []
        for story in stories:
            candidates.append(ClusterCandidate(
                id=story.id,
                title=story.title,
                summary=story.summary,
                content=story.content,
                category=story.category,
                severity=story.severity,
                source_id=story.source_id,
                published_at=story.published_at,
                language=getattr(story, 'language', None),  # Cross-lingual support
            ))

        return candidates

    async def _extract_all_features(self, candidates: List[ClusterCandidate]) -> None:
        """Extract features for all candidates."""
        for candidate in candidates:
            # Try to load cached features from DB
            cached = await self._get_cached_features(candidate.id)

            if cached:
                candidate.features = StoryFeatures(
                    story_id=str(candidate.id),
                    content_minhash=list(cached.content_minhash or []),
                    title_tokens=list(cached.title_tokens or []),
                    districts=list(cached.districts or []),
                    constituencies=list(cached.constituencies or []),
                    key_terms=list(cached.key_terms or []),
                    international_countries=list(getattr(cached, 'international_countries', None) or []),
                    topic=getattr(cached, 'topic', None),
                    # PALANTIR-GRADE entity blocking fields
                    title_district=getattr(cached, 'title_district', None),
                    title_country=getattr(cached, 'title_country', None),
                    title_entities=list(getattr(cached, 'title_entities', None) or []),
                    title_action=getattr(cached, 'title_action', None),
                )
            else:
                # Extract fresh features
                candidate.features = self.feature_extractor.extract(
                    title=candidate.title,
                    summary=candidate.summary,
                    content=candidate.content,
                    story_id=str(candidate.id),
                )

                # Cache features
                await self._cache_features(candidate.id, candidate.features)

    async def _get_cached_features(self, story_id: UUID) -> Optional[StoryFeature]:
        """Get cached features from database."""
        result = await self.db.execute(
            select(StoryFeature).where(StoryFeature.story_id == story_id)
        )
        return result.scalar_one_or_none()

    async def _cache_features(self, story_id: UUID, features: StoryFeatures) -> None:
        """Cache features to database."""
        try:
            feature_record = StoryFeature(
                story_id=story_id,
                content_minhash=features.content_minhash,
                title_tokens=features.title_tokens,
                districts=features.districts,
                constituencies=features.constituencies,
                key_terms=features.key_terms,
                international_countries=features.international_countries,
                topic=features.topic,
                # PALANTIR-GRADE blocking fields
                title_district=features.title_district,
                title_country=features.title_country,
                title_entities=features.title_entities if features.title_entities else None,
                title_action=features.title_action,
            )
            self.db.add(feature_record)
            await self.db.flush()
        except Exception as e:
            # Feature caching is optional, log and continue
            logger.debug(f"Failed to cache features for {story_id}: {e}")

    async def _create_or_update_cluster(
        self,
        stories: List[ClusterCandidate],
    ) -> Tuple[bool, Optional[StoryCluster]]:
        """Create or update a cluster from stories.

        If stories are already assigned to an existing cluster, update it.
        Otherwise create a new cluster.

        Returns:
            Tuple of (is_new, cluster) where is_new is True if created, False if updated
        """
        if not stories:
            return False, None

        # Check if any stories are already in a cluster
        story_ids = [s.id for s in stories]
        existing_cluster = await self._find_existing_cluster(story_ids)

        # Sort by published_at to get most recent
        sorted_stories = sorted(
            stories,
            key=lambda s: s.published_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )

        # Representative headline is most recent
        headline = sorted_stories[0].title

        # Aggregate summary
        summaries = [s.summary for s in stories if s.summary]
        summary = summaries[0] if summaries else None

        # Dominant category (most common)
        categories = [s.category for s in stories if s.category]
        category = max(set(categories), key=categories.count) if categories else None

        # Highest severity
        severities = [s.severity for s in stories if s.severity]
        severity = self._get_highest_severity(severities) if severities else None

        # Unique sources
        sources = set(s.source_id for s in stories)

        # Time range
        times = [s.published_at for s in stories if s.published_at]
        first_published = min(times) if times else None
        last_updated = max(times) if times else None

        if existing_cluster:
            # Update existing cluster
            existing_cluster.headline = headline
            existing_cluster.summary = summary
            existing_cluster.category = category
            existing_cluster.severity = severity
            existing_cluster.story_count = len(stories)
            existing_cluster.source_count = len(sources)
            existing_cluster.first_published = first_published
            existing_cluster.last_updated = last_updated
            return False, existing_cluster  # Not new, updated
        else:
            # Create new cluster
            cluster = StoryCluster(
                id=uuid4(),
                headline=headline,
                summary=summary,
                category=category,
                severity=severity,
                story_count=len(stories),
                source_count=len(sources),
                first_published=first_published,
                last_updated=last_updated,
            )
            self.db.add(cluster)
            return True, cluster  # New cluster

    async def _find_existing_cluster(self, story_ids: List[UUID]) -> Optional[StoryCluster]:
        """Find an existing cluster that contains any of the given stories."""
        result = await self.db.execute(
            select(Story.cluster_id)
            .where(
                and_(
                    Story.id.in_(story_ids),
                    Story.cluster_id.isnot(None),
                )
            )
            .limit(1)
        )
        row = result.first()

        if row and row[0]:
            # Found a cluster - fetch it
            cluster_result = await self.db.execute(
                select(StoryCluster).where(StoryCluster.id == row[0])
            )
            return cluster_result.scalar_one_or_none()

        return None

    async def _assign_stories_to_cluster(
        self,
        story_ids: List[UUID],
        cluster_id: UUID,
    ) -> None:
        """Update stories with cluster assignment."""
        for story_id in story_ids:
            result = await self.db.execute(
                select(Story).where(Story.id == story_id)
            )
            story = result.scalar_one_or_none()
            if story:
                story.cluster_id = cluster_id

    def _get_highest_severity(self, severities: List[str]) -> str:
        """Get highest severity from list."""
        priority = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        if not severities:
            return "low"
        return max(severities, key=lambda s: priority.get(s, 0))

    async def get_clustered_stories(
        self,
        hours: int = 72,
        category: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> List[StoryCluster]:
        """
        Get clusters with their stories.

        Args:
            hours: Time window in hours
            category: Filter by category
            severity: Filter by severity

        Returns:
            List of StoryCluster objects with stories loaded
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        query = (
            select(StoryCluster)
            .where(StoryCluster.first_published >= cutoff)
            .order_by(StoryCluster.first_published.desc().nullslast())
        )

        if category:
            query = query.where(StoryCluster.category == category)
        if severity:
            query = query.where(StoryCluster.severity == severity)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_unanalyzed_clusters(
        self,
        hours: int = 72,
        limit: int = 50,
    ) -> List[StoryCluster]:
        """
        Get clusters that haven't been analyzed yet.

        Args:
            hours: Time window in hours
            limit: Maximum clusters to return

        Returns:
            List of StoryCluster objects without analysis
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(StoryCluster)
            .where(
                and_(
                    StoryCluster.first_published >= cutoff,
                    StoryCluster.analyzed_at.is_(None),
                )
            )
            .order_by(StoryCluster.first_published.desc().nullslast())
            .limit(limit)
        )

        return list(result.scalars().all())

    # ============================================================
    # Haiku-Based Cross-Language Story Merge
    # ============================================================

    async def run_haiku_merge(self, hours: int = 48) -> dict:
        """
        Haiku-based story merge pass for cross-language clustering.

        Groups stories by district (from StoryFeature table),
        then sends each district batch to Haiku for semantic grouping.
        This catches cross-language (EN↔NE) and cross-category pairs
        that the embedding-based system misses.

        Returns stats dict.
        """
        from collections import defaultdict
        from sqlalchemy.orm import selectinload

        stats = {
            "stories_scanned": 0,
            "districts_processed": 0,
            "haiku_calls": 0,
            "merges": 0,
            "errors": [],
        }

        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Districts live in StoryFeature, not Story. Join to get them.
        # Use coalesce(published_at, created_at) since published_at is often NULL.
        result = await self.db.execute(
            select(Story, StoryFeature.districts)
            .join(StoryFeature, Story.id == StoryFeature.story_id)
            .where(
                and_(
                    func.coalesce(Story.published_at, Story.created_at) >= cutoff,
                    Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
                    StoryFeature.districts.isnot(None),
                )
            )
            .order_by(func.coalesce(Story.published_at, Story.created_at).desc())
        )
        rows = result.all()

        # Build story list with their districts
        story_map: dict[UUID, Story] = {}
        story_districts: dict[UUID, list[str]] = {}
        for story, districts in rows:
            if not districts:
                continue
            story_map[story.id] = story
            story_districts[story.id] = districts

        stats["stories_scanned"] = len(story_map)

        if len(story_map) < 2:
            return stats

        # Group stories by district — a story can appear in multiple district buckets
        by_district: dict[str, list[Story]] = defaultdict(list)
        for story_id, districts in story_districts.items():
            for district in districts:
                by_district[district.lower()].append(story_map[story_id])

        # Process each district batch
        stats["districts_skipped"] = 0
        for district, district_stories in by_district.items():
            if len(district_stories) < 2:
                continue

            # Deduplicate by story id (same story may be added via multiple districts)
            seen_ids = set()
            unique_stories = []
            for s in district_stories:
                if s.id not in seen_ids:
                    seen_ids.add(s.id)
                    unique_stories.append(s)

            if len(unique_stories) < 2:
                continue

            # OPTIMIZATION: Skip districts where ALL stories are already clustered
            # Only call Haiku when there are unclustered stories that need merging
            unclustered = [s for s in unique_stories if s.cluster_id is None]
            if not unclustered:
                stats["districts_skipped"] += 1
                continue

            stats["districts_processed"] += 1

            try:
                merges = await self._haiku_merge_batch(unique_stories, district)
                stats["haiku_calls"] += 1
                stats["merges"] += merges
                if merges > 0:
                    await self.db.flush()
                    logger.info(f"Haiku merge {district}: {merges} groups from {len(unique_stories)} stories")
            except Exception as e:
                logger.error(f"Haiku merge failed for district {district}: {e}")
                stats["errors"].append(f"{district}: {e}")

        try:
            await self.db.commit()
            logger.info("Haiku merge DB commit OK")
        except Exception as e:
            logger.error(f"Haiku merge commit FAILED: {e}")
            await self.db.rollback()

        logger.info(
            f"Haiku merge: scanned {stats['stories_scanned']} stories, "
            f"processed {stats['districts_processed']} districts "
            f"(skipped {stats.get('districts_skipped', 0)} fully-clustered), "
            f"merged {stats['merges']} story groups"
        )
        return stats

    async def _haiku_merge_batch(self, stories: list, district: str) -> int:
        """
        Send a batch of stories from the same district to the shared LLM runner.
        Claude remains primary; local fallback can be used when enabled.

        Returns number of merge operations performed.
        """
        from app.services.analyst_agent.claude_runner import call_claude_json, has_available_llm

        if not has_available_llm():
            logger.debug("No LLM provider available — skipping merge batch")
            return 0

        # Build numbered story list — include all stories (clustered + unclustered)
        # Mark clustered ones so Haiku can merge across clusters
        story_lines = []
        id_map: dict[int, "Story"] = {}
        for story in stories:
            if len(id_map) >= 25:
                break
            idx = len(id_map) + 1
            id_map[idx] = story
            title = story.title[:120].replace('\n', ' ')
            source = story.source_id or "?"
            cluster_tag = f" [C{str(story.cluster_id)[:4]}]" if story.cluster_id else ""
            story_lines.append(f"[{idx}] ({source}) {title}{cluster_tag}")

        if len(id_map) < 2:
            return 0

        story_block = "\n".join(story_lines)

        user_msg = (
            f"District: {district}\n\n"
            f"{story_block}\n\n"
            "Return raw JSON only in this exact shape:\n"
            "{\"groups\": [[1,3,5],[4,7]]}\n"
            "If there are no valid merges, return {\"groups\":[]}."
        )
        system_prompt = (
            "You identify news stories covering the SAME real-world event or incident. "
            "Group stories that cover the same event, including updates and follow-on reports. "
            "Do not group stories that only share a broad topic. "
            "Stories already tagged [Cxxxx] may be merged across clusters if they are the same event. "
            "Maximum 10 stories per group. Omit singletons."
        )

        try:
            result = await call_claude_json(
                user_msg,
                timeout=30,
                model="haiku",
                system_prompt=system_prompt,
            )
        except Exception as e:
            logger.warning("Haiku merge failed for %s: %s", district, e)
            return 0

        # Parse groups — cap at 10 per group
        raw_groups = result.get("groups", [])
        merges = 0

        for group_indices in raw_groups:
            if not isinstance(group_indices, list) or len(group_indices) < 2:
                continue

            group_indices = group_indices[:10]

            # Resolve to Story objects
            group_stories = []
            for idx in group_indices:
                if isinstance(idx, int) and idx in id_map:
                    group_stories.append(id_map[idx])

            if len(group_stories) < 2:
                continue

            # Collect all existing cluster IDs in this group
            existing_cluster_ids = set()
            for s in group_stories:
                if s.cluster_id:
                    existing_cluster_ids.add(s.cluster_id)

            if existing_cluster_ids:
                # Pick the largest existing cluster as the target
                target_cluster_id = None
                best_count = -1
                for cid in existing_cluster_ids:
                    res = await self.db.execute(
                        select(StoryCluster.story_count).where(StoryCluster.id == cid)
                    )
                    cnt = res.scalar() or 0
                    if cnt > best_count:
                        best_count = cnt
                        target_cluster_id = cid

                if not target_cluster_id:
                    continue

                # Move all stories in this group to the target cluster (SQL UPDATE)
                story_ids = [s.id for s in group_stories if s.cluster_id != target_cluster_id]
                if story_ids:
                    await self.db.execute(
                        text("UPDATE stories SET cluster_id = :cid WHERE id = ANY(:ids)"),
                        {"cid": target_cluster_id, "ids": story_ids},
                    )

                # Absorb orphan clusters
                orphan_cluster_ids = existing_cluster_ids - {target_cluster_id}
                for orphan_id in orphan_cluster_ids:
                    await self.db.execute(
                        text("UPDATE stories SET cluster_id = :target WHERE cluster_id = :orphan"),
                        {"target": target_cluster_id, "orphan": orphan_id},
                    )
                    await self.db.execute(
                        text("DELETE FROM story_clusters WHERE id = :oid"),
                        {"oid": orphan_id},
                    )

                # Recount and update target cluster
                count_result = await self.db.execute(
                    text("""
                        UPDATE story_clusters SET
                            story_count = sub.cnt,
                            source_count = sub.src,
                            headline = :headline,
                            last_updated = :updated
                        FROM (
                            SELECT count(*) as cnt, count(DISTINCT source_id) as src
                            FROM stories WHERE cluster_id = :cid
                        ) sub
                        WHERE story_clusters.id = :cid
                    """),
                    {
                        "cid": target_cluster_id,
                        "headline": max(
                            group_stories,
                            key=lambda s: s.published_at or s.created_at or datetime.min.replace(tzinfo=timezone.utc),
                        ).title,
                        "updated": max(
                            group_stories,
                            key=lambda s: s.published_at or s.created_at or datetime.min.replace(tzinfo=timezone.utc),
                        ).published_at or datetime.now(timezone.utc),
                    },
                )
                merges += 1
            else:
                # Create new cluster — all stories are unclustered
                sorted_stories = sorted(
                    group_stories,
                    key=lambda s: s.published_at or s.created_at or datetime.min.replace(tzinfo=timezone.utc),
                    reverse=True,
                )

                unique_sources = list(set(s.source_id for s in group_stories if s.source_id))
                categories = [s.category for s in group_stories if s.category]
                severities = [s.severity for s in group_stories if s.severity]
                times = [s.published_at or s.created_at for s in group_stories if s.published_at or s.created_at]

                new_cluster_id = uuid4()
                await self.db.execute(
                    text("""
                        INSERT INTO story_clusters (id, headline, summary, category, severity,
                            story_count, source_count, first_published, last_updated)
                        VALUES (:id, :headline, :summary, :category, :severity,
                            :story_count, :source_count, :first_published, :last_updated)
                    """),
                    {
                        "id": new_cluster_id,
                        "headline": sorted_stories[0].title,
                        "summary": sorted_stories[0].summary,
                        "category": max(set(categories), key=categories.count) if categories else None,
                        "severity": self._get_highest_severity(severities) if severities else None,
                        "story_count": len(group_stories),
                        "source_count": len(unique_sources),
                        "first_published": min(times) if times else None,
                        "last_updated": max(times) if times else None,
                    },
                )

                story_ids = [s.id for s in group_stories]
                await self.db.execute(
                    text("UPDATE stories SET cluster_id = :cid WHERE id = ANY(:ids)"),
                    {"cid": new_cluster_id, "ids": story_ids},
                )

                merges += 1

        return merges

    async def apply_external_merge(self, district: str, groups: list[list[str]], metadata: list[dict] | None = None) -> int:
        """
        Apply merge groups from an external source (e.g., local Claude CLI).
        Each group is a list of story UUIDs that should be merged.
        Optional metadata per group: {headline, bluf, event_type, severity, ...}
        """
        from uuid import UUID as _UUID

        merges = 0
        for gi, group_ids in enumerate(groups):
            meta = (metadata[gi] if metadata and gi < len(metadata) else {}) or {}
            if len(group_ids) < 2:
                continue

            # Resolve story UUIDs
            story_uuids = []
            for sid in group_ids[:10]:
                try:
                    story_uuids.append(_UUID(sid))
                except ValueError:
                    continue

            if len(story_uuids) < 2:
                continue

            # Fetch stories
            result = await self.db.execute(
                select(Story).where(Story.id.in_(story_uuids))
            )
            group_stories = result.scalars().all()
            if len(group_stories) < 2:
                continue

            # Collect existing cluster IDs
            existing_cluster_ids = set()
            for s in group_stories:
                if s.cluster_id:
                    existing_cluster_ids.add(s.cluster_id)

            if existing_cluster_ids:
                # Pick largest existing cluster
                target_cluster_id = None
                best_count = -1
                for cid in existing_cluster_ids:
                    res = await self.db.execute(
                        select(StoryCluster.story_count).where(StoryCluster.id == cid)
                    )
                    cnt = res.scalar() or 0
                    if cnt > best_count:
                        best_count = cnt
                        target_cluster_id = cid

                if not target_cluster_id:
                    continue

                story_ids = [s.id for s in group_stories if s.cluster_id != target_cluster_id]
                if story_ids:
                    await self.db.execute(
                        text("UPDATE stories SET cluster_id = :cid WHERE id = ANY(:ids)"),
                        {"cid": target_cluster_id, "ids": story_ids},
                    )

                # Absorb orphan clusters
                orphan_cluster_ids = existing_cluster_ids - {target_cluster_id}
                for orphan_id in orphan_cluster_ids:
                    await self.db.execute(
                        text("UPDATE stories SET cluster_id = :target WHERE cluster_id = :orphan"),
                        {"target": target_cluster_id, "orphan": orphan_id},
                    )
                    await self.db.execute(
                        text("DELETE FROM story_clusters WHERE id = :oid"),
                        {"oid": orphan_id},
                    )

                # Recount + store analysis metadata if available
                latest_story = max(
                    group_stories,
                    key=lambda s: s.published_at or s.created_at or datetime.min.replace(tzinfo=timezone.utc),
                )
                update_headline = meta.get("headline") or latest_story.title
                update_bluf = meta.get("bluf")
                update_params = {
                    "cid": target_cluster_id,
                    "headline": update_headline,
                    "updated": latest_story.published_at or datetime.now(timezone.utc),
                }
                analysis_json = {k: v for k, v in meta.items() if k not in ("headline", "indices")} if meta else None
                if analysis_json:
                    await self.db.execute(
                        text("""
                            UPDATE story_clusters SET
                                story_count = sub.cnt,
                                source_count = sub.src,
                                headline = :headline,
                                last_updated = :updated,
                                bluf = :bluf,
                                analysis = :analysis,
                                analyzed_at = now()
                            FROM (
                                SELECT count(*) as cnt, count(DISTINCT source_id) as src
                                FROM stories WHERE cluster_id = :cid
                            ) sub
                            WHERE story_clusters.id = :cid
                        """),
                        {**update_params, "bluf": update_bluf, "analysis": json.dumps(analysis_json)},
                    )
                else:
                    await self.db.execute(
                        text("""
                            UPDATE story_clusters SET
                                story_count = sub.cnt,
                                source_count = sub.src,
                                headline = :headline,
                                last_updated = :updated
                            FROM (
                                SELECT count(*) as cnt, count(DISTINCT source_id) as src
                                FROM stories WHERE cluster_id = :cid
                            ) sub
                            WHERE story_clusters.id = :cid
                        """),
                        update_params,
                    )
                merges += 1
            else:
                # All unclustered — create new cluster
                sorted_stories = sorted(
                    group_stories,
                    key=lambda s: s.published_at or s.created_at or datetime.min.replace(tzinfo=timezone.utc),
                    reverse=True,
                )
                unique_sources = list(set(s.source_id for s in group_stories if s.source_id))
                categories = [s.category for s in group_stories if s.category]
                severities = [s.severity for s in group_stories if s.severity]
                times = [s.published_at or s.created_at for s in group_stories if s.published_at or s.created_at]

                # Use metadata from enhanced clustering if available
                cluster_headline = meta.get("headline") or sorted_stories[0].title
                cluster_bluf = meta.get("bluf")
                cluster_severity = meta.get("severity") or (self._get_highest_severity(severities) if severities else None)
                cluster_category = meta.get("event_type") or (max(set(categories), key=categories.count) if categories else None)
                analysis_json = {k: v for k, v in meta.items() if k not in ("headline", "indices")} if meta else None

                new_cluster_id = uuid4()
                await self.db.execute(
                    text("""
                        INSERT INTO story_clusters (id, headline, summary, category, severity,
                            story_count, source_count, first_published, last_updated,
                            bluf, analysis, analyzed_at)
                        VALUES (:id, :headline, :summary, :category, :severity,
                            :story_count, :source_count, :first_published, :last_updated,
                            :bluf, :analysis, now())
                    """),
                    {
                        "id": new_cluster_id,
                        "headline": cluster_headline,
                        "summary": sorted_stories[0].summary,
                        "category": cluster_category,
                        "severity": cluster_severity,
                        "story_count": len(group_stories),
                        "source_count": len(unique_sources),
                        "first_published": min(times) if times else None,
                        "last_updated": max(times) if times else None,
                        "bluf": cluster_bluf,
                        "analysis": json.dumps(analysis_json) if analysis_json else None,
                    },
                )
                await self.db.execute(
                    text("UPDATE stories SET cluster_id = :cid WHERE id = ANY(:ids)"),
                    {"cid": new_cluster_id, "ids": [s.id for s in group_stories]},
                )
                merges += 1

        await self.db.flush()
        logger.info(f"External merge {district}: {merges} groups applied")
        return merges
