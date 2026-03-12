"""Report Generation API for exportable intelligence reports."""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4, UUID
from enum import Enum
import asyncio
import io
import logging

from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.api.deps import get_db, require_analyst
from app.models.user import User
from app.services.analysis.core_paper_service import CorePaperService

router = APIRouter(prefix="/reports", tags=["reports"])
logger = logging.getLogger(__name__)


# ============================================================================
# Enums and Schemas
# ============================================================================


class ReportFormat(str, Enum):
    PDF = "pdf"
    PNG = "png"
    CSV = "csv"
    JSON = "json"


class ReportType(str, Enum):
    SITUATIONAL = "situational"
    ENTITY_DOSSIER = "entity_dossier"
    DAMAGE_ASSESSMENT = "damage_assessment"
    THREAT_MATRIX = "threat_matrix"
    CASE_SUMMARY = "case_summary"
    NETWORK_ANALYSIS = "network_analysis"


class ReportStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class BoundingBox(BaseModel):
    """Geographic bounding box for map exports."""
    north: float
    south: float
    east: float
    west: float


class ReportRequest(BaseModel):
    """Request to generate a report."""
    report_type: ReportType
    format: ReportFormat = ReportFormat.PDF
    title: Optional[str] = None
    description: Optional[str] = None

    # Filters
    hours: int = Field(default=24, ge=1, le=720)
    categories: List[str] = []
    severities: List[str] = []
    districts: List[str] = []

    # Entity-specific
    entity_id: Optional[str] = None

    # Case-specific
    case_id: Optional[str] = None

    # Map settings
    include_map: bool = True
    map_bbox: Optional[BoundingBox] = None
    map_layers: List[str] = []

    # Content options
    include_stories: bool = True
    include_entities: bool = True
    include_charts: bool = True
    include_summary: bool = True
    max_stories: int = Field(default=50, ge=1, le=200)


class ReportMetadata(BaseModel):
    """Metadata about a generated report."""
    id: str
    report_type: ReportType
    format: ReportFormat
    status: ReportStatus
    title: str
    created_at: str
    completed_at: Optional[str] = None
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    download_url: Optional[str] = None
    error: Optional[str] = None
    request_params: dict


class CorePapersRequest(BaseModel):
    """Request payload for evidence-first autonomous core papers."""

    hours: int = Field(default=168, ge=24, le=24 * 30)
    singha_center_lat: float = Field(default=27.6956)
    singha_center_lng: float = Field(default=85.3197)
    singha_radius_km: float = Field(default=1.5, ge=0.2, le=10.0)
    use_llm: bool = Field(default=True)


class AutonomousCorePaperListItem(BaseModel):
    id: str
    report_type: str
    title: str
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    time_window_hours: int
    generated_with_llm: bool
    citations_count: int
    highlights: List[str] = []
    metrics_preview: dict = {}


class AutonomousCorePaperListResponse(BaseModel):
    items: List[AutonomousCorePaperListItem]
    total: int
    limit: int
    offset: int


class AutonomousCorePapersSummaryResponse(BaseModel):
    total_reports: int
    by_report_type: dict[str, int]
    generated_last_24h: int
    generated_last_7d: int
    last_generated_at: Optional[str] = None


# ============================================================================
# In-memory storage (replace with DB/Redis in production)
# ============================================================================

REPORT_JOBS: dict[str, ReportMetadata] = {}


# ============================================================================
# Report Generation Logic
# ============================================================================


async def generate_pdf_report(report_id: str, request: ReportRequest):
    """Generate a PDF report using WeasyPrint."""
    try:
        REPORT_JOBS[report_id].status = ReportStatus.PROCESSING

        # Simulate report generation
        await asyncio.sleep(3)

        # In production, this would:
        # 1. Fetch data based on request filters
        # 2. Generate HTML template with data
        # 3. Convert to PDF using WeasyPrint
        # 4. Save to file storage

        # For now, create a mock completed report
        REPORT_JOBS[report_id].status = ReportStatus.COMPLETED
        REPORT_JOBS[report_id].completed_at = datetime.now(timezone.utc).isoformat()
        REPORT_JOBS[report_id].file_path = f"/tmp/reports/{report_id}.pdf"
        REPORT_JOBS[report_id].file_size = 245000  # Mock file size
        REPORT_JOBS[report_id].download_url = f"/api/v1/reports/{report_id}/download"

        logger.info(f"Report {report_id} generated successfully")

    except Exception as e:
        logger.error(f"Report generation failed: {e}")
        REPORT_JOBS[report_id].status = ReportStatus.FAILED
        REPORT_JOBS[report_id].error = str(e)


async def generate_png_report(report_id: str, request: ReportRequest):
    """Generate a PNG map snapshot."""
    try:
        REPORT_JOBS[report_id].status = ReportStatus.PROCESSING

        # Simulate image generation
        await asyncio.sleep(2)

        REPORT_JOBS[report_id].status = ReportStatus.COMPLETED
        REPORT_JOBS[report_id].completed_at = datetime.now(timezone.utc).isoformat()
        REPORT_JOBS[report_id].file_path = f"/tmp/reports/{report_id}.png"
        REPORT_JOBS[report_id].file_size = 125000
        REPORT_JOBS[report_id].download_url = f"/api/v1/reports/{report_id}/download"

    except Exception as e:
        REPORT_JOBS[report_id].status = ReportStatus.FAILED
        REPORT_JOBS[report_id].error = str(e)


async def generate_csv_report(report_id: str, request: ReportRequest):
    """Generate a CSV data export."""
    try:
        REPORT_JOBS[report_id].status = ReportStatus.PROCESSING

        await asyncio.sleep(1)

        REPORT_JOBS[report_id].status = ReportStatus.COMPLETED
        REPORT_JOBS[report_id].completed_at = datetime.now(timezone.utc).isoformat()
        REPORT_JOBS[report_id].file_path = f"/tmp/reports/{report_id}.csv"
        REPORT_JOBS[report_id].file_size = 45000
        REPORT_JOBS[report_id].download_url = f"/api/v1/reports/{report_id}/download"

    except Exception as e:
        REPORT_JOBS[report_id].status = ReportStatus.FAILED
        REPORT_JOBS[report_id].error = str(e)


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/generate", response_model=ReportMetadata)
async def generate_report(
    request: ReportRequest,
    background_tasks: BackgroundTasks,
):
    """
    Queue a report for generation.

    Supports various report types:
    - situational: Current situation overview
    - entity_dossier: Comprehensive entity profile
    - damage_assessment: Satellite damage analysis report
    - threat_matrix: Threat level breakdown
    - case_summary: Investigation case summary
    - network_analysis: Entity network visualization

    Returns a report ID that can be polled for status.
    """
    report_id = str(uuid4())

    # Generate title if not provided
    title = request.title
    if not title:
        title_map = {
            ReportType.SITUATIONAL: f"Situational Report - {request.hours}h",
            ReportType.ENTITY_DOSSIER: f"Entity Dossier",
            ReportType.DAMAGE_ASSESSMENT: "Damage Assessment Report",
            ReportType.THREAT_MATRIX: f"Threat Matrix - {request.hours}h",
            ReportType.CASE_SUMMARY: "Case Summary",
            ReportType.NETWORK_ANALYSIS: "Network Analysis Report",
        }
        title = title_map.get(request.report_type, "Intelligence Report")

    # Create report metadata
    metadata = ReportMetadata(
        id=report_id,
        report_type=request.report_type,
        format=request.format,
        status=ReportStatus.QUEUED,
        title=title,
        created_at=datetime.now(timezone.utc).isoformat(),
        request_params=request.model_dump(),
    )

    REPORT_JOBS[report_id] = metadata

    # Queue background generation
    if request.format == ReportFormat.PDF:
        background_tasks.add_task(generate_pdf_report, report_id, request)
    elif request.format == ReportFormat.PNG:
        background_tasks.add_task(generate_png_report, report_id, request)
    elif request.format == ReportFormat.CSV:
        background_tasks.add_task(generate_csv_report, report_id, request)
    else:
        # JSON is generated synchronously
        metadata.status = ReportStatus.COMPLETED
        metadata.completed_at = datetime.now(timezone.utc).isoformat()
        metadata.download_url = f"/api/v1/reports/{report_id}/download"

    return metadata


@router.get("/{report_id}/status", response_model=ReportMetadata)
async def get_report_status(report_id: str):
    """
    Check the status of a report generation job.

    Poll this endpoint to know when the report is ready for download.
    """
    if report_id not in REPORT_JOBS:
        raise HTTPException(status_code=404, detail="Report not found")

    return REPORT_JOBS[report_id]


@router.get("/{report_id}/download")
async def download_report(report_id: str):
    """
    Download a generated report.

    Only available after the report status is 'completed'.
    """
    if report_id not in REPORT_JOBS:
        raise HTTPException(status_code=404, detail="Report not found")

    report = REPORT_JOBS[report_id]

    if report.status != ReportStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail=f"Report not ready. Current status: {report.status.value}"
        )

    # In production, this would return the actual file
    # For now, return a mock response

    # Determine content type
    content_types = {
        ReportFormat.PDF: "application/pdf",
        ReportFormat.PNG: "image/png",
        ReportFormat.CSV: "text/csv",
        ReportFormat.JSON: "application/json",
    }

    # Generate a sample response
    if report.format == ReportFormat.JSON:
        return {
            "report_id": report_id,
            "report_type": report.report_type.value,
            "title": report.title,
            "generated_at": report.completed_at,
            "data": {
                "summary": "Mock report data",
                "request_params": report.request_params,
            },
        }

    # For file formats, would return FileResponse with actual file
    raise HTTPException(
        status_code=501,
        detail="File download not implemented in this demo. Use JSON format."
    )


@router.get("")
async def list_reports(
    status: Optional[ReportStatus] = Query(None),
    report_type: Optional[ReportType] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """
    List recent report jobs.

    Optionally filter by status or report type.
    """
    reports = list(REPORT_JOBS.values())

    if status:
        reports = [r for r in reports if r.status == status]

    if report_type:
        reports = [r for r in reports if r.report_type == report_type]

    # Sort by created_at descending
    reports.sort(key=lambda r: r.created_at, reverse=True)

    return {
        "reports": reports[:limit],
        "total": len(reports),
    }


@router.delete("/{report_id}")
async def delete_report(report_id: str):
    """
    Delete a report job and its associated file.
    """
    if report_id not in REPORT_JOBS:
        raise HTTPException(status_code=404, detail="Report not found")

    # In production, also delete the file from storage
    del REPORT_JOBS[report_id]

    return {"status": "deleted", "report_id": report_id}


@router.post("/autonomous/core-papers")
async def generate_autonomous_core_papers(
    request: CorePapersRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Generate three evidence-first analyst papers:
    - Political Developments
    - Security Developments
    - Gen Z Singha Durbar Damage Assessment

    Each paper includes strict citation payloads to reduce hallucination risk.
    """
    service = CorePaperService(db)
    return await service.generate_core_papers(
        hours=request.hours,
        singha_center_lat=request.singha_center_lat,
        singha_center_lng=request.singha_center_lng,
        singha_radius_km=request.singha_radius_km,
        use_llm=request.use_llm,
        generated_by_id=current_user.id,
    )


@router.get("/autonomous/core-papers", response_model=AutonomousCorePaperListResponse)
async def list_autonomous_core_papers(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    report_type: Optional[str] = Query(None),
    generated_by: Optional[UUID] = Query(None),
    generated_by_me: bool = Query(False),
    created_after: Optional[datetime] = Query(None),
    created_before: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List persisted autonomous core papers with filter and pagination."""
    service = CorePaperService(db)
    effective_generated_by = current_user.id if generated_by_me else generated_by
    return await service.list_reports(
        limit=limit,
        offset=offset,
        report_type=report_type,
        generated_by=effective_generated_by,
        created_after=created_after,
        created_before=created_before,
    )


@router.get(
    "/autonomous/core-papers/summary",
    response_model=AutonomousCorePapersSummaryResponse,
)
async def get_autonomous_core_papers_summary(
    report_type: Optional[str] = Query(None),
    generated_by: Optional[UUID] = Query(None),
    generated_by_me: bool = Query(False),
    created_after: Optional[datetime] = Query(None),
    created_before: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Return aggregate counters for persisted autonomous core papers."""
    service = CorePaperService(db)
    effective_generated_by = current_user.id if generated_by_me else generated_by
    return await service.get_reports_summary(
        report_type=report_type,
        generated_by=effective_generated_by,
        created_after=created_after,
        created_before=created_before,
    )


@router.get("/autonomous/core-papers/{report_id}")
async def get_autonomous_core_paper(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_analyst),
):
    """Fetch a persisted autonomous core paper with citations."""
    from uuid import UUID

    try:
        report_uuid = UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid report_id")

    service = CorePaperService(db)
    report = await service.get_report(report_uuid)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


# ============================================================================
# Quick Export Endpoints (synchronous, smaller exports)
# ============================================================================


@router.get("/quick/threat-matrix")
async def quick_export_threat_matrix(
    hours: int = Query(24, ge=1, le=168),
    format: str = Query("json", description="json or csv"),
    db: AsyncSession = Depends(get_db),
):
    """
    Quick export of current threat matrix.

    Returns data immediately without queueing.
    """
    # Mock threat matrix data
    matrix = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "time_window_hours": hours,
        "overall_threat_level": "ELEVATED",
        "categories": [
            {"category": "Political", "level": "ELEVATED", "event_count": 45},
            {"category": "Social", "level": "GUARDED", "event_count": 32},
            {"category": "Economic", "level": "LOW", "event_count": 18},
            {"category": "Disaster", "level": "CRITICAL", "event_count": 8},
            {"category": "Security", "level": "GUARDED", "event_count": 23},
        ],
    }

    if format == "csv":
        # Return CSV format
        lines = ["category,level,event_count"]
        for cat in matrix["categories"]:
            lines.append(f"{cat['category']},{cat['level']},{cat['event_count']}")

        return {
            "content_type": "text/csv",
            "data": "\n".join(lines),
        }

    return matrix


@router.get("/quick/entity-list")
async def quick_export_entity_list(
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(50, ge=1, le=200),
    format: str = Query("json"),
    db: AsyncSession = Depends(get_db),
):
    """
    Quick export of top entities by mentions.
    """
    # Mock entity data
    entities = [
        {"name": "Entity A", "type": "person", "mentions": 45, "trend": "rising"},
        {"name": "Entity B", "type": "party", "mentions": 38, "trend": "stable"},
        {"name": "Entity C", "type": "person", "mentions": 32, "trend": "falling"},
    ]

    if format == "csv":
        lines = ["name,type,mentions,trend"]
        for e in entities:
            lines.append(f"{e['name']},{e['type']},{e['mentions']},{e['trend']}")

        return {
            "content_type": "text/csv",
            "data": "\n".join(lines),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "time_window_hours": hours,
        "entities": entities[:limit],
    }


# ============================================================================
# Corporate Intelligence PDF Reports
# ============================================================================


@router.get("/corporate/entity/{company_id}")
async def download_entity_dossier(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Generate and download a PDF entity dossier for a company.

    Includes company profile, PAN info, IRD tax status, directors,
    shared director network, and risk assessment.
    """
    from app.reports.generator import ReportGenerator

    generator = ReportGenerator(db)
    pdf_bytes = await generator.generate_entity_dossier(company_id)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Company not found")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="entity_dossier_{company_id}.pdf"',
        },
    )


@router.get("/corporate/pan/{pan}")
async def download_pan_report(
    pan: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Generate and download a PDF PAN investigation report.

    Includes all companies under the PAN, IRD details, directors,
    and cross-company risk analysis.
    """
    from app.reports.generator import ReportGenerator

    generator = ReportGenerator(db)
    pdf_bytes = await generator.generate_pan_report(pan)
    if pdf_bytes is None:
        raise HTTPException(
            status_code=404,
            detail=f"No companies found for PAN: {pan}",
        )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="pan_investigation_{pan}.pdf"',
        },
    )


@router.get("/corporate/risk-summary")
async def download_risk_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Generate and download a PDF corporate risk summary report.

    Includes all risk flags sorted by severity, statistics by category,
    corporate landscape overview, and top offenders.
    """
    from app.reports.generator import ReportGenerator

    generator = ReportGenerator(db)
    pdf_bytes = await generator.generate_risk_report()

    now_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="risk_summary_{now_str}.pdf"',
        },
    )
