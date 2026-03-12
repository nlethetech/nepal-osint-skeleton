"""Assessment Service for damage assessment CRUD operations.

Handles creating, updating, and querying damage assessments,
zones, evidence, and notes.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.damage_assessment import (
    DamageAssessment,
    DamageZone,
    DamageEvidence,
    AssessmentNote,
    AssessmentStatus,
    SeverityLevel,
    DamageType,
)

logger = logging.getLogger(__name__)


class AssessmentService:
    """Service for managing damage assessments."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ═══════════════════════════════════════════════════════════════════════════
    # ASSESSMENT CRUD
    # ═══════════════════════════════════════════════════════════════════════════

    async def create_assessment(
        self,
        event_name: str,
        event_type: str,
        event_date: datetime,
        bbox: list[float],
        center_lat: float,
        center_lng: float,
        created_by_id: Optional[UUID] = None,
        event_description: Optional[str] = None,
        districts: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        baseline_start: Optional[datetime] = None,
        baseline_end: Optional[datetime] = None,
        post_event_start: Optional[datetime] = None,
        post_event_end: Optional[datetime] = None,
    ) -> DamageAssessment:
        """Create a new damage assessment."""
        assessment = DamageAssessment(
            event_name=event_name,
            event_type=event_type,
            event_date=event_date,
            event_description=event_description,
            bbox=bbox,
            center_lat=center_lat,
            center_lng=center_lng,
            districts=districts or [],
            tags=tags or [],
            status=AssessmentStatus.DRAFT.value,
            created_by_id=created_by_id,
            baseline_start=baseline_start,
            baseline_end=baseline_end,
            post_event_start=post_event_start,
            post_event_end=post_event_end,
        )
        self.db.add(assessment)
        await self.db.commit()
        await self.db.refresh(assessment)
        return assessment

    async def get_assessment(
        self,
        assessment_id: UUID,
        include_zones: bool = False,
    ) -> Optional[DamageAssessment]:
        """Get a single assessment by ID."""
        query = select(DamageAssessment).where(DamageAssessment.id == assessment_id)

        if include_zones:
            query = query.options(selectinload(DamageAssessment.zones))

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_assessments(
        self,
        event_type: Optional[str] = None,
        status: Optional[str] = None,
        district: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        created_by_id: Optional[UUID] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[DamageAssessment], int]:
        """List assessments with filtering and pagination."""
        query = select(DamageAssessment)
        count_query = select(func.count(DamageAssessment.id))

        # Apply filters
        filters = []
        if event_type:
            filters.append(DamageAssessment.event_type == event_type)
        if status:
            filters.append(DamageAssessment.status == status)
        if district:
            # Check if district is in the districts JSONB array
            filters.append(DamageAssessment.districts.contains([district]))
        if start_date:
            filters.append(DamageAssessment.event_date >= start_date)
        if end_date:
            filters.append(DamageAssessment.event_date <= end_date)
        if created_by_id:
            filters.append(DamageAssessment.created_by_id == created_by_id)

        if filters:
            query = query.where(and_(*filters))
            count_query = count_query.where(and_(*filters))

        # Get total count
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Get items with pagination
        query = query.order_by(DamageAssessment.created_at.desc())
        query = query.offset(offset).limit(limit)

        result = await self.db.execute(query)
        assessments = result.scalars().all()

        return list(assessments), total

    async def update_assessment(
        self,
        assessment_id: UUID,
        **kwargs,
    ) -> Optional[DamageAssessment]:
        """Update an assessment's fields."""
        assessment = await self.get_assessment(assessment_id)
        if not assessment:
            return None

        for key, value in kwargs.items():
            if hasattr(assessment, key) and value is not None:
                setattr(assessment, key, value)

        assessment.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(assessment)
        return assessment

    async def update_assessment_results(
        self,
        assessment_id: UUID,
        total_area_km2: float,
        damaged_area_km2: float,
        damage_percentage: float,
        critical_area_km2: float,
        severe_area_km2: float,
        moderate_area_km2: float,
        minor_area_km2: float,
        confidence_score: float,
        baseline_images_count: int,
        post_images_count: int,
        damage_tile_url: Optional[str] = None,
        before_tile_url: Optional[str] = None,
        after_tile_url: Optional[str] = None,
        before_sar_tile_url: Optional[str] = None,
        after_sar_tile_url: Optional[str] = None,
        t_stat_tile_url: Optional[str] = None,
        baseline_start: Optional[datetime] = None,
        baseline_end: Optional[datetime] = None,
        post_event_start: Optional[datetime] = None,
        post_event_end: Optional[datetime] = None,
    ) -> Optional[DamageAssessment]:
        """Update assessment with analysis results from PWTT service."""
        assessment = await self.get_assessment(assessment_id)
        if not assessment:
            return None

        assessment.total_area_km2 = total_area_km2
        assessment.damaged_area_km2 = damaged_area_km2
        assessment.damage_percentage = damage_percentage
        assessment.critical_area_km2 = critical_area_km2
        assessment.severe_area_km2 = severe_area_km2
        assessment.moderate_area_km2 = moderate_area_km2
        assessment.minor_area_km2 = minor_area_km2
        assessment.confidence_score = confidence_score
        assessment.baseline_images_count = baseline_images_count
        assessment.post_images_count = post_images_count
        assessment.damage_tile_url = damage_tile_url
        assessment.before_tile_url = before_tile_url
        assessment.after_tile_url = after_tile_url
        assessment.before_sar_tile_url = before_sar_tile_url
        assessment.after_sar_tile_url = after_sar_tile_url
        assessment.t_stat_tile_url = t_stat_tile_url

        if baseline_start:
            assessment.baseline_start = baseline_start
        if baseline_end:
            assessment.baseline_end = baseline_end
        if post_event_start:
            assessment.post_event_start = post_event_start
        if post_event_end:
            assessment.post_event_end = post_event_end

        # Update status to in_progress if still draft
        if assessment.status == AssessmentStatus.DRAFT.value:
            assessment.status = AssessmentStatus.IN_PROGRESS.value

        assessment.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(assessment)
        return assessment

    async def verify_assessment(
        self,
        assessment_id: UUID,
        verified_by_id: UUID,
    ) -> Optional[DamageAssessment]:
        """Mark assessment as verified."""
        assessment = await self.get_assessment(assessment_id)
        if not assessment:
            return None

        assessment.status = AssessmentStatus.VERIFIED.value
        assessment.verified_by_id = verified_by_id
        assessment.verified_at = datetime.now(timezone.utc)
        assessment.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(assessment)
        return assessment

    async def delete_assessment(self, assessment_id: UUID) -> bool:
        """Delete an assessment and all related data."""
        assessment = await self.get_assessment(assessment_id)
        if not assessment:
            return False

        await self.db.delete(assessment)
        await self.db.commit()
        return True

    # ═══════════════════════════════════════════════════════════════════════════
    # ZONE CRUD
    # ═══════════════════════════════════════════════════════════════════════════

    async def create_zone(
        self,
        assessment_id: UUID,
        geometry: dict,
        centroid_lat: float,
        centroid_lng: float,
        area_km2: float,
        severity: str,
        damage_percentage: float,
        confidence: float = 0.5,
        zone_name: Optional[str] = None,
        zone_type: str = "area",
        land_use: Optional[str] = None,
        building_type: Optional[str] = None,
        satellite_detected: bool = True,
    ) -> DamageZone:
        """Create a damage zone within an assessment."""
        zone = DamageZone(
            assessment_id=assessment_id,
            geometry=geometry,
            centroid_lat=centroid_lat,
            centroid_lng=centroid_lng,
            area_km2=area_km2,
            severity=severity,
            damage_percentage=damage_percentage,
            confidence=confidence,
            zone_name=zone_name,
            zone_type=zone_type,
            land_use=land_use,
            building_type=building_type,
            satellite_detected=satellite_detected,
        )
        self.db.add(zone)
        await self.db.commit()
        await self.db.refresh(zone)
        return zone

    async def get_zones(
        self,
        assessment_id: UUID,
        severity: Optional[str] = None,
        zone_type: Optional[str] = None,
    ) -> list[DamageZone]:
        """Get zones for an assessment with optional filtering."""
        query = select(DamageZone).where(DamageZone.assessment_id == assessment_id)

        if severity:
            query = query.where(DamageZone.severity == severity)
        if zone_type:
            query = query.where(DamageZone.zone_type == zone_type)

        query = query.order_by(DamageZone.damage_percentage.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_zone(
        self,
        zone_id: UUID,
        **kwargs,
    ) -> Optional[DamageZone]:
        """Update a zone's fields."""
        query = select(DamageZone).where(DamageZone.id == zone_id)
        result = await self.db.execute(query)
        zone = result.scalar_one_or_none()

        if not zone:
            return None

        for key, value in kwargs.items():
            if hasattr(zone, key) and value is not None:
                setattr(zone, key, value)

        zone.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(zone)
        return zone

    # ═══════════════════════════════════════════════════════════════════════════
    # EVIDENCE CRUD
    # ═══════════════════════════════════════════════════════════════════════════

    async def add_evidence(
        self,
        assessment_id: UUID,
        source_type: str,
        evidence_type: str,
        zone_id: Optional[UUID] = None,
        source_id: Optional[str] = None,
        source_url: Optional[str] = None,
        source_name: Optional[str] = None,
        title: Optional[str] = None,
        excerpt: Optional[str] = None,
        timestamp: Optional[datetime] = None,
        confidence: float = 0.5,
        added_by_id: Optional[UUID] = None,
        auto_linked: bool = False,
        link_confidence: Optional[float] = None,
        metadata: Optional[dict] = None,
    ) -> DamageEvidence:
        """Add evidence to an assessment or zone."""
        evidence = DamageEvidence(
            assessment_id=assessment_id,
            zone_id=zone_id,
            source_type=source_type,
            source_id=source_id,
            source_url=source_url,
            source_name=source_name,
            evidence_type=evidence_type,
            title=title,
            excerpt=excerpt,
            timestamp=timestamp,
            confidence=confidence,
            added_by_id=added_by_id,
            auto_linked=auto_linked,
            link_confidence=link_confidence,
            metadata=metadata,
        )
        self.db.add(evidence)
        await self.db.commit()
        await self.db.refresh(evidence)
        return evidence

    async def get_evidence(
        self,
        assessment_id: UUID,
        source_type: Optional[str] = None,
        zone_id: Optional[UUID] = None,
        verification_status: Optional[str] = None,
    ) -> list[DamageEvidence]:
        """Get evidence for an assessment with filtering."""
        query = select(DamageEvidence).where(DamageEvidence.assessment_id == assessment_id)

        if source_type:
            query = query.where(DamageEvidence.source_type == source_type)
        if zone_id:
            query = query.where(DamageEvidence.zone_id == zone_id)
        if verification_status:
            query = query.where(DamageEvidence.verification_status == verification_status)

        query = query.order_by(DamageEvidence.timestamp.desc().nullsfirst())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_evidence_verification(
        self,
        evidence_id: UUID,
        verification_status: str,
        verification_notes: Optional[str] = None,
    ) -> Optional[DamageEvidence]:
        """Update evidence verification status."""
        query = select(DamageEvidence).where(DamageEvidence.id == evidence_id)
        result = await self.db.execute(query)
        evidence = result.scalar_one_or_none()

        if not evidence:
            return None

        evidence.verification_status = verification_status
        if verification_notes:
            evidence.verification_notes = verification_notes
        evidence.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(evidence)
        return evidence

    # ═══════════════════════════════════════════════════════════════════════════
    # NOTES CRUD
    # ═══════════════════════════════════════════════════════════════════════════

    async def add_note(
        self,
        assessment_id: UUID,
        content: str,
        author_id: UUID,
        note_type: str = "observation",
        zone_id: Optional[UUID] = None,
    ) -> AssessmentNote:
        """Add a note to an assessment."""
        note = AssessmentNote(
            assessment_id=assessment_id,
            zone_id=zone_id,
            note_type=note_type,
            content=content,
            author_id=author_id,
            status="open",
        )
        self.db.add(note)
        await self.db.commit()
        await self.db.refresh(note)
        return note

    async def get_notes(
        self,
        assessment_id: UUID,
        note_type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[AssessmentNote]:
        """Get notes for an assessment."""
        query = select(AssessmentNote).where(AssessmentNote.assessment_id == assessment_id)

        if note_type:
            query = query.where(AssessmentNote.note_type == note_type)
        if status:
            query = query.where(AssessmentNote.status == status)

        query = query.order_by(AssessmentNote.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def resolve_note(
        self,
        note_id: UUID,
        resolved_by_id: UUID,
        resolution_notes: Optional[str] = None,
    ) -> Optional[AssessmentNote]:
        """Mark a note as resolved."""
        query = select(AssessmentNote).where(AssessmentNote.id == note_id)
        result = await self.db.execute(query)
        note = result.scalar_one_or_none()

        if not note:
            return None

        note.status = "resolved"
        note.resolved_by_id = resolved_by_id
        note.resolved_at = datetime.now(timezone.utc)
        if resolution_notes:
            note.resolution_notes = resolution_notes
        note.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(note)
        return note

    # ═══════════════════════════════════════════════════════════════════════════
    # STATISTICS
    # ═══════════════════════════════════════════════════════════════════════════

    async def get_assessment_stats(self, assessment_id: UUID) -> dict:
        """Get aggregated statistics for an assessment."""
        assessment = await self.get_assessment(assessment_id, include_zones=True)
        if not assessment:
            return {}

        zones = assessment.zones

        # Get evidence counts
        evidence_query = select(
            func.count(DamageEvidence.id).label('total'),
            func.count(DamageEvidence.id).filter(DamageEvidence.verification_status == 'verified').label('verified'),
        ).where(DamageEvidence.assessment_id == assessment_id)

        evidence_result = await self.db.execute(evidence_query)
        evidence_stats = evidence_result.one()

        # Get notes counts
        notes_query = select(
            func.count(AssessmentNote.id).label('total'),
            func.count(AssessmentNote.id).filter(AssessmentNote.status == 'open').label('open'),
        ).where(AssessmentNote.assessment_id == assessment_id)

        notes_result = await self.db.execute(notes_query)
        notes_stats = notes_result.one()

        return {
            'total_zones': len(zones),
            'zones_by_severity': {
                'critical': len([z for z in zones if z.severity == SeverityLevel.CRITICAL.value]),
                'severe': len([z for z in zones if z.severity == SeverityLevel.SEVERE.value]),
                'moderate': len([z for z in zones if z.severity == SeverityLevel.MODERATE.value]),
                'minor': len([z for z in zones if z.severity == SeverityLevel.MINOR.value]),
            },
            'total_evidence': evidence_stats.total,
            'verified_evidence': evidence_stats.verified,
            'total_notes': notes_stats.total,
            'open_notes': notes_stats.open,
            'ground_verified_zones': len([z for z in zones if z.ground_verified]),
        }
