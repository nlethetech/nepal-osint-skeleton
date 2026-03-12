"""Trade intelligence API endpoints for connected analyst workflows."""
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services.trade import TradeIngestionService

router = APIRouter(prefix="/trade", tags=["trade"])


class TradeIngestRunRequest(BaseModel):
    """Request to run trade ingestion."""

    data_root: str = Field(
        default="trade_data",
        description="Relative or absolute path to trade workbook directory",
    )


class TradeRecomputeRequest(BaseModel):
    fiscal_year_bs: str | None = Field(
        default=None,
        description="Optional BS fiscal year filter (e.g., 2081-82)",
    )


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


@router.post("/ingest/run")
async def run_trade_ingest(
    request: TradeIngestRunRequest,
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)

    data_root = Path(request.data_root)
    if not data_root.is_absolute():
        repo_root = Path(__file__).resolve().parents[4]
        data_root = repo_root / data_root

    summary = await service.run_ingestion(data_root)
    return {"status": "ok", "summary": summary, "data_root": str(data_root)}


@router.post("/files/upload")
async def upload_trade_files(
    files: list[UploadFile] = File(...),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    root = _repo_root()
    upload_root = root / "trade_data" / "uploads" / datetime.utcnow().strftime("%Y%m%d")
    upload_root.mkdir(parents=True, exist_ok=True)

    accepted: list[dict[str, str]] = []
    for item in files:
        if not item.filename:
            continue
        if not item.filename.lower().endswith(".xlsx"):
            continue

        safe_name = Path(item.filename).name
        destination = upload_root / safe_name
        payload = await item.read()
        destination.write_bytes(payload)
        accepted.append(
            {
                "filename": safe_name,
                "saved_path": str(destination),
                "size_bytes": str(len(payload)),
            }
        )

    if not accepted:
        raise HTTPException(status_code=400, detail="No valid .xlsx files were uploaded")

    return {
        "status": "ok",
        "upload_root": str(upload_root),
        "files": accepted,
        "count": len(accepted),
    }


@router.post("/recompute")
async def recompute_trade_metrics(
    request: TradeRecomputeRequest,
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.recompute(fiscal_year_bs=request.fiscal_year_bs)


@router.get("/flows")
async def get_trade_flows(
    hs_code: str | None = Query(None),
    partner_country: str | None = Query(None),
    customs_office: str | None = Query(None),
    fiscal_year_bs: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.list_flows(
        hs_code=hs_code,
        partner_country=partner_country,
        customs_office=customs_office,
        fiscal_year_bs=fiscal_year_bs,
        limit=limit,
        offset=offset,
    )


@router.get("/anomalies")
async def get_trade_anomalies(
    dimension: str | None = Query(None),
    dimension_key: str | None = Query(None),
    fiscal_year_bs: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.list_anomalies(
        dimension=dimension,
        dimension_key=dimension_key,
        fiscal_year_bs=fiscal_year_bs,
        limit=limit,
        offset=offset,
    )


@router.get("/customs/{customs_id}/impact")
async def get_customs_impact(
    customs_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.customs_impact(customs_id)


@router.get("/workbench/summary")
async def get_trade_workbench_summary(
    fiscal_year_bs: str | None = Query(None),
    month_ordinal: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.workbench_summary(
        fiscal_year_bs=fiscal_year_bs,
        month_ordinal=month_ordinal,
    )


@router.get("/workbench/drilldown")
async def get_trade_workbench_drilldown(
    fiscal_year_bs: str | None = Query(None),
    direction: str | None = Query(None),
    hs_code: str | None = Query(None),
    partner_country: str | None = Query(None),
    customs_office: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.workbench_drilldown(
        fiscal_year_bs=fiscal_year_bs,
        direction=direction,
        hs_code=hs_code,
        partner_country=partner_country,
        customs_office=customs_office,
        limit=limit,
        offset=offset,
    )


@router.get("/workbench/series")
async def get_trade_workbench_series(
    dimension: str = Query(...),
    dimension_key: str = Query(...),
    direction: str | None = Query(None),
    fiscal_year_bs: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.workbench_series(
        dimension=dimension,
        dimension_key=dimension_key,
        direction=direction,
        fiscal_year_bs=fiscal_year_bs,
    )


@router.get("/workbench/hs-aggregation")
async def get_trade_workbench_hs_aggregation(
    fiscal_year_bs: str | None = Query(None),
    direction: str | None = Query(None),
    partner_country: str | None = Query(None),
    customs_office: str | None = Query(None),
    hs_prefix: str | None = Query(None),
    sort_by: str = Query("total_value_npr_thousands"),
    sort_direction: str = Query("desc"),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    service = TradeIngestionService(db)
    return await service.workbench_hs_aggregation(
        fiscal_year_bs=fiscal_year_bs,
        direction=direction,
        partner_country=partner_country,
        customs_office=customs_office,
        hs_prefix=hs_prefix,
        sort_by=sort_by,
        sort_direction=sort_direction,
        limit=limit,
        offset=offset,
    )
