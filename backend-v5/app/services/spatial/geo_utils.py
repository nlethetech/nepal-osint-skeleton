"""Geographic utility functions for spatial analysis.

This module provides shared geographic calculations used across
hotspot detection, proximity queries, and temporal-spatial analysis.

Consolidates previously duplicated code from hotspot_detector.py
and proximity_service.py.
"""

import math
from typing import Tuple

# Earth radius in kilometers (WGS84 mean radius)
EARTH_RADIUS_KM = 6371.0

# Nepal official boundaries (for validation)
# Nepal spans 26.347-30.447N latitude, 80.058-88.201E longitude
NEPAL_BOUNDS = {
    'min_lat': 26.347,
    'max_lat': 30.447,
    'min_lng': 80.058,
    'max_lng': 88.201,
}

# Slightly relaxed bounds for validation (allows small buffer)
NEPAL_BOUNDS_RELAXED = {
    'min_lat': 26.3,
    'max_lat': 30.5,
    'min_lng': 80.0,
    'max_lng': 88.3,
}


def haversine_distance(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> float:
    """Calculate great-circle distance between two points in kilometers.

    Uses the Haversine formula for spherical Earth approximation.
    Accuracy: ~0.3% error due to Earth's ellipsoidal shape.

    Args:
        lat1, lng1: First point coordinates (degrees)
        lat2, lng2: Second point coordinates (degrees)

    Returns:
        Distance in kilometers
    """
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)

    dlat = lat2_r - lat1_r
    dlng = lng2_r - lng1_r

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))

    return EARTH_RADIUS_KM * c


def calculate_bearing(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> float:
    """Calculate compass bearing from point 1 to point 2.

    Args:
        lat1, lng1: Starting point coordinates (degrees)
        lat2, lng2: Ending point coordinates (degrees)

    Returns:
        Bearing in degrees (0-360, where 0 is North)
    """
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)

    dlng = lng2_r - lng1_r

    x = math.sin(dlng) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlng)

    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


def bearing_to_direction(bearing: float) -> str:
    """Convert bearing degrees to compass direction.

    Args:
        bearing: Bearing in degrees (0-360)

    Returns:
        Compass direction string (N, NE, E, SE, S, SW, W, NW)
    """
    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    index = round(bearing / 45) % 8
    return directions[index]


def is_within_nepal(lat: float, lng: float, buffer_km: float = 0.0) -> bool:
    """Check if coordinates are within Nepal bounds (with optional buffer).

    Args:
        lat: Latitude in degrees
        lng: Longitude in degrees
        buffer_km: Buffer distance in km (converted to approximate degrees)

    Returns:
        True if within bounds, False otherwise
    """
    buffer_deg = buffer_km / 111.0  # Approximate km to degrees
    return (
        NEPAL_BOUNDS_RELAXED['min_lat'] - buffer_deg <= lat <= NEPAL_BOUNDS_RELAXED['max_lat'] + buffer_deg and
        NEPAL_BOUNDS_RELAXED['min_lng'] - buffer_deg <= lng <= NEPAL_BOUNDS_RELAXED['max_lng'] + buffer_deg
    )


def calculate_geodesic_area(
    min_lat: float, max_lat: float, min_lng: float, max_lng: float
) -> float:
    """Calculate geodesic area of a bounding box in km².

    Uses spherical approximation: A = R² × |sin(lat2) - sin(lat1)| × |lng2 - lng1|

    This is more accurate than flat-plane width × height calculation,
    which has 12-15% error at Nepal latitudes.

    Args:
        min_lat, max_lat: Latitude bounds in degrees
        min_lng, max_lng: Longitude bounds in degrees

    Returns:
        Area in square kilometers
    """
    lat1_rad = math.radians(min_lat)
    lat2_rad = math.radians(max_lat)
    lng_diff_rad = math.radians(max_lng - min_lng)

    area = EARTH_RADIUS_KM**2 * abs(math.sin(lat2_rad) - math.sin(lat1_rad)) * abs(lng_diff_rad)
    return max(area, 0.01)  # Avoid zero area


def calculate_centroid(coordinates: list[Tuple[float, float]]) -> Tuple[float, float]:
    """Calculate geographic centroid of a set of points.

    Uses simple arithmetic mean. For more accurate results with
    large geographic areas, consider using spherical centroid.

    Args:
        coordinates: List of (lat, lng) tuples

    Returns:
        (centroid_lat, centroid_lng) tuple
    """
    if not coordinates:
        return (0.0, 0.0)

    lats = [c[0] for c in coordinates]
    lngs = [c[1] for c in coordinates]

    return (sum(lats) / len(lats), sum(lngs) / len(lngs))
