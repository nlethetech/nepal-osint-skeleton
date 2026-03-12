"""
Curfew Detection Service

Automatically detects curfew orders from government announcements
using keyword matching. When detected, creates CurfewAlert records
that trigger map highlighting and critical alerts.
"""
import re
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.announcement import GovtAnnouncement
from app.models.curfew_alert import CurfewAlert, get_province_for_district
from app.repositories.curfew import CurfewRepository

logger = logging.getLogger(__name__)


class CurfewDetectionService:
    """
    Service for detecting curfew orders in government announcements.

    Scans announcement titles and content for curfew-related keywords
    in both Nepali and English, then creates CurfewAlert records.
    """

    # Keywords that indicate a curfew order
    # Ordered by specificity (more specific first)
    CURFEW_KEYWORDS = [
        # Nepali curfew terms (most important)
        "कर्फ्यु आदेश",       # Curfew order
        "कर्फ्यु",            # Curfew
        "निषेधाज्ञा आदेश",    # Prohibition order
        "निषेधाज्ञा",         # Prohibition
        "धारा १४४",          # Section 144 (Nepali numerals)
        "धारा 144",          # Section 144 (Arabic numerals)

        # English terms
        "curfew order",
        "curfew imposed",
        "curfew declared",
        "curfew",
        "prohibitory order",
        "section 144",

        # Related emergency orders
        "बन्द आदेश",          # Closure order
        "आपतकालीन",          # Emergency
        "emergency order",
    ]

    # Keywords that indicate curfew lifting (to avoid false positives)
    CURFEW_LIFT_KEYWORDS = [
        "कर्फ्यु हटाइयो",     # Curfew lifted
        "निषेधाज्ञा हटाइयो",  # Prohibition lifted
        "curfew lifted",
        "curfew removed",
        "curfew relaxed",
        "prohibition lifted",
    ]

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = CurfewRepository(db)

    def detect_curfew_keywords(self, text: str) -> Tuple[bool, List[str]]:
        """
        Check if text contains curfew-related keywords.

        Args:
            text: Text to scan (title + content)

        Returns:
            Tuple of (is_curfew, matched_keywords)
        """
        if not text:
            return False, []

        text_lower = text.lower()

        # Check for lift keywords first (avoid false positives)
        for keyword in self.CURFEW_LIFT_KEYWORDS:
            if keyword.lower() in text_lower:
                logger.debug(f"Found lift keyword: {keyword}")
                return False, []

        # Check for curfew keywords
        matched = []
        for keyword in self.CURFEW_KEYWORDS:
            # Nepali keywords - case-sensitive match
            if keyword in text:
                matched.append(keyword)
            # English keywords - case-insensitive
            elif keyword.lower() in text_lower:
                matched.append(keyword)

        is_curfew = len(matched) > 0
        return is_curfew, matched

    def extract_district_from_source(self, source: str) -> Optional[str]:
        """
        Extract district name from DAO source domain.

        Args:
            source: Source domain (e.g., "daokathmandu.moha.gov.np")

        Returns:
            District name or None
        """
        # DAO pattern: dao{district}.moha.gov.np
        match = re.search(r'dao(\w+)\.moha\.gov\.np', source, re.I)
        if match:
            district_key = match.group(1).lower()
            # Convert to proper case
            return district_key.title()

        return None

    def extract_district_from_text(self, text: str) -> Optional[str]:
        """
        Try to extract district name from announcement text.

        Args:
            text: Announcement title or content

        Returns:
            District name or None
        """
        # Common district patterns in announcements
        # "Kathmandu जिल्लामा कर्फ्यु"
        # "कर्फ्यु: काठमाडौं"

        # Major districts to look for
        districts = [
            ("काठमाडौं", "Kathmandu"), ("kathmandu", "Kathmandu"),
            ("ललितपुर", "Lalitpur"), ("lalitpur", "Lalitpur"),
            ("भक्तपुर", "Bhaktapur"), ("bhaktapur", "Bhaktapur"),
            ("पोखरा", "Pokhara"), ("pokhara", "Pokhara"), ("kaski", "Kaski"),
            ("बिराटनगर", "Biratnagar"), ("biratnagar", "Biratnagar"), ("morang", "Morang"),
            ("जनकपुर", "Janakpur"), ("janakpur", "Janakpur"), ("dhanusa", "Dhanusa"),
            ("वीरगन्ज", "Birgunj"), ("birgunj", "Birgunj"), ("parsa", "Parsa"),
            ("नेपालगन्ज", "Nepalgunj"), ("nepalgunj", "Nepalgunj"), ("banke", "Banke"),
        ]

        text_lower = text.lower()
        for nepali, english in districts:
            if nepali.lower() in text_lower or nepali in text:
                return english

        return None

    async def check_announcement(
        self,
        announcement: GovtAnnouncement,
        duration_hours: int = 24,
    ) -> Optional[CurfewAlert]:
        """
        Check if an announcement contains a curfew order.

        Args:
            announcement: The government announcement to check
            duration_hours: Default curfew alert duration

        Returns:
            CurfewAlert if curfew detected, None otherwise
        """
        # Combine title and content for scanning
        text = f"{announcement.title} {announcement.content or ''}"

        # Detect curfew keywords
        is_curfew, matched_keywords = self.detect_curfew_keywords(text)

        if not is_curfew:
            return None

        logger.info(f"Curfew detected in announcement: {announcement.title[:50]}...")
        logger.info(f"Matched keywords: {matched_keywords}")

        # Extract district
        district = self.extract_district_from_source(announcement.source)
        if not district:
            district = self.extract_district_from_text(text)
        if not district:
            district = "Unknown"

        # Get province for district
        province = get_province_for_district(district)

        # Determine severity based on keywords
        severity = "critical" if any(k in ["कर्फ्यु आदेश", "कर्फ्यु", "curfew order"] for k in matched_keywords) else "high"

        # Check if we already have an active alert for this district
        existing = await self.repo.get_active_by_district(district)
        if existing:
            logger.info(f"Active curfew alert already exists for {district}, updating expiration")
            # Extend the existing alert
            existing.expires_at = datetime.now(timezone.utc) + timedelta(hours=duration_hours)
            existing.matched_keywords = list(set(existing.matched_keywords or []) | set(matched_keywords))
            await self.repo.update(existing)
            return existing

        # Create new alert
        alert = CurfewAlert.create_from_announcement(
            district=district,
            title=announcement.title,
            source=announcement.source,
            matched_keywords=matched_keywords,
            announcement_id=announcement.id,
            source_name=announcement.source_name,
            province=province,
            duration_hours=duration_hours,
        )
        alert.severity = severity

        created = await self.repo.create(alert)
        logger.info(f"Created curfew alert for {district}: {created.id}")

        return created

    async def process_announcements(
        self,
        announcements: List[GovtAnnouncement],
        duration_hours: int = 24,
    ) -> List[CurfewAlert]:
        """
        Process multiple announcements for curfew detection.

        Args:
            announcements: List of announcements to check
            duration_hours: Default curfew duration

        Returns:
            List of created/updated CurfewAlert objects
        """
        alerts = []
        for announcement in announcements:
            try:
                alert = await self.check_announcement(announcement, duration_hours)
                if alert:
                    alerts.append(alert)
            except Exception as e:
                logger.error(f"Error processing announcement {announcement.id}: {e}")

        return alerts

    async def expire_old_alerts(self) -> int:
        """
        Mark expired alerts as inactive.

        Returns:
            Number of alerts expired
        """
        return await self.repo.expire_alerts()

    async def get_active_alerts(self) -> List[CurfewAlert]:
        """Get all currently active curfew alerts."""
        return await self.repo.get_active_alerts()

    async def get_active_districts(self) -> List[str]:
        """Get list of districts with active curfews."""
        alerts = await self.get_active_alerts()
        return [a.district for a in alerts]


# ============ Helper functions for integration ============

async def check_for_curfews(
    db: AsyncSession,
    announcements: List[GovtAnnouncement],
) -> List[CurfewAlert]:
    """
    Convenience function to check announcements for curfews.

    For use in ingestion pipelines.
    """
    service = CurfewDetectionService(db)

    # First expire old alerts
    await service.expire_old_alerts()

    # Then check new announcements
    return await service.process_announcements(announcements)
