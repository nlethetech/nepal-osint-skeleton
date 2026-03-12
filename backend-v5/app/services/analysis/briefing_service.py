"""Intelligence briefing service using Claude 3.5 Haiku."""
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.analysis_batch import AnalysisBatch, BatchStatus as DBBatchStatus
from app.services.analysis.anthropic_client import (
    AnthropicBatchClient,
    BatchRequest,
    get_anthropic_client,
)

logger = logging.getLogger(__name__)

# Model to use for analysis
ANALYSIS_MODEL = os.environ.get(
    "ANTHROPIC_ANALYSIS_MODEL",
    os.environ.get("ANTHROPIC_MODEL", "claude-3-haiku-20240307"),
)

# System prompt for intelligence analysis (~1800 tokens for prompt caching)
INTEL_SYSTEM_PROMPT = """You are a senior intelligence analyst specializing in South Asian geopolitics, with particular expertise in Nepal. Your role is to analyze news stories and produce actionable intelligence briefings for decision-makers.

## Your Analytical Framework

1. **BLUF (Bottom Line Up Front)**: Start with the most important conclusion in 1-2 sentences.

2. **Key Judgment**: Provide your analytical assessment of the situation, including confidence level (HIGH/MEDIUM/LOW).

3. **Threat Assessment**:
   - Level: CRITICAL (immediate action needed), ELEVATED (increased monitoring), GUARDED (routine), or LOW (minimal concern)
   - Trajectory: ESCALATING, STABLE, or DE-ESCALATING

4. **Source Analysis**: Briefly summarize what each source reported and note any discrepancies.

5. **Recommended Actions**: 2-3 specific, actionable recommendations for stakeholders.

## Context on Nepal

Nepal is a federal democratic republic bordered by China (Tibet) to the north and India to the south, east, and west. Key factors:
- Political: Multi-party democracy with frequent coalition governments
- Economic: Remittance-dependent economy, tourism sector recovery
- Security: Border security concerns, internal political tensions
- Geographic: Vulnerable to natural disasters (earthquakes, floods, landslides)
- International: Balancing relations between India and China

## Output Format

Respond ONLY with valid JSON in this exact structure:
{
  "bluf": "string - 1-2 sentence summary of the key takeaway",
  "key_judgment": "string - your analytical assessment with confidence level",
  "threat_assessment": {
    "level": "CRITICAL|ELEVATED|GUARDED|LOW",
    "trajectory": "ESCALATING|STABLE|DE-ESCALATING",
    "rationale": "string - brief explanation"
  },
  "sources_summary": ["string array - what each source reported"],
  "recommended_actions": ["string array - 2-3 actionable recommendations"],
  "entities": {
    "people": ["mentioned people"],
    "organizations": ["mentioned orgs"],
    "locations": ["mentioned places"]
  },
  "category_confidence": {
    "category": "political|economic|security|disaster|social",
    "confidence": 0.0-1.0
  }
}

Do not include any text outside the JSON object. Ensure the JSON is valid and parseable."""


@dataclass
class AnalysisResult:
    """Result of analyzing a cluster."""
    cluster_id: UUID
    bluf: str
    analysis: Dict[str, Any]
    success: bool
    error: Optional[str] = None


class BriefingService:
    """
    Service for generating intelligence briefings using Claude 3.5 Haiku.

    Uses Anthropic's Batch API for 50% cost savings on non-time-sensitive analysis.
    Includes prompt caching for additional savings on the system prompt.
    """

    def __init__(
        self,
        db: AsyncSession,
        client: Optional[AnthropicBatchClient] = None,
    ):
        """
        Initialize the briefing service.

        Args:
            db: Database session
            client: Optional Anthropic client (defaults to singleton)
        """
        self.db = db
        self.client = client or get_anthropic_client()

    def _build_cluster_prompt(self, cluster: StoryCluster) -> str:
        """
        Build the user prompt for analyzing a cluster.

        Includes the cluster headline and all story details.
        """
        parts = [
            f"# News Cluster Analysis Request",
            f"",
            f"## Cluster Overview",
            f"- Headline: {cluster.headline}",
            f"- Category: {cluster.category or 'unknown'}",
            f"- Severity (system assigned): {cluster.severity or 'unknown'}",
            f"- Number of sources: {cluster.source_count}",
            f"- Time range: {cluster.first_published} to {cluster.last_updated}",
            f"",
            f"## Stories in this Cluster",
        ]

        for i, story in enumerate(cluster.stories, 1):
            parts.append(f"")
            parts.append(f"### Story {i}: {story.source_name or story.source_id}")
            parts.append(f"**Title**: {story.title}")
            parts.append(f"**Published**: {story.published_at}")
            if story.summary:
                parts.append(f"**Summary**: {story.summary[:500]}")
            if story.content and not story.summary:
                parts.append(f"**Content**: {story.content[:800]}")
            parts.append(f"**URL**: {story.url}")

        parts.append("")
        parts.append("Please analyze this cluster and provide your intelligence assessment.")

        return "\n".join(parts)

    async def generate_single_briefing(
        self,
        cluster_id: UUID,
    ) -> AnalysisResult:
        """
        Generate a briefing for a single cluster (synchronous, not batched).

        This is useful for immediate analysis needs but costs more than batching.

        Args:
            cluster_id: Cluster to analyze

        Returns:
            AnalysisResult with the briefing
        """
        # Fetch cluster with stories
        result = await self.db.execute(
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.id == cluster_id)
        )
        cluster = result.scalar_one_or_none()

        if not cluster:
            return AnalysisResult(
                cluster_id=cluster_id,
                bluf="",
                analysis={},
                success=False,
                error="Cluster not found",
            )

        # Use synchronous API for immediate result
        try:
            import anthropic

            client = anthropic.Anthropic()
            response = client.messages.create(
                model=ANALYSIS_MODEL,
                max_tokens=1500,
                system=INTEL_SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": self._build_cluster_prompt(cluster)}
                ],
            )

            # Parse response
            content = response.content[0].text
            analysis = json.loads(content)

            # Update cluster with analysis
            cluster.bluf = analysis.get("bluf", "")
            cluster.analysis = analysis
            cluster.analyzed_at = datetime.now(timezone.utc)
            cluster.analysis_model = ANALYSIS_MODEL

            await self.db.commit()

            return AnalysisResult(
                cluster_id=cluster_id,
                bluf=analysis.get("bluf", ""),
                analysis=analysis,
                success=True,
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse analysis JSON for cluster {cluster_id}: {e}")
            return AnalysisResult(
                cluster_id=cluster_id,
                bluf="",
                analysis={},
                success=False,
                error=f"JSON parse error: {str(e)}",
            )
        except Exception as e:
            logger.exception(f"Failed to analyze cluster {cluster_id}: {e}")
            return AnalysisResult(
                cluster_id=cluster_id,
                bluf="",
                analysis={},
                success=False,
                error=str(e),
            )

    async def submit_batch_analysis(
        self,
        cluster_ids: List[UUID],
    ) -> Optional[str]:
        """
        Submit a batch of clusters for analysis.

        Uses Anthropic Batch API for 50% cost savings.
        Results will be available within 24 hours.

        Args:
            cluster_ids: List of cluster IDs to analyze

        Returns:
            Batch ID if successful, None if failed
        """
        if not cluster_ids:
            return None

        # Fetch all clusters with stories
        result = await self.db.execute(
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.id.in_(cluster_ids))
        )
        clusters = list(result.scalars().all())

        if not clusters:
            logger.warning("No clusters found for batch analysis")
            return None

        # Build batch requests
        requests = []
        for cluster in clusters:
            prompt = self._build_cluster_prompt(cluster)
            requests.append(BatchRequest(
                custom_id=str(cluster.id),
                model=ANALYSIS_MODEL,
                max_tokens=1500,
                system=INTEL_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            ))

        try:
            # Submit batch to Anthropic
            batch_id = await self.client.create_batch(requests)

            # Store batch record in database
            batch_record = AnalysisBatch(
                anthropic_batch_id=batch_id,
                status=DBBatchStatus.PENDING,
                cluster_ids=cluster_ids,
                total_clusters=len(cluster_ids),
                completed_clusters=0,
            )
            self.db.add(batch_record)
            await self.db.commit()

            logger.info(f"Submitted batch {batch_id} with {len(clusters)} clusters")
            return batch_id

        except Exception as e:
            logger.exception(f"Failed to submit batch analysis: {e}")
            return None

    async def check_and_process_batch(
        self,
        batch_id: str,
    ) -> Dict[str, Any]:
        """
        Check batch status and process results if complete.

        Args:
            batch_id: Anthropic batch ID

        Returns:
            Status dict with processing info
        """
        status = {
            "batch_id": batch_id,
            "status": "unknown",
            "processed": 0,
            "succeeded": 0,
            "failed": 0,
        }

        try:
            # Get batch status from Anthropic
            batch_status = await self.client.get_batch_status(batch_id)
            status["status"] = batch_status.status

            # Update our database record
            result = await self.db.execute(
                select(AnalysisBatch).where(AnalysisBatch.anthropic_batch_id == batch_id)
            )
            batch_record = result.scalar_one_or_none()

            if batch_status.status == "ended":
                # Fetch and process results
                results = await self.client.get_batch_results(batch_id)

                for batch_result in results:
                    status["processed"] += 1
                    cluster_id = UUID(batch_result.custom_id)

                    if batch_result.result_type == "succeeded" and batch_result.message:
                        try:
                            # Extract text content from response
                            content = batch_result.message.get("content", [{}])[0].get("text", "{}")
                            analysis = json.loads(content)

                            # Update cluster
                            cluster_result = await self.db.execute(
                                select(StoryCluster).where(StoryCluster.id == cluster_id)
                            )
                            cluster = cluster_result.scalar_one_or_none()

                            if cluster:
                                cluster.bluf = analysis.get("bluf", "")
                                cluster.analysis = analysis
                                cluster.analyzed_at = datetime.now(timezone.utc)
                                cluster.analysis_model = ANALYSIS_MODEL
                                status["succeeded"] += 1

                        except (json.JSONDecodeError, KeyError) as e:
                            logger.error(f"Failed to parse result for cluster {cluster_id}: {e}")
                            status["failed"] += 1
                    else:
                        status["failed"] += 1
                        logger.warning(f"Batch result failed for cluster {cluster_id}: {batch_result.error}")

                # Update batch record
                if batch_record:
                    batch_record.status = DBBatchStatus.COMPLETED
                    batch_record.completed_clusters = status["succeeded"]
                    batch_record.completed_at = datetime.now(timezone.utc)

                await self.db.commit()

            elif batch_record:
                # Update processing status
                if batch_status.status == "processing":
                    batch_record.status = DBBatchStatus.PROCESSING

        except Exception as e:
            logger.exception(f"Error checking batch {batch_id}: {e}")
            status["error"] = str(e)

        return status

    async def get_pending_batches(self) -> List[AnalysisBatch]:
        """Get batches that are still processing."""
        result = await self.db.execute(
            select(AnalysisBatch).where(
                AnalysisBatch.status.in_([DBBatchStatus.PENDING, DBBatchStatus.PROCESSING])
            )
        )
        return list(result.scalars().all())

    async def analyze_unanalyzed_clusters(
        self,
        hours: int = 72,
        limit: int = 50,
    ) -> Optional[str]:
        """
        Find and submit unanalyzed clusters for batch analysis.

        Args:
            hours: Time window to search
            limit: Maximum clusters to analyze

        Returns:
            Batch ID if clusters were submitted, None otherwise
        """
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Find clusters without analysis
        result = await self.db.execute(
            select(StoryCluster.id)
            .where(
                and_(
                    StoryCluster.created_at >= cutoff,
                    StoryCluster.analyzed_at.is_(None),
                    StoryCluster.story_count >= 2,  # Only analyze multi-story clusters
                )
            )
            .order_by(StoryCluster.story_count.desc())  # Prioritize larger clusters
            .limit(limit)
        )

        cluster_ids = [row[0] for row in result.all()]

        if not cluster_ids:
            logger.info("No unanalyzed clusters found")
            return None

        logger.info(f"Found {len(cluster_ids)} unanalyzed clusters")
        return await self.submit_batch_analysis(cluster_ids)
