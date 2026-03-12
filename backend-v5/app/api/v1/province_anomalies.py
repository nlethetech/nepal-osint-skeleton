"""API endpoints for province anomaly data (Province Anomaly Agent output)."""
import logging
from typing import Optional
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.api.deps import get_db, require_dev
from app.models.province_anomaly import ProvinceAnomalyRun, ProvinceAnomaly

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/province-anomalies", tags=["province-anomalies"])


# ── Response schemas ──


class ProvinceAnomalyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    province_id: int
    province_name: str
    threat_level: str
    threat_trajectory: str
    summary: str
    political: Optional[str] = None
    economic: Optional[str] = None
    security: Optional[str] = None
    anomalies: list[dict] = []
    story_count: int = 0
    tweet_count: int = 0


class ProvinceAnomalyLatestResponse(BaseModel):
    run_id: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    stories_analyzed: int = 0
    tweets_analyzed: int = 0
    provinces: list[ProvinceAnomalyResponse] = []


# ── Ingest schemas (for local agent POST) ──


class ProvinceAnomalyIngest(BaseModel):
    province_id: int
    province_name: str
    threat_level: str = "LOW"
    threat_trajectory: str = "STABLE"
    summary: str = ""
    political: Optional[str] = None
    economic: Optional[str] = None
    security: Optional[str] = None
    anomalies: list[dict] = []
    story_count: int = 0
    tweet_count: int = 0
    key_sources: list[dict] = []


class ProvinceAnomalyRunIngest(BaseModel):
    stories_analyzed: int = 0
    tweets_analyzed: int = 0
    provinces: list[ProvinceAnomalyIngest] = []


# ── Endpoints ──


@router.get("/latest", response_model=ProvinceAnomalyLatestResponse)
async def get_latest_province_anomalies(db: AsyncSession = Depends(get_db)):
    """Get the most recent completed province anomaly run with all 7 province assessments."""
    try:
        # Find most recent completed run
        run_result = await db.execute(
            select(ProvinceAnomalyRun)
            .where(ProvinceAnomalyRun.status == "completed")
            .order_by(ProvinceAnomalyRun.completed_at.desc())
            .limit(1)
        )
        run = run_result.scalar_one_or_none()

        if not run:
            return ProvinceAnomalyLatestResponse()

        # Fetch anomalies for this run
        anomalies_result = await db.execute(
            select(ProvinceAnomaly)
            .where(ProvinceAnomaly.run_id == run.id)
            .order_by(ProvinceAnomaly.province_id)
        )
        anomalies = anomalies_result.scalars().all()

        return ProvinceAnomalyLatestResponse(
            run_id=run.id,
            completed_at=run.completed_at,
            stories_analyzed=run.stories_analyzed,
            tweets_analyzed=run.tweets_analyzed,
            provinces=[
                ProvinceAnomalyResponse(
                    province_id=a.province_id,
                    province_name=a.province_name,
                    threat_level=a.threat_level,
                    threat_trajectory=a.threat_trajectory,
                    summary=a.summary,
                    political=a.political,
                    economic=a.economic,
                    security=a.security,
                    anomalies=a.anomalies_data or [],
                    story_count=a.story_count,
                    tweet_count=a.tweet_count,
                )
                for a in anomalies
            ],
        )
    except (ProgrammingError, OperationalError):
        logger.warning("province_anomaly tables not found — run migration 053")
        return ProvinceAnomalyLatestResponse()


@router.post("/ingest", response_model=ProvinceAnomalyLatestResponse)
async def ingest_province_anomalies(
    payload: ProvinceAnomalyRunIngest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_dev),
):
    """Ingest province anomaly results from local agent (dev role required).

    Creates a ProvinceAnomalyRun + 7 ProvinceAnomaly records.
    Used by run_local_api.py to POST results without direct DB access.
    """
    now = datetime.now(timezone.utc)

    run = ProvinceAnomalyRun(
        started_at=now,
        completed_at=now,
        status="completed",
        stories_analyzed=payload.stories_analyzed,
        tweets_analyzed=payload.tweets_analyzed,
        model_used="sonnet",
    )
    db.add(run)
    await db.flush()

    anomalies = []
    for p in payload.provinces:
        anomaly = ProvinceAnomaly(
            run_id=run.id,
            province_id=p.province_id,
            province_name=p.province_name,
            threat_level=p.threat_level,
            threat_trajectory=p.threat_trajectory,
            summary=p.summary,
            political=p.political,
            economic=p.economic,
            security=p.security,
            anomalies_data=p.anomalies,
            story_count=p.story_count,
            tweet_count=p.tweet_count,
            key_sources=p.key_sources,
        )
        db.add(anomaly)
        anomalies.append(anomaly)

    await db.commit()

    logger.info(
        "Province anomaly run ingested: %d provinces, %d stories, %d tweets",
        len(anomalies), payload.stories_analyzed, payload.tweets_analyzed,
    )

    return ProvinceAnomalyLatestResponse(
        run_id=run.id,
        completed_at=run.completed_at,
        stories_analyzed=run.stories_analyzed,
        tweets_analyzed=run.tweets_analyzed,
        provinces=[
            ProvinceAnomalyResponse(
                province_id=a.province_id,
                province_name=a.province_name,
                threat_level=a.threat_level,
                threat_trajectory=a.threat_trajectory,
                summary=a.summary,
                political=a.political,
                economic=a.economic,
                security=a.security,
                anomalies=a.anomalies_data or [],
                story_count=a.story_count,
                tweet_count=a.tweet_count,
            )
            for a in anomalies
        ],
    )
