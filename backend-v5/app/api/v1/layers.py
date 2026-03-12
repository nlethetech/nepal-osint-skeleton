"""Layer configuration API for geospatial analysis."""
from typing import Optional, List
from uuid import UUID, uuid4
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db

router = APIRouter(prefix="/layers", tags=["layers"])


# ============================================================================
# Schemas
# ============================================================================


class LayerSource(BaseModel):
    """Source configuration for a data layer."""
    type: str  # 'geojson', 'tile', 'wms', 'api'
    url: Optional[str] = None
    api_endpoint: Optional[str] = None
    refresh_interval: Optional[int] = None  # seconds


class LayerConfig(BaseModel):
    """Configuration for a map layer."""
    id: str
    name: str
    description: Optional[str] = None
    category: str  # 'base', 'overlay', 'data'
    type: str  # 'tile', 'geojson', 'heatmap', 'marker', 'polygon'
    source: LayerSource
    visible: bool = False
    opacity: float = 1.0
    min_zoom: int = 0
    max_zoom: int = 18
    legend: Optional[dict] = None
    style: Optional[dict] = None
    attribution: Optional[str] = None


class LayerGroup(BaseModel):
    """Group of related layers."""
    id: str
    name: str
    layers: List[LayerConfig]
    exclusive: bool = False  # If true, only one layer can be active


class LayerConfigResponse(BaseModel):
    """Full layer configuration response."""
    base_layers: List[LayerConfig]
    overlay_layers: List[LayerConfig]
    data_layers: List[LayerConfig]
    groups: List[LayerGroup]


# ============================================================================
# Layer Definitions
# ============================================================================


# Base layers - only one can be active at a time
BASE_LAYERS = [
    LayerConfig(
        id="osm",
        name="OpenStreetMap",
        description="Standard OpenStreetMap tiles",
        category="base",
        type="tile",
        source=LayerSource(
            type="tile",
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ),
        visible=True,
        attribution="© OpenStreetMap contributors",
    ),
    LayerConfig(
        id="carto-dark",
        name="Dark Mode",
        description="CartoDB dark basemap",
        category="base",
        type="tile",
        source=LayerSource(
            type="tile",
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        ),
        visible=False,
        attribution="© CartoDB © OpenStreetMap",
    ),
    LayerConfig(
        id="carto-voyager",
        name="Voyager",
        description="CartoDB Voyager basemap",
        category="base",
        type="tile",
        source=LayerSource(
            type="tile",
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        ),
        visible=False,
        attribution="© CartoDB © OpenStreetMap",
    ),
    LayerConfig(
        id="sentinel2-rgb",
        name="Sentinel-2 RGB",
        description="Latest Sentinel-2 satellite imagery",
        category="base",
        type="tile",
        source=LayerSource(
            type="tile",
            url="/api/v1/earth-engine/tiles/sentinel2-rgb/{z}/{x}/{y}",
        ),
        visible=False,
        attribution="© Copernicus Sentinel data",
    ),
]

# Overlay layers - multiple can be active
OVERLAY_LAYERS = [
    LayerConfig(
        id="ndvi",
        name="Vegetation Index (NDVI)",
        description="Normalized Difference Vegetation Index from Sentinel-2",
        category="overlay",
        type="tile",
        source=LayerSource(
            type="tile",
            url="/api/v1/earth-engine/tiles/ndvi/{z}/{x}/{y}",
        ),
        visible=False,
        opacity=0.7,
        legend={
            "type": "gradient",
            "min": -1,
            "max": 1,
            "colors": ["#8B4513", "#FFFF00", "#228B22"],
            "labels": ["Bare", "Sparse", "Dense"],
        },
    ),
    LayerConfig(
        id="flood-extent",
        name="Flood Detection",
        description="Estimated flood extent from SAR analysis",
        category="overlay",
        type="tile",
        source=LayerSource(
            type="tile",
            url="/api/v1/earth-engine/tiles/flood-extent/{z}/{x}/{y}",
        ),
        visible=False,
        opacity=0.6,
        legend={
            "type": "categorical",
            "items": [
                {"color": "#0000FF", "label": "Water"},
                {"color": "#00BFFF", "label": "Temporary flooding"},
            ],
        },
    ),
    LayerConfig(
        id="damage-pwtt",
        name="PWTT Damage Assessment",
        description="Pre-event vs post-event change detection",
        category="overlay",
        type="tile",
        source=LayerSource(
            type="tile",
            url="/api/v1/earth-engine/tiles/damage-pwtt/{z}/{x}/{y}",
        ),
        visible=False,
        opacity=0.7,
        legend={
            "type": "gradient",
            "min": 0,
            "max": 1,
            "colors": ["#00FF00", "#FFFF00", "#FF0000"],
            "labels": ["No change", "Minor", "Major damage"],
        },
    ),
    LayerConfig(
        id="landslide-risk",
        name="Landslide Risk",
        description="Slope-based landslide susceptibility",
        category="overlay",
        type="tile",
        source=LayerSource(
            type="tile",
            url="/api/v1/earth-engine/tiles/landslide-risk/{z}/{x}/{y}",
        ),
        visible=False,
        opacity=0.5,
        legend={
            "type": "categorical",
            "items": [
                {"color": "#00FF00", "label": "Low"},
                {"color": "#FFFF00", "label": "Moderate"},
                {"color": "#FFA500", "label": "High"},
                {"color": "#FF0000", "label": "Very High"},
            ],
        },
    ),
    LayerConfig(
        id="terrain-hillshade",
        name="Terrain Hillshade",
        description="Shaded relief from DEM",
        category="overlay",
        type="tile",
        source=LayerSource(
            type="tile",
            url="/api/v1/earth-engine/tiles/hillshade/{z}/{x}/{y}",
        ),
        visible=False,
        opacity=0.3,
    ),
]

# Data layers - vector/feature layers from APIs
DATA_LAYERS = [
    LayerConfig(
        id="events",
        name="News Events",
        description="Geolocated news events from stories",
        category="data",
        type="marker",
        source=LayerSource(
            type="api",
            api_endpoint="/api/v1/map/events",
            refresh_interval=300,
        ),
        visible=True,
        style={
            "cluster": True,
            "cluster_radius": 50,
            "marker_color_field": "severity",
            "marker_colors": {
                "critical": "#EF4444",
                "high": "#F97316",
                "medium": "#EAB308",
                "low": "#22C55E",
            },
        },
    ),
    LayerConfig(
        id="river-stations",
        name="River Monitoring",
        description="River gauge stations with water levels",
        category="data",
        type="marker",
        source=LayerSource(
            type="api",
            api_endpoint="/api/v1/river/map-data",
            refresh_interval=600,
        ),
        visible=False,
        style={
            "marker_type": "circle",
            "marker_color_field": "alert_level",
            "marker_colors": {
                "normal": "#22C55E",
                "warning": "#EAB308",
                "danger": "#F97316",
                "extreme": "#EF4444",
            },
        },
    ),
    LayerConfig(
        id="curfews",
        name="Curfew Zones",
        description="Active curfew and restriction zones",
        category="data",
        type="polygon",
        source=LayerSource(
            type="api",
            api_endpoint="/api/v1/curfew/map-data",
            refresh_interval=300,
        ),
        visible=False,
        opacity=0.4,
        style={
            "fill_color": "#EF4444",
            "stroke_color": "#991B1B",
            "stroke_width": 2,
        },
    ),
    LayerConfig(
        id="seismic",
        name="Seismic Activity",
        description="Recent earthquake events",
        category="data",
        type="marker",
        source=LayerSource(
            type="api",
            api_endpoint="/api/v1/seismic/recent",
            refresh_interval=300,
        ),
        visible=False,
        style={
            "marker_type": "circle",
            "marker_size_field": "magnitude",
            "marker_color": "#8B5CF6",
            "pulse_animation": True,
        },
    ),
    LayerConfig(
        id="districts",
        name="District Boundaries",
        description="Nepal administrative district boundaries",
        category="data",
        type="polygon",
        source=LayerSource(
            type="geojson",
            url="/api/v1/spatial/districts",
        ),
        visible=False,
        opacity=0.3,
        style={
            "fill_color": "transparent",
            "stroke_color": "#71717A",
            "stroke_width": 1,
            "hover_fill": "#3F3F46",
        },
    ),
    LayerConfig(
        id="threat-heatmap",
        name="Threat Heatmap",
        description="Aggregated threat level by location",
        category="data",
        type="heatmap",
        source=LayerSource(
            type="api",
            api_endpoint="/api/v1/analytics/threat-heatmap",
            refresh_interval=600,
        ),
        visible=False,
        opacity=0.6,
        style={
            "radius": 25,
            "blur": 15,
            "gradient": {
                "0.0": "#22C55E",
                "0.3": "#EAB308",
                "0.6": "#F97316",
                "1.0": "#EF4444",
            },
        },
    ),
]

# Layer groups for UI organization
LAYER_GROUPS = [
    LayerGroup(
        id="satellite",
        name="Satellite Imagery",
        layers=[l for l in BASE_LAYERS if l.id in ["sentinel2-rgb"]],
        exclusive=False,
    ),
    LayerGroup(
        id="environmental",
        name="Environmental Analysis",
        layers=[l for l in OVERLAY_LAYERS if l.id in ["ndvi", "flood-extent", "landslide-risk"]],
        exclusive=False,
    ),
    LayerGroup(
        id="damage",
        name="Damage Assessment",
        layers=[l for l in OVERLAY_LAYERS if l.id in ["damage-pwtt"]],
        exclusive=False,
    ),
    LayerGroup(
        id="events",
        name="Events & Alerts",
        layers=[l for l in DATA_LAYERS if l.id in ["events", "river-stations", "seismic", "curfews"]],
        exclusive=False,
    ),
]


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/config", response_model=LayerConfigResponse)
async def get_layer_config():
    """
    Get full layer configuration for the map interface.

    Returns all available base layers, overlay layers, and data layers
    with their sources, styles, and legends.
    """
    return LayerConfigResponse(
        base_layers=BASE_LAYERS,
        overlay_layers=OVERLAY_LAYERS,
        data_layers=DATA_LAYERS,
        groups=LAYER_GROUPS,
    )


@router.get("/base")
async def get_base_layers():
    """Get available base layers."""
    return BASE_LAYERS


@router.get("/overlays")
async def get_overlay_layers():
    """Get available overlay layers."""
    return OVERLAY_LAYERS


@router.get("/data")
async def get_data_layers():
    """Get available data layers."""
    return DATA_LAYERS


@router.get("/{layer_id}")
async def get_layer_details(layer_id: str):
    """Get details for a specific layer."""
    all_layers = BASE_LAYERS + OVERLAY_LAYERS + DATA_LAYERS

    for layer in all_layers:
        if layer.id == layer_id:
            return layer

    raise HTTPException(status_code=404, detail=f"Layer '{layer_id}' not found")


@router.get("/{layer_id}/legend")
async def get_layer_legend(layer_id: str):
    """Get legend configuration for a specific layer."""
    all_layers = BASE_LAYERS + OVERLAY_LAYERS + DATA_LAYERS

    for layer in all_layers:
        if layer.id == layer_id:
            if layer.legend:
                return layer.legend
            raise HTTPException(status_code=404, detail=f"Layer '{layer_id}' has no legend")

    raise HTTPException(status_code=404, detail=f"Layer '{layer_id}' not found")
