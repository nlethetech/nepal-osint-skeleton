"""Pydantic schemas for Anomaly Detection API."""
from datetime import date, datetime
from typing import Optional, List, Dict
from enum import Enum

from pydantic import BaseModel, Field


# ============================================================
# Enums
# ============================================================

class AnomalySeverity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class AnomalyType(str, Enum):
    SAME_DAY_CLUSTER = "same_day_cluster"
    RAPID_DIRECTOR_CHANGE = "rapid_director_change"
    NON_FILER_CLUSTER = "non_filer_cluster"
    PAN_ANOMALY = "pan_anomaly"


# ============================================================
# Base
# ============================================================

class AnomalyBase(BaseModel):
    """Base anomaly record."""
    type: AnomalyType
    severity: AnomalySeverity
    title: str
    description: str
    entities: List[str] = Field(default_factory=list, description="Entity IDs involved")


# ============================================================
# Same-Day Registration Clusters
# ============================================================

class SameDayCompany(BaseModel):
    """Company within a same-day registration cluster."""
    id: str
    name_english: str
    registration_number: int
    pan: Optional[str] = None
    company_type_category: Optional[str] = None


class SameDayCluster(AnomalyBase):
    """Cluster of companies registered at the same address on the same day."""
    type: AnomalyType = AnomalyType.SAME_DAY_CLUSTER
    registration_date: str = Field(description="Date (AD) of registration")
    address: str
    company_count: int
    companies: List[SameDayCompany] = Field(default_factory=list)


# ============================================================
# Rapid Director Changes
# ============================================================

class RapidDirectorChange(AnomalyBase):
    """Director appointed and resigned within a short period."""
    type: AnomalyType = AnomalyType.RAPID_DIRECTOR_CHANGE
    company_id: str
    company_name: str
    director_name: str
    director_role: Optional[str] = None
    appointed_date: Optional[str] = None
    resigned_date: Optional[str] = None
    duration_days: int


# ============================================================
# Non-Filer Clusters
# ============================================================

class NonFilerClusterCompany(BaseModel):
    """Company within a non-filer cluster."""
    id: str
    name_english: str
    pan: Optional[str] = None
    is_non_filer: bool


class NonFilerCluster(AnomalyBase):
    """Address where majority of companies are IRD non-filers."""
    type: AnomalyType = AnomalyType.NON_FILER_CLUSTER
    address: str
    total_companies: int
    non_filer_count: int
    non_filer_pct: float = Field(description="Percentage of non-filers at this address")
    companies: List[NonFilerClusterCompany] = Field(default_factory=list)


# ============================================================
# PAN Anomalies
# ============================================================

class PANAnomalyCompany(BaseModel):
    """Company linked to an anomalous PAN."""
    id: str
    name_english: str
    registration_number: int
    company_address: Optional[str] = None


class PANAnomaly(AnomalyBase):
    """PAN linked to unusually many companies."""
    type: AnomalyType = AnomalyType.PAN_ANOMALY
    pan: str
    company_count: int
    companies: List[PANAnomalyCompany] = Field(default_factory=list)


# ============================================================
# Summary & Full Scan
# ============================================================

class AnomalySummary(BaseModel):
    """Aggregate counts of all anomaly types."""
    same_day_clusters: int = 0
    rapid_director_changes: int = 0
    non_filer_clusters: int = 0
    pan_anomalies: int = 0
    total: int = 0


class AnomalyScanResult(BaseModel):
    """Full anomaly scan result combining all detector outputs."""
    summary: AnomalySummary
    same_day_clusters: List[SameDayCluster] = Field(default_factory=list)
    rapid_director_changes: List[RapidDirectorChange] = Field(default_factory=list)
    non_filer_clusters: List[NonFilerCluster] = Field(default_factory=list)
    pan_anomalies: List[PANAnomaly] = Field(default_factory=list)
    scanned_at: Optional[datetime] = None
