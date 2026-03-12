"""Shared enums for connected analyst graph and provenance models."""
from enum import Enum


class AnalystVerificationStatus(str, Enum):
    """Verification state for generated analyst objects, links, and findings."""

    UNVERIFIED = "unverified"
    CANDIDATE = "candidate"
    VERIFIED = "verified"
    REJECTED = "rejected"


class SourceClassification(str, Enum):
    """Classification for provenance source quality tier."""

    OFFICIAL = "official"
    INDEPENDENT = "independent"
    UNKNOWN = "unknown"
