"""Workflow service for analyst graph corrections."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import GraphNode, GraphEdge
from app.models.graph_correction import (
    GraphCorrection,
    GraphCorrectionAction,
    GraphCorrectionStatus,
)
from app.models.user import User
from app.services.graph.entity_resolution_service import EntityResolutionService

logger = logging.getLogger(__name__)


class GraphCorrectionService:
    """Submit/review/apply/rollback graph corrections with auditability."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def submit(
        self,
        action: str,
        payload: dict[str, Any],
        reason: str,
        submitted_by: UUID,
        node_id: UUID | None = None,
        edge_id: UUID | None = None,
    ) -> GraphCorrection:
        if action not in {a.value for a in GraphCorrectionAction}:
            raise ValueError(f"Unsupported graph correction action: {action}")

        correction = GraphCorrection(
            id=uuid4(),
            action=action,
            status=GraphCorrectionStatus.PENDING.value,
            payload=payload,
            reason=reason,
            node_id=node_id,
            edge_id=edge_id,
            submitted_by=submitted_by,
        )
        self.db.add(correction)
        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def list(
        self,
        status: str | None = None,
        page: int = 1,
        per_page: int = 20,
    ) -> dict[str, Any]:
        query = (
            select(GraphCorrection, User.email.label("submitted_by_email"))
            .join(User, GraphCorrection.submitted_by == User.id, isouter=True)
        )
        if status:
            query = query.where(GraphCorrection.status == status)

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        pending_result = await self.db.execute(
            select(func.count()).where(GraphCorrection.status == GraphCorrectionStatus.PENDING.value)
        )
        pending_count = pending_result.scalar() or 0

        rows = (
            await self.db.execute(
                query
                .order_by(GraphCorrection.submitted_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).all()

        items = []
        for correction, submitted_by_email in rows:
            items.append({
                "id": str(correction.id),
                "action": correction.action,
                "status": correction.status,
                "node_id": str(correction.node_id) if correction.node_id else None,
                "edge_id": str(correction.edge_id) if correction.edge_id else None,
                "payload": correction.payload,
                "reason": correction.reason,
                "submitted_by": str(correction.submitted_by),
                "submitted_by_email": submitted_by_email or "",
                "submitted_at": correction.submitted_at.isoformat() if correction.submitted_at else None,
                "reviewed_by": str(correction.reviewed_by) if correction.reviewed_by else None,
                "reviewed_at": correction.reviewed_at.isoformat() if correction.reviewed_at else None,
                "review_notes": correction.review_notes,
                "rejection_reason": correction.rejection_reason,
                "applied_change": correction.applied_change,
                "applied_at": correction.applied_at.isoformat() if correction.applied_at else None,
                "rolled_back_by": str(correction.rolled_back_by) if correction.rolled_back_by else None,
                "rolled_back_at": correction.rolled_back_at.isoformat() if correction.rolled_back_at else None,
                "rollback_reason": correction.rollback_reason,
            })

        return {
            "items": items,
            "pending_count": pending_count,
            "page": page,
            "total": total,
            "total_pages": (total + per_page - 1) // per_page if per_page else 0,
        }

    async def approve(self, correction_id: UUID, reviewer_id: UUID, notes: str | None = None) -> GraphCorrection:
        correction = await self.db.get(GraphCorrection, correction_id)
        if not correction or correction.status != GraphCorrectionStatus.PENDING.value:
            raise ValueError("Correction not found or not pending")

        applied_change = await self._apply_action(correction, reviewer_id)
        now = datetime.now(timezone.utc)

        correction.status = GraphCorrectionStatus.APPROVED.value
        correction.reviewed_by = reviewer_id
        correction.reviewed_at = now
        correction.review_notes = notes
        correction.applied_change = applied_change
        correction.applied_at = now

        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def reject(self, correction_id: UUID, reviewer_id: UUID, reason: str) -> GraphCorrection:
        correction = await self.db.get(GraphCorrection, correction_id)
        if not correction or correction.status != GraphCorrectionStatus.PENDING.value:
            raise ValueError("Correction not found or not pending")

        correction.status = GraphCorrectionStatus.REJECTED.value
        correction.reviewed_by = reviewer_id
        correction.reviewed_at = datetime.now(timezone.utc)
        correction.rejection_reason = reason

        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def rollback(self, correction_id: UUID, reviewer_id: UUID, reason: str) -> GraphCorrection:
        correction = await self.db.get(GraphCorrection, correction_id)
        if not correction or correction.status != GraphCorrectionStatus.APPROVED.value:
            raise ValueError("Correction not found or not approved")

        await self._rollback_action(correction)
        correction.status = GraphCorrectionStatus.ROLLED_BACK.value
        correction.rolled_back_by = reviewer_id
        correction.rolled_back_at = datetime.now(timezone.utc)
        correction.rollback_reason = reason

        await self.db.commit()
        await self.db.refresh(correction)
        return correction

    async def _apply_action(self, correction: GraphCorrection, reviewer_id: UUID) -> dict[str, Any]:
        payload = correction.payload or {}
        action = correction.action

        if action == GraphCorrectionAction.ADD_EDGE.value:
            source_node_id = UUID(str(payload["source_node_id"]))
            target_node_id = UUID(str(payload["target_node_id"]))
            predicate = str(payload["predicate"])
            confidence = float(payload.get("confidence", 0.9))
            weight = float(payload.get("weight", 1.0))
            properties = payload.get("properties") or {}

            existing = await self.db.execute(
                select(GraphEdge).where(
                    GraphEdge.source_node_id == source_node_id,
                    GraphEdge.target_node_id == target_node_id,
                    GraphEdge.predicate == predicate,
                    GraphEdge.valid_from.is_(None),
                )
            )
            edge = existing.scalar_one_or_none()
            if edge:
                old_is_current = edge.is_current
                edge.is_current = True
                edge.confidence = confidence
                edge.weight = weight
                edge.properties = properties
                await self.db.flush()
                return {
                    "edge_id": str(edge.id),
                    "reactivated": True,
                    "old_is_current": old_is_current,
                }

            edge = GraphEdge(
                id=uuid4(),
                source_node_id=source_node_id,
                target_node_id=target_node_id,
                predicate=predicate,
                confidence=confidence,
                weight=weight,
                properties=properties,
                source_table="graph_corrections",
                source_id=str(correction.id),
                is_current=True,
            )
            self.db.add(edge)
            await self.db.flush()
            return {"edge_id": str(edge.id), "created": True}

        if action == GraphCorrectionAction.DEACTIVATE_EDGE.value:
            edge_id = UUID(str(payload.get("edge_id") or correction.edge_id))
            edge = await self.db.get(GraphEdge, edge_id)
            if not edge:
                raise ValueError(f"Edge {edge_id} not found")
            old_is_current = bool(edge.is_current)
            edge.is_current = False
            edge.valid_to = datetime.now(timezone.utc)
            await self.db.flush()
            return {"edge_id": str(edge.id), "old_is_current": old_is_current}

        if action == GraphCorrectionAction.UPDATE_NODE_FIELD.value:
            node_id = UUID(str(payload.get("node_id") or correction.node_id))
            field = str(payload["field"])
            new_value = payload.get("new_value")
            node = await self.db.get(GraphNode, node_id)
            if not node:
                raise ValueError(f"Node {node_id} not found")

            if field.startswith("properties."):
                prop_key = field.split(".", 1)[1]
                properties = dict(node.properties or {})
                old_value = properties.get(prop_key)
                properties[prop_key] = new_value
                node.properties = properties
            else:
                if not hasattr(node, field):
                    raise ValueError(f"Unsupported node field: {field}")
                old_value = getattr(node, field)
                setattr(node, field, new_value)
            await self.db.flush()
            return {"node_id": str(node.id), "field": field, "old_value": old_value}

        if action == GraphCorrectionAction.PREDICATE_CORRECTION.value:
            edge_id = UUID(str(payload.get("edge_id") or correction.edge_id))
            new_predicate = str(payload["new_predicate"])
            edge = await self.db.get(GraphEdge, edge_id)
            if not edge:
                raise ValueError(f"Edge {edge_id} not found")
            old_predicate = edge.predicate
            edge.predicate = new_predicate
            await self.db.flush()
            return {"edge_id": str(edge.id), "old_predicate": old_predicate}

        if action == GraphCorrectionAction.MERGE_NODES.value:
            canonical_node_id = UUID(str(payload["canonical_node_id"]))
            merged_node_id = UUID(str(payload["merged_node_id"]))
            method = str(payload.get("method", "manual"))
            confidence = float(payload.get("confidence", 1.0))
            rationale = payload.get("rationale")
            resolver = EntityResolutionService(self.db)
            resolution = await resolver.merge_nodes(
                canonical_id=canonical_node_id,
                merged_id=merged_node_id,
                method=method,
                confidence=confidence,
                auto=False,
                rationale=rationale,
                resolved_by=reviewer_id,
            )
            return {"resolution_id": str(resolution.id)}

        if action == GraphCorrectionAction.SPLIT_SUGGESTION.value:
            # Stored as analyst signal for manual graph curation.
            return {"manual_review_only": True, "payload": payload}

        raise ValueError(f"Unsupported action: {action}")

    async def _rollback_action(self, correction: GraphCorrection) -> None:
        action = correction.action
        applied = correction.applied_change or {}

        if action == GraphCorrectionAction.ADD_EDGE.value:
            edge_id = applied.get("edge_id")
            if not edge_id:
                return
            edge = await self.db.get(GraphEdge, UUID(str(edge_id)))
            if not edge:
                return
            if applied.get("created"):
                edge.is_current = False
                edge.valid_to = datetime.now(timezone.utc)
            else:
                edge.is_current = bool(applied.get("old_is_current", True))
            await self.db.flush()
            return

        if action == GraphCorrectionAction.DEACTIVATE_EDGE.value:
            edge_id = applied.get("edge_id")
            if not edge_id:
                return
            edge = await self.db.get(GraphEdge, UUID(str(edge_id)))
            if edge:
                edge.is_current = bool(applied.get("old_is_current", True))
                if edge.is_current:
                    edge.valid_to = None
            await self.db.flush()
            return

        if action == GraphCorrectionAction.UPDATE_NODE_FIELD.value:
            node_id = applied.get("node_id")
            field = applied.get("field")
            if not node_id or not field:
                return
            node = await self.db.get(GraphNode, UUID(str(node_id)))
            if not node:
                return
            old_value = applied.get("old_value")
            if str(field).startswith("properties."):
                prop_key = str(field).split(".", 1)[1]
                properties = dict(node.properties or {})
                properties[prop_key] = old_value
                node.properties = properties
            else:
                setattr(node, str(field), old_value)
            await self.db.flush()
            return

        if action == GraphCorrectionAction.PREDICATE_CORRECTION.value:
            edge_id = applied.get("edge_id")
            old_predicate = applied.get("old_predicate")
            if edge_id and old_predicate:
                edge = await self.db.get(GraphEdge, UUID(str(edge_id)))
                if edge:
                    edge.predicate = str(old_predicate)
            await self.db.flush()
            return

        if action == GraphCorrectionAction.MERGE_NODES.value:
            resolution_id = applied.get("resolution_id")
            if resolution_id:
                resolver = EntityResolutionService(self.db)
                await resolver.unmerge_nodes(UUID(str(resolution_id)))
            return

        # SPLIT_SUGGESTION and unknown actions: no runtime mutation to rollback.
        return

