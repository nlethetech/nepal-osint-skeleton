"""PWTT run persistence and evidence APIs."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_analyst
from app.models.analyst_enums import SourceClassification
from app.models.connected_analyst import DamageRun, DamageRunStatus
from app.models.user import User
from app.services.pwtt import PWTTPersistenceService

router = APIRouter(prefix="/pwtt", tags=["pwtt"])


class PWTTArtifactRequest(BaseModel):
    artifact_type: str
    file_path: str
    mime_type: str | None = None
    metadata: dict[str, Any] | None = None
    source_classification: SourceClassification = SourceClassification.UNKNOWN


class PWTTFindingRequest(BaseModel):
    finding_type: str = "damage_signal"
    title: str | None = None
    severity: str = "moderate"
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    geometry: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    district: str | None = None
    customs_office: str | None = None
    route_name: str | None = None


class CreatePWTTRunRequest(BaseModel):
    assessment_id: UUID | None = None
    case_id: UUID | None = None
    algorithm_name: str = "pwtt"
    algorithm_version: str = "1.0"
    status: DamageRunStatus = DamageRunStatus.COMPLETED
    aoi_geojson: dict[str, Any]
    event_date: datetime | None = None
    run_params: dict[str, Any] | None = None
    summary: dict[str, Any] | None = None
    confidence_score: float | None = Field(default=None, ge=0.0, le=1.0)
    artifacts: list[PWTTArtifactRequest] = Field(default_factory=list)
    findings: list[PWTTFindingRequest] = Field(default_factory=list)


class AttachRunToCaseRequest(BaseModel):
    case_id: UUID | None = None
    include_findings: bool = True


class CreateAOIRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    center_lat: float
    center_lng: float
    radius_km: float = Field(default=1.0, ge=0.1, le=25.0)
    geometry: dict[str, Any] | None = None
    tags: list[str] | None = None


def _safe_artifact_path(file_path: str) -> Path:
    repo_root = Path(__file__).resolve().parents[4]
    candidate = Path(file_path).expanduser()
    if not candidate.is_absolute():
        candidate = (repo_root / candidate).resolve()
    else:
        candidate = candidate.resolve()
    allowed_prefixes = [
        str(repo_root),
        "/tmp",
    ]
    if not any(str(candidate).startswith(prefix) for prefix in allowed_prefixes):
        raise HTTPException(status_code=400, detail="Artifact path is outside allowed roots")
    return candidate


@router.get("/runs")
async def list_pwtt_runs(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    service = PWTTPersistenceService(db)

    runs_query = await db.execute(
        select(DamageRun)
        .order_by(DamageRun.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    runs = list(runs_query.scalars().all())

    total = int((await db.execute(select(func.count()).select_from(DamageRun))).scalar() or 0)

    items: list[dict[str, Any]] = []
    for run in runs:
        artifacts = await service.get_run_artifacts(run.id)
        findings = await service.get_findings(run.id)
        items.append(
            {
                "id": str(run.id),
                "case_id": str(run.case_id) if run.case_id else None,
                "algorithm_name": run.algorithm_name,
                "algorithm_version": run.algorithm_version,
                "status": run.status.value,
                "confidence": run.confidence_score,
                "source_count": len(artifacts) + len(findings),
                "artifacts_count": len(artifacts),
                "findings_count": len(findings),
                "verification_status": run.verification_status.value,
                "created_at": run.created_at.isoformat() if run.created_at else None,
            }
        )

    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/runs")
async def create_pwtt_run(
    request: CreatePWTTRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    service = PWTTPersistenceService(db)
    try:
        run = await service.create_run(
            initiated_by_id=current_user.id,
            assessment_id=request.assessment_id,
            case_id=request.case_id,
            algorithm_name=request.algorithm_name,
            algorithm_version=request.algorithm_version,
            status=request.status,
            aoi_geojson=request.aoi_geojson,
            event_date=request.event_date,
            run_params=request.run_params,
            summary=request.summary,
            confidence_score=request.confidence_score,
            artifacts=[item.model_dump() for item in request.artifacts],
            findings=[item.model_dump() for item in request.findings],
        )
        await db.commit()
        artifacts = await service.get_run_artifacts(run.id)
        findings = await service.get_findings(run.id)
        return {
            "id": str(run.id),
            "status": run.status.value,
            "algorithm_name": run.algorithm_name,
            "algorithm_version": run.algorithm_version,
            "verification_status": run.verification_status.value,
            "source_count": len(artifacts) + len(findings),
            "confidence": run.confidence_score,
            "artifacts_count": len(artifacts),
            "findings_count": len(findings),
            "created_at": run.created_at.isoformat() if run.created_at else None,
        }
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/runs/{run_id}")
async def get_pwtt_run(
    run_id: UUID,
    include_artifacts: bool = Query(True),
    include_findings: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    service = PWTTPersistenceService(db)
    run = await service.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="PWTT run not found")

    artifacts = await service.get_run_artifacts(run.id) if include_artifacts else []
    findings = await service.get_findings(run.id) if include_findings else []

    return {
        "id": str(run.id),
        "assessment_id": str(run.assessment_id) if run.assessment_id else None,
        "case_id": str(run.case_id) if run.case_id else None,
        "algorithm_name": run.algorithm_name,
        "algorithm_version": run.algorithm_version,
        "status": run.status.value,
        "aoi_geojson": run.aoi_geojson,
        "event_date": run.event_date.isoformat() if run.event_date else None,
        "run_params": run.run_params or {},
        "summary": run.summary or {},
        "confidence": run.confidence_score,
        "source_count": len(artifacts) + len(findings),
        "verification_status": run.verification_status.value,
        "artifacts": [
            {
                "id": str(item.id),
                "artifact_type": item.artifact_type,
                "file_path": item.file_path,
                "checksum_sha256": item.checksum_sha256,
                "mime_type": item.mime_type,
                "source_classification": item.source_classification.value,
                "metadata": item.artifact_metadata or {},
            }
            for item in artifacts
        ],
        "findings": [
            {
                "id": str(item.id),
                "finding_type": item.finding_type,
                "title": item.title,
                "severity": item.severity,
                "confidence": item.confidence,
                "district": item.district,
                "customs_office": item.customs_office,
                "route_name": item.route_name,
                "geometry": item.geometry,
                "metrics": item.metrics,
                "verification_status": item.verification_status.value,
            }
            for item in findings
        ],
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }


@router.get("/runs/{run_id}/three-panel")
async def get_three_panel_artifacts(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    service = PWTTPersistenceService(db)
    run = await service.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="PWTT run not found")

    artifacts = await service.get_three_panel_artifacts(run_id)
    return {
        "run_id": str(run_id),
        "items": [
            {
                "id": str(item.id),
                "artifact_type": item.artifact_type,
                "file_path": item.file_path,
                "checksum_sha256": item.checksum_sha256,
                "mime_type": item.mime_type,
                "source_classification": item.source_classification.value,
                "metadata": item.artifact_metadata or {},
            }
            for item in artifacts
        ],
        "total": len(artifacts),
    }


@router.get("/runs/{run_id}/findings")
async def get_pwtt_findings(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    service = PWTTPersistenceService(db)
    run = await service.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="PWTT run not found")

    findings = await service.get_findings(run_id)
    provenance = await service.get_provenance_for_findings([str(item.id) for item in findings])

    return {
        "run_id": str(run_id),
        "items": [
            {
                "id": str(item.id),
                "finding_type": item.finding_type,
                "title": item.title,
                "severity": item.severity,
                "confidence": item.confidence,
                "district": item.district,
                "customs_office": item.customs_office,
                "route_name": item.route_name,
                "verification_status": item.verification_status.value,
                "geometry": item.geometry,
                "metrics": item.metrics,
                "source_count": len(provenance.get(str(item.id), [])),
                "provenance_refs": provenance.get(str(item.id), []),
            }
            for item in findings
        ],
        "total": len(findings),
    }


@router.post("/runs/{run_id}/attach-to-case")
async def attach_pwtt_run_to_case(
    run_id: UUID,
    request: AttachRunToCaseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    service = PWTTPersistenceService(db)
    run = await service.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="PWTT run not found")

    case_id = request.case_id or run.case_id
    if not case_id:
        raise HTTPException(status_code=400, detail="case_id must be provided if run is not already linked")

    try:
        result = await service.attach_run_to_case(
            run_id=run_id,
            case_id=case_id,
            added_by_id=current_user.id,
            include_findings=request.include_findings,
        )
        await db.commit()
        return {
            "status": "ok",
            **result,
        }
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/aois")
async def list_pwtt_aois(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    service = PWTTPersistenceService(db)
    rows = await service.list_aois(current_user.id, limit=limit)
    return {
        "items": [
            {
                "id": str(item.id),
                "name": item.name,
                "owner_user_id": str(item.owner_user_id),
                "center_lat": item.center_lat,
                "center_lng": item.center_lng,
                "radius_km": item.radius_km,
                "geometry": item.geometry,
                "tags": item.tags or [],
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            }
            for item in rows
        ],
        "total": len(rows),
    }


@router.post("/aois")
async def create_pwtt_aoi(
    request: CreateAOIRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    service = PWTTPersistenceService(db)
    item = await service.create_aoi(
        owner_user_id=current_user.id,
        name=request.name,
        center_lat=request.center_lat,
        center_lng=request.center_lng,
        radius_km=request.radius_km,
        geometry=request.geometry,
        tags=request.tags,
    )
    await db.commit()
    return {
        "id": str(item.id),
        "name": item.name,
        "owner_user_id": str(item.owner_user_id),
        "center_lat": item.center_lat,
        "center_lng": item.center_lng,
        "radius_km": item.radius_km,
        "geometry": item.geometry,
        "tags": item.tags or [],
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


@router.get("/runs/{run_id}/artifacts/{artifact_id}/stream")
async def stream_pwtt_artifact(
    run_id: UUID,
    artifact_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_analyst),
):
    service = PWTTPersistenceService(db)
    artifact = await service.get_artifact(run_id, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    path = _safe_artifact_path(artifact.file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact file not found on disk")

    media_type = artifact.mime_type or "application/octet-stream"
    return FileResponse(path=str(path), media_type=media_type, filename=path.name)
