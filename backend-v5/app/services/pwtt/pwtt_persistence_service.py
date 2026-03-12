"""Persistence service for PWTT runs, artifacts, findings, and cross-domain links."""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analyst_enums import SourceClassification
from app.models.case import Case, CaseEvidence, EvidenceType
from app.models.connected_analyst import (
    AnalystAOI,
    AnalystVerificationStatus,
    DamageArtifact,
    DamageFinding,
    DamageRun,
    DamageRunStatus,
    KBEvidenceRef,
    KBLink,
    KBObject,
    ProvenanceOwnerType,
    TradeAnomaly,
)


class PWTTPersistenceService:
    """Persist and query PWTT evidence entities for analyst workflows."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_run(
        self,
        *,
        initiated_by_id: UUID | None,
        assessment_id: UUID | None,
        case_id: UUID | None,
        algorithm_name: str,
        algorithm_version: str,
        status: DamageRunStatus,
        aoi_geojson: dict[str, Any],
        event_date: datetime | None,
        run_params: dict[str, Any] | None,
        summary: dict[str, Any] | None,
        confidence_score: float | None,
        artifacts: list[dict[str, Any]],
        findings: list[dict[str, Any]],
    ) -> DamageRun:
        if case_id:
            case_exists = await self.db.scalar(select(Case.id).where(Case.id == case_id))
            if not case_exists:
                raise ValueError("Case not found for provided case_id")

        now = datetime.now(timezone.utc)
        run = DamageRun(
            assessment_id=assessment_id,
            case_id=case_id,
            algorithm_name=algorithm_name,
            algorithm_version=algorithm_version,
            status=status,
            aoi_geojson=aoi_geojson,
            event_date=event_date,
            run_params=run_params,
            initiated_by_id=initiated_by_id,
            started_at=now,
            completed_at=now if status == DamageRunStatus.COMPLETED else None,
            confidence_score=confidence_score,
            summary=summary,
            verification_status=AnalystVerificationStatus.CANDIDATE,
        )
        self.db.add(run)
        await self.db.flush()

        for artifact in artifacts:
            file_path = str(artifact.get("file_path", "")).strip()
            checksum = self._checksum_if_exists(file_path)
            item = DamageArtifact(
                run_id=run.id,
                artifact_type=str(artifact.get("artifact_type", "artifact")),
                file_path=file_path,
                checksum_sha256=checksum,
                mime_type=artifact.get("mime_type"),
                artifact_metadata=artifact.get("metadata") or {},
                source_classification=artifact.get("source_classification") or SourceClassification.UNKNOWN,
            )
            self.db.add(item)

        for finding_payload in findings:
            finding = DamageFinding(
                run_id=run.id,
                finding_type=str(finding_payload.get("finding_type", "damage_signal")),
                title=finding_payload.get("title"),
                severity=str(finding_payload.get("severity", "moderate")),
                confidence=float(finding_payload.get("confidence") or 0.0),
                geometry=finding_payload.get("geometry"),
                metrics=finding_payload.get("metrics"),
                district=finding_payload.get("district"),
                customs_office=finding_payload.get("customs_office"),
                route_name=finding_payload.get("route_name"),
                verification_status=AnalystVerificationStatus.CANDIDATE,
            )
            self.db.add(finding)
            await self.db.flush()

            await self._create_finding_provenance(run, finding)
            await self._link_finding_to_graph(run, finding)

        await self.db.flush()
        return run

    async def get_run(self, run_id: UUID) -> DamageRun | None:
        return await self.db.scalar(select(DamageRun).where(DamageRun.id == run_id))

    async def get_run_artifacts(self, run_id: UUID) -> list[DamageArtifact]:
        rows = await self.db.execute(
            select(DamageArtifact)
            .where(DamageArtifact.run_id == run_id)
            .order_by(DamageArtifact.created_at.desc())
        )
        return list(rows.scalars().all())

    async def get_three_panel_artifacts(self, run_id: UUID) -> list[DamageArtifact]:
        rows = await self.db.execute(
            select(DamageArtifact)
            .where(DamageArtifact.run_id == run_id)
            .where(DamageArtifact.artifact_type.ilike("three_panel%"))
            .order_by(DamageArtifact.created_at.asc())
        )
        return list(rows.scalars().all())

    async def get_artifact(self, run_id: UUID, artifact_id: UUID) -> DamageArtifact | None:
        return await self.db.scalar(
            select(DamageArtifact)
            .where(DamageArtifact.run_id == run_id)
            .where(DamageArtifact.id == artifact_id)
        )

    async def list_aois(self, owner_user_id: UUID, limit: int = 100) -> list[AnalystAOI]:
        rows = await self.db.execute(
            select(AnalystAOI)
            .where(AnalystAOI.owner_user_id == owner_user_id)
            .order_by(AnalystAOI.updated_at.desc())
            .limit(limit)
        )
        return list(rows.scalars().all())

    async def create_aoi(
        self,
        *,
        owner_user_id: UUID,
        name: str,
        center_lat: float,
        center_lng: float,
        radius_km: float,
        geometry: dict[str, Any] | None,
        tags: list[str] | None,
    ) -> AnalystAOI:
        aoi = AnalystAOI(
            owner_user_id=owner_user_id,
            name=name,
            center_lat=center_lat,
            center_lng=center_lng,
            radius_km=radius_km,
            geometry=geometry,
            tags=tags,
        )
        self.db.add(aoi)
        await self.db.flush()
        return aoi

    async def get_findings(self, run_id: UUID) -> list[DamageFinding]:
        rows = await self.db.execute(
            select(DamageFinding)
            .where(DamageFinding.run_id == run_id)
            .order_by(DamageFinding.created_at.desc())
        )
        return list(rows.scalars().all())

    async def get_provenance_for_findings(self, finding_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        if not finding_ids:
            return {}

        rows = await self.db.execute(
            select(KBEvidenceRef)
            .where(KBEvidenceRef.owner_type == ProvenanceOwnerType.DAMAGE_FINDING)
            .where(KBEvidenceRef.owner_id.in_(finding_ids))
            .order_by(KBEvidenceRef.captured_at.desc())
        )

        grouped: dict[str, list[dict[str, Any]]] = {item: [] for item in finding_ids}
        for item in rows.scalars().all():
            grouped.setdefault(item.owner_id, []).append(
                {
                    "id": str(item.id),
                    "evidence_type": item.evidence_type,
                    "source_name": item.source_name,
                    "source_key": item.source_key,
                    "source_classification": item.source_classification.value,
                    "confidence": item.confidence,
                    "excerpt": item.excerpt,
                    "captured_at": item.captured_at.isoformat() if item.captured_at else None,
                    "metadata": item.evidence_metadata or {},
                }
            )
        return grouped

    async def attach_run_to_case(
        self,
        *,
        run_id: UUID,
        case_id: UUID,
        added_by_id: UUID,
        include_findings: bool = True,
    ) -> dict[str, Any]:
        run = await self.get_run(run_id)
        if not run:
            raise ValueError("PWTT run not found")

        case = await self.db.scalar(select(Case).where(Case.id == case_id))
        if not case:
            raise ValueError("Case not found")

        run.case_id = case_id

        run_evidence = CaseEvidence(
            case_id=case_id,
            evidence_type=EvidenceType.DOCUMENT,
            reference_id=str(run.id),
            title=f"PWTT Run {run.algorithm_name} {run.algorithm_version}",
            summary="Persisted PWTT run with three-panel artifacts and extracted findings",
            relevance_notes="Connected analyst PWTT evidence attached to case",
            is_key_evidence=True,
            confidence="likely",
            added_by_id=added_by_id,
            extra_data={
                "damage_run_id": str(run.id),
                "algorithm": run.algorithm_name,
                "version": run.algorithm_version,
                "verification_status": run.verification_status.value,
            },
        )
        self.db.add(run_evidence)

        findings = await self.get_findings(run_id)
        findings_attached = 0

        if include_findings:
            for finding in findings:
                evidence = CaseEvidence(
                    case_id=case_id,
                    evidence_type=EvidenceType.NOTE,
                    reference_id=str(finding.id),
                    title=finding.title or f"PWTT finding {finding.finding_type}",
                    summary=f"Severity={finding.severity}, confidence={finding.confidence:.2f}",
                    relevance_notes="Auto-attached PWTT finding for hypothesis and timeline analysis",
                    is_key_evidence=finding.severity in {"critical", "high", "severe"},
                    confidence=self._confidence_band(finding.confidence),
                    added_by_id=added_by_id,
                    extra_data={
                        "damage_run_id": str(run.id),
                        "damage_finding_id": str(finding.id),
                        "district": finding.district,
                        "customs_office": finding.customs_office,
                        "route_name": finding.route_name,
                        "verification_status": finding.verification_status.value,
                    },
                )
                self.db.add(evidence)
                findings_attached += 1

        await self.db.flush()
        return {
            "run_id": str(run.id),
            "case_id": str(case.id),
            "attached_run_evidence": True,
            "attached_findings": findings_attached,
        }

    async def _create_finding_provenance(self, run: DamageRun, finding: DamageFinding) -> None:
        evidence = KBEvidenceRef(
            owner_type=ProvenanceOwnerType.DAMAGE_FINDING,
            owner_id=str(finding.id),
            evidence_type="pwtt_run",
            evidence_id=str(run.id),
            source_key=f"pwtt:{run.algorithm_name}:{run.algorithm_version}:{run.id}",
            source_name=f"{run.algorithm_name} {run.algorithm_version}",
            source_classification=SourceClassification.INDEPENDENT,
            confidence=max(0.2, min(1.0, finding.confidence)),
            excerpt=finding.title,
            evidence_metadata={
                "finding_type": finding.finding_type,
                "severity": finding.severity,
                "district": finding.district,
                "customs_office": finding.customs_office,
                "route_name": finding.route_name,
            },
        )
        self.db.add(evidence)

    async def _link_finding_to_graph(self, run: DamageRun, finding: DamageFinding) -> None:
        finding_obj = await self._get_or_create_object(
            canonical_key=f"damage_finding:{finding.id}",
            object_type="damage_finding",
            title=finding.title or f"Finding {finding.finding_type}",
            description=f"PWTT {finding.finding_type} ({finding.severity})",
            attributes={
                "run_id": str(run.id),
                "severity": finding.severity,
                "finding_type": finding.finding_type,
                "district": finding.district,
                "customs_office": finding.customs_office,
                "route_name": finding.route_name,
            },
            confidence=max(0.2, min(1.0, finding.confidence)),
        )

        if finding.district:
            district_obj = await self._get_or_create_object(
                canonical_key=f"district:{self._slugify(finding.district)}",
                object_type="district",
                title=finding.district,
                description=None,
                attributes={"district": finding.district},
                confidence=0.6,
            )
            link = await self._get_or_create_link(finding_obj, district_obj, "IMPACTS_DISTRICT", finding.confidence)
            await self._add_link_evidence(link.id, run, finding)

        if finding.customs_office:
            customs_key = self._slugify(finding.customs_office)
            customs_obj = await self._get_or_create_object(
                canonical_key=f"customs:{customs_key}",
                object_type="customs_office",
                title=finding.customs_office,
                description=None,
                attributes={"customs_office": finding.customs_office},
                confidence=0.6,
            )
            link = await self._get_or_create_link(finding_obj, customs_obj, "DISRUPTS_CUSTOMS", finding.confidence)
            await self._add_link_evidence(link.id, run, finding)

            anomalies = await self.db.execute(
                select(TradeAnomaly)
                .where(TradeAnomaly.dimension == "customs_office")
                .where(TradeAnomaly.dimension_key == customs_key)
                .order_by(TradeAnomaly.anomaly_score.desc())
                .limit(5)
            )
            for anomaly in anomalies.scalars().all():
                anomaly_obj = await self._get_or_create_object(
                    canonical_key=f"trade_anomaly:{anomaly.id}",
                    object_type="trade_anomaly",
                    title=f"Trade anomaly {anomaly.dimension_key}",
                    description=anomaly.rationale,
                    attributes={
                        "dimension": anomaly.dimension,
                        "dimension_key": anomaly.dimension_key,
                        "fiscal_year_bs": anomaly.fiscal_year_bs,
                        "month_ordinal": anomaly.month_ordinal,
                        "severity": anomaly.severity,
                    },
                    confidence=min(1.0, anomaly.anomaly_score / 5.0),
                )
                anomaly_link = await self._get_or_create_link(
                    finding_obj,
                    anomaly_obj,
                    "CORRELATED_WITH_TRADE_ANOMALY",
                    min(1.0, anomaly.anomaly_score / 5.0),
                )
                await self._add_link_evidence(anomaly_link.id, run, finding)

        if finding.route_name:
            route_obj = await self._get_or_create_object(
                canonical_key=f"route:{self._slugify(finding.route_name)}",
                object_type="route",
                title=finding.route_name,
                description=None,
                attributes={"route_name": finding.route_name},
                confidence=0.55,
            )
            link = await self._get_or_create_link(finding_obj, route_obj, "DISRUPTS_ROUTE", finding.confidence)
            await self._add_link_evidence(link.id, run, finding)

    async def _get_or_create_object(
        self,
        *,
        canonical_key: str,
        object_type: str,
        title: str,
        description: str | None,
        attributes: dict[str, Any],
        confidence: float,
    ) -> KBObject:
        obj = await self.db.scalar(select(KBObject).where(KBObject.canonical_key == canonical_key))
        if obj:
            obj.source_count += 1
            obj.confidence = max(obj.confidence, confidence)
            obj.attributes = {**(obj.attributes or {}), **attributes}
            if description and not obj.description:
                obj.description = description
            return obj

        obj = KBObject(
            object_type=object_type,
            canonical_key=canonical_key,
            title=title,
            description=description,
            attributes=attributes,
            confidence=max(0.2, min(1.0, confidence)),
            source_count=1,
            verification_status=AnalystVerificationStatus.CANDIDATE,
        )
        self.db.add(obj)
        await self.db.flush()
        return obj

    async def _get_or_create_link(
        self,
        source_obj: KBObject,
        target_obj: KBObject,
        predicate: str,
        confidence: float,
    ) -> KBLink:
        link = await self.db.scalar(
            select(KBLink)
            .where(KBLink.source_object_id == source_obj.id)
            .where(KBLink.target_object_id == target_obj.id)
            .where(KBLink.predicate == predicate)
        )
        if link:
            link.source_count += 1
            link.confidence = max(link.confidence, max(0.2, min(1.0, confidence)))
            link.last_seen_at = datetime.now(timezone.utc)
            return link

        now = datetime.now(timezone.utc)
        link = KBLink(
            source_object_id=source_obj.id,
            target_object_id=target_obj.id,
            predicate=predicate,
            confidence=max(0.2, min(1.0, confidence)),
            source_count=1,
            verification_status=AnalystVerificationStatus.CANDIDATE,
            first_seen_at=now,
            last_seen_at=now,
        )
        self.db.add(link)
        await self.db.flush()
        return link

    async def _add_link_evidence(self, link_id: UUID, run: DamageRun, finding: DamageFinding) -> None:
        evidence = KBEvidenceRef(
            owner_type=ProvenanceOwnerType.LINK,
            owner_id=str(link_id),
            evidence_type="pwtt_finding",
            evidence_id=str(finding.id),
            source_key=f"pwtt:{run.id}:{finding.id}",
            source_name=f"{run.algorithm_name} {run.algorithm_version}",
            source_classification=SourceClassification.INDEPENDENT,
            confidence=max(0.2, min(1.0, finding.confidence)),
            excerpt=f"{finding.finding_type} {finding.severity}",
            evidence_metadata={
                "run_id": str(run.id),
                "finding_id": str(finding.id),
            },
        )
        self.db.add(evidence)

    @staticmethod
    def _checksum_if_exists(file_path: str) -> str | None:
        if not file_path:
            return None
        path = Path(file_path)
        if not path.exists() or not path.is_file():
            return None

        hasher = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    @staticmethod
    def _slugify(value: str) -> str:
        cleaned = value.strip().lower()
        cleaned = re.sub(r"[^a-z0-9]+", "_", cleaned)
        return cleaned.strip("_")

    @staticmethod
    def _confidence_band(confidence: float) -> str:
        if confidence >= 0.85:
            return "confirmed"
        if confidence >= 0.65:
            return "likely"
        if confidence >= 0.4:
            return "possible"
        return "doubtful"
