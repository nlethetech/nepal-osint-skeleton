"""Energy data models for Nepal Electricity Authority (NEA) power grid data."""
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, Numeric, DateTime, Enum as SQLEnum, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EnergyDataType(str, Enum):
    """Types of energy data from NEA."""
    NEA_SUBSIDIARY = "nea_subsidiary"  # NEA owned power plants
    IPP = "ipp"                         # Independent Power Producers
    IMPORT = "import"                   # Import from India
    INTERRUPTION = "interruption"       # System interruption/loss
    TOTAL_DEMAND = "total_demand"       # Total energy demand


class EnergyData(Base):
    """Energy data record from Nepal Electricity Authority."""

    __tablename__ = "energy_data"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # Data type identifier
    data_type: Mapped[EnergyDataType] = mapped_column(
        SQLEnum(EnergyDataType, native_enum=False),
        nullable=False,
    )

    # Value and unit
    value: Mapped[Decimal] = mapped_column(Numeric(precision=12, scale=2), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="MWh")

    # Change from previous value
    previous_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(precision=12, scale=2))
    change_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(precision=12, scale=2))
    change_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(precision=8, scale=4))

    # Source info
    source_name: Mapped[str] = mapped_column(String(100), nullable=False, default="Nepal Electricity Authority")
    source_url: Mapped[Optional[str]] = mapped_column(String(500), default="https://www.nea.org.np")

    # Timestamps
    data_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )  # The date this data is for
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    # Indexes for common queries
    __table_args__ = (
        Index("ix_energy_data_type_date", "data_type", "data_date"),
        Index("ix_energy_data_fetched", "fetched_at"),
    )

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "id": str(self.id),
            "data_type": self.data_type.value,
            "value": float(self.value),
            "unit": self.unit,
            "previous_value": float(self.previous_value) if self.previous_value else None,
            "change_amount": float(self.change_amount) if self.change_amount else None,
            "change_percent": float(self.change_percent) if self.change_percent else None,
            "source_name": self.source_name,
            "source_url": self.source_url,
            "data_date": self.data_date.isoformat() if self.data_date else None,
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
        }


# Label mapping for NEA website scraping
NEA_LABEL_MAPPING = {
    "nea subsidiary companies": EnergyDataType.NEA_SUBSIDIARY,
    "nea subsidiary": EnergyDataType.NEA_SUBSIDIARY,
    "subsidiary companies": EnergyDataType.NEA_SUBSIDIARY,
    "ipp": EnergyDataType.IPP,
    "independent power producers": EnergyDataType.IPP,
    "import": EnergyDataType.IMPORT,
    "interruption": EnergyDataType.INTERRUPTION,
    "total energy demand": EnergyDataType.TOTAL_DEMAND,
    "total demand": EnergyDataType.TOTAL_DEMAND,
}
