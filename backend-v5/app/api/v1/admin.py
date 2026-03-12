"""Admin endpoints: audit logs, user management, corrections management, analyst agent."""
import logging
import math
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_dev, get_current_user
from app.core.database import get_db, AsyncSessionLocal
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.correction_service import CorrectionService
from app.services.notification_service import NotificationService
from app.services.bulk_correction_service import BulkCorrectionService
from app.services.editorial_control_service import EditorialControlService, PROVIDER_LABELS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Audit Log Endpoints ──

@router.get("/audit-log")
async def get_audit_log(
    action: Optional[str] = Query(default=None),
    user_search: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated audit logs with filtering. DEV only."""
    service = AuditService(db)

    start_dt = datetime.fromisoformat(start_date) if start_date else None
    end_dt = datetime.fromisoformat(end_date) if end_date else None

    items, total = await service.get_logs(
        action_type=action,
        user_search=user_search,
        start_date=start_dt,
        end_date=end_dt,
        page=page,
        per_page=per_page,
    )
    return {
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": math.ceil(total / per_page) if per_page else 0,
    }


@router.get("/audit-log/export")
async def export_audit_log(
    action: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Export audit logs as CSV. DEV only."""
    service = AuditService(db)

    start_dt = datetime.fromisoformat(start_date) if start_date else None
    end_dt = datetime.fromisoformat(end_date) if end_date else None

    csv_bytes = await service.export_csv(
        action_type=action,
        start_date=start_dt,
        end_date=end_dt,
    )

    import io
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit-log-{datetime.now().strftime('%Y%m%d')}.csv"},
    )


# ── User Management Endpoints ──

@router.get("/users")
async def list_users(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=40, ge=1, le=200),
    auth_provider: Optional[str] = Query(default=None, pattern="^(local|google|guest)$"),
    search: Optional[str] = Query(default=None, min_length=1, max_length=200),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """List paginated user accounts with provider filtering. DEV only."""
    filters = []
    if auth_provider:
        filters.append(User.auth_provider == auth_provider)
    if search:
        needle = f"%{search.strip()}%"
        filters.append(
            or_(
                User.email.ilike(needle),
                User.full_name.ilike(needle),
            )
        )

    total_stmt = select(func.count(User.id))
    if filters:
        total_stmt = total_stmt.where(*filters)
    total = int((await db.execute(total_stmt)).scalar() or 0)

    stmt = select(User).order_by(User.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    if filters:
        stmt = stmt.where(*filters)

    result = await db.execute(stmt)
    users = result.scalars().all()
    return {
        "items": [
            {
                "id": str(u.id),
                "email": u.email,
                "full_name": u.full_name,
                "auth_provider": u.auth_provider,
                "auth_provider_label": PROVIDER_LABELS.get(u.auth_provider, u.auth_provider.title()),
                "role": u.role.value if hasattr(u.role, 'value') else str(u.role),
                "is_active": u.is_active,
                "created_at": u.created_at,
                "last_login_at": u.last_login_at,
            }
            for u in users
        ],
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": math.ceil(total / per_page) if per_page else 0,
        "filters": {
            "auth_provider": auth_provider,
            "search": search,
        },
    }


@router.get("/users/summary")
async def get_user_summary(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get aggregated user/account intelligence for the dev console. DEV only."""
    service = EditorialControlService(db)
    return await service.get_user_summary()


@router.get("/users/sessions")
async def get_active_sessions(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get active user sessions (approximate via recent logins). DEV only."""
    from datetime import timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    result = await db.execute(
        select(User)
        .where(User.last_login_at >= cutoff)
        .order_by(User.last_login_at.desc())
    )
    active = result.scalars().all()
    return {
        "active_sessions": [
            {
                "user_id": str(u.id),
                "email": u.email,
                "role": u.role.value if hasattr(u.role, 'value') else str(u.role),
                "last_active": u.last_login_at,
            }
            for u in active
        ],
        "count": len(active),
    }


# ── Correction Management Endpoints ──

@router.get("/corrections")
async def get_corrections(
    status: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get corrections queue. DEV only."""
    service = CorrectionService(db)
    return await service.get_corrections(status=status, page=page, per_page=per_page)


@router.post("/corrections/{correction_id}/approve")
async def approve_correction(
    correction_id: UUID,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Approve and apply a correction. DEV only."""
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    notes = body.get("notes")

    service = CorrectionService(db)
    try:
        result = await service.approve_correction(correction_id, user.id, notes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Audit log
    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="approve",
        target_type="correction",
        target_id=str(correction_id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    # Notify submitter
    from app.repositories.correction_repository import CorrectionRepository
    correction = await CorrectionRepository(db).get_by_id(correction_id)
    if correction:
        notif = NotificationService(db)
        await notif.notify_correction_approved(
            user_id=correction.submitted_by,
            candidate_name=correction.candidate_external_id,
            field=correction.field,
            correction_id=correction_id,
        )

    return result


@router.post("/corrections/{correction_id}/reject")
async def reject_correction(
    correction_id: UUID,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Reject a correction with reason. DEV only."""
    body = await request.json()
    reason = body.get("reason", "")
    if not reason:
        raise HTTPException(status_code=400, detail="Rejection reason is required")

    service = CorrectionService(db)
    try:
        result = await service.reject_correction(correction_id, user.id, reason)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Audit log
    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="reject",
        target_type="correction",
        target_id=str(correction_id),
        details={"reason": reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    # Notify submitter
    from app.repositories.correction_repository import CorrectionRepository
    correction = await CorrectionRepository(db).get_by_id(correction_id)
    if correction:
        notif = NotificationService(db)
        await notif.notify_correction_rejected(
            user_id=correction.submitted_by,
            candidate_name=correction.candidate_external_id,
            field=correction.field,
            correction_id=correction_id,
            reason=reason,
        )

    return result


@router.post("/corrections/{correction_id}/rollback")
async def rollback_correction(
    correction_id: UUID,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Rollback an approved correction. DEV only."""
    body = await request.json()
    reason = body.get("reason", "")
    if not reason:
        raise HTTPException(status_code=400, detail="Rollback reason is required")

    service = CorrectionService(db)
    try:
        result = await service.rollback_correction(correction_id, user.id, reason)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Audit log
    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="rollback",
        target_type="correction",
        target_id=str(correction_id),
        details={"reason": reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.post("/corrections/bulk")
async def bulk_upload_corrections(
    file: UploadFile = File(...),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Bulk upload corrections via CSV. DEV only."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    content = await file.read()
    service = BulkCorrectionService(db)
    result = await service.process_csv(content, user.id)

    # Notify uploader
    notif = NotificationService(db)
    await notif.notify_bulk_upload_complete(
        user_id=user.id,
        total=result["total_rows"],
        valid=result["valid"],
        invalid=result["invalid"],
        batch_id=result["batch_id"],
    )

    return result


# ── Analyst Agent ──

async def _run_analyst_agent(hours: int, province: Optional[str], dry_run: bool) -> None:
    """Background task that runs the analyst agent with its own DB session."""
    from app.services.analyst_agent.agent import NaradaAnalystAgent

    async with AsyncSessionLocal() as db:
        service = EditorialControlService(db)
        await service.mark_run_started("analyst_brief_generation")
        agent = NaradaAnalystAgent(
            db=db,
            hours=hours,
            province_filter=province,
            dry_run=dry_run,
        )
        try:
            brief = await agent.run()
            logger.info(
                "Analyst agent completed: run #%d, status=%s",
                brief.run_number, brief.status,
            )
            await service.mark_run_finished("analyst_brief_generation", success=True)
        except Exception as e:
            await service.mark_run_finished("analyst_brief_generation", success=False, error=str(e))
            logger.error("Analyst agent failed: %s", e, exc_info=True)


@router.post("/analyst-agent/run")
async def run_analyst_agent(
    background_tasks: BackgroundTasks,
    hours: int = Query(default=3, ge=1, le=24),
    province: Optional[str] = Query(default=None),
    dry_run: bool = Query(default=False),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Trigger the Narada Analyst Agent. Runs in background. DEV only."""
    service = EditorialControlService(db)
    if not await service.is_enabled("analyst_brief_generation"):
        raise HTTPException(status_code=409, detail="Analyst brief generation is paused")
    await service.mark_rerun_requested(
        automation_key="analyst_brief_generation",
        changed_by=user,
        reason=f"Manual analyst-agent run ({hours}h)",
    )
    background_tasks.add_task(_run_analyst_agent, hours, province, dry_run)
    return {
        "status": "started",
        "hours": hours,
        "province": province or "all",
        "dry_run": dry_run,
    }
