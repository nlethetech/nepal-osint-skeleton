"""Blocking rules for story clustering."""
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, Set, Tuple, Dict, List
from uuid import UUID

from app.services.clustering.feature_extractor import StoryFeatures

logger = logging.getLogger(__name__)


class HierarchicalBlocker:
    """
    Hierarchical blocking for efficient candidate generation.

    Reduces O(n^2) pairwise comparisons to O(n * block_size) by
    grouping stories into blocks based on:
    1. Constituency (most specific)
    2. District (medium specificity)
    3. Category + Time window (broadest)
    """

    def __init__(self, time_window_hours: int = 24):
        """
        Initialize the hierarchical blocker.

        Args:
            time_window_hours: Time window for temporal blocking
        """
        self.time_window_hours = time_window_hours

    def get_candidate_pairs(
        self,
        stories: List[Tuple[UUID, StoryFeatures, Optional[str], Optional[datetime]]],
    ) -> Set[Tuple[UUID, UUID]]:
        """
        Generate candidate pairs using hierarchical blocking.

        Args:
            stories: List of (story_id, features, category, published_at) tuples

        Returns:
            Set of (story_id1, story_id2) pairs to compare
        """
        candidates: Set[Tuple[UUID, UUID]] = set()

        # Build blocking indexes
        by_constituency: Dict[str, List[UUID]] = defaultdict(list)
        by_district: Dict[str, List[UUID]] = defaultdict(list)
        by_category_time: Dict[str, List[UUID]] = defaultdict(list)

        for story_id, features, category, published_at in stories:
            # Constituency blocking (most specific)
            for constituency in features.constituencies:
                by_constituency[constituency].append(story_id)

            # District blocking
            for district in features.districts:
                by_district[district].append(story_id)

            # Title district is especially important
            if features.title_district:
                by_district[features.title_district].append(story_id)

            # Category + time window blocking (broadest)
            if category and published_at:
                # Create time buckets (e.g., 6-hour windows)
                time_bucket = published_at.replace(
                    hour=published_at.hour // 6 * 6, minute=0, second=0, microsecond=0
                )
                key = f"{category}_{time_bucket.isoformat()}"
                by_category_time[key].append(story_id)

        # Generate pairs from each block
        # Priority: Constituency > District > Category+Time

        # Constituency pairs (highest confidence)
        for block in by_constituency.values():
            if len(block) >= 2:
                candidates.update(self._pairs_from_block(block))

        # District pairs
        for block in by_district.values():
            if len(block) >= 2:
                candidates.update(self._pairs_from_block(block))

        # Category+time pairs (lowest confidence, most numerous)
        for block in by_category_time.values():
            if len(block) >= 2:
                # Limit block size to avoid explosion
                block = block[:100]
                candidates.update(self._pairs_from_block(block))

        logger.debug(f"Generated {len(candidates)} candidate pairs from blocking")
        return candidates

    def _pairs_from_block(self, block: List[UUID]) -> Set[Tuple[UUID, UUID]]:
        """Generate all pairs from a block."""
        pairs = set()
        for i, id1 in enumerate(block):
            for id2 in block[i + 1:]:
                # Ensure consistent ordering
                if str(id1) < str(id2):
                    pairs.add((id1, id2))
                else:
                    pairs.add((id2, id1))
        return pairs


class BlockingRules:
    """
    Hard blocking rules for story clustering.

    Blocking rules prevent stories from being clustered together
    when they clearly should not be (different categories, too far apart in time, etc.).
    """

    # Maximum time gap in hours between stories to consider clustering
    MAX_TIME_GAP_HOURS = 48

    # Maximum stories in a single cluster
    MAX_CLUSTER_SIZE = 50

    def __init__(
        self,
        max_time_gap_hours: int = MAX_TIME_GAP_HOURS,
        max_cluster_size: int = MAX_CLUSTER_SIZE,
    ):
        """
        Initialize blocking rules.

        Args:
            max_time_gap_hours: Maximum hours between story publication times
            max_cluster_size: Maximum number of stories in a cluster
        """
        self.max_time_gap_hours = max_time_gap_hours
        self.max_cluster_size = max_cluster_size

    def should_block(
        self,
        category1: Optional[str],
        category2: Optional[str],
        time1: Optional[datetime],
        time2: Optional[datetime],
        source1: str,
        source2: str,
    ) -> tuple[bool, str]:
        """
        Check if two stories should be blocked from clustering.

        Args:
            category1: First story category
            category2: Second story category
            time1: First story publication time
            time2: Second story publication time
            source1: First story source_id
            source2: Second story source_id

        Returns:
            Tuple of (should_block, reason)
        """
        # Rule 1: Category mismatch - NOW STRICT (HARD BLOCK)
        # Previously we allowed cross-category clustering, but this caused mixed clusters
        # (e.g., crime stories mixed with election stories)
        # Now we require EXACT category match - stories about same event should have same category
        if category1 and category2 and category1 != category2:
            return True, f"category_mismatch:{category1}!={category2}"

        # Rule 2: Time gap > max hours → never cluster
        if time1 and time2:
            time_diff = abs((time1 - time2).total_seconds() / 3600)
            if time_diff > self.max_time_gap_hours:
                return True, f"time_gap:{time_diff:.1f}h>{self.max_time_gap_hours}h"

        # Rule 3: Same source same day → candidate (not blocked)
        # This is actually a positive signal, so we don't block
        # But we note it for potential boost

        return False, ""

    def should_block_with_features(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
        category1: Optional[str],
        category2: Optional[str],
        time1: Optional[datetime],
        time2: Optional[datetime],
    ) -> Tuple[bool, str]:
        """
        Check blocking rules using extracted features.

        Includes additional hard block rules for geographic constraints.

        Args:
            features1: First story features
            features2: Second story features
            category1: First story category
            category2: Second story category
            time1: First story publication time
            time2: Second story publication time

        Returns:
            Tuple of (should_block, reason)
        """
        # Rule 0: International countries in title must match (HARD BLOCK)
        # If both stories have different countries in title, they're about different events
        if features1.title_country and features2.title_country:
            if features1.title_country != features2.title_country:
                return True, f"intl_country_mismatch:{features1.title_country}!={features2.title_country}"

        # Rule 0b: One has international country, other has Nepal district -> BLOCK
        has_intl1 = bool(features1.international_countries) or bool(features1.title_country)
        has_intl2 = bool(features2.international_countries) or bool(features2.title_country)
        has_nepal1 = bool(features1.districts) or bool(features1.title_district)
        has_nepal2 = bool(features2.districts) or bool(features2.title_district)

        if (has_intl1 and has_nepal2) or (has_intl2 and has_nepal1):
            return True, "intl_vs_nepal_location"

        # Rule 0c: Both have international locations but different ones -> BLOCK
        if has_intl1 and has_intl2:
            intl1 = set(features1.international_countries)
            intl2 = set(features2.international_countries)
            if features1.title_country:
                intl1.add(features1.title_country)
            if features2.title_country:
                intl2.add(features2.title_country)

            # Must have at least one common international location
            if intl1 and intl2 and not (intl1 & intl2):
                return True, "no_intl_overlap"

        # Rule 0d: Asymmetric international geography -> HARD BLOCK
        # If one has international locations but the other has NO geography at all, don't cluster
        has_any_geo1 = has_intl1 or has_nepal1
        has_any_geo2 = has_intl2 or has_nepal2
        if has_intl1 and not has_any_geo2:
            return True, "asymmetric_intl_geography"
        if has_intl2 and not has_any_geo1:
            return True, "asymmetric_intl_geography"

        # Rule 1: Title districts must match (HARD BLOCK)
        # If both stories have a district in the title, they must match
        if features1.title_district and features2.title_district:
            if features1.title_district != features2.title_district:
                return True, f"title_district_mismatch:{features1.title_district}!={features2.title_district}"

        # Rule 2: Category mismatch - NOW STRICT (HARD BLOCK)
        # Same as should_block() - require EXACT category match
        if category1 and category2 and category1 != category2:
            return True, f"category_mismatch:{category1}!={category2}"

        # Rule 3: Time gap > max hours -> never cluster
        if time1 and time2:
            time_diff = abs((time1 - time2).total_seconds() / 3600)
            if time_diff > self.max_time_gap_hours:
                return True, f"time_gap:{time_diff:.1f}h>{self.max_time_gap_hours}h"

        # Rule 4: Asymmetric Nepal geography (SOFT)
        # One story may include a district while another uses a generic headline.
        # We rely on similarity scoring + other hard blocks instead of blocking here.

        # Rule 5: If both have Nepal geography, must have overlap
        if has_nepal1 and has_nepal2:
            geo1 = set(features1.districts)
            geo2 = set(features2.districts)
            if features1.title_district:
                geo1.add(features1.title_district)
            if features2.title_district:
                geo2.add(features2.title_district)

            # Must have at least one common location
            if not (geo1 & geo2):
                return True, "no_geographic_overlap"

        # Rule 6: Different topics -> HARD BLOCK
        # Stories about elections should never cluster with weather, sports, etc.
        if features1.topic and features2.topic:
            if features1.topic != features2.topic:
                return True, f"topic_mismatch:{features1.topic}!={features2.topic}"

        # Rule 7: One has a specific topic, other doesn't -> BLOCK
        # This prevents specific topic stories from clustering with generic stories
        # Soft: topic extraction can be missing on one side.

        # ========================================
        # PALANTIR-GRADE ENTITY BLOCKING (CRITICAL)
        # ========================================

        # Rule 8: Different named entities -> HARD BLOCK
        # Stories about Oli should NEVER cluster with stories about Karki
        # Stories about Prachanda should NEVER cluster with stories about Deuba
        if features1.title_entities and features2.title_entities:
            entities1 = set(features1.title_entities)
            entities2 = set(features2.title_entities)
            # If both have entities but no overlap -> HARD BLOCK
            if not (entities1 & entities2):
                return True, f"entity_mismatch:{entities1}!={entities2}"

        # Rule 9: One story has named entity, other doesn't -> SOFT BLOCK
        # A story specifically about Oli shouldn't cluster with generic political news
        # Soft: entity extraction can be missing; let similarity decide.

        # Rule 10: Different actions for SAME entity -> HARD BLOCK
        # "Oli's clarification about 2023" != "Oli meets Chinese ambassador"
        if features1.title_entities and features2.title_entities:
            entities1 = set(features1.title_entities)
            entities2 = set(features2.title_entities)
            # If same entities but different actions -> BLOCK
            if entities1 == entities2:
                if features1.title_action and features2.title_action:
                    if features1.title_action != features2.title_action:
                        return True, f"action_mismatch:{features1.title_action}!={features2.title_action}"

        return False, ""

    def can_add_to_cluster(
        self,
        cluster_category: Optional[str],
        cluster_first_time: Optional[datetime],
        cluster_last_time: Optional[datetime],
        cluster_size: int,
        story_category: Optional[str],
        story_time: Optional[datetime],
    ) -> tuple[bool, str]:
        """
        Check if a story can be added to an existing cluster.

        Args:
            cluster_category: Cluster's dominant category
            cluster_first_time: Earliest story time in cluster
            cluster_last_time: Latest story time in cluster
            cluster_size: Current number of stories in cluster
            story_category: Story's category
            story_time: Story's publication time

        Returns:
            Tuple of (can_add, reason)
        """
        # Rule 1: Cluster at max size
        if cluster_size >= self.max_cluster_size:
            return False, f"cluster_full:{cluster_size}>={self.max_cluster_size}"

        # Rule 2: Category mismatch
        if (
            cluster_category and
            story_category and
            cluster_category != story_category
        ):
            return False, f"category_mismatch:{story_category}!={cluster_category}"

        # Rule 3: Time window exceeded
        if story_time and cluster_first_time:
            time_from_first = abs((story_time - cluster_first_time).total_seconds() / 3600)
            if time_from_first > self.max_time_gap_hours:
                return False, f"time_from_first:{time_from_first:.1f}h>{self.max_time_gap_hours}h"

        return True, ""

    def get_time_diff_hours(
        self,
        time1: Optional[datetime],
        time2: Optional[datetime],
    ) -> float:
        """Get time difference in hours between two timestamps."""
        if not time1 or not time2:
            return 0.0

        return abs((time1 - time2).total_seconds() / 3600)

    def is_same_source_same_day(
        self,
        source1: str,
        source2: str,
        time1: Optional[datetime],
        time2: Optional[datetime],
    ) -> bool:
        """Check if two stories are from the same source on the same day."""
        if source1 != source2:
            return False

        if not time1 or not time2:
            return False

        return time1.date() == time2.date()
