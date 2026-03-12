"""Spatial Analysis Services for NARADA.

Provides:
- KML/KMZ generation for Google Earth
- Hotspot detection using hierarchical clustering
- Proximity/radius queries with Haversine distance
- Temporal-spatial analysis for animation
"""

from .kml_generator import KMLGenerator
from .hotspot_detector import HotspotDetector
from .proximity_service import ProximityService
from .temporal_spatial import TemporalSpatialService

__all__ = [
    "KMLGenerator",
    "HotspotDetector",
    "ProximityService",
    "TemporalSpatialService",
]
