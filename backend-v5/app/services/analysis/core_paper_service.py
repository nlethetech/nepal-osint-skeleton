"""Evidence-first generation of core analyst papers."""
from __future__ import annotations

import asyncio
import json
import os
import re
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.connected_analyst import (
    AnalystAOI,
    AnalystReport,
    AnalystReportCitation,
    DamageArtifact,
    DamageFinding,
    DamageRun,
    DamageRunStatus,
    KBEvidenceRef,
    ProvenanceOwnerType,
    TradeAnomaly,
)
from app.models.analyst_enums import SourceClassification
from app.models.damage_assessment import DamageAssessment, DamageType
from app.models.entity_relationship import EntityRelationship
from app.models.political_entity import PoliticalEntity
from app.models.story import Story
from app.models.story_entity_link import StoryEntityLink
from app.models.announcement import GovtAnnouncement

SINGHA_DURBAR_LAT = 27.6956
SINGHA_DURBAR_LNG = 85.3197

LLM_MODEL = os.environ.get(
    "ANTHROPIC_ANALYSIS_MODEL",
    os.environ.get("ANTHROPIC_MODEL", "claude-3-haiku-20240307"),
)

LLM_SYSTEM_PROMPT = """You are an intelligence analyst writing evidence-only reports.
Never invent facts. Use only the evidence list. If evidence is insufficient, state that clearly.
Always include source references inline using [S1], [S2] style and do not add citations not present in evidence."""

OFFICIAL_SECURITY_SOURCES = {
    "nepalpolice.gov.np",
    "apf.gov.np",
    "nepalarmy.mil.np",
    "nid.gov.np",
    "cib.nepalpolice.gov.np",
}


@dataclass
class Citation:
    source_id: str
    source_name: str | None
    source_url: str | None
    source_type: str
    source_classification: str
    published_at: str | None = None
    confidence: float | None = None
    excerpt: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_name": self.source_name,
            "source_url": self.source_url,
            "source_type": self.source_type,
            "source_classification": self.source_classification,
            "published_at": self.published_at,
            "confidence": self.confidence,
            "excerpt": self.excerpt,
        }


class CorePaperService:
    """Generate three core analyst papers with explicit provenance."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_core_papers(
        self,
        hours: int = 168,
        singha_center_lat: float = SINGHA_DURBAR_LAT,
        singha_center_lng: float = SINGHA_DURBAR_LNG,
        singha_radius_km: float = 1.5,
        use_llm: bool = True,
        generated_by_id: UUID | None = None,
    ) -> dict[str, Any]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        warnings: list[str] = []
        aoi = await self._get_or_create_aoi(
            generated_by_id=generated_by_id,
            center_lat=singha_center_lat,
            center_lng=singha_center_lng,
            radius_km=singha_radius_km,
        )

        political = await self._build_political_paper(cutoff, use_llm, warnings)
        security = await self._build_security_paper(cutoff, use_llm, warnings)
        singha = await self._build_singha_durbar_paper(
            cutoff=cutoff,
            center_lat=singha_center_lat,
            center_lng=singha_center_lng,
            radius_km=singha_radius_km,
            use_llm=use_llm,
            warnings=warnings,
        )

        persisted = await self._persist_papers(
            papers=[political, security, singha],
            generated_by_id=generated_by_id,
            time_window_hours=hours,
            aoi_id=aoi.id if aoi else None,
            generated_with_llm=use_llm,
        )

        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "hours_window": hours,
            "report_ids": persisted,
            "singha_durbar_query": {
                "center_lat": singha_center_lat,
                "center_lng": singha_center_lng,
                "radius_km": singha_radius_km,
            },
            "warnings": warnings,
            "papers": [political, security, singha],
        }

    async def _collect_pwtt_evidence_pack(
        self,
        *,
        cutoff: datetime,
        center_lat: float | None = None,
        center_lng: float | None = None,
        radius_km: float | None = None,
        max_runs: int = 3,
    ) -> tuple[dict[str, Any], list[Citation]]:
        run_rows = await self.db.execute(
            select(DamageRun)
            .where(DamageRun.created_at >= cutoff)
            .where(DamageRun.status == DamageRunStatus.COMPLETED)
            .order_by(DamageRun.created_at.desc())
            .limit(200)
        )
        candidate_runs = list(run_rows.scalars().all())
        if center_lat is not None and center_lng is not None:
            filtered_runs = [
                run
                for run in candidate_runs
                if self._aoi_contains_point(run.aoi_geojson, center_lat, center_lng)
            ]
        else:
            filtered_runs = candidate_runs

        filtered_runs.sort(
            key=lambda item: (
                item.confidence_score if item.confidence_score is not None else 0.0,
                item.created_at or datetime.min.replace(tzinfo=timezone.utc),
            ),
            reverse=True,
        )
        selected_runs = filtered_runs[:max_runs]
        run_ids = [item.id for item in selected_runs]
        if not run_ids:
            return {
                "run_count": 0,
                "finding_count": 0,
                "three_panel_images": [],
                "runs": [],
                "building_damage": {
                    "reported_buildings_affected": None,
                    "building_metric_total": None,
                    "building_signal_count": 0,
                    "damaged_area_km2": None,
                    "avg_damage_percentage": None,
                    "note": "No PWTT runs in selected window.",
                },
            }, []

        artifact_rows = await self.db.execute(
            select(DamageArtifact)
            .where(DamageArtifact.run_id.in_(run_ids))
            .order_by(DamageArtifact.created_at.desc())
        )
        artifacts = list(artifact_rows.scalars().all())

        finding_rows = await self.db.execute(
            select(DamageFinding)
            .where(DamageFinding.run_id.in_(run_ids))
            .order_by(DamageFinding.confidence.desc())
        )
        findings = list(finding_rows.scalars().all())

        three_panel_images: list[dict[str, Any]] = []
        citations: list[Citation] = []

        for artifact in artifacts:
            artifact_label = self._artifact_label(artifact.artifact_type)
            if artifact_label is None:
                continue
            image_url = self._resolve_artifact_url(
                run_id=str(artifact.run_id),
                artifact_id=str(artifact.id),
                file_path=artifact.file_path,
            )
            image_item = {
                "run_id": str(artifact.run_id),
                "artifact_id": str(artifact.id),
                "artifact_type": artifact.artifact_type,
                "label": artifact_label,
                "image_url": image_url,
                "mime_type": artifact.mime_type,
                "source_classification": artifact.source_classification.value,
            }
            three_panel_images.append(image_item)
            citations.append(
                Citation(
                    source_id=f"pwtt_artifact:{artifact.id}",
                    source_name=f"PWTT artifact {artifact_label}",
                    source_url=image_url,
                    source_type="pwtt_artifact",
                    source_classification=artifact.source_classification.value,
                    confidence=0.85,
                    excerpt=f"{artifact_label} for PWTT run {artifact.run_id}",
                )
            )

        building_metric_total = 0.0
        building_signal_count = 0
        damaged_area_km2 = 0.0
        damage_pct_values: list[float] = []
        finding_ids = [str(item.id) for item in findings]

        for finding in findings:
            metrics = finding.metrics or {}
            has_building_metric = False
            for key, value in metrics.items():
                number = self._to_float(value)
                if number is None:
                    continue
                key_lower = key.lower()
                if "building" in key_lower:
                    building_metric_total += number
                    has_building_metric = True
                if key_lower in {"damaged_area_km2", "damaged_area"}:
                    damaged_area_km2 += number
                if key_lower in {"damage_percentage", "damage_pct"}:
                    damage_pct_values.append(number)
            if has_building_metric:
                building_signal_count += 1

        reported_buildings_affected = 0.0
        assessment_ids = [item.assessment_id for item in selected_runs if item.assessment_id is not None]
        if assessment_ids:
            assessment_rows = await self.db.execute(
                select(DamageAssessment)
                .where(DamageAssessment.id.in_(assessment_ids))
            )
            for assessment in assessment_rows.scalars().all():
                if assessment.buildings_affected is not None:
                    reported_buildings_affected += float(assessment.buildings_affected)

        evidence_refs: list[KBEvidenceRef] = []
        if finding_ids:
            ref_rows = await self.db.execute(
                select(KBEvidenceRef)
                .where(KBEvidenceRef.owner_type == ProvenanceOwnerType.DAMAGE_FINDING)
                .where(KBEvidenceRef.owner_id.in_(finding_ids))
                .order_by(KBEvidenceRef.created_at.desc())
                .limit(50)
            )
            evidence_refs = list(ref_rows.scalars().all())
            for ref in evidence_refs:
                citations.append(
                    Citation(
                        source_id=f"finding_ref:{ref.id}",
                        source_name=ref.source_name or ref.source_key,
                        source_url=ref.source_url,
                        source_type=ref.evidence_type,
                        source_classification=ref.source_classification.value,
                        confidence=ref.confidence,
                        excerpt=ref.excerpt,
                    )
                )

        avg_damage_percentage = (
            round(sum(damage_pct_values) / len(damage_pct_values), 2)
            if damage_pct_values
            else None
        )
        building_note = None
        if building_signal_count == 0 and reported_buildings_affected == 0:
            building_note = (
                "No explicit per-building count metrics found in selected PWTT findings; "
                "area-level damage metrics are used."
            )

        pack = {
            "run_count": len(selected_runs),
            "finding_count": len(findings),
            "three_panel_images": three_panel_images[:12],
            "runs": [
                {
                    "run_id": str(run.id),
                    "algorithm_name": run.algorithm_name,
                    "algorithm_version": run.algorithm_version,
                    "confidence": run.confidence_score,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                    "status": run.status.value,
                }
                for run in selected_runs
            ],
            "building_damage": {
                "reported_buildings_affected": (
                    int(reported_buildings_affected) if reported_buildings_affected > 0 else None
                ),
                "building_metric_total": (
                    round(building_metric_total, 2) if building_metric_total > 0 else None
                ),
                "building_signal_count": building_signal_count,
                "damaged_area_km2": round(damaged_area_km2, 4) if damaged_area_km2 > 0 else None,
                "avg_damage_percentage": avg_damage_percentage,
                "note": building_note,
            },
        }
        return pack, self._dedupe_citations(citations, limit=20)

    @staticmethod
    def _artifact_label(artifact_type: str) -> str | None:
        normalized = (artifact_type or "").lower()
        if normalized == "three_panel":
            return "three_panel"
        if normalized.endswith("three_panel_before") or normalized == "three_panel_before":
            return "before"
        if normalized.endswith("three_panel_after") or normalized == "three_panel_after":
            return "after"
        if normalized.endswith("three_panel_damage") or normalized == "three_panel_damage":
            return "damage"
        return None

    @staticmethod
    def _resolve_artifact_url(run_id: str, artifact_id: str, file_path: str) -> str:
        if file_path.startswith("http://") or file_path.startswith("https://"):
            return file_path
        return f"/api/v1/pwtt/runs/{run_id}/artifacts/{artifact_id}/stream"

    @staticmethod
    def _dedupe_citations(citations: list[Citation], limit: int = 20) -> list[Citation]:
        deduped: list[Citation] = []
        seen: set[str] = set()
        for item in citations:
            key = item.source_id or f"{item.source_name}:{item.source_url}"
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
            if len(deduped) >= limit:
                break
        return deduped

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value).strip())
        except Exception:
            return None

    async def _build_political_paper(self, cutoff: datetime, use_llm: bool, warnings: list[str]) -> dict[str, Any]:
        pwtt_pack, pwtt_citations = await self._collect_pwtt_evidence_pack(
            cutoff=cutoff,
            max_runs=2,
        )
        rows = await self.db.execute(
            select(Story)
            .where(Story.published_at.is_not(None))
            .where(Story.published_at >= cutoff)
            .where(Story.category == "political")
            .order_by(Story.published_at.desc())
            .limit(80)
        )
        stories = list(rows.scalars().all())

        source_names = sorted({s.source_name or s.source_id for s in stories})
        story_citations = [
            Citation(
                source_id=f"story:{story.id}",
                source_name=story.source_name or story.source_id,
                source_url=story.url,
                source_type="story",
                source_classification="independent",
                published_at=story.published_at.isoformat() if story.published_at else None,
                excerpt=story.title,
            )
            for story in stories[:20]
        ]

        top_mentions_rows = await self.db.execute(
            select(
                PoliticalEntity.name_en,
                func.count(StoryEntityLink.id).label("mention_count"),
            )
            .join(StoryEntityLink, StoryEntityLink.entity_id == PoliticalEntity.id)
            .join(Story, Story.id == StoryEntityLink.story_id)
            .where(Story.published_at.is_not(None))
            .where(Story.published_at >= cutoff)
            .where(Story.category == "political")
            .group_by(PoliticalEntity.name_en)
            .order_by(func.count(StoryEntityLink.id).desc())
            .limit(8)
        )
        top_mentions = [
            {"entity_name": row.name_en, "mention_count": int(row.mention_count)}
            for row in top_mentions_rows.all()
        ]

        source_entity = aliased(PoliticalEntity)
        target_entity = aliased(PoliticalEntity)
        rel_rows = await self.db.execute(
            select(EntityRelationship.id)
            .join(source_entity, EntityRelationship.source_entity_id == source_entity.id)
            .join(target_entity, EntityRelationship.target_entity_id == target_entity.id)
            .where(
                or_(
                    EntityRelationship.last_co_mention_at.is_(None),
                    EntityRelationship.last_co_mention_at >= cutoff,
                )
            )
            .order_by(EntityRelationship.co_mention_count.desc())
            .limit(10)
        )
        relationship_count = len(rel_rows.all())

        highlights = [
            f"{len(stories)} political stories observed in the selected window from {len(source_names)} unique sources.",
            f"Top mentioned political entities tracked: {', '.join(item['entity_name'] for item in top_mentions[:5]) or 'none'}.",
            f"{relationship_count} high-weight entity relationships were active in the current graph window.",
            (
                f"{pwtt_pack['run_count']} PWTT runs with {len(pwtt_pack['three_panel_images'])} "
                "three-panel artifacts are attached for geospatial context."
            ),
        ]

        citations = self._dedupe_citations(story_citations + pwtt_citations, limit=24)

        evidence_payload = {
            "title": "Political Developments",
            "scope": "Nepal political developments",
            "highlights": highlights,
            "top_mentions": top_mentions,
            "pwtt_evidence": pwtt_pack,
            "sources": [citation.to_dict() for citation in citations],
        }
        markdown, llm_used = await self._render_markdown_with_optional_llm(
            evidence_payload,
            use_llm,
            warnings,
        )

        return {
            "paper_key": "political_developments",
            "title": "Political Developments Intelligence Paper",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generated_with_llm": llm_used,
            "highlights": highlights,
            "metrics": {
                "story_count": len(stories),
                "source_count": len(source_names),
                "relationship_count": relationship_count,
                "top_mentions": top_mentions,
            },
            "pwtt_evidence": pwtt_pack,
            "markdown": markdown,
            "citations": [citation.to_dict() for citation in citations],
        }

    async def _build_security_paper(self, cutoff: datetime, use_llm: bool, warnings: list[str]) -> dict[str, Any]:
        story_rows = await self.db.execute(
            select(Story)
            .where(Story.published_at.is_not(None))
            .where(Story.published_at >= cutoff)
            .where(Story.category.in_(["security", "disaster"]))
            .order_by(Story.published_at.desc())
            .limit(80)
        )
        stories = list(story_rows.scalars().all())
        pwtt_pack, pwtt_citations = await self._collect_pwtt_evidence_pack(
            cutoff=cutoff,
            max_runs=4,
        )

        official_rows = await self.db.execute(
            select(GovtAnnouncement)
            .where(GovtAnnouncement.created_at >= cutoff)
            .where(
                or_(
                    GovtAnnouncement.category.ilike("security:%"),
                    GovtAnnouncement.source.in_(list(OFFICIAL_SECURITY_SOURCES)),
                )
            )
            .order_by(GovtAnnouncement.created_at.desc())
            .limit(120)
        )
        official_items = list(official_rows.scalars().all())

        damage_rows = await self.db.execute(
            select(DamageAssessment)
            .where(DamageAssessment.created_at >= cutoff)
            .order_by(DamageAssessment.created_at.desc())
            .limit(40)
        )
        assessments = list(damage_rows.scalars().all())

        anomaly_rows = await self.db.execute(
            select(TradeAnomaly)
            .where(TradeAnomaly.created_at >= cutoff)
            .where(TradeAnomaly.severity.in_(["high", "critical"]))
            .order_by(TradeAnomaly.anomaly_score.desc())
            .limit(30)
        )
        anomalies = list(anomaly_rows.scalars().all())

        official_citations = [
            Citation(
                source_id=f"announcement:{item.id}",
                source_name=item.source_name,
                source_url=item.url,
                source_type="govt_announcement",
                source_classification="official",
                published_at=(
                    item.published_at.isoformat() if item.published_at
                    else item.created_at.isoformat() if item.created_at
                    else None
                ),
                confidence=0.9,
                excerpt=item.title,
            )
            for item in official_items[:20]
        ]
        story_citations = [
            Citation(
                source_id=f"story:{story.id}",
                source_name=story.source_name or story.source_id,
                source_url=story.url,
                source_type="story",
                source_classification=self._classify_story_source(story),
                published_at=story.published_at.isoformat() if story.published_at else None,
                excerpt=story.title,
            )
            for story in stories[:16]
        ]
        anomaly_citations = [
            Citation(
                source_id=f"trade_anomaly:{item.id}",
                source_name="Trade anomaly engine",
                source_url=None,
                source_type="trade_anomaly",
                source_classification="official",
                confidence=min(1.0, max(0.0, float(item.anomaly_score) / 5.0)),
                excerpt=f"{item.dimension}:{item.dimension_key} score={item.anomaly_score:.2f}",
            )
            for item in anomalies[:8]
        ]
        citations = self._dedupe_citations(
            official_citations + story_citations + anomaly_citations + pwtt_citations,
            limit=30,
        )

        official_source_names = sorted({item.source_name for item in official_items if item.source_name})
        corroborated_incidents = self._count_corroborated_security_incidents(stories, official_items)

        highlights = [
            f"{len(stories)} security/disaster stories were ingested in the selected window.",
            f"{len(official_items)} official security announcements were captured from {len(official_source_names)} security sources.",
            f"{len(assessments)} damage assessment records were updated or created in the same period.",
            f"{len(anomalies)} high-severity trade anomalies can be used as disruption indicators.",
            f"{corroborated_incidents} incidents have corroboration overlap between official releases and other reporting.",
            (
                f"{pwtt_pack['run_count']} PWTT runs with {len(pwtt_pack['three_panel_images'])} "
                "three-panel artifacts were included for damage verification context."
            ),
        ]

        evidence_payload = {
            "title": "Security Developments",
            "scope": "Nepal security and disruption developments",
            "highlights": highlights,
            "official_sources": official_source_names,
            "pwtt_evidence": pwtt_pack,
            "official_announcements": [
                {
                    "id": str(item.id),
                    "source": item.source_name,
                    "source_domain": item.source,
                    "title": item.title,
                    "url": item.url,
                    "category": item.category,
                }
                for item in official_items[:20]
            ],
            "assessments": [
                {
                    "id": str(item.id),
                    "event_name": item.event_name,
                    "event_type": item.event_type,
                    "damage_percentage": item.damage_percentage,
                    "districts": item.districts,
                }
                for item in assessments[:10]
            ],
            "anomalies": [
                {
                    "id": str(item.id),
                    "dimension": item.dimension,
                    "dimension_key": item.dimension_key,
                    "severity": item.severity,
                    "score": item.anomaly_score,
                }
                for item in anomalies[:10]
            ],
            "sources": [citation.to_dict() for citation in citations],
        }
        markdown, llm_used = await self._render_markdown_with_optional_llm(
            evidence_payload,
            use_llm,
            warnings,
        )

        return {
            "paper_key": "security_developments",
            "title": "Security Developments Intelligence Paper",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generated_with_llm": llm_used,
            "highlights": highlights,
            "metrics": {
                "story_count": len(stories),
                "official_security_announcement_count": len(official_items),
                "official_security_source_count": len(official_source_names),
                "corroborated_incident_count": corroborated_incidents,
                "assessment_count": len(assessments),
                "high_severity_trade_anomalies": len(anomalies),
            },
            "pwtt_evidence": pwtt_pack,
            "markdown": markdown,
            "citations": [citation.to_dict() for citation in citations],
        }

    async def _build_singha_durbar_paper(
        self,
        cutoff: datetime,
        center_lat: float,
        center_lng: float,
        radius_km: float,
        use_llm: bool,
        warnings: list[str],
    ) -> dict[str, Any]:
        search_terms = ["gen z", "singha durbar", "protest", "sindurdarbar", "sinhadurbar"]

        story_rows = await self.db.execute(
            select(Story)
            .where(Story.published_at.is_not(None))
            .where(Story.published_at >= cutoff)
            .where(
                or_(
                    Story.title.ilike("%gen z%"),
                    Story.title.ilike("%singha durbar%"),
                    Story.title.ilike("%protest%"),
                    Story.content.ilike("%gen z%"),
                    Story.content.ilike("%singha durbar%"),
                    Story.content.ilike("%protest%"),
                )
            )
            .order_by(Story.published_at.desc())
            .limit(80)
        )
        stories = list(story_rows.scalars().all())
        pwtt_pack, pwtt_citations = await self._collect_pwtt_evidence_pack(
            cutoff=cutoff,
            center_lat=center_lat,
            center_lng=center_lng,
            radius_km=radius_km,
            max_runs=4,
        )

        official_rows = await self.db.execute(
            select(GovtAnnouncement)
            .where(GovtAnnouncement.created_at >= cutoff)
            .where(GovtAnnouncement.source.in_(list(OFFICIAL_SECURITY_SOURCES)))
            .where(
                or_(
                    GovtAnnouncement.title.ilike("%gen z%"),
                    GovtAnnouncement.title.ilike("%singha durbar%"),
                    GovtAnnouncement.title.ilike("%protest%"),
                    GovtAnnouncement.content.ilike("%gen z%"),
                    GovtAnnouncement.content.ilike("%singha durbar%"),
                    GovtAnnouncement.content.ilike("%protest%"),
                )
            )
            .order_by(GovtAnnouncement.created_at.desc())
            .limit(60)
        )
        official_items = list(official_rows.scalars().all())

        assessment_rows = await self.db.execute(
            select(DamageAssessment)
            .where(DamageAssessment.created_at >= cutoff)
            .where(DamageAssessment.event_type == DamageType.CIVIL_UNREST.value)
            .order_by(DamageAssessment.created_at.desc())
            .limit(40)
        )
        assessments = [item for item in assessment_rows.scalars().all() if self._bbox_contains_point(item.bbox, center_lat, center_lng)]

        run_rows = await self.db.execute(
            select(DamageRun)
            .where(DamageRun.created_at >= cutoff)
            .order_by(DamageRun.created_at.desc())
            .limit(120)
        )
        runs = [item for item in run_rows.scalars().all() if self._aoi_contains_point(item.aoi_geojson, center_lat, center_lng)]

        run_ids = [item.id for item in runs]
        finding_rows = []
        if run_ids:
            finding_query = await self.db.execute(
                select(DamageFinding)
                .where(DamageFinding.run_id.in_(run_ids))
                .order_by(DamageFinding.confidence.desc())
                .limit(120)
            )
            finding_rows = list(finding_query.scalars().all())

        evidence_rows: list[KBEvidenceRef] = []
        if finding_rows:
            finding_id_strings = [str(item.id) for item in finding_rows]
            refs = await self.db.execute(
                select(KBEvidenceRef)
                .where(KBEvidenceRef.owner_type == ProvenanceOwnerType.DAMAGE_FINDING)
                .where(KBEvidenceRef.owner_id.in_(finding_id_strings))
                .order_by(KBEvidenceRef.created_at.desc())
                .limit(100)
            )
            evidence_rows = list(refs.scalars().all())

        story_citations = [
            Citation(
                source_id=f"story:{story.id}",
                source_name=story.source_name or story.source_id,
                source_url=story.url,
                source_type="story",
                source_classification=self._classify_story_source(story),
                published_at=story.published_at.isoformat() if story.published_at else None,
                excerpt=story.title,
            )
            for story in stories[:20]
        ]
        official_citations = [
            Citation(
                source_id=f"announcement:{item.id}",
                source_name=item.source_name,
                source_url=item.url,
                source_type="govt_announcement",
                source_classification="official",
                published_at=(
                    item.published_at.isoformat() if item.published_at
                    else item.created_at.isoformat() if item.created_at
                    else None
                ),
                confidence=0.9,
                excerpt=item.title,
            )
            for item in official_items[:12]
        ]
        finding_citations = [
            Citation(
                source_id=f"finding_ref:{row.id}",
                source_name=row.source_name or row.source_key,
                source_url=row.source_url,
                source_type=row.evidence_type,
                source_classification=row.source_classification.value,
                confidence=row.confidence,
                excerpt=row.excerpt,
            )
            for row in evidence_rows[:20]
        ]
        citations = self._dedupe_citations(
            official_citations + story_citations + finding_citations + pwtt_citations,
            limit=30,
        )

        high_conf_findings = [
            item for item in finding_rows if item.confidence >= 0.75 and item.severity in {"high", "critical"}
        ]

        highlights = [
            f"{len(stories)} related stories matched Gen Z/Singha Durbar protest terms: {', '.join(search_terms[:3])}.",
            f"{len(official_items)} official security announcements matched protest terms in the same window.",
            f"{len(runs)} PWTT runs intersect the specified Singha Durbar area (radius {radius_km:.2f} km).",
            f"{len(high_conf_findings)} high-confidence/high-severity PWTT findings were detected in-area.",
            (
                f"{len(pwtt_pack['three_panel_images'])} PWTT three-panel images are attached; "
                f"building signals={pwtt_pack['building_damage']['building_signal_count']}."
            ),
        ]

        if not high_conf_findings and not assessments:
            highlights.append(
                "No verified destructive PWTT signal is currently available for the selected area in the queried window."
            )

        evidence_payload = {
            "title": "Gen Z Damage Assessment Around Singha Durbar",
            "scope": {
                "center_lat": center_lat,
                "center_lng": center_lng,
                "radius_km": radius_km,
            },
            "highlights": highlights,
            "pwtt_evidence": pwtt_pack,
            "pwtt_runs": [
                {
                    "run_id": str(item.id),
                    "algorithm": item.algorithm_name,
                    "version": item.algorithm_version,
                    "status": item.status.value,
                    "confidence": item.confidence_score,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                }
                for item in runs[:12]
            ],
            "official_announcements": [
                {
                    "id": str(item.id),
                    "source": item.source_name,
                    "source_domain": item.source,
                    "title": item.title,
                    "url": item.url,
                    "category": item.category,
                }
                for item in official_items[:12]
            ],
            "pwtt_findings": [
                {
                    "id": str(item.id),
                    "title": item.title,
                    "severity": item.severity,
                    "confidence": item.confidence,
                    "district": item.district,
                    "route_name": item.route_name,
                    "metrics": item.metrics,
                }
                for item in finding_rows[:20]
            ],
            "sources": [citation.to_dict() for citation in citations],
        }
        markdown, llm_used = await self._render_markdown_with_optional_llm(
            evidence_payload,
            use_llm,
            warnings,
        )

        return {
            "paper_key": "genz_singha_durbar_damage",
            "title": "Gen Z Protest Damage Assessment: Singha Durbar AOI",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generated_with_llm": llm_used,
            "highlights": highlights,
            "metrics": {
                "matching_story_count": len(stories),
                "matching_official_announcement_count": len(official_items),
                "matching_assessment_count": len(assessments),
                "matching_run_count": len(runs),
                "finding_count": len(finding_rows),
                "high_confidence_high_severity_findings": len(high_conf_findings),
            },
            "pwtt_evidence": pwtt_pack,
            "markdown": markdown,
            "citations": [citation.to_dict() for citation in citations],
        }

    async def _render_markdown_with_optional_llm(
        self,
        evidence_payload: dict[str, Any],
        use_llm: bool,
        warnings: list[str],
    ) -> tuple[str, bool]:
        fallback = self._render_deterministic_markdown(evidence_payload)
        if not use_llm:
            return fallback, False

        try:
            llm_markdown = await asyncio.to_thread(self._call_haiku, evidence_payload)
            self._validate_cited_markdown(llm_markdown, len(evidence_payload.get("sources", [])))
            return llm_markdown, True
        except Exception as exc:  # pragma: no cover - external service failure path
            warnings.append(f"LLM synthesis unavailable for '{evidence_payload.get('title')}': {exc}")
            return fallback, False

    def _render_deterministic_markdown(self, evidence_payload: dict[str, Any]) -> str:
        lines = [
            f"# {evidence_payload.get('title', 'Intelligence Paper')}",
            "",
            "## Evidence Summary",
        ]
        for item in evidence_payload.get("highlights", []):
            lines.append(f"- {item}")
        lines.append("")

        pwtt_evidence = evidence_payload.get("pwtt_evidence") or {}
        if pwtt_evidence:
            lines.append("## PWTT Three Panel Evidence")
            lines.append(f"- Runs considered: {pwtt_evidence.get('run_count', 0)}")
            lines.append(f"- Findings considered: {pwtt_evidence.get('finding_count', 0)}")
            building = pwtt_evidence.get("building_damage") or {}
            lines.append(
                "- Building damage summary: "
                f"reported_buildings_affected={building.get('reported_buildings_affected')}, "
                f"building_metric_total={building.get('building_metric_total')}, "
                f"building_signal_count={building.get('building_signal_count')}, "
                f"damaged_area_km2={building.get('damaged_area_km2')}, "
                f"avg_damage_percentage={building.get('avg_damage_percentage')}"
            )
            if building.get("note"):
                lines.append(f"- Note: {building.get('note')}")

            images = pwtt_evidence.get("three_panel_images") or []
            if images:
                lines.append("")
                lines.append("### Three Panel Images")
                for item in images[:9]:
                    label = item.get("label") or item.get("artifact_type") or "three_panel"
                    image_url = item.get("image_url") or "no_url"
                    lines.append(f"- {label}: {image_url}")
                    if image_url != "no_url":
                        lines.append(f"![{label}]({image_url})")
            lines.append("")

        lines.append("## Source-Cited Notes")

        sources = evidence_payload.get("sources", [])
        if not sources:
            lines.append("- No sources available for this window.")
        else:
            for index, source in enumerate(sources[:12], start=1):
                label = source.get("source_name") or source.get("source_id")
                url = source.get("source_url") or "no_url"
                excerpt = source.get("excerpt") or ""
                lines.append(f"- [S{index}] {label} | {url} {excerpt}".strip())

        lines.append("")
        lines.append("## Analytic Note")
        lines.append(
            "This paper is generated from repository evidence objects only. "
            "Claims without source references are intentionally omitted."
        )
        return "\n".join(lines)

    @staticmethod
    def _normalize_title_key(text: str) -> str:
        lowered = re.sub(r"[^a-z0-9\s]", " ", text.lower())
        tokens = [token for token in lowered.split() if len(token) > 3]
        return " ".join(tokens[:8])

    def _count_corroborated_security_incidents(
        self,
        stories: list[Story],
        official_items: list[GovtAnnouncement],
    ) -> int:
        source_buckets: dict[str, set[str]] = {}
        has_official: dict[str, bool] = {}

        for item in official_items:
            key = self._normalize_title_key(item.title or "")
            if not key:
                continue
            source_buckets.setdefault(key, set()).add(item.source or item.source_name or "official")
            has_official[key] = True

        for story in stories:
            key = self._normalize_title_key(story.title or "")
            if not key:
                continue
            source_buckets.setdefault(key, set()).add(story.source_name or story.source_id or "media")
            has_official.setdefault(key, False)

        return sum(1 for key, sources in source_buckets.items() if has_official.get(key) and len(sources) >= 2)

    def _classify_story_source(self, story: Story) -> str:
        url = story.url or ""
        try:
            domain = (urlparse(url).hostname or "").lower()
        except Exception:
            domain = ""
        if any(domain.endswith(source) for source in OFFICIAL_SECURITY_SOURCES):
            return "official"
        return "independent"

    def _call_haiku(self, evidence_payload: dict[str, Any]) -> str:
        import anthropic

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")

        client = anthropic.Anthropic(api_key=api_key)
        prompt = (
            "Generate a concise analyst paper in Markdown with sections: Executive Summary, "
            "Observed Evidence, Analytic Assessment, Collection Gaps, Citations.\n\n"
            "Citations must be only [S1], [S2] from the provided evidence list.\n"
            "Do not add facts not present in evidence.\n\n"
            f"Evidence JSON:\n{json.dumps(evidence_payload, ensure_ascii=False)}"
        )
        response = client.messages.create(
            model=LLM_MODEL,
            max_tokens=1600,
            system=LLM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        blocks = response.content or []
        if not blocks:
            raise RuntimeError("Empty response from model")
        return blocks[0].text.strip()

    async def _get_or_create_aoi(
        self,
        *,
        generated_by_id: UUID | None,
        center_lat: float,
        center_lng: float,
        radius_km: float,
    ) -> AnalystAOI | None:
        if not generated_by_id:
            return None

        existing = await self.db.execute(
            select(AnalystAOI)
            .where(AnalystAOI.owner_user_id == generated_by_id)
            .where(AnalystAOI.center_lat == center_lat)
            .where(AnalystAOI.center_lng == center_lng)
            .where(AnalystAOI.radius_km == radius_km)
            .order_by(AnalystAOI.updated_at.desc())
            .limit(1)
        )
        aoi = existing.scalar_one_or_none()
        if aoi:
            return aoi

        aoi = AnalystAOI(
            name=f"SinghaDurbar_{center_lat:.4f}_{center_lng:.4f}_{radius_km:.2f}km",
            owner_user_id=generated_by_id,
            center_lat=center_lat,
            center_lng=center_lng,
            radius_km=radius_km,
            geometry={
                "type": "PointRadius",
                "center": {"lat": center_lat, "lng": center_lng},
                "radius_km": radius_km,
            },
            tags=["autonomous-report", "singha-durbar"],
        )
        self.db.add(aoi)
        await self.db.flush()
        return aoi

    async def _persist_papers(
        self,
        *,
        papers: list[dict[str, Any]],
        generated_by_id: UUID | None,
        time_window_hours: int,
        aoi_id: UUID | None,
        generated_with_llm: bool,
    ) -> list[str]:
        report_ids: list[str] = []
        for paper in papers:
            report = AnalystReport(
                report_type=paper.get("paper_key", "unknown"),
                time_window_hours=time_window_hours,
                aoi_id=aoi_id,
                generated_by=generated_by_id,
                generated_with_llm=bool(paper.get("generated_with_llm", generated_with_llm)),
                status="completed",
                markdown=paper.get("markdown", ""),
                metrics_json=paper.get("metrics") or {},
                metadata_json={
                    "title": paper.get("title"),
                    "highlights": paper.get("highlights", []),
                    "pwtt_evidence": paper.get("pwtt_evidence") or {},
                },
            )
            self.db.add(report)
            await self.db.flush()

            for order, citation in enumerate(paper.get("citations", []), start=1):
                evidence_ref = await self._resolve_or_create_evidence_ref(report.id, citation)
                claim_hash = hashlib.sha256(
                    f"{paper.get('paper_key')}|{order}|{citation.get('source_id')}".encode("utf-8")
                ).hexdigest()
                self.db.add(
                    AnalystReportCitation(
                        report_id=report.id,
                        evidence_ref_id=evidence_ref.id,
                        claim_hash=claim_hash,
                        citation_order=order,
                    )
                )

            report_ids.append(str(report.id))

        await self.db.commit()
        return report_ids

    async def _resolve_or_create_evidence_ref(self, report_id: UUID, citation: dict[str, Any]) -> KBEvidenceRef:
        source_id = str(citation.get("source_id") or "")
        if source_id.startswith("finding_ref:"):
            maybe_id = source_id.split(":", 1)[1]
            try:
                finding_ref_id = UUID(maybe_id)
            except ValueError:
                finding_ref_id = None
            if finding_ref_id:
                existing = await self.db.scalar(select(KBEvidenceRef).where(KBEvidenceRef.id == finding_ref_id))
                if existing:
                    return existing

        source_name = citation.get("source_name")
        source_url = citation.get("source_url")
        source_key = source_id or source_url or source_name or "unknown"
        source_classification_raw = str(citation.get("source_classification") or "unknown").lower()
        source_classification = SourceClassification.UNKNOWN
        if source_classification_raw == SourceClassification.OFFICIAL.value:
            source_classification = SourceClassification.OFFICIAL
        elif source_classification_raw == SourceClassification.INDEPENDENT.value:
            source_classification = SourceClassification.INDEPENDENT

        existing = await self.db.scalar(
            select(KBEvidenceRef)
            .where(KBEvidenceRef.owner_type == ProvenanceOwnerType.OBJECT)
            .where(KBEvidenceRef.owner_id == f"report:{report_id}")
            .where(KBEvidenceRef.source_key == source_key)
            .limit(1)
        )
        if existing:
            return existing

        evidence = KBEvidenceRef(
            owner_type=ProvenanceOwnerType.OBJECT,
            owner_id=f"report:{report_id}",
            evidence_type=str(citation.get("source_type") or "report_source"),
            evidence_id=source_id,
            source_url=source_url,
            source_key=source_key,
            source_name=source_name,
            source_classification=source_classification,
            confidence=float(citation.get("confidence") or 0.6),
            excerpt=citation.get("excerpt"),
            evidence_metadata={
                "published_at": citation.get("published_at"),
            },
        )
        self.db.add(evidence)
        await self.db.flush()
        return evidence

    async def get_report(self, report_id: UUID) -> dict[str, Any] | None:
        report = await self.db.scalar(select(AnalystReport).where(AnalystReport.id == report_id))
        if not report:
            return None

        citation_rows = await self.db.execute(
            select(AnalystReportCitation, KBEvidenceRef)
            .join(KBEvidenceRef, KBEvidenceRef.id == AnalystReportCitation.evidence_ref_id)
            .where(AnalystReportCitation.report_id == report.id)
            .order_by(AnalystReportCitation.citation_order.asc())
        )

        citations: list[dict[str, Any]] = []
        for item, evidence in citation_rows.all():
            citations.append(
                {
                    "id": str(item.id),
                    "citation_order": item.citation_order,
                    "claim_hash": item.claim_hash,
                    "source_id": evidence.evidence_id,
                    "source_name": evidence.source_name,
                    "source_url": evidence.source_url,
                    "source_type": evidence.evidence_type,
                    "source_classification": evidence.source_classification.value,
                    "confidence": evidence.confidence,
                    "excerpt": evidence.excerpt,
                    "published_at": (evidence.evidence_metadata or {}).get("published_at"),
                }
            )

        return {
            "id": str(report.id),
            "report_type": report.report_type,
            "time_window_hours": report.time_window_hours,
            "aoi_id": str(report.aoi_id) if report.aoi_id else None,
            "generated_by": str(report.generated_by) if report.generated_by else None,
            "generated_with_llm": report.generated_with_llm,
            "status": report.status,
            "markdown": report.markdown,
            "metrics": report.metrics_json or {},
            "metadata": report.metadata_json or {},
            "citations": citations,
            "created_at": report.created_at.isoformat() if report.created_at else None,
            "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        }

    async def list_reports(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        report_type: str | None = None,
        generated_by: UUID | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> dict[str, Any]:
        """List persisted autonomous core papers with lightweight summary fields."""
        filters = []
        if report_type:
            filters.append(AnalystReport.report_type == report_type)
        if generated_by:
            filters.append(AnalystReport.generated_by == generated_by)
        if created_after:
            filters.append(AnalystReport.created_at >= created_after)
        if created_before:
            filters.append(AnalystReport.created_at <= created_before)

        base_query = select(AnalystReport)
        if filters:
            base_query = base_query.where(and_(*filters))

        total = await self.db.scalar(
            select(func.count()).select_from(base_query.subquery())
        )
        total = int(total or 0)

        rows = await self.db.execute(
            select(
                AnalystReport,
                func.count(AnalystReportCitation.id).label("citations_count"),
            )
            .outerjoin(
                AnalystReportCitation,
                AnalystReportCitation.report_id == AnalystReport.id,
            )
            .where(and_(*filters) if filters else True)
            .group_by(AnalystReport.id)
            .order_by(AnalystReport.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        items: list[dict[str, Any]] = []
        for report, citations_count in rows.all():
            metadata = report.metadata_json or {}
            metrics = report.metrics_json or {}
            items.append(
                {
                    "id": str(report.id),
                    "report_type": report.report_type,
                    "title": metadata.get("title") or report.report_type,
                    "status": report.status,
                    "created_at": report.created_at.isoformat() if report.created_at else None,
                    "updated_at": report.updated_at.isoformat() if report.updated_at else None,
                    "time_window_hours": report.time_window_hours,
                    "generated_with_llm": report.generated_with_llm,
                    "citations_count": int(citations_count or 0),
                    "highlights": metadata.get("highlights") or [],
                    "metrics_preview": metrics,
                }
            )

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    async def get_reports_summary(
        self,
        *,
        report_type: str | None = None,
        generated_by: UUID | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> dict[str, Any]:
        """Aggregate autonomous paper counts for dashboard KPIs."""
        now = datetime.now(timezone.utc)
        day_cutoff = now - timedelta(hours=24)
        week_cutoff = now - timedelta(days=7)

        filters = []
        if report_type:
            filters.append(AnalystReport.report_type == report_type)
        if generated_by:
            filters.append(AnalystReport.generated_by == generated_by)
        if created_after:
            filters.append(AnalystReport.created_at >= created_after)
        if created_before:
            filters.append(AnalystReport.created_at <= created_before)

        base_where = and_(*filters) if filters else True

        total_reports = int(
            await self.db.scalar(
                select(func.count()).select_from(AnalystReport).where(base_where)
            )
            or 0
        )

        by_type_rows = await self.db.execute(
            select(AnalystReport.report_type, func.count())
            .where(base_where)
            .group_by(AnalystReport.report_type)
        )
        by_report_type = {r_type: int(count) for r_type, count in by_type_rows.all()}

        generated_last_24h = int(
            await self.db.scalar(
                select(func.count())
                .select_from(AnalystReport)
                .where(base_where)
                .where(AnalystReport.created_at >= day_cutoff)
            )
            or 0
        )
        generated_last_7d = int(
            await self.db.scalar(
                select(func.count())
                .select_from(AnalystReport)
                .where(base_where)
                .where(AnalystReport.created_at >= week_cutoff)
            )
            or 0
        )
        last_generated_at = await self.db.scalar(
            select(func.max(AnalystReport.created_at)).where(base_where)
        )

        return {
            "total_reports": total_reports,
            "by_report_type": by_report_type,
            "generated_last_24h": generated_last_24h,
            "generated_last_7d": generated_last_7d,
            "last_generated_at": last_generated_at.isoformat() if last_generated_at else None,
        }

    @staticmethod
    def _validate_cited_markdown(markdown: str, citation_count: int) -> None:
        if citation_count <= 0:
            return
        referenced = {
            int(match.group(1))
            for match in re.finditer(r"\[S(\d+)\]", markdown)
        }
        if not referenced:
            raise RuntimeError("LLM output contains no citation references")
        if any(number < 1 or number > citation_count for number in referenced):
            raise RuntimeError("LLM output references unknown citations")

    def _bbox_contains_point(self, bbox: Any, lat: float, lng: float) -> bool:
        if not isinstance(bbox, list) or len(bbox) != 4:
            return False
        min_lng, min_lat, max_lng, max_lat = bbox
        return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng

    def _aoi_contains_point(self, aoi_geojson: Any, lat: float, lng: float) -> bool:
        if not isinstance(aoi_geojson, dict):
            return False
        geometry_type = aoi_geojson.get("type")
        if geometry_type not in {"Polygon", "MultiPolygon"}:
            return False

        coordinates = aoi_geojson.get("coordinates")
        if not coordinates:
            return False

        points: list[tuple[float, float]] = []
        if geometry_type == "Polygon":
            for ring in coordinates:
                for point in ring:
                    if isinstance(point, list) and len(point) >= 2:
                        points.append((float(point[0]), float(point[1])))
        else:
            for polygon in coordinates:
                for ring in polygon:
                    for point in ring:
                        if isinstance(point, list) and len(point) >= 2:
                            points.append((float(point[0]), float(point[1])))

        if not points:
            return False

        lng_values = [point[0] for point in points]
        lat_values = [point[1] for point in points]
        return min(lat_values) <= lat <= max(lat_values) and min(lng_values) <= lng <= max(lng_values)
