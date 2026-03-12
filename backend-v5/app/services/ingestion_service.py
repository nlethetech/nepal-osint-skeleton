"""Ingestion service for processing RSS articles into stories."""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import yaml
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.ingestion.rss_fetcher import RSSFetcher, FetchedArticle, FetchResult
from app.ingestion.deduplicator import Deduplicator, normalize_url, generate_external_id
from app.ingestion.realtime_dedup import get_realtime_deduplicator, compute_similarity
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.story_entity_link import StoryEntityLink
from app.models.political_entity import PoliticalEntity
from app.repositories.story import StoryRepository
from app.services.relevance_service import RelevanceService, RelevanceLevel
from app.services.severity_service import SeverityService
from app.services.analysis.haiku_relevance_filter import verify_nepal_relevance, should_haiku_verify
from app.services.editorial_control_service import EditorialControlService
from app.core.realtime_bus import publish_news
from app.ml.feature_extraction import extract_severity_tokens
from app.ml.inference import get_predictor

logger = logging.getLogger(__name__)
settings = get_settings()

# RL prediction confidence threshold - use RL prediction if confidence >= this
RL_CONFIDENCE_THRESHOLD = 0.6


class IngestionService:
    """
    Service for ingesting RSS feeds into the database.

    Handles:
    - Loading source configuration
    - Fetching RSS feeds
    - Deduplication
    - Nepal relevance classification
    - Category and severity classification
    - Database storage
    """

    def __init__(self, db: AsyncSession, use_rl: bool = True):
        self.db = db
        self.repo = StoryRepository(db)
        self.relevance = RelevanceService()
        self.severity = SeverityService()
        self.deduplicator = Deduplicator()
        self.realtime_dedup = get_realtime_deduplicator()  # Real-time title similarity matching
        self._sources: Optional[list[dict]] = None
        self._new_story_payloads: list[dict] = []  # Track new stories for WebSocket broadcast
        self.use_rl = use_rl
        self._rl_predictor = None

    async def _create_realtime_cluster(
        self,
        new_story: Story,
        matched_title: str,
    ) -> Optional[str]:
        """
        Create a cluster for two similar stories detected at ingestion time.

        If matched story already has a cluster, return that cluster_id.
        Otherwise, create a new cluster and assign both stories to it.
        """
        try:
            # Find the matched story in database by title (recent only)
            from sqlalchemy import select
            from datetime import timedelta

            recent_cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
            result = await self.db.execute(
                select(Story)
                .where(Story.title == matched_title)
                .where(Story.created_at >= recent_cutoff)
                .limit(1)
            )
            matched_story = result.scalar_one_or_none()

            if not matched_story:
                return None

            # If matched story has a cluster, use it
            if matched_story.cluster_id:
                # Update cluster counts
                cluster_result = await self.db.execute(
                    select(StoryCluster).where(StoryCluster.id == matched_story.cluster_id)
                )
                cluster = cluster_result.scalar_one_or_none()
                if cluster:
                    cluster.story_count += 1
                    if new_story.source_id not in (cluster.unique_sources or []):
                        cluster.source_count += 1
                        cluster.unique_sources = (cluster.unique_sources or []) + [new_story.source_id]
                return str(matched_story.cluster_id)

            # Create new cluster for both stories
            cluster = StoryCluster(
                headline=new_story.title,  # Use newest as headline
                summary=new_story.summary,
                category=new_story.category,
                severity=new_story.severity,
                story_count=2,
                source_count=2 if new_story.source_id != matched_story.source_id else 1,
                unique_sources=[matched_story.source_id, new_story.source_id],
                confidence_level="corroborated",
            )
            self.db.add(cluster)
            await self.db.flush()

            # Assign both stories to cluster
            matched_story.cluster_id = cluster.id
            new_story.cluster_id = cluster.id

            logger.info(
                f"Real-time cluster created: {cluster.id} with 2 stories "
                f"({matched_story.source_name}, {new_story.source_name})"
            )

            return str(cluster.id)

        except Exception as e:
            logger.warning(f"Failed to create real-time cluster: {e}")
            return None

    def _get_rl_predictor(self):
        if self._rl_predictor is None and self.use_rl:
            try:
                self._rl_predictor = get_predictor()
                if not self._rl_predictor._initialized:
                    self._rl_predictor.initialize()
            except Exception as e:
                logger.warning(f"Failed to initialize RL predictor: {e}")
                self._rl_predictor = None
        return self._rl_predictor

    def _load_sources(self) -> list[dict]:
        """Load RSS sources from config file."""
        if self._sources is not None:
            return self._sources

        try:
            with open(settings.sources_config_path) as f:
                config = yaml.safe_load(f)
                self._sources = config.get("sources", [])
        except FileNotFoundError:
            logger.error(f"Sources config not found: {settings.sources_config_path}")
            self._sources = []

        return self._sources

    def get_sources(self, priority_max: int = 10, active_only: bool = True) -> list[dict]:
        """Get filtered list of sources for RSS fetching.

        Sources with 'scrape_method' are skipped - they use dedicated scrapers.
        """
        sources = self._load_sources()

        filtered = []
        for s in sources:
            if active_only and not s.get("is_active", True):
                continue
            if s.get("priority", 5) > priority_max:
                continue
            # Skip sources with scrape_method - they use dedicated scrapers (e.g., ratopati_scraper.py)
            if s.get("scrape_method"):
                continue
            filtered.append(s)

        return filtered

    def get_priority_sources(self) -> list[dict]:
        """Get high-priority sources (priority 1-2)."""
        return self.get_sources(priority_max=2)

    async def ingest_all(
        self,
        priority_only: bool = False,
        max_sources: Optional[int] = None,
    ) -> dict:
        """
        Fetch and ingest all RSS sources.

        Args:
            priority_only: Only fetch priority 1-2 sources
            max_sources: Limit number of sources to fetch

        Returns:
            Summary dict with counts
        """
        if priority_only:
            sources = self.get_priority_sources()
        else:
            sources = self.get_sources()

        if max_sources:
            sources = sources[:max_sources]

        if not sources:
            return {"sources": 0, "fetched": 0, "new": 0, "duplicates": 0}

        logger.info(f"Fetching {len(sources)} RSS sources...")

        # Fetch all sources concurrently
        async with RSSFetcher(
            max_concurrent=settings.rss_max_concurrent,
            timeout=settings.rss_timeout,
        ) as fetcher:
            results = await fetcher.fetch_many(sources)

        # Process results
        stats = {
            "sources": len(sources),
            "sources_success": 0,
            "sources_failed": 0,
            "fetched": 0,
            "new": 0,
            "duplicates": 0,
            "international": 0,
            "failed": 0,
            "errors": [],
        }

        for result in results:
            if result.success:
                stats["sources_success"] += 1
                stats["fetched"] += len(result.articles)

                # Process articles
                for article in result.articles:
                    outcome = await self._process_article(article)
                    stats[outcome] += 1
            else:
                stats["sources_failed"] += 1
                stats["errors"].append({
                    "source": result.source_id,
                    "error": result.error,
                })
                logger.warning(f"Failed to fetch {result.source_id}: {result.error}")

        # Commit all new stories before broadcasting
        try:
            await self.db.commit()
        except Exception:
            # Ensure connection/transaction state is cleared for subsequent jobs.
            try:
                await self.db.rollback()
            except Exception:
                pass
            raise
        await self._broadcast_new_stories()

        logger.info(
            f"Ingestion complete: {stats['new']} new, "
            f"{stats['duplicates']} duplicates, "
            f"{stats['international']} filtered"
        )

        return stats

    async def _broadcast_new_stories(self):
        """Broadcast all new stories to WebSocket clients."""
        if not self._new_story_payloads:
            return

        for payload in self._new_story_payloads:
            try:
                await publish_news(
                    {
                        "type": "new_story",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": payload,
                    }
                )
            except Exception as e:
                logger.warning(f"Failed to broadcast story: {e}")

        # Clear the list
        self._new_story_payloads = []

    async def _process_article(self, article: FetchedArticle) -> str:
        """
        Process a single article.

        Returns:
            "new" if created, "duplicates" if already exists, "international" if filtered
        """
        # Check in-memory dedup first (by external_id)
        if not self.deduplicator.check_and_mark(article.external_id):
            return "duplicates"

        # Check database dedup by external_id
        if await self.repo.exists_by_external_id(article.external_id):
            return "duplicates"

        # Also check by URL (unique constraint)
        if await self.repo.exists_by_url(article.url):
            return "duplicates"

        # Real-time title similarity check - find existing similar story
        # This catches duplicate stories from different sources (same event, different URL)
        similar_match = self.realtime_dedup.find_match(
            title=article.title,
            timestamp=article.published_at,
        )
        matched_cluster_id = None
        matched_title = None
        if similar_match:
            matched_title, matched_cluster_id, similarity_score = similar_match
            logger.debug(
                f"Real-time match ({similarity_score:.0%}): '{article.title[:40]}' "
                f"-> '{matched_title[:40]}'"
            )

        # Classify Nepal relevance
        relevance = self.relevance.classify(
            title=article.title,
            content=article.summary,
            source_id=article.source_id,
        )

        # Skip international stories
        if relevance.level == RelevanceLevel.INTERNATIONAL:
            return "international"

        # Haiku verification for borderline stories
        if settings.haiku_relevance_filter_enabled and should_haiku_verify(
            relevance.score, relevance.triggers, article.title
        ):
            control_service = EditorialControlService(self.db)
            if await control_service.is_enabled("haiku_relevance"):
                haiku_result = await verify_nepal_relevance(
                    title=article.title,
                    summary=article.summary,
                    source_name=article.source_name,
                )
                if haiku_result is False:
                    # Haiku says NOT relevant — filter out
                    return "international"
                if haiku_result is True:
                    # Haiku confirmed relevant — mark it
                    relevance.triggers.append("HAIKU_VERIFIED")

        # Classify severity (rule-based)
        severity_result = self.severity.grade(
            title=article.title,
            content=article.summary,
            nepal_relevance=relevance.level.value,
            relevance_score=relevance.score,
        )

        # Get initial category and severity from rules
        final_category = relevance.category.value if relevance.category else None
        final_severity = severity_result.level.value

        # Apply RL predictions if enabled and confident
        rl_predictor = self._get_rl_predictor()
        rl_category_used = False
        rl_priority_used = False

        if rl_predictor:
            try:
                # RL Category prediction
                category_pred = rl_predictor.classify_story(
                    title=article.title,
                    content=article.summary,
                )
                if category_pred.confidence >= RL_CONFIDENCE_THRESHOLD:
                    final_category = category_pred.category
                    rl_category_used = True
                    logger.debug(
                        f"RL category: {category_pred.category} "
                        f"({category_pred.confidence:.0%}) for '{article.title[:50]}'"
                    )

                # RL Priority prediction
                severity_tokens = extract_severity_tokens(article.title, article.summary)
                priority_pred = rl_predictor.predict_priority(
                    category=final_category,
                    severity_keywords=severity_tokens,
                    source_id=article.source_id,
                )
                if priority_pred.confidence >= RL_CONFIDENCE_THRESHOLD:
                    severity_rank = {"low": 1, "medium": 2, "high": 3, "critical": 4}
                    if severity_rank.get(priority_pred.priority, 0) >= severity_rank.get(final_severity, 0):
                        final_severity = priority_pred.priority
                        rl_priority_used = True
                        logger.debug(
                            f"RL priority: {priority_pred.priority} "
                            f"({priority_pred.confidence:.0%})"
                        )

            except Exception as e:
                logger.warning(f"RL prediction failed, using rules: {e}")

        # Log RL usage stats periodically
        if rl_category_used or rl_priority_used:
            logger.info(
                f"RL predictions used - category: {rl_category_used}, "
                f"priority: {rl_priority_used} for '{article.title[:40]}...'"
            )

        # Create story with cluster_id if matched to existing story
        story = Story(
            external_id=article.external_id,
            source_id=article.source_id,
            source_name=article.source_name,
            title=article.title,
            url=article.url,
            summary=article.summary,
            language=article.language,
            author=article.author,
            categories=article.categories,
            published_at=article.published_at,
            scraped_at=datetime.now(timezone.utc),
            nepal_relevance=relevance.level.value,
            relevance_score=relevance.score,
            relevance_triggers=relevance.triggers,
            category=final_category,
            severity=final_severity,
            cluster_id=matched_cluster_id,  # Assign cluster from similar story
        )

        try:
            async with self.db.begin_nested():
                self.db.add(story)
                await self.db.flush()  # Check for constraint violations early

            # Create real-time cluster if similar story found but no cluster exists
            if matched_title and not matched_cluster_id:
                new_cluster_id = await self._create_realtime_cluster(story, matched_title)
                if new_cluster_id:
                    matched_cluster_id = new_cluster_id

            self._new_story_payloads.append(
                {
                    "id": str(story.id),
                    "title": story.title,
                    "url": story.url,
                    "summary": story.summary,
                    "source_id": story.source_id,
                    "source_name": story.source_name,
                    "category": story.category,
                    "severity": story.severity,
                    "nepal_relevance": story.nepal_relevance,
                    "published_at": story.published_at.isoformat() if story.published_at else None,
                    "created_at": story.created_at.isoformat() if story.created_at else None,
                    "cluster_id": str(story.cluster_id) if story.cluster_id else None,
                }
            )

            # Add to realtime dedup cache for future matching
            # Use matched_cluster_id as it may have been created after story insertion
            final_cluster_id = matched_cluster_id or (str(story.cluster_id) if story.cluster_id else None)
            self.realtime_dedup.add_to_cache(
                title=story.title,
                cluster_id=final_cluster_id,
                timestamp=story.published_at or datetime.now(timezone.utc),
            )

            # Extract and link entities (non-blocking - errors don't fail ingestion)
            await self._extract_and_link_entities(story)

            return "new"
        except IntegrityError:
            logger.debug(f"Duplicate story skipped: {article.url[:50]}")
            return "duplicates"
        except Exception as e:
            logger.exception(f"Failed to insert story: {e}")
            return "failed"

    async def _extract_and_link_entities(self, story: Story) -> None:
        """Extract entities from story and create StoryEntityLink records."""
        try:
            from app.services.nlp.database_entity_extractor import get_database_entity_extractor

            extractor = get_database_entity_extractor()
            if not extractor.is_initialized:
                return  # Extractor not yet initialized; scheduler will backfill

            text = f"{story.title} {story.summary or ''}"
            entities = await extractor.extract(text, min_confidence=0.6, session=self.db)

            if not entities:
                return

            # Build canonical_id → entity UUID mapping (lazy-loaded once)
            if not hasattr(self, '_entity_map') or self._entity_map is None:
                result = await self.db.execute(
                    select(PoliticalEntity.canonical_id, PoliticalEntity.id)
                )
                self._entity_map = {row[0]: row[1] for row in result.all()}

            for entity in entities:
                entity_uuid = self._entity_map.get(entity.canonical_id)
                if not entity_uuid:
                    continue

                is_title = entity.text.lower() in story.title.lower() if story.title else False

                link = StoryEntityLink(
                    story_id=story.id,
                    entity_id=entity_uuid,
                    is_title_mention=is_title,
                    confidence=entity.confidence,
                )
                self.db.add(link)

        except Exception as e:
            logger.debug(f"Entity extraction skipped for story {story.id}: {e}")

    async def ingest_single_source(self, source_id: str) -> dict:
        """Fetch and ingest a single source by ID."""
        sources = self._load_sources()
        source = next((s for s in sources if s["id"] == source_id), None)

        if not source:
            return {"error": f"Source not found: {source_id}"}

        async with RSSFetcher() as fetcher:
            result = await fetcher.fetch_source(
                source_id=source["id"],
                source_name=source["name"],
                url=source["url"],
                language=source.get("language", "en"),
            )

        if not result.success:
            return {"error": result.error, "source": source_id}

        stats = {"fetched": len(result.articles), "new": 0, "duplicates": 0, "international": 0, "failed": 0}

        for article in result.articles:
            outcome = await self._process_article(article)
            stats[outcome] += 1

        try:
            await self.db.commit()
        except Exception:
            try:
                await self.db.rollback()
            except Exception:
                pass
            raise
        await self._broadcast_new_stories()

        return stats
