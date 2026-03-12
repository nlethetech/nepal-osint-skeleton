"""Graph API endpoints for connected analyst graph and provenance."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services.graph import GraphService

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/objects/search")
async def search_objects(
    q: str | None = Query(None, description="Search query for title/canonical key"),
    object_type: list[str] | None = Query(None, description="Object type filter (repeatable)"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    service = GraphService(db)
    return await service.search_objects(query=q, object_types=object_type, limit=limit, offset=offset)


@router.get("/objects/{object_id}")
async def get_object(
    object_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    service = GraphService(db)
    obj = await service.get_object(object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")
    return obj


@router.get("/objects/{object_id}/neighbors")
async def get_object_neighbors(
    object_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    service = GraphService(db)
    payload = await service.get_neighbors(object_id, limit=limit)
    if not payload:
        raise HTTPException(status_code=404, detail="Object not found")
    return payload


@router.get("/objects/{object_id}/timeline")
async def get_object_timeline(
    object_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    service = GraphService(db)
    payload = await service.get_timeline(object_id, limit=limit)
    if not payload:
        raise HTTPException(status_code=404, detail="Object not found")
    return payload
