"""Corroboration service for multi-source verification."""
from app.services.corroboration.corroboration_service import (
    CorroborationService,
    CorroborationResult,
    get_corroboration_service,
)

__all__ = [
    "CorroborationService",
    "CorroborationResult",
    "get_corroboration_service",
]
