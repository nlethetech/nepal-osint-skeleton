"""Hotspot detection service using hierarchical clustering.

Uses scipy for DBSCAN-style clustering with Haversine distance.
Identifies geographic clusters of events (hotspots) for spatial analysis.
"""

import math
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime
from collections import Counter

import numpy as np

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


def haversine_distance_matrix(coordinates: np.ndarray) -> np.ndarray:
    """Compute pairwise Haversine distance matrix.

    Args:
        coordinates: Array of shape (n, 2) with [lat, lng] rows

    Returns:
        Distance matrix of shape (n, n) in kilometers
    """
    n = len(coordinates)
    dist_matrix = np.zeros((n, n))

    for i in range(n):
        for j in range(i + 1, n):
            dist = haversine_distance(
                coordinates[i, 0], coordinates[i, 1],
                coordinates[j, 0], coordinates[j, 1]
            )
            dist_matrix[i, j] = dist
            dist_matrix[j, i] = dist

    return dist_matrix


class HotspotDetector:
    """Service for detecting geographic hotspots using clustering.

    Uses a simple DBSCAN-style algorithm:
    1. Build distance matrix using Haversine formula
    2. Find core points (points with >= min_samples neighbors within eps_km)
    3. Expand clusters from core points
    4. Mark remaining points as noise
    """

    def __init__(self, eps_km: float = 10.0, min_samples: int = 3):
        """Initialize hotspot detector.

        Args:
            eps_km: Maximum distance between points in same cluster (km).
                   Default 10km is appropriate for Nepal's geography where
                   districts average ~30km across. Previous default of 25km
                   was too broad and clustered entire districts together.
            min_samples: Minimum points required to form a cluster
        """
        self.eps_km = eps_km
        self.min_samples = min_samples

    def detect_hotspots(
        self,
        events: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Detect hotspot clusters in events.

        Args:
            events: List of event dicts with coordinates

        Returns:
            Dict with clusters, stats, and parameters
        """
        # Filter events with valid coordinates
        valid_events = []
        for event in events:
            coords = event.get("coordinates", [])
            if len(coords) >= 2:
                lng, lat = coords[0], coords[1]
                # Validate Nepal coordinates (precise bounds)
                # Nepal spans 26.347-30.447N latitude, 80.058-88.201E longitude
                # Previous bounds (26-31, 80-89) incorrectly included India/Tibet/Bangladesh
                if 26.3 <= lat <= 30.5 and 80.0 <= lng <= 88.3:
                    valid_events.append({
                        **event,
                        "lat": lat,
                        "lng": lng,
                    })

        if len(valid_events) < self.min_samples:
            return {
                "clusters": [],
                "total_events_analyzed": len(valid_events),
                "clustered_events": 0,
                "noise_events": len(valid_events),
                "parameters": {
                    "eps_km": self.eps_km,
                    "min_samples": self.min_samples,
                },
            }

        # Extract coordinates
        coordinates = np.array([[e["lat"], e["lng"]] for e in valid_events])

        # Run clustering
        labels = self._dbscan_clustering(coordinates)

        # Compute cluster statistics
        clusters = self._compute_cluster_stats(valid_events, labels)

        # Count clustered vs noise
        clustered_count = sum(1 for label in labels if label >= 0)
        noise_count = sum(1 for label in labels if label < 0)

        return {
            "clusters": clusters,
            "total_events_analyzed": len(valid_events),
            "clustered_events": clustered_count,
            "noise_events": noise_count,
            "parameters": {
                "eps_km": self.eps_km,
                "min_samples": self.min_samples,
            },
        }

    def _dbscan_clustering(self, coordinates: np.ndarray) -> np.ndarray:
        """Perform DBSCAN-style clustering on coordinates.

        Args:
            coordinates: Array of [lat, lng] pairs

        Returns:
            Array of cluster labels (-1 for noise)
        """
        n = len(coordinates)
        labels = np.full(n, -1)  # -1 means noise/unassigned
        cluster_id = 0

        # Compute distance matrix
        dist_matrix = haversine_distance_matrix(coordinates)

        # Find neighbors for each point
        neighbors = []
        for i in range(n):
            point_neighbors = np.where(dist_matrix[i] <= self.eps_km)[0]
            neighbors.append(point_neighbors)

        # Find core points (points with enough neighbors)
        core_points = set()
        for i in range(n):
            if len(neighbors[i]) >= self.min_samples:
                core_points.add(i)

        # Expand clusters from core points
        visited = set()

        for point in core_points:
            if point in visited:
                continue

            # Start new cluster
            cluster = set()
            queue = [point]

            while queue:
                current = queue.pop(0)
                if current in visited:
                    continue

                visited.add(current)
                cluster.add(current)

                # If current is a core point, add its neighbors to queue
                # BUG FIX: Previously had `cluster.add(neighbor)` here which incorrectly
                # added unvisited neighbors directly to the cluster. In DBSCAN, neighbors
                # should only be added to the queue for processing - they join the cluster
                # when they are actually visited (popped from queue above).
                if current in core_points:
                    for neighbor in neighbors[current]:
                        if neighbor not in visited:
                            queue.append(neighbor)
                        # REMOVED: cluster.add(neighbor) - this was the bug

            # Assign cluster label
            for p in cluster:
                labels[p] = cluster_id

            cluster_id += 1

        return labels

    def _compute_cluster_stats(
        self,
        events: List[Dict[str, Any]],
        labels: np.ndarray,
    ) -> List[Dict[str, Any]]:
        """Compute statistics for each cluster.

        Args:
            events: List of event dicts with lat/lng
            labels: Cluster labels array

        Returns:
            List of cluster stat dicts
        """
        clusters = []
        unique_labels = set(labels)

        for label in unique_labels:
            if label < 0:  # Skip noise
                continue

            # Get cluster members
            mask = labels == label
            cluster_events = [e for e, m in zip(events, mask) if m]

            if not cluster_events:
                continue

            # Compute centroid
            lats = [e["lat"] for e in cluster_events]
            lngs = [e["lng"] for e in cluster_events]
            centroid_lat = sum(lats) / len(lats)
            centroid_lng = sum(lngs) / len(lngs)

            # Bounding box
            bounding_box = [
                min(lngs),  # min_lng
                min(lats),  # min_lat
                max(lngs),  # max_lng
                max(lats),  # max_lat
            ]

            # Category breakdown
            categories = [e.get("category", "GENERAL").upper() for e in cluster_events]
            category_counts = Counter(categories)
            dominant_category = category_counts.most_common(1)[0][0]

            # Severity breakdown
            severities = [e.get("severity", "MEDIUM").upper() for e in cluster_events]
            severity_breakdown = dict(Counter(severities))

            # Districts
            districts = list(set(e.get("district", "") for e in cluster_events if e.get("district")))

            # Time range
            timestamps = []
            for e in cluster_events:
                ts = e.get("timestamp")
                if ts:
                    try:
                        if isinstance(ts, str):
                            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        else:
                            dt = ts
                        timestamps.append(dt)
                    except (ValueError, AttributeError):
                        pass

            time_range = {}
            if timestamps:
                time_range = {
                    "earliest": min(timestamps).isoformat(),
                    "latest": max(timestamps).isoformat(),
                }

            # Density score (events per 100 sq km)
            # Use geodesic area calculation (not flat-plane width * height)
            # Previous calculation had 12-15% error at Nepal latitudes
            min_lat, max_lat = bounding_box[1], bounding_box[3]
            min_lng, max_lng = bounding_box[0], bounding_box[2]

            # Spherical area formula: A = R² × |sin(lat2) - sin(lat1)| × |lng2 - lng1|
            lat1_rad = math.radians(min_lat)
            lat2_rad = math.radians(max_lat)
            lng_diff_rad = math.radians(max_lng - min_lng)
            area_sq_km = EARTH_RADIUS_KM**2 * abs(math.sin(lat2_rad) - math.sin(lat1_rad)) * abs(lng_diff_rad)
            area_sq_km = max(area_sq_km, 0.01)  # Avoid division by zero

            density_score = (len(cluster_events) / area_sq_km) * 100

            clusters.append({
                "cluster_id": int(label),
                "centroid": [centroid_lng, centroid_lat],  # GeoJSON format [lng, lat]
                "member_count": len(cluster_events),
                "events": [e.get("id", "") for e in cluster_events],
                "bounding_box": bounding_box,
                "dominant_category": dominant_category,
                "severity_breakdown": severity_breakdown,
                "districts": districts,
                "time_range": time_range,
                "density_score": round(density_score, 2),
            })

        # Sort by member count descending
        clusters.sort(key=lambda c: c["member_count"], reverse=True)

        return clusters
