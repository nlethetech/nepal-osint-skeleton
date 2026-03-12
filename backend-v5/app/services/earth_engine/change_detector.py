"""Automated satellite change detection service.

Monitors regions for significant changes and generates alerts.
Runs as a background task via the scheduler.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime_bus import publish_news

from .gee_client import GEEClient
from .imagery_service import ImageryService
from .environmental_service import EnvironmentalService

logger = logging.getLogger(__name__)


@dataclass
class ChangeAlert:
    """A detected change alert."""
    id: str
    detection_type: str  # flood, landslide, vegetation-loss, urban-expansion
    severity: str  # low, medium, high, critical
    confidence: float
    district: Optional[str]
    center_lng: float
    center_lat: float
    area_km2: float
    before_image_url: Optional[str]
    after_image_url: Optional[str]
    difference_tile_url: Optional[str]
    detected_at: datetime
    description: str
    geojson: Optional[dict[str, Any]]


@dataclass
class ChangeDetectionSubscription:
    """A subscription for change monitoring."""
    id: str
    region_type: str  # district, bbox, polygon
    region_value: str  # District name, coords, or GeoJSON
    detection_types: list[str]
    sensitivity: float
    min_area_km2: float
    is_active: bool
    last_checked_at: Optional[datetime]
    baseline_date: Optional[datetime]


class ChangeDetectorService:
    """Service for automated satellite change detection."""

    # Severity thresholds
    SEVERITY_THRESHOLDS = {
        "flood": {
            "low": 1,      # km2
            "medium": 10,
            "high": 50,
            "critical": 200,
        },
        "landslide": {
            "low": 0.01,
            "medium": 0.1,
            "high": 0.5,
            "critical": 2,
        },
        "vegetation-loss": {
            "low": 5,
            "medium": 25,
            "high": 100,
            "critical": 500,
        },
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.imagery_service = ImageryService()
        self.environmental_service = EnvironmentalService()

    async def run_detection_cycle(self) -> dict[str, int]:
        """Run detection for all active subscriptions.

        Returns:
            Stats dict with counts of alerts created, etc.
        """
        stats = {
            "subscriptions_checked": 0,
            "alerts_created": 0,
            "errors": 0,
        }

        # Get active subscriptions from database
        subscriptions = await self._get_active_subscriptions()

        for subscription in subscriptions:
            try:
                alerts = await self.detect_changes(subscription)
                stats["subscriptions_checked"] += 1

                for alert in alerts:
                    await self._save_alert(alert, subscription.id)
                    stats["alerts_created"] += 1

                    # Broadcast significant alerts
                    if alert.severity in ["high", "critical"]:
                        await self._broadcast_alert(alert)

                # Update last checked timestamp
                await self._update_subscription_checked(subscription.id)

            except Exception as e:
                logger.exception(f"Error processing subscription {subscription.id}: {e}")
                stats["errors"] += 1

        logger.info(
            f"Change detection cycle complete: "
            f"{stats['subscriptions_checked']} checked, "
            f"{stats['alerts_created']} alerts, "
            f"{stats['errors']} errors"
        )

        return stats

    async def detect_changes(
        self,
        subscription: ChangeDetectionSubscription,
    ) -> list[ChangeAlert]:
        """Detect changes for a single subscription.

        Args:
            subscription: The subscription to check

        Returns:
            List of detected change alerts
        """
        alerts = []

        # Parse region
        bbox = self._parse_region(subscription)
        if bbox is None:
            logger.warning(f"Could not parse region for subscription {subscription.id}")
            return alerts

        # Determine date range
        now = datetime.now(timezone.utc)
        after_date = now.strftime("%Y-%m-%d")

        # Use baseline or 30 days ago
        if subscription.baseline_date:
            before_date = subscription.baseline_date.strftime("%Y-%m-%d")
        else:
            before_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")

        # Run detection for each type
        for detection_type in subscription.detection_types:
            try:
                type_alerts = await self._run_detection_type(
                    detection_type=detection_type,
                    bbox=bbox,
                    before_date=before_date,
                    after_date=after_date,
                    sensitivity=subscription.sensitivity,
                    min_area_km2=subscription.min_area_km2,
                )
                alerts.extend(type_alerts)
            except Exception as e:
                logger.exception(f"Error in {detection_type} detection: {e}")

        return alerts

    async def _run_detection_type(
        self,
        detection_type: str,
        bbox: list[float],
        before_date: str,
        after_date: str,
        sensitivity: float,
        min_area_km2: float,
    ) -> list[ChangeAlert]:
        """Run detection for a specific type."""
        alerts = []

        if detection_type == "flood":
            result = await self.imagery_service.detect_flood_extent(
                bbox=bbox,
                before_date=before_date,
                after_date=after_date,
            )

            if result.flooded_area_km2 >= min_area_km2:
                severity = self._calculate_severity(
                    detection_type, result.flooded_area_km2
                )
                alerts.append(
                    ChangeAlert(
                        id=str(uuid4()),
                        detection_type="flood",
                        severity=severity,
                        confidence=0.8,
                        district=None,  # Could lookup from coordinates
                        center_lng=(bbox[0] + bbox[2]) / 2,
                        center_lat=(bbox[1] + bbox[3]) / 2,
                        area_km2=result.flooded_area_km2,
                        before_image_url=result.before_image_url,
                        after_image_url=result.after_image_url,
                        difference_tile_url=result.tile_url_template,
                        detected_at=datetime.now(timezone.utc),
                        description=f"Detected {result.flooded_area_km2:.2f} km2 of new flooding",
                        geojson=result.geojson,
                    )
                )

        elif detection_type == "landslide":
            result = await self.imagery_service.detect_landslides(
                bbox=bbox,
                before_date=before_date,
                after_date=after_date,
                sensitivity=sensitivity,
            )

            if result.total_affected_km2 >= min_area_km2:
                severity = self._calculate_severity(
                    detection_type, result.total_affected_km2
                )
                for detection in result.detections:
                    alerts.append(
                        ChangeAlert(
                            id=str(uuid4()),
                            detection_type="landslide",
                            severity=severity,
                            confidence=detection.confidence,
                            district=None,
                            center_lng=detection.center[0],
                            center_lat=detection.center[1],
                            area_km2=detection.area_km2,
                            before_image_url=None,
                            after_image_url=None,
                            difference_tile_url=result.tile_url_template,
                            detected_at=datetime.now(timezone.utc),
                            description=f"Potential landslide: {detection.area_km2:.4f} km2 vegetation loss on steep terrain",
                            geojson=detection.geojson,
                        )
                    )

        elif detection_type == "vegetation-loss":
            # Use NDVI analysis
            result = await self.environmental_service.get_ndvi(
                bbox=bbox,
                date=after_date,
            )

            # Check for significant negative anomaly
            if result.anomaly_pct < -20:  # 20% below normal
                # Estimate affected area (rough calculation)
                area_km2 = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) * 111 * 111 * 0.2
                severity = self._calculate_severity(detection_type, area_km2)

                alerts.append(
                    ChangeAlert(
                        id=str(uuid4()),
                        detection_type="vegetation-loss",
                        severity=severity,
                        confidence=0.7,
                        district=None,
                        center_lng=(bbox[0] + bbox[2]) / 2,
                        center_lat=(bbox[1] + bbox[3]) / 2,
                        area_km2=area_km2,
                        before_image_url=None,
                        after_image_url=None,
                        difference_tile_url=result.tile_url_template,
                        detected_at=datetime.now(timezone.utc),
                        description=f"Vegetation anomaly: NDVI {result.anomaly_pct:.1f}% below normal",
                        geojson=None,
                    )
                )

        return alerts

    def _calculate_severity(self, detection_type: str, area_km2: float) -> str:
        """Calculate severity based on affected area."""
        thresholds = self.SEVERITY_THRESHOLDS.get(
            detection_type,
            {"low": 1, "medium": 10, "high": 50, "critical": 200},
        )

        if area_km2 >= thresholds["critical"]:
            return "critical"
        elif area_km2 >= thresholds["high"]:
            return "high"
        elif area_km2 >= thresholds["medium"]:
            return "medium"
        else:
            return "low"

    def _parse_region(
        self,
        subscription: ChangeDetectionSubscription,
    ) -> Optional[list[float]]:
        """Parse region definition to bbox."""
        if subscription.region_type == "bbox":
            try:
                coords = [float(x) for x in subscription.region_value.split(",")]
                if len(coords) == 4:
                    return coords
            except ValueError:
                pass

        elif subscription.region_type == "district":
            # TODO: Look up district bounds
            # For now, return Nepal bbox as fallback
            return [80.0, 26.3, 88.2, 30.5]

        return None

    async def _get_active_subscriptions(self) -> list[ChangeDetectionSubscription]:
        """Get active subscriptions from database."""
        # TODO: Implement actual database query
        # For now, return empty list (no subscriptions yet)
        return []

    async def _save_alert(self, alert: ChangeAlert, subscription_id: str):
        """Save alert to database."""
        # TODO: Implement database insert
        logger.info(
            f"Alert created: {alert.detection_type} - {alert.severity} - "
            f"{alert.area_km2:.4f} km2"
        )

    async def _update_subscription_checked(self, subscription_id: str):
        """Update subscription's last_checked_at timestamp."""
        # TODO: Implement database update
        pass

    async def _broadcast_alert(self, alert: ChangeAlert):
        """Publish alert to Redis for WebSocket broadcast."""
        try:
            await publish_news(
                {
                    "type": "satellite_alert",
                    "timestamp": alert.detected_at.isoformat(),
                    "data": {
                        "id": alert.id,
                        "detection_type": alert.detection_type,
                        "severity": alert.severity,
                        "center": [alert.center_lng, alert.center_lat],
                        "area_km2": alert.area_km2,
                        "description": alert.description,
                        "detected_at": alert.detected_at.isoformat(),
                    },
                }
            )
            logger.info(f"Broadcast {alert.severity} {alert.detection_type} alert")
        except Exception as e:
            logger.warning(f"Could not broadcast alert: {e}")


# Default subscriptions for Nepal-wide monitoring
DEFAULT_NEPAL_SUBSCRIPTIONS = [
    {
        "id": "nepal-flood-monitoring",
        "region_type": "bbox",
        "region_value": "80.0,26.3,88.2,30.5",
        "detection_types": ["flood"],
        "sensitivity": 0.5,
        "min_area_km2": 5.0,
    },
    {
        "id": "nepal-landslide-monitoring",
        "region_type": "bbox",
        "region_value": "83.0,27.5,87.0,29.5",  # Central hills
        "detection_types": ["landslide"],
        "sensitivity": 0.6,
        "min_area_km2": 0.1,
    },
]
