"""Infrastructure status API - derives infrastructure impact from disaster data."""
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.connected_analyst import TradeFact, TradeReport
from app.models.disaster import DisasterIncident

router = APIRouter(prefix="/infrastructure", tags=["infrastructure"])

# Nepal Infrastructure Baseline (Official Statistics)
NEPAL_INFRA = {
    "roads_km": 32_000,       # Total strategic road network in km
    "bridges": 159,           # Major bridges
    "airports": 32,           # 5 international + 27 domestic
    "hospitals": 125,         # Major hospitals
}

# Districts with major airports
AIRPORT_DISTRICTS = [
    "Kathmandu", "Lalitpur", "Kaski", "Rupandehi", "Jhapa",
    "Morang", "Sunsari", "Chitwan", "Kailali", "Bardiya",
    "Dolpa", "Jumla", "Humla", "Mugu", "Bajhang", "Bajura",
    "Darchula", "Taplejung", "Solukhumbu", "Manang", "Mustang"
]

# Hazard types that block roads
ROAD_BLOCKING_HAZARDS = ["flood", "landslide", "avalanche", "earthquake"]

# Hazard types that affect bridges
BRIDGE_HAZARDS = ["flood"]

# High-severity incidents that impact hospital capacity
HOSPITAL_IMPACT_SEVERITIES = ["critical", "high"]

# Friendly names/routes for known customs keys from monthly trade workbooks.
CUSTOMS_DISPLAY_METADATA: dict[str, dict[str, str]] = {
    "BIRGUNJ": {"name": "Birgunj-Raxaul", "route": "Nepal ↔ India"},
    "MECHI": {"name": "Kakarbhitta-Panitanki", "route": "Nepal ↔ India"},
    "TATOPANI": {"name": "Tatopani-Zhangmu", "route": "Nepal ↔ China"},
    "TI_AIRPORT": {"name": "TIA (Tribhuvan Int'l Airport)", "route": "Nepal ↔ Global (Air Cargo)"},
    "GAUTAM BUDDHA AIRPORT": {"name": "Gautam Buddha International Airport", "route": "Nepal ↔ Global (Air Cargo)"},
    "POKHARA": {"name": "Pokhara International Airport", "route": "Nepal ↔ Global (Air Cargo)"},
}

INDIA_BORDER_OFFICES = {
    "BIRGUNJ", "BHAIRAHAWA", "BIRATNAGAR", "MECHI", "NEPALGUNJ", "KAILALI",
    "KRISHNANAGAR", "JALESHWOR", "SUTHAULI", "SUNSARI", "SARLAHI", "KANCHANPUR",
    "JANAKPUR", "GAUR", "MAHESHPAUR", "BHADRAPUR", "SIRAHA", "SATI", "THADHI",
    "RAJBIRAJ", "PASHUPATINAGAR", "TRIVENI",
}

CHINA_BORDER_OFFICES = {"TATOPANI", "RASUWA", "MUSTANG"}

AIR_OFFICES = {"TI_AIRPORT", "GAUTAM BUDDHA AIRPORT", "POKHARA"}


async def count_incidents_by_hazard(
    db: AsyncSession,
    hazard_types: list[str],
    days: int = 7
) -> tuple[int, list[str]]:
    """Count incidents by hazard type and return affected districts."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(
        func.count(DisasterIncident.id),
        func.array_agg(func.distinct(DisasterIncident.district))
    ).where(
        and_(
            DisasterIncident.hazard_type.in_(hazard_types),
            DisasterIncident.incident_on >= cutoff
        )
    )

    result = await db.execute(query)
    row = result.one()
    count = row[0] or 0
    districts = [d for d in (row[1] or []) if d is not None]

    return count, districts


async def count_incidents_in_districts(
    db: AsyncSession,
    districts: list[str],
    days: int = 7
) -> int:
    """Count incidents in specific districts."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Use ILIKE for case-insensitive district matching
    conditions = [DisasterIncident.incident_on >= cutoff]
    district_conditions = []
    for district in districts:
        district_conditions.append(DisasterIncident.district.ilike(f"%{district}%"))

    if district_conditions:
        from sqlalchemy import or_
        conditions.append(or_(*district_conditions))

    query = select(func.count(DisasterIncident.id)).where(and_(*conditions))
    result = await db.execute(query)
    return result.scalar() or 0


async def count_high_severity_incidents(
    db: AsyncSession,
    days: int = 7
) -> tuple[int, int]:
    """Count high-severity incidents and total casualties."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(
        func.count(DisasterIncident.id),
        func.coalesce(func.sum(DisasterIncident.deaths), 0),
        func.coalesce(func.sum(DisasterIncident.injured), 0)
    ).where(
        and_(
            DisasterIncident.incident_on >= cutoff,
            DisasterIncident.severity.in_(HOSPITAL_IMPACT_SEVERITIES)
        )
    )

    result = await db.execute(query)
    row = result.one()
    incident_count = row[0] or 0
    total_casualties = (row[1] or 0) + (row[2] or 0)

    return incident_count, total_casualties


def calculate_status(blocked: int, total: int, close_pct: float = 0.50) -> str:
    """Calculate status based on blocked fraction of total infrastructure.

    - OPEN: no incidents
    - PARTIAL: some incidents, but less than close_pct of total affected
    - CLOSED: close_pct or more of total affected
    """
    if blocked == 0:
        return "OPEN"
    elif blocked / max(total, 1) >= close_pct:
        return "CLOSED"
    else:
        return "PARTIAL"


def calculate_hospital_capacity(casualties: int, base_capacity: int = 125) -> int:
    """Estimate hospital capacity based on casualties needing treatment."""
    # Assume each hospital can handle ~50 additional patients before strain
    # If casualties exceed this, capacity decreases
    max_capacity = base_capacity * 50
    if casualties == 0:
        return 95  # Normal operating capacity

    strain_factor = min(casualties / max_capacity, 0.3)  # Max 30% strain
    return max(60, int(95 - (strain_factor * 100)))


async def aggregate_customs_values_for_report(
    db: AsyncSession,
    report_id,
) -> dict[str, float]:
    """Aggregate monthly trade value by customs office for a single report."""
    rows = await db.execute(
        select(
            TradeFact.customs_office,
            func.coalesce(func.sum(TradeFact.value_npr_thousands), 0.0).label("value_npr_thousands"),
        )
        .where(
            and_(
                TradeFact.report_id == report_id,
                TradeFact.customs_office.isnot(None),
            )
        )
        .group_by(TradeFact.customs_office)
    )
    return {
        str(row.customs_office): float(row.value_npr_thousands or 0.0)
        for row in rows.all()
    }


def _normalize_customs_key(value: str) -> str:
    return value.strip().upper()


def _slugify_customs_id(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "customs"


def _display_name_for_customs(customs_office: str) -> str:
    metadata = CUSTOMS_DISPLAY_METADATA.get(customs_office)
    if metadata and metadata.get("name"):
        return metadata["name"]
    return customs_office.replace("_", " ").title()


def _route_for_customs(customs_office: str) -> str:
    metadata = CUSTOMS_DISPLAY_METADATA.get(customs_office)
    if metadata and metadata.get("route"):
        return metadata["route"]
    if customs_office in AIR_OFFICES:
        return "Nepal ↔ Global (Air Cargo)"
    if customs_office in CHINA_BORDER_OFFICES:
        return "Nepal ↔ China"
    if customs_office in INDIA_BORDER_OFFICES:
        return "Nepal ↔ India"
    return "Nepal ↔ Cross-border"


@router.get("/status")
async def get_infrastructure_status(
    days: int = Query(default=7, ge=1, le=30, description="Days to look back for incidents"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get infrastructure status derived from active disaster incidents.

    - Roads: Affected by floods, landslides, avalanches, earthquakes
    - Bridges: Affected by floods
    - Airports: Incidents in airport districts
    - Hospitals: High-severity incidents impacting capacity
    """

    # Count road-blocking incidents
    road_incidents, road_affected_districts = await count_incidents_by_hazard(
        db, ROAD_BLOCKING_HAZARDS, days
    )

    # Count bridge-affecting incidents (floods)
    bridge_incidents, bridge_affected_districts = await count_incidents_by_hazard(
        db, BRIDGE_HAZARDS, days
    )

    # Count incidents in airport districts
    airport_incidents = await count_incidents_in_districts(
        db, AIRPORT_DISTRICTS, days
    )

    # Count high-severity incidents for hospital impact
    hospital_incidents, total_casualties = await count_high_severity_incidents(db, days)

    # Calculate capacity percentage
    hospital_capacity = calculate_hospital_capacity(total_casualties)

    return {
        "roads": {
            "status": calculate_status(road_incidents, 77, 0.50),  # 77 districts; CLOSED only if 50%+ affected
            "blocked": road_incidents,
            "total": NEPAL_INFRA["roads_km"],
            "affected_districts": road_affected_districts[:10],  # Limit to 10
            "label_blocked": "Incidents",
            "label_total": "Network (km)"
        },
        "bridges": {
            "status": calculate_status(bridge_incidents, NEPAL_INFRA["bridges"], 0.50),
            "blocked": min(bridge_incidents, NEPAL_INFRA["bridges"]),
            "total": NEPAL_INFRA["bridges"],
            "affected_districts": bridge_affected_districts[:5],
            "label_blocked": "Affected",
            "label_total": "Total"
        },
        "airports": {
            "status": calculate_status(airport_incidents, NEPAL_INFRA["airports"], 0.50),
            "blocked": airport_incidents,
            "total": NEPAL_INFRA["airports"],
            "label_blocked": "Alerts",
            "label_total": "Total"
        },
        "hospitals": {
            "status": "ACTIVE" if hospital_capacity >= 80 else "STRAINED",
            "capacity_pct": hospital_capacity,
            "active": NEPAL_INFRA["hospitals"],
            "casualties_treated": total_casualties,
            "label_blocked": "Available",  # 95% available = good (5% used by disaster patients)
            "label_total": "Facilities"
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "lookback_days": days
    }


@router.get("/border-crossings")
async def get_border_crossing_status(
    db: AsyncSession = Depends(get_db),
):
    """
    Border crossing operational status derived from monthly customs trade data.

    Rule:
    - OPERATIONAL: customs has >0 value in latest monthly trade report
    - NOT_OPERATIONAL: no value in latest month, but had value in previous month
    - NO_DATA: no value in latest or previous month
    """
    report_rows = await db.execute(
        select(TradeReport)
        .order_by(TradeReport.fiscal_year_bs.desc(), TradeReport.month_ordinal.desc())
        .limit(2)
    )
    reports = list(report_rows.scalars().all())

    latest_report = reports[0] if reports else None
    previous_report = reports[1] if len(reports) > 1 else None

    latest_values_raw = (
        await aggregate_customs_values_for_report(db, latest_report.id)
        if latest_report
        else {}
    )
    previous_values_raw = (
        await aggregate_customs_values_for_report(db, previous_report.id)
        if previous_report
        else {}
    )
    latest_values = {
        _normalize_customs_key(key): float(value)
        for key, value in latest_values_raw.items()
        if key and key.strip()
    }
    previous_values = {
        _normalize_customs_key(key): float(value)
        for key, value in previous_values_raw.items()
        if key and key.strip()
    }

    offices = sorted(
        {
            _normalize_customs_key(office)
            for office in (list(latest_values.keys()) + list(previous_values.keys()))
            if office and office.strip()
        }
    )

    items = []
    for office in offices:
        latest_value = float(latest_values.get(office, 0.0))
        previous_value = float(previous_values.get(office, 0.0))

        if latest_value > 0:
            status = "OPERATIONAL"
        elif previous_value > 0:
            status = "NOT_OPERATIONAL"
        else:
            status = "NO_DATA"

        items.append(
            {
                "id": _slugify_customs_id(office),
                "name": _display_name_for_customs(office),
                "route": _route_for_customs(office),
                "customs_offices": [office],
                "status": status,
                "current_month_value_npr_thousands": latest_value,
                "previous_month_value_npr_thousands": previous_value,
                "is_operational": status == "OPERATIONAL",
            }
        )

    items.sort(
        key=lambda item: (
            0 if item["status"] == "OPERATIONAL" else 1,
            -item["current_month_value_npr_thousands"],
            item["name"],
        )
    )

    return {
        "period": (
            {
                "fiscal_year_bs": latest_report.fiscal_year_bs,
                "month_ordinal": latest_report.month_ordinal,
                "upto_month": latest_report.upto_month,
            }
            if latest_report
            else None
        ),
        "previous_period": (
            {
                "fiscal_year_bs": previous_report.fiscal_year_bs,
                "month_ordinal": previous_report.month_ordinal,
                "upto_month": previous_report.upto_month,
            }
            if previous_report
            else None
        ),
        "items": items,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
