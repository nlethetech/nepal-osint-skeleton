"""Resolved candidate profile precedence and override projection utilities."""
from __future__ import annotations

import json
from typing import Any, Optional
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.candidate_correction import CandidateCorrection, CorrectionStatus
from app.models.candidate_profile_override import CandidateProfileOverride
from app.models.election import Candidate


class CandidateProfileResolver:
    """Apply read-time precedence and maintain override projection."""

    OVERRIDABLE_FIELDS = {
        "name_en_roman",
        "aliases",
        "biography",
        "biography_source",
        "education",
        "education_institution",
        "age",
        "gender",
        "previous_positions",
    }

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _is_empty(value: Any) -> bool:
        return value in (None, "", [], {})

    @staticmethod
    def _deserialize_override(field: str, raw_value: str) -> Any:
        """Deserialize text override into field-compatible value."""
        value = raw_value
        if field in {"aliases", "previous_positions"}:
            try:
                parsed = json.loads(raw_value)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
            if field == "aliases":
                return [v.strip() for v in raw_value.split(",") if v.strip()]
            return [v.strip() for v in raw_value.split(",") if v.strip()]

        if field == "age":
            try:
                return int(raw_value)
            except Exception:
                return None

        return value

    @staticmethod
    def derive_source_label(source_url: Optional[str]) -> Optional[str]:
        """Derive a display label from URL hostname (no hardcoded source names)."""
        if not source_url:
            return None
        try:
            parsed = urlparse(source_url)
            hostname = (parsed.hostname or "").lower().strip()
            if not hostname and "://" not in source_url:
                hostname = (urlparse(f"https://{source_url}").hostname or "").lower().strip()
            hostname = hostname.removeprefix("www.")
            if not hostname:
                return None

            parts = [p for p in hostname.split(".") if p]
            if len(parts) >= 3 and parts[-2:] == ["gov", "np"]:
                base = parts[0]
            elif len(parts) >= 2:
                base = parts[-2]
                if base in {"co", "com", "org", "net"} and len(parts) >= 3:
                    base = parts[-3]
            else:
                base = parts[0]
            return " ".join(token.capitalize() for token in base.replace("_", "-").split("-") if token)
        except Exception:
            return None

    async def get_active_overrides_map(
        self,
        candidate_external_ids: list[str],
    ) -> dict[str, dict[str, CandidateProfileOverride]]:
        """Get active overrides grouped by candidate_external_id then field."""
        if not candidate_external_ids:
            return {}

        result = await self.db.execute(
            select(CandidateProfileOverride).where(
                CandidateProfileOverride.candidate_external_id.in_(candidate_external_ids),
                CandidateProfileOverride.is_active.is_(True),
            )
        )
        rows = result.scalars().all()

        grouped: dict[str, dict[str, CandidateProfileOverride]] = {}
        for row in rows:
            grouped.setdefault(row.candidate_external_id, {})[row.field] = row
        return grouped

    def _entity_fallback(self, candidate: Candidate, field: str) -> Any:
        """Fallback values from linked political entity when candidate field is empty."""
        entity = candidate.__dict__.get("political_entity")
        if not entity:
            return None

        entity_map = {
            "aliases": "aliases",
            "biography": "biography",
            "biography_source": "biography_source",
            "education": "education",
            "education_institution": "education_institution",
            "age": "age",
            "gender": "gender",
            "name_en_roman": "name_en",
            "previous_positions": "position_history",
        }
        entity_field = entity_map.get(field)
        if not entity_field:
            return None
        return getattr(entity, entity_field, None)

    @staticmethod
    def _pick_profile_origin(origins: dict[str, str]) -> str:
        for field in ("biography", "education", "name_en_roman", "aliases"):
            origin = origins.get(field)
            if origin:
                return origin
        return "seed"

    def resolve_candidate_profile(
        self,
        candidate: Candidate,
        overrides_for_candidate: Optional[dict[str, CandidateProfileOverride]] = None,
    ) -> dict[str, Any]:
        """Resolve profile fields using precedence:
        active override > candidate record (JSON import) > entity fallback.
        """
        overrides_for_candidate = overrides_for_candidate or {}
        resolved: dict[str, Any] = {}
        origins: dict[str, str] = {}

        for field in self.OVERRIDABLE_FIELDS:
            value = getattr(candidate, field, None)
            origin: Optional[str] = None

            if not self._is_empty(value):
                origin = "json"
            else:
                fallback = self._entity_fallback(candidate, field)
                if not self._is_empty(fallback):
                    value = fallback
                    origin = "seed"

            override = overrides_for_candidate.get(field)
            if override and override.is_active:
                value = self._deserialize_override(field, override.value)
                origin = "override"

            resolved[field] = value
            if origin:
                origins[field] = origin

        biography_source = resolved.get("biography_source")
        entity = candidate.__dict__.get("political_entity")

        resolved["biography_source_label"] = self.derive_source_label(biography_source)
        resolved["profile_origin"] = self._pick_profile_origin(origins)
        resolved["linked_entity_id"] = str(candidate.linked_entity_id) if candidate.linked_entity_id else None
        resolved["entity_link_confidence"] = candidate.entity_link_confidence
        resolved["entity_summary"] = {
            "entity_id": str(entity.id),
            "canonical_id": entity.canonical_id,
            "name_en": entity.name_en,
            "name_ne": entity.name_ne,
            "match_confidence": candidate.entity_link_confidence,
        } if entity else None
        return resolved

    async def upsert_from_correction(
        self,
        correction: CandidateCorrection,
        updated_by: Optional[UUID] = None,
    ) -> CandidateProfileOverride:
        """Upsert projection row from an approved correction."""
        result = await self.db.execute(
            select(CandidateProfileOverride).where(
                CandidateProfileOverride.candidate_external_id == correction.candidate_external_id,
                CandidateProfileOverride.field == correction.field,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = correction.new_value
            row.source_correction_id = correction.id
            row.is_active = True
            row.updated_by = updated_by
        else:
            row = CandidateProfileOverride(
                candidate_external_id=correction.candidate_external_id,
                field=correction.field,
                value=correction.new_value,
                source_correction_id=correction.id,
                is_active=True,
                updated_by=updated_by,
            )
            self.db.add(row)
        await self.db.flush()
        return row

    async def rebuild_projection_from_corrections(
        self,
        updated_by: Optional[UUID] = None,
    ) -> dict[str, int]:
        """Rebuild projection so latest approved corrections are active and authoritative."""
        approved_result = await self.db.execute(
            select(CandidateCorrection).where(
                CandidateCorrection.status == CorrectionStatus.APPROVED.value,
                CandidateCorrection.field.in_(self.OVERRIDABLE_FIELDS),
            ).order_by(
                CandidateCorrection.reviewed_at.asc().nulls_last(),
                CandidateCorrection.created_at.asc(),
            )
        )
        approved = approved_result.scalars().all()

        latest_by_key: dict[tuple[str, str], CandidateCorrection] = {}
        for correction in approved:
            key = (correction.candidate_external_id, correction.field)
            latest_by_key[key] = correction

        existing_result = await self.db.execute(
            select(CandidateProfileOverride).where(
                CandidateProfileOverride.field.in_(self.OVERRIDABLE_FIELDS)
            )
        )
        existing = existing_result.scalars().all()
        existing_by_key = {
            (row.candidate_external_id, row.field): row
            for row in existing
        }

        activated = 0
        deactivated = 0
        created = 0

        for key, row in existing_by_key.items():
            correction = latest_by_key.get(key)
            if correction:
                row.value = correction.new_value
                row.source_correction_id = correction.id
                if not row.is_active:
                    activated += 1
                row.is_active = True
                row.updated_by = updated_by
            elif row.is_active:
                row.is_active = False
                row.updated_by = updated_by
                deactivated += 1

        for key, correction in latest_by_key.items():
            if key in existing_by_key:
                continue
            row = CandidateProfileOverride(
                candidate_external_id=correction.candidate_external_id,
                field=correction.field,
                value=correction.new_value,
                source_correction_id=correction.id,
                is_active=True,
                updated_by=updated_by,
            )
            self.db.add(row)
            created += 1

        await self.db.flush()
        return {
            "approved_corrections": len(approved),
            "created": created,
            "activated": activated,
            "deactivated": deactivated,
            "active_total": len(latest_by_key),
        }
