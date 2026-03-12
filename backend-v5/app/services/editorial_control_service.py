"""Runtime control and overview helpers for the developer editorial console."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_control import AutomationControl
from app.models.fact_check import FactCheckRequest, FactCheckResult
from app.models.fact_check_review import FactCheckReview
from app.models.situation_brief import SituationBrief
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.story_narrative import StoryNarrative
from app.models.user import User

logger = logging.getLogger(__name__)

AUTOMATION_DEFS: dict[str, dict[str, str]] = {
    "fact_check_generation": {
        "label": "Fact Check Generation",
        "description": "Feeds pending stories to the fact-check worker and handles reruns.",
    },
    "developing_story_bluf": {
        "label": "Developing Story BLUF",
        "description": "Generates and refreshes developing-story BLUF summaries.",
    },
    "story_tracker_refresh": {
        "label": "Story Tracker Refresh",
        "description": "Refreshes strategic narrative groupings and tracker labels.",
    },
    "haiku_relevance": {
        "label": "Haiku Relevance",
        "description": "Controls Haiku relevance checks and borderline review.",
    },
    "haiku_summary": {
        "label": "Haiku Summary",
        "description": "Controls Haiku summary queue export and rerun requests.",
    },
    "analyst_brief_generation": {
        "label": "Analyst Brief Generation",
        "description": "Runs the national analyst brief generator.",
    },
}

PROVIDER_LABELS = {
    "local": "Email",
    "google": "Google",
    "guest": "Guest",
}


class EditorialControlService:
    """Persistence-backed control plane for editorial automation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def ensure_defaults(self) -> None:
        result = await self.db.execute(select(AutomationControl.automation_key))
        existing = set(result.scalars().all())
        created = False
        for key in AUTOMATION_DEFS:
            if key in existing:
                continue
            self.db.add(AutomationControl(automation_key=key))
            created = True
        if created:
            await self.db.commit()

    async def list_controls(self) -> list[AutomationControl]:
        await self.ensure_defaults()
        result = await self.db.execute(
            select(AutomationControl).order_by(AutomationControl.automation_key.asc())
        )
        return list(result.scalars().all())

    async def get_control(self, automation_key: str) -> AutomationControl:
        await self.ensure_defaults()
        result = await self.db.execute(
            select(AutomationControl).where(AutomationControl.automation_key == automation_key)
        )
        control = result.scalar_one_or_none()
        if not control:
            raise KeyError(f"Unknown automation key: {automation_key}")
        return control

    async def is_enabled(self, automation_key: str) -> bool:
        control = await self.get_control(automation_key)
        return bool(control.is_enabled)

    async def set_enabled(
        self,
        *,
        automation_key: str,
        enabled: bool,
        changed_by,
        reason: str,
    ) -> AutomationControl:
        control = await self.get_control(automation_key)
        now = datetime.now(timezone.utc)
        control.is_enabled = enabled
        control.reason = reason
        control.last_changed_by = changed_by.id
        control.last_changed_at = now
        await self.db.commit()
        await self.db.refresh(control)
        return control

    async def mark_rerun_requested(
        self,
        *,
        automation_key: str,
        changed_by,
        reason: str,
    ) -> AutomationControl:
        control = await self.get_control(automation_key)
        now = datetime.now(timezone.utc)
        control.last_rerun_requested_at = now
        control.reason = reason
        control.last_changed_by = changed_by.id
        control.last_changed_at = now
        await self.db.commit()
        await self.db.refresh(control)
        return control

    async def mark_run_started(self, automation_key: str) -> None:
        try:
            control = await self.get_control(automation_key)
            control.last_run_started_at = datetime.now(timezone.utc)
            control.last_run_status = "running"
            control.last_error = None
            await self.db.commit()
        except Exception:
            logger.warning("Failed to mark automation %s as started", automation_key, exc_info=True)

    async def mark_run_finished(self, automation_key: str, *, success: bool, error: Optional[str] = None) -> None:
        try:
            control = await self.get_control(automation_key)
            now = datetime.now(timezone.utc)
            control.last_run_completed_at = now
            control.last_run_status = "success" if success else "failed"
            control.last_error = None if success else (error or "Unknown failure")
            if success:
                control.last_success_at = now
            await self.db.commit()
        except Exception:
            logger.warning("Failed to mark automation %s as finished", automation_key, exc_info=True)

    async def get_user_summary(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        cutoff_1h = now - timedelta(hours=1)
        cutoff_24h = now - timedelta(hours=24)
        cutoff_7d = now - timedelta(days=7)

        totals_row = (
            await self.db.execute(
                select(
                    func.count(User.id),
                    func.count(case((User.last_login_at >= cutoff_1h, 1))),
                    func.count(case((User.created_at >= cutoff_24h, 1))),
                    func.count(case((User.created_at >= cutoff_7d, 1))),
                )
            )
        ).one()

        provider_rows = (
            await self.db.execute(
                select(User.auth_provider, func.count(User.id))
                .group_by(User.auth_provider)
                .order_by(func.count(User.id).desc())
            )
        ).all()
        role_rows = (
            await self.db.execute(
                select(User.role, func.count(User.id))
                .group_by(User.role)
                .order_by(func.count(User.id).desc())
            )
        ).all()
        signup_rows = (
            await self.db.execute(
                select(
                    func.date_trunc("day", User.created_at).label("day"),
                    func.count(User.id),
                )
                .where(User.created_at >= cutoff_7d)
                .group_by("day")
                .order_by("day")
            )
        ).all()

        provider_counts = {
            PROVIDER_LABELS.get(str(provider), str(provider).title()): count
            for provider, count in provider_rows
        }
        role_counts = {
            getattr(role, "value", str(role)): count
            for role, count in role_rows
        }
        registered_count = sum(
            count for label, count in provider_counts.items() if label in {"Email", "Google"}
        )

        return {
            "total_users": int(totals_row[0] or 0),
            "active_last_hour": int(totals_row[1] or 0),
            "new_last_24h": int(totals_row[2] or 0),
            "new_last_7d": int(totals_row[3] or 0),
            "provider_counts": provider_counts,
            "role_counts": role_counts,
            "guest_to_registered": {
                "guest": int(provider_counts.get("Guest", 0)),
                "registered": int(registered_count),
            },
            "signups_by_day": [
                {
                    "date": day.date().isoformat() if hasattr(day, "date") else str(day),
                    "count": int(count or 0),
                }
                for day, count in signup_rows
            ],
        }

    async def get_overview(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        cutoff_72h = now - timedelta(hours=72)
        controls = await self.list_controls()
        user_summary = await self.get_user_summary()

        pending_fc = (
            await self.db.execute(
                select(func.count(FactCheckResult.id))
                .join(FactCheckReview, FactCheckReview.fact_check_result_id == FactCheckResult.id)
                .where(FactCheckReview.workflow_status == "pending_review")
            )
        ).scalar() or 0
        queued_fc = (
            await self.db.execute(
                select(func.count(func.distinct(FactCheckRequest.story_id)))
                .outerjoin(FactCheckResult, FactCheckResult.story_id == FactCheckRequest.story_id)
                .where(FactCheckResult.id.is_(None))
            )
        ).scalar() or 0
        rerun_fc = (
            await self.db.execute(
                select(func.count(FactCheckReview.id)).where(FactCheckReview.needs_rerun.is_(True))
            )
        ).scalar() or 0
        developing_review = (
            await self.db.execute(
                select(func.count(StoryCluster.id))
                .where(StoryCluster.first_published >= cutoff_72h)
                .where(StoryCluster.story_count >= 2)
                .where(StoryCluster.workflow_status.in_(["unreviewed", "monitoring"]))
            )
        ).scalar() or 0
        story_tracker_review = (
            await self.db.execute(
                select(func.count(StoryNarrative.id))
                .where(StoryNarrative.last_updated >= cutoff_72h)
                .where(StoryNarrative.workflow_status != "approved")
            )
        ).scalar() or 0
        stale_story_tracker = (
            await self.db.execute(
                select(func.count(StoryNarrative.id))
                .where(StoryNarrative.last_updated < now - timedelta(hours=12))
            )
        ).scalar() or 0
        haiku_relevance_queue = (
            await self.db.execute(
                select(func.count(Story.id))
                .where(Story.created_at >= now - timedelta(hours=6))
                .where(Story.relevance_score < 0.75)
                .where(Story.ai_summary.is_(None))
            )
        ).scalar() or 0
        haiku_summary_queue = (
            await self.db.execute(
                select(func.count(Story.id))
                .where(Story.created_at >= now - timedelta(hours=12))
                .where(Story.ai_summary.is_(None))
            )
        ).scalar() or 0
        latest_brief = (
            await self.db.execute(
                select(SituationBrief).order_by(SituationBrief.created_at.desc()).limit(1)
            )
        ).scalar_one_or_none()

        alerts = []
        for control in controls:
            if not control.is_enabled:
                alerts.append(
                    {
                        "severity": "warning",
                        "title": f"{AUTOMATION_DEFS[control.automation_key]['label']} paused",
                        "detail": control.reason or "Paused by developer",
                    }
                )
            elif control.last_run_status == "failed":
                alerts.append(
                    {
                        "severity": "error",
                        "title": f"{AUTOMATION_DEFS[control.automation_key]['label']} failed",
                        "detail": control.last_error or "Last run failed",
                    }
                )

        return {
            "editorial_backlog": {
                "fact_check_pending_review": int(pending_fc),
                "fact_check_queue": int(queued_fc),
                "fact_check_reruns": int(rerun_fc),
                "developing_stories_review": int(developing_review),
                "story_tracker_review": int(story_tracker_review),
                "story_tracker_stale": int(stale_story_tracker),
                "haiku_relevance_queue": int(haiku_relevance_queue),
                "haiku_summary_queue": int(haiku_summary_queue),
            },
            "paused_automations": sum(1 for control in controls if not control.is_enabled),
            "automation_controls": [serialize_control(control) for control in controls],
            "alerts": alerts[:6],
            "users": user_summary,
            "analyst_brief": {
                "latest_run_number": latest_brief.run_number if latest_brief else None,
                "latest_status": latest_brief.status if latest_brief else "never_run",
                "latest_created_at": latest_brief.created_at if latest_brief else None,
            },
        }


def serialize_control(control: AutomationControl) -> dict[str, Any]:
    meta = AUTOMATION_DEFS.get(control.automation_key, {})
    return {
        "automation_key": control.automation_key,
        "label": meta.get("label", control.automation_key),
        "description": meta.get("description", ""),
        "is_enabled": control.is_enabled,
        "reason": control.reason,
        "last_changed_at": control.last_changed_at,
        "last_rerun_requested_at": control.last_rerun_requested_at,
        "last_run_started_at": control.last_run_started_at,
        "last_run_completed_at": control.last_run_completed_at,
        "last_success_at": control.last_success_at,
        "last_run_status": control.last_run_status,
        "last_error": control.last_error,
    }
