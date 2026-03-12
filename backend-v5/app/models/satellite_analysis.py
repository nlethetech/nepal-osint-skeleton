"""Satellite Analysis models - GEE analysis results, subscriptions, and change alerts."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, Boolean, Integer, Float, Index, func, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AnalysisType(str, Enum):
    """Type of satellite analysis."""
    FLOOD_EXTENT = "flood_extent"
    LANDSLIDE = "landslide"
    NDVI = "ndvi"
    PRECIPITATION = "precipitation"
    TEMPERATURE = "temperature"
    BEFORE_AFTER = "before_after"


class AnalysisStatus(str, Enum):
    """Status of satellite analysis job."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class DetectionType(str, Enum):
    """Type of change detection."""
    FLOOD = "flood"
    LANDSLIDE = "landslide"
    VEGETATION_LOSS = "vegetation-loss"
    URBAN_EXPANSION = "urban-expansion"


class AlertSeverity(str, Enum):
    """Severity level for change alerts."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class SatelliteAnalysis(Base):
    """Satellite analysis request and results.

    Stores analysis parameters, status, and results for:
    - Flood extent detection
    - Landslide detection
    - NDVI analysis
    - Precipitation analysis
    - Temperature analysis
    - Before/after comparison imagery
    """

    __tablename__ = "satellite_analyses"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Analysis type and status
    analysis_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="flood_extent|landslide|ndvi|precipitation|temperature|before_after",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=AnalysisStatus.PENDING.value,
        index=True,
        comment="pending|processing|completed|failed",
    )

    # Analysis parameters
    parameters: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="Analysis input parameters",
    )

    # Bounding box (stored as array for indexing)
    bbox_min_lng: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_min_lat: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_max_lng: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_max_lat: Mapped[float] = mapped_column(Float, nullable=False)

    # Location context
    district: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    province: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Results
    results: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Analysis results (structure depends on analysis_type)",
    )
    tile_url_template: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="GEE tile URL template for visualization",
    )
    geojson: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="GeoJSON result (e.g., flood polygon)",
    )

    # Error handling
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_satellite_analysis_type_status", "analysis_type", "status"),
        Index("idx_satellite_analysis_bbox", "bbox_min_lng", "bbox_min_lat", "bbox_max_lng", "bbox_max_lat"),
        Index("idx_satellite_analysis_created", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<SatelliteAnalysis {self.id}: {self.analysis_type} - {self.status}>"


class ChangeDetectionSubscription(Base):
    """Subscription for automated change detection monitoring.

    Users/system can subscribe regions for automated monitoring
    of flood, landslide, and vegetation changes.
    """

    __tablename__ = "change_detection_subscriptions"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Region definition
    region_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="bbox|district|polygon",
    )
    region_value: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="Region definition (coords, district name, or GeoJSON)",
    )
    region_name: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="Human-readable name for the region",
    )

    # What to detect
    detection_types: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        comment="List of detection types: flood, landslide, vegetation-loss",
    )

    # Detection parameters
    sensitivity: Mapped[float] = mapped_column(
        Float,
        default=0.5,
        nullable=False,
        comment="Detection sensitivity (0.1-1.0)",
    )
    min_area_km2: Mapped[float] = mapped_column(
        Float,
        default=1.0,
        nullable=False,
        comment="Minimum area for alerts",
    )

    # Baseline
    baseline_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Baseline date for comparison (defaults to 30 days ago)",
    )

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
    )

    # User who created (nullable for system subscriptions)
    created_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    alerts = relationship("ChangeDetectionAlert", back_populates="subscription")

    __table_args__ = (
        Index("idx_change_subscription_active", "is_active", "last_checked_at"),
    )

    def __repr__(self) -> str:
        return f"<ChangeDetectionSubscription {self.id}: {self.region_type}={self.region_value[:30]}>"


class ChangeDetectionAlert(Base):
    """Alert generated by automated change detection.

    When the change detector finds significant changes in a subscribed
    region, it creates an alert with details about the detection.
    """

    __tablename__ = "change_detection_alerts"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Link to subscription (nullable if deleted)
    subscription_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("change_detection_subscriptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Detection details
    detection_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        index=True,
        comment="flood|landslide|vegetation-loss|urban-expansion",
    )
    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
        comment="critical|high|medium|low",
    )
    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Detection confidence (0-1)",
    )

    # Location
    center_lng: Mapped[float] = mapped_column(Float, nullable=False)
    center_lat: Mapped[float] = mapped_column(Float, nullable=False)
    area_km2: Mapped[float] = mapped_column(Float, nullable=False)
    district: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)

    # Imagery URLs
    before_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    difference_tile_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Description and details
    description: Mapped[str] = mapped_column(Text, nullable=False)
    geojson: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="GeoJSON of affected area",
    )

    # Analysis reference
    analysis_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("satellite_analyses.id", ondelete="SET NULL"),
        nullable=True,
    )

    # User interaction
    is_acknowledged: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
    )
    acknowledged_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Timestamps
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )

    # Relationships
    subscription = relationship("ChangeDetectionSubscription", back_populates="alerts")

    __table_args__ = (
        Index("idx_change_alert_type_severity", "detection_type", "severity"),
        Index("idx_change_alert_detected", "detected_at"),
        Index("idx_change_alert_coords", "center_lng", "center_lat"),
        Index("idx_change_alert_unacknowledged", "is_acknowledged", "detected_at"),
    )

    def __repr__(self) -> str:
        return f"<ChangeDetectionAlert {self.id}: {self.detection_type} - {self.severity}>"

    @classmethod
    def calculate_severity(
        cls,
        detection_type: str,
        area_km2: float,
    ) -> str:
        """Calculate severity based on detection type and affected area.

        Uses thresholds appropriate for Nepal context:
        - Flood: Areas >200 km2 are critical (river basin scale)
        - Landslide: Areas >2 km2 are critical (major landslide)
        - Vegetation loss: Areas >500 km2 are critical (regional deforestation)
        """
        thresholds = {
            "flood": {"critical": 200, "high": 50, "medium": 10, "low": 1},
            "landslide": {"critical": 2, "high": 0.5, "medium": 0.1, "low": 0.01},
            "vegetation-loss": {"critical": 500, "high": 100, "medium": 25, "low": 5},
            "urban-expansion": {"critical": 50, "high": 20, "medium": 5, "low": 1},
        }

        type_thresholds = thresholds.get(
            detection_type,
            {"critical": 200, "high": 50, "medium": 10, "low": 1}
        )

        if area_km2 >= type_thresholds["critical"]:
            return AlertSeverity.CRITICAL.value
        elif area_km2 >= type_thresholds["high"]:
            return AlertSeverity.HIGH.value
        elif area_km2 >= type_thresholds["medium"]:
            return AlertSeverity.MEDIUM.value
        else:
            return AlertSeverity.LOW.value
