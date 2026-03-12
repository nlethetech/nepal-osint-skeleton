"""Case hypothesis APIs with provenance-backed evidence linking."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_analyst
from app.models.analyst_enums import SourceClassification
from app.models.case import Case
from app.models.team import TeamMembership
from app.models.connected_analyst import (
    CaseHypothesis,
    HypothesisEvidenceLink,
    HypothesisEvidenceRelation,
    HypothesisStatus,
    KBEvidenceRef,
    ProvenanceOwnerType,
)
from app.models.user import User

router = APIRouter(prefix="/cases", tags=["hypotheses"])


async def _can_access_case(case: Case, user: User, db: AsyncSession, require_write: bool) -> bool:
    if user.is_dev():
        return True
    if case.created_by_id == user.id:
        return True
    if case.assigned_to_id == user.id:
        return True
    if case.visibility.value == "public":
        return not require_write
    if case.visibility.value == "team" and case.team_id:
        member = await db.scalar(
            select(TeamMembership)
            .where(TeamMembership.team_id == case.team_id)
            .where(TeamMembership.user_id == user.id)
            .where(TeamMembership.is_active == True)
        )
        if not member:
            return False
        if not require_write:
            return True
        return member.role.value != "viewer"
    return False


class CreateHypothesisRequest(BaseModel):
    statement: str = Field(min_length=3)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    rationale: str | None = None


class UpdateHypothesisRequest(BaseModel):
    statement: str | None = Field(default=None, min_length=3)
    status: HypothesisStatus | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    rationale: str | None = None


class AttachEvidenceRequest(BaseModel):
    evidence_ref_id: UUID | None = None
    relation_type: HypothesisEvidenceRelation = HypothesisEvidenceRelation.CONTEXT
    weight: float | None = Field(default=None, ge=0.0, le=1.0)
    notes: str | None = None

    evidence_type: str | None = None
    evidence_id: str | None = None
    source_url: str | None = None
    source_key: str | None = None
    source_name: str | None = None
    source_classification: SourceClassification = SourceClassification.UNKNOWN
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    excerpt: str | None = None
    metadata: dict[str, Any] | None = None


@router.post("/{case_id}/hypotheses")
async def create_hypothesis(
    case_id: UUID,
    request: CreateHypothesisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    case = await db.scalar(select(Case).where(Case.id == case_id))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if not await _can_access_case(case, current_user, db, require_write=True):
        raise HTTPException(status_code=403, detail="You don't have access to this case")

    hypothesis = CaseHypothesis(
        case_id=case_id,
        statement=request.statement,
        status=HypothesisStatus.OPEN,
        confidence=request.confidence,
        rationale=request.rationale,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(hypothesis)
    await db.commit()
    await db.refresh(hypothesis)

    return {
        "id": str(hypothesis.id),
        "case_id": str(hypothesis.case_id),
        "statement": hypothesis.statement,
        "status": hypothesis.status.value,
        "confidence": hypothesis.confidence,
        "rationale": hypothesis.rationale,
        "created_by_id": str(hypothesis.created_by_id) if hypothesis.created_by_id else None,
        "updated_by_id": str(hypothesis.updated_by_id) if hypothesis.updated_by_id else None,
        "source_count": 0,
        "created_at": hypothesis.created_at.isoformat() if hypothesis.created_at else None,
        "updated_at": hypothesis.updated_at.isoformat() if hypothesis.updated_at else None,
    }


@router.get("/{case_id}/hypotheses")
async def list_hypotheses(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    case = await db.scalar(select(Case).where(Case.id == case_id))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if not await _can_access_case(case, current_user, db, require_write=False):
        raise HTTPException(status_code=403, detail="You don't have access to this case")

    rows = await db.execute(
        select(CaseHypothesis)
        .where(CaseHypothesis.case_id == case_id)
        .order_by(CaseHypothesis.updated_at.desc())
    )
    items = list(rows.scalars().all())

    results: list[dict[str, Any]] = []
    for hypothesis in items:
        source_count = int(
            (
                await db.execute(
                    select(func.count()).select_from(HypothesisEvidenceLink).where(
                        HypothesisEvidenceLink.hypothesis_id == hypothesis.id
                    )
                )
            ).scalar()
            or 0
        )
        results.append(
            {
                "id": str(hypothesis.id),
                "case_id": str(hypothesis.case_id),
                "statement": hypothesis.statement,
                "status": hypothesis.status.value,
                "confidence": hypothesis.confidence,
                "rationale": hypothesis.rationale,
                "source_count": source_count,
                "created_by_id": str(hypothesis.created_by_id) if hypothesis.created_by_id else None,
                "updated_by_id": str(hypothesis.updated_by_id) if hypothesis.updated_by_id else None,
                "created_at": hypothesis.created_at.isoformat() if hypothesis.created_at else None,
                "updated_at": hypothesis.updated_at.isoformat() if hypothesis.updated_at else None,
            }
        )

    return {"items": results, "total": len(results)}


@router.patch("/{case_id}/hypotheses/{hypothesis_id}")
async def update_hypothesis(
    case_id: UUID,
    hypothesis_id: UUID,
    request: UpdateHypothesisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    case = await db.scalar(select(Case).where(Case.id == case_id))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if not await _can_access_case(case, current_user, db, require_write=True):
        raise HTTPException(status_code=403, detail="You don't have access to this case")

    hypothesis = await db.scalar(
        select(CaseHypothesis)
        .where(CaseHypothesis.id == hypothesis_id)
        .where(CaseHypothesis.case_id == case_id)
    )
    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    data = request.model_dump(exclude_unset=True)
    if "statement" in data:
        hypothesis.statement = data["statement"]
    if "status" in data and data["status"] is not None:
        hypothesis.status = data["status"]
    if "confidence" in data and data["confidence"] is not None:
        hypothesis.confidence = data["confidence"]
    if "rationale" in data:
        hypothesis.rationale = data["rationale"]

    hypothesis.updated_by_id = current_user.id

    await db.commit()
    await db.refresh(hypothesis)

    links_count = int(
        (
            await db.execute(
                select(func.count()).select_from(HypothesisEvidenceLink).where(
                    HypothesisEvidenceLink.hypothesis_id == hypothesis.id
                )
            )
        ).scalar()
        or 0
    )

    return {
        "id": str(hypothesis.id),
        "case_id": str(hypothesis.case_id),
        "statement": hypothesis.statement,
        "status": hypothesis.status.value,
        "confidence": hypothesis.confidence,
        "rationale": hypothesis.rationale,
        "source_count": links_count,
        "updated_by_id": str(hypothesis.updated_by_id) if hypothesis.updated_by_id else None,
        "updated_at": hypothesis.updated_at.isoformat() if hypothesis.updated_at else None,
    }


@router.post("/{case_id}/hypotheses/{hypothesis_id}/evidence")
async def attach_hypothesis_evidence(
    case_id: UUID,
    hypothesis_id: UUID,
    request: AttachEvidenceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    case = await db.scalar(select(Case).where(Case.id == case_id))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if not await _can_access_case(case, current_user, db, require_write=True):
        raise HTTPException(status_code=403, detail="You don't have access to this case")

    hypothesis = await db.scalar(
        select(CaseHypothesis)
        .where(CaseHypothesis.id == hypothesis_id)
        .where(CaseHypothesis.case_id == case_id)
    )
    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    evidence_ref_id = request.evidence_ref_id

    if evidence_ref_id is None:
        if not request.evidence_type:
            raise HTTPException(
                status_code=400,
                detail="Provide evidence_ref_id or evidence_type to create a new provenance reference",
            )

        evidence = KBEvidenceRef(
            owner_type=ProvenanceOwnerType.HYPOTHESIS,
            owner_id=str(hypothesis.id),
            evidence_type=request.evidence_type,
            evidence_id=request.evidence_id,
            source_url=request.source_url,
            source_key=request.source_key,
            source_name=request.source_name,
            source_classification=request.source_classification,
            confidence=request.confidence,
            excerpt=request.excerpt,
            evidence_metadata=request.metadata or {},
        )
        db.add(evidence)
        await db.flush()
        evidence_ref_id = evidence.id
    else:
        existing_ref = await db.scalar(select(KBEvidenceRef).where(KBEvidenceRef.id == evidence_ref_id))
        if not existing_ref:
            raise HTTPException(status_code=404, detail="evidence_ref_id not found")

    existing_link = await db.scalar(
        select(HypothesisEvidenceLink)
        .where(HypothesisEvidenceLink.hypothesis_id == hypothesis.id)
        .where(HypothesisEvidenceLink.evidence_ref_id == evidence_ref_id)
    )
    if existing_link:
        existing_link.relation_type = request.relation_type
        existing_link.weight = request.weight
        existing_link.notes = request.notes
        existing_link.created_by_id = current_user.id
        link = existing_link
    else:
        link = HypothesisEvidenceLink(
            hypothesis_id=hypothesis.id,
            evidence_ref_id=evidence_ref_id,
            relation_type=request.relation_type,
            weight=request.weight,
            notes=request.notes,
            created_by_id=current_user.id,
        )
        db.add(link)

    await db.commit()
    await db.refresh(link)

    return {
        "id": str(link.id),
        "hypothesis_id": str(link.hypothesis_id),
        "evidence_ref_id": str(link.evidence_ref_id),
        "relation_type": link.relation_type.value,
        "weight": link.weight,
        "notes": link.notes,
        "created_by_id": str(link.created_by_id) if link.created_by_id else None,
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "updated_at": link.updated_at.isoformat() if link.updated_at else None,
    }
