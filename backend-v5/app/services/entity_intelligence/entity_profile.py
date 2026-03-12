"""EntityProfileService - Build comprehensive entity dossiers."""
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any
from uuid import UUID
import logging

from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.political_entity import PoliticalEntity
from app.models.story_entity_link import StoryEntityLink
from app.models.story import Story
from app.models.entity_relationship import (
    EntityRelationship,
    EntityNetworkMetrics,
    RelationshipType,
    MetricWindowType,
)

logger = logging.getLogger(__name__)


class EntityProfileService:
    """
    Builds comprehensive entity profiles (dossiers).

    Aggregates information from multiple sources:
    - Basic entity information (with enrichment fields)
    - Story mentions and trends
    - Network relationships
    - Network metrics (centrality, influence)
    - Election history (via linked Candidates)
    - Parliament record (via linked MPPerformance)
    - Executive record (via linked MinisterialPosition)
    - Business connections (via linked CompanyDirector)
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_full_profile(
        self,
        entity_id: UUID,
        include_stories: bool = True,
        include_relationships: bool = True,
        include_metrics: bool = True,
        include_parliament: bool = True,
        story_limit: int = 20,
        relationship_limit: int = 30,
    ) -> Optional[Dict[str, Any]]:
        """
        Build a comprehensive entity profile/dossier.

        This is the main endpoint for the EntityProfilePanel component.
        """
        # Get base entity
        result = await self.db.execute(
            select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
        )
        entity = result.scalar_one_or_none()

        if not entity:
            return None

        profile = {
            "entity": self._serialize_entity(entity),
            "mention_summary": await self._get_mention_summary(entity_id),
        }

        if include_stories:
            profile["recent_stories"] = await self._get_recent_stories(entity_id, story_limit)
            profile["story_categories"] = await self._get_story_categories(entity_id)

        if include_relationships:
            profile["relationships"] = await self._get_relationships(entity_id, relationship_limit)
            profile["top_co_mentions"] = await self._get_top_co_mentions(entity_id, 10)

        if include_metrics:
            profile["network_metrics"] = await self._get_network_metrics(entity_id)

        if include_parliament:
            profile["parliament_record"] = await self._get_parliament_record(entity_id)

        # New unified sections
        profile["election_history"] = await self._get_election_history(entity_id)
        profile["executive_record"] = await self._get_executive_record(entity_id)
        profile["business_connections"] = await self._get_business_connections(entity_id)

        profile["generated_at"] = datetime.now(timezone.utc).isoformat()

        return profile

    def _serialize_entity(self, entity: PoliticalEntity) -> Dict[str, Any]:
        """Serialize base entity information including enrichment fields."""
        return {
            "id": str(entity.id),
            "canonical_id": entity.canonical_id,
            "name_en": entity.name_en,
            "name_ne": entity.name_ne,
            "entity_type": entity.entity_type.value,
            "party": entity.party,
            "role": entity.role,
            "aliases": entity.aliases or [],
            "description": entity.description,
            "image_url": entity.image_url,
            # Enrichment fields
            "biography": entity.biography,
            "biography_source": getattr(entity, "biography_source", None),
            "education": entity.education,
            "education_institution": getattr(entity, "education_institution", None),
            "age": entity.age,
            "gender": entity.gender,
            "former_parties": entity.former_parties,
            "current_position": entity.current_position,
            "position_history": entity.position_history,
            # Mention stats
            "total_mentions": entity.total_mentions,
            "mentions_24h": entity.mentions_24h,
            "mentions_7d": entity.mentions_7d,
            "trend": entity.trend.value,
            "last_mentioned_at": entity.last_mentioned_at.isoformat() if entity.last_mentioned_at else None,
            "is_watchable": entity.is_watchable,
            "extra_data": entity.extra_data,
        }

    async def _get_mention_summary(self, entity_id: UUID) -> Dict[str, Any]:
        """Get mention statistics summary."""
        now = datetime.now(timezone.utc)

        # Mentions by time period
        periods = [
            ("24h", timedelta(hours=24)),
            ("7d", timedelta(days=7)),
            ("30d", timedelta(days=30)),
            ("90d", timedelta(days=90)),
        ]

        mentions_by_period = {}
        for name, delta in periods:
            cutoff = now - delta
            result = await self.db.execute(
                select(func.count(StoryEntityLink.id))
                .join(Story, StoryEntityLink.story_id == Story.id)
                .where(StoryEntityLink.entity_id == entity_id)
                .where(Story.published_at >= cutoff)
            )
            mentions_by_period[name] = result.scalar() or 0

        # Daily trend (last 14 days)
        cutoff_14d = now - timedelta(days=14)
        result = await self.db.execute(
            select(
                func.date_trunc('day', Story.published_at).label('date'),
                func.count(StoryEntityLink.id).label('count'),
            )
            .join(Story, StoryEntityLink.story_id == Story.id)
            .where(StoryEntityLink.entity_id == entity_id)
            .where(Story.published_at >= cutoff_14d)
            .group_by(func.date_trunc('day', Story.published_at))
            .order_by(func.date_trunc('day', Story.published_at))
        )
        daily_trend = [
            {"date": row.date.isoformat() if row.date else None, "count": row.count}
            for row in result.all()
        ]

        return {
            "by_period": mentions_by_period,
            "daily_trend": daily_trend,
        }

    async def _get_recent_stories(
        self,
        entity_id: UUID,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Get recent stories mentioning this entity."""
        result = await self.db.execute(
            select(Story, StoryEntityLink.confidence, StoryEntityLink.is_title_mention)
            .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
            .where(StoryEntityLink.entity_id == entity_id)
            .order_by(Story.published_at.desc())
            .limit(limit)
        )

        stories = []
        for row in result.all():
            story = row.Story
            stories.append({
                "id": str(story.id),
                "title": story.title,
                "summary": story.summary,
                "url": story.url,
                "source_name": story.source_name,
                "category": story.category,
                "severity": story.severity,
                "published_at": story.published_at.isoformat() if story.published_at else None,
                "mention_confidence": row.confidence,
                "is_title_mention": row.is_title_mention,
            })

        return stories

    async def _get_story_categories(self, entity_id: UUID) -> Dict[str, int]:
        """Get breakdown of story categories for this entity."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)

        result = await self.db.execute(
            select(Story.category, func.count(StoryEntityLink.id).label('count'))
            .join(StoryEntityLink, StoryEntityLink.story_id == Story.id)
            .where(StoryEntityLink.entity_id == entity_id)
            .where(Story.published_at >= cutoff)
            .group_by(Story.category)
            .order_by(desc('count'))
        )

        return {row.category or "unknown": row.count for row in result.all()}

    async def _get_relationships(
        self,
        entity_id: UUID,
        limit: int = 30,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Get entity relationships grouped by type."""
        result = await self.db.execute(
            select(EntityRelationship, PoliticalEntity)
            .join(
                PoliticalEntity,
                (EntityRelationship.source_entity_id == PoliticalEntity.id) |
                (EntityRelationship.target_entity_id == PoliticalEntity.id)
            )
            .where(
                (EntityRelationship.source_entity_id == entity_id) |
                (EntityRelationship.target_entity_id == entity_id)
            )
            .where(PoliticalEntity.id != entity_id)
            .order_by(EntityRelationship.strength_score.desc())
            .limit(limit)
        )

        relationships_by_type: Dict[str, List[Dict[str, Any]]] = {}

        seen_pairs = set()
        for rel, other_entity in result.all():
            # Avoid duplicates
            pair_key = (str(entity_id), str(other_entity.id), rel.relationship_type.value)
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            rel_type = rel.relationship_type.value
            if rel_type not in relationships_by_type:
                relationships_by_type[rel_type] = []

            relationships_by_type[rel_type].append({
                "entity": {
                    "id": str(other_entity.id),
                    "name_en": other_entity.name_en,
                    "entity_type": other_entity.entity_type.value,
                    "party": other_entity.party,
                },
                "strength": rel.strength_score,
                "co_mentions": rel.co_mention_count,
                "is_verified": rel.is_verified,
                "last_interaction": rel.last_co_mention_at.isoformat() if rel.last_co_mention_at else None,
            })

        return relationships_by_type

    async def _get_top_co_mentions(
        self,
        entity_id: UUID,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Get top co-mentioned entities."""
        result = await self.db.execute(
            select(EntityRelationship, PoliticalEntity)
            .join(
                PoliticalEntity,
                (EntityRelationship.source_entity_id == PoliticalEntity.id) |
                (EntityRelationship.target_entity_id == PoliticalEntity.id)
            )
            .where(
                (EntityRelationship.source_entity_id == entity_id) |
                (EntityRelationship.target_entity_id == entity_id)
            )
            .where(EntityRelationship.relationship_type == RelationshipType.CO_MENTION)
            .where(PoliticalEntity.id != entity_id)
            .order_by(EntityRelationship.co_mention_count.desc())
            .limit(limit)
        )

        top_co_mentions = []
        seen = set()
        for rel, other_entity in result.all():
            if str(other_entity.id) in seen:
                continue
            seen.add(str(other_entity.id))

            top_co_mentions.append({
                "entity": {
                    "id": str(other_entity.id),
                    "name_en": other_entity.name_en,
                    "party": other_entity.party,
                },
                "co_mention_count": rel.co_mention_count,
                "strength": rel.strength_score,
            })

        return top_co_mentions

    async def _get_network_metrics(self, entity_id: UUID) -> Dict[str, Any]:
        """Get network analysis metrics for this entity."""
        # Get metrics for different time windows
        metrics_by_window = {}

        for window_type in [MetricWindowType.WINDOW_7D, MetricWindowType.WINDOW_30D]:
            result = await self.db.execute(
                select(EntityNetworkMetrics).where(
                    EntityNetworkMetrics.entity_id == entity_id,
                    EntityNetworkMetrics.window_type == window_type,
                )
            )
            metrics = result.scalar_one_or_none()

            if metrics:
                metrics_by_window[window_type.value] = {
                    "pagerank": metrics.pagerank_score,
                    "degree_centrality": metrics.degree_centrality,
                    "betweenness_centrality": metrics.betweenness_centrality,
                    "eigenvector_centrality": metrics.eigenvector_centrality,
                    "clustering_coefficient": metrics.clustering_coefficient,
                    "cluster_id": metrics.cluster_id,
                    "is_hub": metrics.is_hub,
                    "is_authority": metrics.is_authority,
                    "is_bridge": metrics.is_bridge,
                    "influence_rank": metrics.influence_rank,
                    "total_connections": metrics.total_connections,
                    "computed_at": metrics.computed_at.isoformat() if metrics.computed_at else None,
                }

        return metrics_by_window

    async def _get_parliament_record(self, entity_id: UUID) -> Optional[Dict[str, Any]]:
        """Get parliament record via linked_entity_id on MPPerformance."""
        try:
            from app.models.parliament import MPPerformance

            result = await self.db.execute(
                select(MPPerformance).where(
                    MPPerformance.linked_entity_id == entity_id
                )
            )
            member = result.scalar_one_or_none()

            if not member:
                return None

            return {
                "mp_id": member.mp_id,
                "chamber": member.chamber,
                "term": member.term,
                "constituency": member.constituency,
                "performance_score": member.performance_score,
                "performance_percentile": member.performance_percentile,
                "performance_tier": member.performance_tier,
                "bills_introduced": member.bills_introduced,
                "bills_passed": member.bills_passed,
                "questions_asked": member.questions_asked,
                "speeches_count": member.speeches_count,
                "session_attendance_pct": member.session_attendance_pct,
                "committee_memberships": member.committee_memberships,
                "is_minister": member.is_minister,
                "ministry_portfolio": member.ministry_portfolio,
                "is_current_member": member.is_current_member,
            }
        except Exception as e:
            logger.debug(f"Could not fetch parliament record: {e}")
            return None

    async def _get_election_history(self, entity_id: UUID) -> Dict[str, Any]:
        """Get election history via linked Candidates with cross-election analytics."""
        try:
            from app.models.election import Candidate, Election, Constituency

            result = await self.db.execute(
                select(Candidate, Election, Constituency)
                .join(Election, Candidate.election_id == Election.id)
                .join(Constituency, Candidate.constituency_id == Constituency.id)
                .where(Candidate.linked_entity_id == entity_id)
                .order_by(Election.year_bs.desc())
            )

            records = []
            for cand, election, constituency in result.all():
                records.append({
                    "year_bs": election.year_bs,
                    "year_ad": election.year_ad,
                    "constituency": constituency.name_en,
                    "constituency_code": constituency.constituency_code,
                    "district": constituency.district,
                    "party": cand.party,
                    "votes": cand.votes,
                    "vote_pct": cand.vote_pct,
                    "rank": cand.rank,
                    "is_winner": cand.is_winner,
                })

            analytics = self._compute_election_analytics(records)

            return {
                "records": records,
                "analytics": analytics,
            }
        except Exception as e:
            logger.debug(f"Could not fetch election history: {e}")
            return {"records": [], "analytics": {}}

    def _compute_election_analytics(self, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Compute cross-election analytics from election records."""
        if not records:
            return {}

        elections_contested = len(records)
        elections_won = sum(1 for r in records if r.get("is_winner"))
        win_rate = round(elections_won / elections_contested, 2) if elections_contested > 0 else 0.0

        # Sort chronologically for trend analysis
        sorted_records = sorted(records, key=lambda r: r.get("year_bs") or 0)

        # Vote trends between consecutive elections
        vote_trends = []
        for i in range(1, len(sorted_records)):
            prev = sorted_records[i - 1]
            curr = sorted_records[i]
            prev_votes = prev.get("votes")
            curr_votes = curr.get("votes")
            if prev_votes and curr_votes and prev_votes > 0:
                vote_change = curr_votes - prev_votes
                pct_change = round((vote_change / prev_votes) * 100, 1)
                same_party = (prev.get("party") or "").lower() == (curr.get("party") or "").lower()
                vote_trends.append({
                    "from_year": prev.get("year_bs"),
                    "to_year": curr.get("year_bs"),
                    "vote_change": vote_change,
                    "pct_change": pct_change,
                    "same_party": same_party,
                })

        # Party switches between elections
        party_switches = []
        for i in range(1, len(sorted_records)):
            prev = sorted_records[i - 1]
            curr = sorted_records[i]
            prev_party = (prev.get("party") or "").strip()
            curr_party = (curr.get("party") or "").strip()
            if prev_party and curr_party and prev_party.lower() != curr_party.lower():
                party_switches.append({
                    "from_year": prev.get("year_bs"),
                    "to_year": curr.get("year_bs"),
                    "from_party": prev_party,
                    "to_party": curr_party,
                })

        is_loyal = len(party_switches) == 0

        # Career span
        years = [r.get("year_ad") for r in sorted_records if r.get("year_ad")]
        career_span_years = (max(years) - min(years)) if len(years) >= 2 else 0

        return {
            "elections_contested": elections_contested,
            "elections_won": elections_won,
            "win_rate": win_rate,
            "vote_trends": vote_trends,
            "party_switches": party_switches,
            "is_loyal": is_loyal,
            "career_span_years": career_span_years,
        }

    async def _get_executive_record(self, entity_id: UUID) -> List[Dict[str, Any]]:
        """Get executive (ministerial) positions via linked_entity_id."""
        try:
            from app.models.ministerial_position import MinisterialPosition

            result = await self.db.execute(
                select(MinisterialPosition)
                .where(MinisterialPosition.linked_entity_id == entity_id)
                .order_by(MinisterialPosition.start_date.desc())
            )

            records = []
            for pos in result.scalars().all():
                records.append({
                    "position_type": pos.position_type,
                    "ministry": pos.ministry,
                    "position_title": pos.position_title,
                    "start_date": pos.start_date.isoformat() if pos.start_date else None,
                    "end_date": pos.end_date.isoformat() if pos.end_date else None,
                    "is_current": pos.is_current,
                    "government_name": pos.government_name,
                    "party_at_appointment": pos.party_at_appointment,
                })

            return records
        except Exception as e:
            logger.debug(f"Could not fetch executive record: {e}")
            return []

    async def _get_business_connections(self, entity_id: UUID) -> List[Dict[str, Any]]:
        """Get business connections via linked CompanyDirector records."""
        try:
            from app.models.company import CompanyDirector, CompanyRegistration

            result = await self.db.execute(
                select(CompanyDirector, CompanyRegistration)
                .outerjoin(CompanyRegistration, CompanyDirector.company_id == CompanyRegistration.id)
                .where(CompanyDirector.linked_entity_id == entity_id)
            )

            connections = []
            for director, company in result.all():
                connections.append({
                    "company_name": company.name_english if company else director.company_name_hint,
                    "role": director.role,
                    "source": director.source,
                    "confidence": director.confidence,
                    "company_id": str(company.id) if company else None,
                })

            return connections
        except Exception as e:
            logger.debug(f"Could not fetch business connections: {e}")
            return []

    async def get_entity_mentions_timeline(
        self,
        entity_id: UUID,
        days: int = 30,
        granularity: str = "day",
    ) -> List[Dict[str, Any]]:
        """
        Get mention timeline for visualization.

        Supports day or hour granularity.
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)

        trunc_func = func.date_trunc('hour' if granularity == "hour" else 'day', Story.published_at)

        result = await self.db.execute(
            select(
                trunc_func.label('time_bucket'),
                func.count(StoryEntityLink.id).label('count'),
            )
            .join(Story, StoryEntityLink.story_id == Story.id)
            .where(StoryEntityLink.entity_id == entity_id)
            .where(Story.published_at >= cutoff)
            .group_by(trunc_func)
            .order_by(trunc_func)
        )

        return [
            {"time": row.time_bucket.isoformat() if row.time_bucket else None, "count": row.count}
            for row in result.all()
        ]

    async def compare_entities(
        self,
        entity_ids: List[UUID],
        window_type: MetricWindowType = MetricWindowType.WINDOW_7D,
    ) -> Dict[str, Any]:
        """Compare multiple entities side by side."""
        comparisons = []

        for entity_id in entity_ids:
            profile = await self.get_full_profile(
                entity_id,
                include_stories=False,
                include_relationships=False,
                include_parliament=False,
                include_metrics=True,
            )

            if profile:
                comparisons.append({
                    "entity": profile["entity"],
                    "mentions": profile["mention_summary"]["by_period"],
                    "metrics": profile.get("network_metrics", {}).get(window_type.value, {}),
                })

        return {
            "comparisons": comparisons,
            "window_type": window_type.value,
        }
