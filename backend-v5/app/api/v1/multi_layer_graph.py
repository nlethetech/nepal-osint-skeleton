"""Multi-layer graph API endpoints for trade, entity, geographic, news, and disaster layers."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services.graph.multi_layer_graph_service import MultiLayerGraphService

router = APIRouter(prefix="/graph/multi-layer", tags=["multi-layer-graph"])


# ------------------------------------------------------------------
# 1. Trade flow graph
# ------------------------------------------------------------------
@router.get("/trade")
async def get_trade_graph(
    fiscal_year_bs: str | None = Query(None, description="Bikram Sambat fiscal year e.g. 2081-82"),
    direction: str | None = Query(None, description="Filter: import or export"),
    top_countries: int = Query(20, ge=1, le=226),
    top_hs_chapters: int = Query(15, ge=1, le=97),
    min_value_npr_thousands: float = Query(0, ge=0),
    expand_country: str | None = Query(None, description="Country to drill down into"),
    expand_hs_chapter: str | None = Query(None, description="HS chapter to drill down into"),
    include_customs: bool = Query(True),
    top_customs: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Return a graph of Nepal's trade flows — countries, HS chapters, and customs offices."""
    try:
        service = MultiLayerGraphService(db)
        return await service.get_trade_graph(
            fiscal_year_bs=fiscal_year_bs,
            direction=direction,
            top_countries=top_countries,
            top_hs_chapters=top_hs_chapters,
            min_value_npr_thousands=min_value_npr_thousands,
            expand_country=expand_country,
            expand_hs_chapter=expand_hs_chapter,
            include_customs=include_customs,
            top_customs=top_customs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Trade graph error: {exc}")


# ------------------------------------------------------------------
# 2. Political entity graph
# ------------------------------------------------------------------
@router.get("/entity")
async def get_entity_graph(
    window: str = Query("7d", description="Time window: 24h, 7d, 30d, 90d"),
    min_strength: float = Query(0.1, ge=0, le=1),
    limit_nodes: int = Query(100, ge=1, le=500),
    include_parties: bool = Query(True),
    include_constituencies: bool = Query(True),
    include_ministerial: bool = Query(True),
    include_opponents: bool = Query(False),
    include_geographic: bool = Query(True),
    election_year_bs: int | None = Query(None, description="Election year BS: 2074, 2079, or 2082"),
    db: AsyncSession = Depends(get_db),
):
    """Return a graph of political entities — people, parties, ministries, and constituencies."""
    try:
        service = MultiLayerGraphService(db)
        return await service.get_entity_political_graph(
            window=window,
            min_strength=min_strength,
            limit_nodes=limit_nodes,
            include_parties=include_parties,
            include_constituencies=include_constituencies,
            include_ministerial=include_ministerial,
            include_opponents=include_opponents,
            include_geographic=include_geographic,
            election_year_bs=election_year_bs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Entity graph error: {exc}")


# ------------------------------------------------------------------
# 3. Geographic hierarchy
# ------------------------------------------------------------------
@router.get("/geographic")
async def get_geographic_graph(
    expand_province_id: int | None = Query(None, ge=1, le=7),
    expand_district: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the geographic hierarchy — provinces, districts, and constituencies."""
    try:
        service = MultiLayerGraphService(db)
        return await service.get_geographic_graph(
            expand_province_id=expand_province_id,
            expand_district=expand_district,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Geographic graph error: {exc}")


# ------------------------------------------------------------------
# 4. News co-mention graph
# ------------------------------------------------------------------
@router.get("/news")
async def get_news_graph(
    hours: int = Query(168, ge=1, le=720),
    min_co_mentions: int = Query(2, ge=1),
    limit_entities: int = Query(50, ge=1, le=200),
    include_story_nodes: bool = Query(True),
    category: str | None = Query(None, description="Filter: political, economic, security, disaster, social"),
    include_districts: bool = Query(True),
    include_entity_connections: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    """Return a graph of news co-mentions — entities that appear together in stories."""
    try:
        service = MultiLayerGraphService(db)
        return await service.get_news_graph(
            hours=hours,
            min_co_mentions=min_co_mentions,
            limit_entities=limit_entities,
            include_story_nodes=include_story_nodes,
            category=category,
            include_districts=include_districts,
            include_entity_connections=include_entity_connections,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"News graph error: {exc}")


# ------------------------------------------------------------------
# 5. Disaster graph
# ------------------------------------------------------------------
@router.get("/disaster")
async def get_disaster_graph(
    days: int = Query(90, ge=1, le=365),
    min_severity: str | None = Query(None, description="Minimum: low, medium, high, critical"),
    hazard_type: str | None = Query(None, description="Filter: flood, landslide, earthquake, fire, etc."),
    limit_incidents: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Return a graph of disaster incidents — hazard types, affected areas, and severity."""
    try:
        service = MultiLayerGraphService(db)
        return await service.get_disaster_graph(
            days=days,
            min_severity=min_severity,
            hazard_type=hazard_type,
            limit_incidents=limit_incidents,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Disaster graph error: {exc}")


# ------------------------------------------------------------------
# 6. Combined multi-layer graph
# ------------------------------------------------------------------
@router.get("/combined")
async def get_combined_graph(
    layers: list[str] = Query(..., description="Active layers: trade, entity, geographic, news, disaster"),
    # Trade params
    fiscal_year_bs: str | None = Query(None),
    direction: str | None = Query(None),
    top_countries: int = Query(20, ge=1, le=226),
    top_hs_chapters: int = Query(15, ge=1, le=97),
    min_value_npr_thousands: float = Query(0, ge=0),
    include_customs: bool = Query(True),
    top_customs: int = Query(20, ge=1, le=50),
    # Entity params
    window: str = Query("7d"),
    min_strength: float = Query(0.1, ge=0, le=1),
    limit_nodes: int = Query(100, ge=1, le=500),
    include_parties: bool = Query(True),
    include_constituencies: bool = Query(True),
    include_ministerial: bool = Query(True),
    include_opponents: bool = Query(False),
    include_geographic: bool = Query(True),
    election_year_bs: int | None = Query(None),
    # Geographic params
    expand_province_id: int | None = Query(None),
    expand_district: str | None = Query(None),
    # News params
    news_hours: int = Query(168, ge=1, le=720),
    min_co_mentions: int = Query(2, ge=1),
    limit_entities: int = Query(50, ge=1, le=200),
    include_story_nodes: bool = Query(True),
    news_category: str | None = Query(None),
    include_districts: bool = Query(True),
    include_entity_connections: bool = Query(True),
    # Disaster params
    disaster_days: int = Query(90, ge=1, le=365),
    min_severity: str | None = Query(None),
    hazard_type: str | None = Query(None),
    limit_incidents: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Merge multiple graph layers into a single combined graph response."""
    valid_layers = {"trade", "entity", "geographic", "news", "disaster"}
    invalid = set(layers) - valid_layers
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid layer(s): {', '.join(sorted(invalid))}. Valid: {', '.join(sorted(valid_layers))}",
        )

    try:
        service = MultiLayerGraphService(db)
        return await service.get_combined_graph(
            layers=layers,
            trade={
                "fiscal_year_bs": fiscal_year_bs,
                "direction": direction,
                "top_countries": top_countries,
                "top_hs_chapters": top_hs_chapters,
                "min_value_npr_thousands": min_value_npr_thousands,
                "include_customs": include_customs,
                "top_customs": top_customs,
            },
            entity={
                "window": window,
                "min_strength": min_strength,
                "limit_nodes": limit_nodes,
                "include_parties": include_parties,
                "include_constituencies": include_constituencies,
                "include_ministerial": include_ministerial,
                "include_opponents": include_opponents,
                "include_geographic": include_geographic,
                "election_year_bs": election_year_bs,
            },
            geographic={
                "expand_province_id": expand_province_id,
                "expand_district": expand_district,
            },
            news={
                "hours": news_hours,
                "min_co_mentions": min_co_mentions,
                "limit_entities": limit_entities,
                "include_story_nodes": include_story_nodes,
                "category": news_category,
                "include_districts": include_districts,
                "include_entity_connections": include_entity_connections,
            },
            disaster={
                "days": disaster_days,
                "min_severity": min_severity,
                "hazard_type": hazard_type,
                "limit_incidents": limit_incidents,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Combined graph error: {exc}")


# ------------------------------------------------------------------
# 7. Metadata (filter dropdowns)
# ------------------------------------------------------------------
@router.get("/metadata")
async def get_graph_metadata(
    db: AsyncSession = Depends(get_db),
):
    """Return available fiscal years, election years for filter dropdowns."""
    try:
        service = MultiLayerGraphService(db)
        fiscal_years = await service.get_available_fiscal_years()
        election_years = await service.get_available_election_years()
        return {
            "fiscal_years": fiscal_years,
            "election_years": election_years,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Metadata error: {exc}")
