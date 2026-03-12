"""Proximity query service using Haversine distance.

Provides radius-based spatial queries to find events within
a specified distance from a center point.
"""

import math
from typing import List, Dict, Any, Optional, Tuple

# Earth radius in kilometers
EARTH_RADIUS_KM = 6371.0


def haversine_distance(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> float:
    """Calculate great-circle distance between two points in kilometers.

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
        lat1, lng1: Origin point coordinates (degrees)
        lat2, lng2: Destination point coordinates (degrees)

    Returns:
        Bearing in degrees (0-360, where 0=N, 90=E, 180=S, 270=W)
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
        Compass direction (N, NE, E, SE, S, SW, W, NW)
    """
    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    index = round(bearing / 45) % 8
    return directions[index]


class ProximityService:
    """Service for radius-based event queries."""

    def find_within_radius(
        self,
        events: List[Dict[str, Any]],
        center_lat: float,
        center_lng: float,
        radius_km: float,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Find events within radius of a center point.

        Args:
            events: List of event dicts with coordinates
            center_lat: Center latitude
            center_lng: Center longitude
            radius_km: Search radius in kilometers
            limit: Maximum number of results (optional)

        Returns:
            Dict with events, stats, and query parameters
        """
        results = []

        for event in events:
            coords = event.get("coordinates", [])
            if len(coords) < 2:
                continue

            lng, lat = coords[0], coords[1]

            # Calculate distance from center
            distance = haversine_distance(center_lat, center_lng, lat, lng)

            if distance <= radius_km:
                # Calculate bearing from center
                bearing = calculate_bearing(center_lat, center_lng, lat, lng)
                direction = bearing_to_direction(bearing)

                results.append({
                    **event,
                    "distance_km": round(distance, 2),
                    "bearing_deg": round(bearing, 1),
                    "direction": direction,
                })

        # Sort by distance
        results.sort(key=lambda x: x["distance_km"])

        # Apply limit
        if limit and len(results) > limit:
            results = results[:limit]

        # Find nearest and farthest
        nearest = results[0] if results else None
        farthest = results[-1] if results else None

        return {
            "center": [center_lng, center_lat],  # GeoJSON format
            "radius_km": radius_km,
            "events": results,
            "total_found": len(results),
            "nearest_event": nearest,
            "farthest_event": farthest,
        }

    def find_events_near_each_other(
        self,
        events: List[Dict[str, Any]],
        max_distance_km: float = 10.0,
    ) -> List[Tuple[Dict[str, Any], Dict[str, Any], float]]:
        """Find pairs of events that are close to each other.

        Args:
            events: List of event dicts with coordinates
            max_distance_km: Maximum distance to consider as "near"

        Returns:
            List of (event1, event2, distance_km) tuples
        """
        pairs = []

        # Extract events with valid coordinates
        valid_events = []
        for event in events:
            coords = event.get("coordinates", [])
            if len(coords) >= 2:
                valid_events.append({
                    **event,
                    "_lat": coords[1],
                    "_lng": coords[0],
                })

        # Find pairs within distance
        n = len(valid_events)
        for i in range(n):
            for j in range(i + 1, n):
                dist = haversine_distance(
                    valid_events[i]["_lat"], valid_events[i]["_lng"],
                    valid_events[j]["_lat"], valid_events[j]["_lng"],
                )
                if dist <= max_distance_km:
                    pairs.append((valid_events[i], valid_events[j], round(dist, 2)))

        # Sort by distance
        pairs.sort(key=lambda x: x[2])

        return pairs
