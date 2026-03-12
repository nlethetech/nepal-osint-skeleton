"""Connected analyst graph service with provenance-aware responses."""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connected_analyst import (
    KBObject,
    KBLink,
    KBEvidenceRef,
    ProvenanceOwnerType,
)


class GraphService:
    """Query service for connected analyst graph APIs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def search_objects(
        self,
        query: Optional[str] = None,
        object_types: Optional[list[str]] = None,
        limit: int = 25,
        offset: int = 0,
    ) -> dict[str, Any]:
        stmt = select(KBObject)

        if query:
            pattern = f"%{query.strip()}%"
            stmt = stmt.where(
                or_(
                    KBObject.title.ilike(pattern),
                    KBObject.canonical_key.ilike(pattern),
                    KBObject.description.ilike(pattern),
                )
            )

        if object_types:
            normalized = [item.strip().lower() for item in object_types if item.strip()]
            if normalized:
                stmt = stmt.where(KBObject.object_type.in_(normalized))

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.db.execute(count_stmt)).scalar() or 0

        rows = await self.db.execute(
            stmt.order_by(KBObject.source_count.desc(), KBObject.confidence.desc(), KBObject.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )

        objects = [await self._serialize_object(item) for item in rows.scalars().all()]

        return {
            "items": objects,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    async def get_object(self, object_id: UUID) -> Optional[dict[str, Any]]:
        obj = await self.db.scalar(select(KBObject).where(KBObject.id == object_id))
        if not obj:
            return None
        return await self._serialize_object(obj, include_evidence=True)

    async def get_neighbors(self, object_id: UUID, limit: int = 100) -> Optional[dict[str, Any]]:
        center = await self.db.scalar(select(KBObject).where(KBObject.id == object_id))
        if not center:
            return None

        links = await self.db.execute(
            select(KBLink)
            .where(or_(KBLink.source_object_id == object_id, KBLink.target_object_id == object_id))
            .order_by(KBLink.source_count.desc(), KBLink.confidence.desc(), KBLink.updated_at.desc())
            .limit(limit)
        )

        results: list[dict[str, Any]] = []
        for link in links.scalars().all():
            neighbor_id = link.target_object_id if link.source_object_id == object_id else link.source_object_id
            neighbor = await self.db.scalar(select(KBObject).where(KBObject.id == neighbor_id))
            if not neighbor:
                continue

            results.append(
                {
                    "neighbor": await self._serialize_object(neighbor),
                    "link": await self._serialize_link(link),
                }
            )

        return {
            "center": await self._serialize_object(center, include_evidence=True),
            "neighbors": results,
        }

    async def get_timeline(self, object_id: UUID, limit: int = 100) -> Optional[dict[str, Any]]:
        center = await self.db.scalar(select(KBObject).where(KBObject.id == object_id))
        if not center:
            return None

        events: list[dict[str, Any]] = []

        events.append(
            {
                "event_type": "object_created",
                "timestamp": center.created_at.isoformat() if center.created_at else None,
                "title": center.title,
                "object_id": str(center.id),
                "confidence": center.confidence,
                "source_count": center.source_count,
                "verification_status": center.verification_status.value,
                "provenance_refs": await self._get_evidence(
                    owner_type=ProvenanceOwnerType.OBJECT,
                    owner_id=str(center.id),
                ),
            }
        )

        links = await self.db.execute(
            select(KBLink)
            .where(or_(KBLink.source_object_id == object_id, KBLink.target_object_id == object_id))
            .order_by(KBLink.last_seen_at.desc().nullslast(), KBLink.updated_at.desc())
            .limit(limit)
        )

        for link in links.scalars().all():
            neighbor_id = link.target_object_id if link.source_object_id == object_id else link.source_object_id
            neighbor = await self.db.scalar(select(KBObject).where(KBObject.id == neighbor_id))
            if not neighbor:
                continue

            events.append(
                {
                    "event_type": "link_activity",
                    "timestamp": (
                        link.last_seen_at.isoformat()
                        if link.last_seen_at
                        else (link.created_at.isoformat() if link.created_at else None)
                    ),
                    "title": f"{center.title} {link.predicate} {neighbor.title}",
                    "object_id": str(neighbor.id),
                    "link_id": str(link.id),
                    "confidence": link.confidence,
                    "source_count": link.source_count,
                    "verification_status": link.verification_status.value,
                    "provenance_refs": await self._get_evidence(
                        owner_type=ProvenanceOwnerType.LINK,
                        owner_id=str(link.id),
                    ),
                }
            )

        events = sorted(events, key=lambda item: item.get("timestamp") or "", reverse=True)[:limit]

        return {
            "center": {
                "id": str(center.id),
                "title": center.title,
                "object_type": center.object_type,
            },
            "events": events,
            "total": len(events),
        }

    async def _serialize_object(self, obj: KBObject, include_evidence: bool = False) -> dict[str, Any]:
        payload = {
            "id": str(obj.id),
            "object_type": obj.object_type,
            "canonical_key": obj.canonical_key,
            "title": obj.title,
            "description": obj.description,
            "attributes": obj.attributes or {},
            "confidence": obj.confidence,
            "source_count": obj.source_count,
            "verification_status": obj.verification_status.value,
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
            "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
        }
        if include_evidence:
            payload["provenance_refs"] = await self._get_evidence(
                owner_type=ProvenanceOwnerType.OBJECT,
                owner_id=str(obj.id),
            )
        return payload

    async def _serialize_link(self, link: KBLink) -> dict[str, Any]:
        return {
            "id": str(link.id),
            "source_object_id": str(link.source_object_id),
            "target_object_id": str(link.target_object_id),
            "predicate": link.predicate,
            "confidence": link.confidence,
            "source_count": link.source_count,
            "verification_status": link.verification_status.value,
            "first_seen_at": link.first_seen_at.isoformat() if link.first_seen_at else None,
            "last_seen_at": link.last_seen_at.isoformat() if link.last_seen_at else None,
            "metadata": link.link_metadata or {},
            "provenance_refs": await self._get_evidence(
                owner_type=ProvenanceOwnerType.LINK,
                owner_id=str(link.id),
            ),
        }

    async def _get_evidence(self, owner_type: ProvenanceOwnerType, owner_id: str) -> list[dict[str, Any]]:
        rows = await self.db.execute(
            select(KBEvidenceRef)
            .where(KBEvidenceRef.owner_type == owner_type)
            .where(KBEvidenceRef.owner_id == owner_id)
            .order_by(KBEvidenceRef.captured_at.desc())
            .limit(20)
        )

        evidence: list[dict[str, Any]] = []
        for item in rows.scalars().all():
            evidence.append(
                {
                    "id": str(item.id),
                    "evidence_type": item.evidence_type,
                    "evidence_id": item.evidence_id,
                    "source_url": item.source_url,
                    "source_key": item.source_key,
                    "source_name": item.source_name,
                    "source_classification": item.source_classification.value,
                    "confidence": item.confidence,
                    "excerpt": item.excerpt,
                    "metadata": item.evidence_metadata or {},
                    "captured_at": item.captured_at.isoformat() if item.captured_at else None,
                }
            )
        return evidence
