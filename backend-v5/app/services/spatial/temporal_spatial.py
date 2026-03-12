"""Temporal-spatial analysis service.

Provides time-bucketed spatial data for animation and
propagation analysis (how events spread over time and space).
"""

import math
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from collections import defaultdict

from .proximity_service import haversine_distance, calculate_bearing, bearing_to_direction


class TemporalSpatialService:
    """Service for temporal-spatial analysis."""

    def get_temporal_buckets(
        self,
        events: List[Dict[str, Any]],
        hours: int = 48,
        bucket_hours: int = 1,
        include_propagation: bool = False,
    ) -> Dict[str, Any]:
        """Get events organized into time buckets with spatial info.

        Args:
            events: List of event dicts with coordinates and timestamps
            hours: Total time window in hours
            bucket_hours: Size of each time bucket in hours
            include_propagation: Whether to calculate spread metrics

        Returns:
            Dict with time buckets and optional propagation metrics
        """
        now = datetime.now(timezone.utc)
        start_time = now - timedelta(hours=hours)

        # Parse and filter events with valid timestamps and coordinates
        valid_events = []
        for event in events:
            coords = event.get("coordinates", [])
            if len(coords) < 2:
                continue

            ts = event.get("timestamp")
            if not ts:
                continue

            try:
                if isinstance(ts, str):
                    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                else:
                    dt = ts

                # Ensure timezone aware
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)

                if dt >= start_time:
                    valid_events.append({
                        **event,
                        "_dt": dt,
                        "_lat": coords[1],
                        "_lng": coords[0],
                    })
            except (ValueError, AttributeError):
                continue

        # Sort by timestamp
        valid_events.sort(key=lambda e: e["_dt"])

        # Create time buckets
        num_buckets = math.ceil(hours / bucket_hours)
        buckets = []
        seen_districts: set = set()
        cumulative_centroids = []

        for i in range(num_buckets):
            bucket_start = start_time + timedelta(hours=i * bucket_hours)
            bucket_end = bucket_start + timedelta(hours=bucket_hours)

            # Filter events in this bucket
            bucket_events = [
                e for e in valid_events
                if bucket_start <= e["_dt"] < bucket_end
            ]

            # Calculate centroid
            centroid = None
            if bucket_events:
                lats = [e["_lat"] for e in bucket_events]
                lngs = [e["_lng"] for e in bucket_events]
                centroid = [
                    sum(lngs) / len(lngs),
                    sum(lats) / len(lats),
                ]
                cumulative_centroids.append(centroid)

            # Find new districts in this bucket
            bucket_districts = set(
                e.get("district", "") for e in bucket_events if e.get("district")
            )
            new_districts = list(bucket_districts - seen_districts)
            seen_districts.update(bucket_districts)

            # Simplify event data for response
            simplified_events = [
                {
                    "id": e.get("id", ""),
                    "title": e.get("title", "")[:100],
                    "category": e.get("category", ""),
                    "severity": e.get("severity", ""),
                    "coordinates": e.get("coordinates"),
                    "district": e.get("district"),
                }
                for e in bucket_events
            ]

            buckets.append({
                "bucket_start": bucket_start.isoformat(),
                "bucket_end": bucket_end.isoformat(),
                "events": simplified_events,
                "event_count": len(bucket_events),
                "centroid": centroid,
                "new_districts": new_districts,
            })

        # Calculate propagation metrics if requested
        propagation = None
        if include_propagation and len(cumulative_centroids) >= 2:
            propagation = self._calculate_propagation(
                cumulative_centroids, valid_events, seen_districts
            )

        return {
            "buckets": buckets,
            "time_range": {
                "start": start_time.isoformat(),
                "end": now.isoformat(),
            },
            "total_events": len(valid_events),
            "bucket_hours": bucket_hours,
            "propagation": propagation,
        }

    def _calculate_propagation(
        self,
        centroids: List[List[float]],
        events: List[Dict[str, Any]],
        all_districts: set,
    ) -> Dict[str, Any]:
        """Calculate event propagation/spread metrics.

        Args:
            centroids: List of [lng, lat] centroids over time
            events: All events in time window
            all_districts: Set of all affected districts

        Returns:
            Dict with propagation metrics
        """
        initial_centroid = centroids[0]
        final_centroid = centroids[-1]

        # Calculate spread distance (how far centroid has moved)
        spread_distance = haversine_distance(
            initial_centroid[1], initial_centroid[0],
            final_centroid[1], final_centroid[0],
        )

        # Calculate spread direction
        bearing = calculate_bearing(
            initial_centroid[1], initial_centroid[0],
            final_centroid[1], final_centroid[0],
        )
        spread_direction = bearing_to_direction(bearing)

        # Calculate maximum extent (farthest points from initial centroid)
        max_extent = 0
        for event in events:
            dist = haversine_distance(
                initial_centroid[1], initial_centroid[0],
                event["_lat"], event["_lng"],
            )
            max_extent = max(max_extent, dist)

        # Calculate affected area (convex hull approximation via bounding box)
        if events:
            lats = [e["_lat"] for e in events]
            lngs = [e["_lng"] for e in events]
            width_km = haversine_distance(
                min(lats), min(lngs),
                min(lats), max(lngs),
            )
            height_km = haversine_distance(
                min(lats), min(lngs),
                max(lats), min(lngs),
            )
            affected_area_sq_km = width_km * height_km
        else:
            affected_area_sq_km = 0

        return {
            "initial_centroid": initial_centroid,
            "final_centroid": final_centroid,
            "spread_distance_km": round(spread_distance, 2),
            "spread_direction": spread_direction,
            "bearing_deg": round(bearing, 1),
            "max_extent_km": round(max_extent, 2),
            "affected_area_sq_km": round(affected_area_sq_km, 2),
            "total_districts_affected": len(all_districts),
            "districts": list(all_districts),
        }

    def get_event_spread_sequence(
        self,
        events: List[Dict[str, Any]],
        hours: int = 48,
    ) -> List[Dict[str, Any]]:
        """Get events as a time-ordered sequence for animation.

        Args:
            events: List of event dicts
            hours: Time window

        Returns:
            Time-sorted list of events with cumulative stats
        """
        now = datetime.now(timezone.utc)
        start_time = now - timedelta(hours=hours)

        # Parse and filter
        valid_events = []
        for event in events:
            coords = event.get("coordinates", [])
            if len(coords) < 2:
                continue

            ts = event.get("timestamp")
            if not ts:
                continue

            try:
                if isinstance(ts, str):
                    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                else:
                    dt = ts

                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)

                if dt >= start_time:
                    valid_events.append({
                        "id": event.get("id", ""),
                        "title": event.get("title", ""),
                        "category": event.get("category", ""),
                        "severity": event.get("severity", ""),
                        "coordinates": coords,
                        "district": event.get("district"),
                        "timestamp": dt.isoformat(),
                        "_dt": dt,
                    })
            except (ValueError, AttributeError):
                continue

        # Sort by timestamp
        valid_events.sort(key=lambda e: e["_dt"])

        # Add cumulative stats
        districts_seen = set()
        categories_seen = defaultdict(int)

        for event in valid_events:
            if event.get("district"):
                districts_seen.add(event["district"])
            categories_seen[event.get("category", "GENERAL")] += 1

            event["cumulative_event_count"] = valid_events.index(event) + 1
            event["cumulative_districts"] = len(districts_seen)
            event["category_breakdown"] = dict(categories_seen)

            # Remove internal field
            del event["_dt"]

        return valid_events
