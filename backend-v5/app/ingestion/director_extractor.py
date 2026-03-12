"""Extract director/CEO/chairman mentions from news stories using pattern matching."""
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import CompanyDirector, CompanyRegistration
from app.models.story import Story

logger = logging.getLogger(__name__)


@dataclass
class DirectorMention:
    """A potential director-company relationship extracted from text."""

    person_name: str
    company_name: Optional[str] = None
    role: Optional[str] = None
    source_url: Optional[str] = None
    story_id: Optional[UUID] = None
    confidence: float = 0.5
    matched_company_id: Optional[UUID] = None
    raw_context: str = ""


# English patterns: "X, director/CEO/chairman of Y"
ENGLISH_PATTERNS = [
    # "John Smith, Chairman of ABC Company" or "John Smith, CEO of ABC Company"
    re.compile(
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})"
        r"\s*,\s*"
        r"(?:the\s+)?"
        r"((?:Managing\s+)?Director|Chairman|Chairperson|CEO|Chief\s+Executive(?:\s+Officer)?|MD|President|"
        r"Executive\s+Director|Board\s+(?:Member|Chair))"
        r"\s+(?:of\s+)"
        r"(.+?)(?:[,\.\;\:]|$)",
        re.IGNORECASE,
    ),
    # "Director/CEO X of Y Company"
    re.compile(
        r"(?:the\s+)?"
        r"((?:Managing\s+)?Director|Chairman|Chairperson|CEO|Chief\s+Executive(?:\s+Officer)?|MD|President)"
        r"\s+(?:of\s+)?"
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})"
        r"\s+(?:of\s+)"
        r"(.+?)(?:[,\.\;\:]|$)",
        re.IGNORECASE,
    ),
    # "X has been appointed as Director/CEO of Y"
    re.compile(
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})"
        r"\s+(?:has\s+been\s+|was\s+)"
        r"(?:appointed|named|elected|selected)\s+"
        r"(?:as\s+)?(?:the\s+)?"
        r"((?:Managing\s+)?Director|Chairman|Chairperson|CEO|Chief\s+Executive(?:\s+Officer)?|MD|President)"
        r"\s+(?:of\s+)"
        r"(.+?)(?:[,\.\;\:]|$)",
        re.IGNORECASE,
    ),
]

# Nepali patterns
NEPALI_PATTERNS = [
    # "X सञ्चालक/अध्यक्ष/प्रबन्ध निर्देशक Y"
    re.compile(
        r"(.+?)\s+"
        r"(सञ्चालक|अध्यक्ष|प्रबन्ध\s*निर्देशक|कार्यकारी\s*(?:निर्देशक|अध्यक्ष)|प्रमुख\s*कार्यकारी\s*अधिकृत)"
        r"\s+"
        r"(.+?)(?:[,।\.\;\:]|$)",
    ),
    # "Y का सञ्चालक X"
    re.compile(
        r"(.+?)\s+का\s+"
        r"(सञ्चालक|अध्यक्ष|प्रबन्ध\s*निर्देशक|कार्यकारी\s*(?:निर्देशक|अध्यक्ष))"
        r"\s+"
        r"(.+?)(?:[,।\.\;\:]|$)",
    ),
]

# Role normalization
ROLE_MAP = {
    "director": "Director",
    "managing director": "Managing Director",
    "md": "Managing Director",
    "chairman": "Chairman",
    "chairperson": "Chairman",
    "ceo": "CEO",
    "chief executive": "CEO",
    "chief executive officer": "CEO",
    "president": "President",
    "executive director": "Executive Director",
    "board member": "Director",
    "board chair": "Chairman",
    "सञ्चालक": "Director",
    "अध्यक्ष": "Chairman",
    "प्रबन्ध निर्देशक": "Managing Director",
    "प्रबन्धनिर्देशक": "Managing Director",
    "कार्यकारी निर्देशक": "Executive Director",
    "कार्यकारी अध्यक्ष": "Executive Chairman",
    "प्रमुख कार्यकारी अधिकृत": "CEO",
}


def _normalize_role(raw_role: str) -> str:
    """Normalize a role string to a canonical form."""
    key = re.sub(r"\s+", " ", raw_role.strip().lower())
    return ROLE_MAP.get(key, raw_role.strip().title())


def _clean_name(name: str) -> str:
    """Clean up an extracted person/company name."""
    name = name.strip().strip(",.:;'\"")
    name = re.sub(r"\s+", " ", name)
    return name


def extract_mentions_from_text(
    text: str,
    source_url: Optional[str] = None,
    story_id: Optional[UUID] = None,
) -> list[DirectorMention]:
    """Extract director-company mentions from a block of text."""
    mentions: list[DirectorMention] = []

    for pattern in ENGLISH_PATTERNS:
        for match in pattern.finditer(text):
            groups = match.groups()
            if len(groups) == 3:
                # Determine which group is person, role, company based on pattern
                if groups[0][0].isupper() and len(groups[0]) > 3:
                    person = _clean_name(groups[0])
                    role = _normalize_role(groups[1])
                    company = _clean_name(groups[2])
                else:
                    role = _normalize_role(groups[0])
                    person = _clean_name(groups[1])
                    company = _clean_name(groups[2])

                if len(person) > 3 and len(company) > 2:
                    mentions.append(
                        DirectorMention(
                            person_name=person,
                            company_name=company,
                            role=role,
                            source_url=source_url,
                            story_id=story_id,
                            confidence=0.6,
                            raw_context=match.group(0)[:300],
                        )
                    )

    for pattern in NEPALI_PATTERNS:
        for match in pattern.finditer(text):
            groups = match.groups()
            if len(groups) == 3:
                person = _clean_name(groups[0])
                role = _normalize_role(groups[1])
                company = _clean_name(groups[2])

                if len(person) > 2 and len(company) > 2:
                    mentions.append(
                        DirectorMention(
                            person_name=person,
                            company_name=company,
                            role=role,
                            source_url=source_url,
                            story_id=story_id,
                            confidence=0.5,
                            raw_context=match.group(0)[:300],
                        )
                    )

    return mentions


class DirectorExtractor:
    """Extracts director mentions from stories and saves as CompanyDirector records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def process_story(self, story: Story) -> list[DirectorMention]:
        """Extract director mentions from a single story's title and content."""
        text_parts = [story.title or ""]
        if story.content:
            text_parts.append(story.content)
        elif story.summary:
            text_parts.append(story.summary)

        full_text = "\n".join(text_parts)
        mentions = extract_mentions_from_text(
            full_text,
            source_url=story.url,
            story_id=story.id,
        )

        # Try to match company names against known companies
        for mention in mentions:
            if mention.company_name:
                mention.matched_company_id = await self._match_company(mention.company_name)

        return mentions

    async def _match_company(self, company_name: str) -> Optional[UUID]:
        """Try to match an extracted company name to a CompanyRegistration."""
        # Exact match first
        stmt = select(CompanyRegistration.id).where(
            CompanyRegistration.name_english.ilike(company_name)
        ).limit(1)
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if row:
            return row

        # Fuzzy match: try partial match
        stmt = select(CompanyRegistration.id).where(
            CompanyRegistration.name_english.ilike(f"%{company_name}%")
        ).limit(1)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def save_mentions(self, mentions: list[DirectorMention]) -> dict:
        """Save extracted mentions as CompanyDirector records. Deduplicates by name+company+role."""
        stats = {"saved": 0, "skipped_duplicate": 0, "errors": 0}

        for mention in mentions:
            try:
                # Check for existing record with same name + company + role
                conditions = [CompanyDirector.name_en.ilike(mention.person_name)]
                if mention.matched_company_id:
                    conditions.append(CompanyDirector.company_id == mention.matched_company_id)
                if mention.role:
                    conditions.append(CompanyDirector.role == mention.role)

                existing_stmt = select(CompanyDirector.id).where(and_(*conditions)).limit(1)
                existing = await self.db.execute(existing_stmt)

                if existing.scalar_one_or_none():
                    stats["skipped_duplicate"] += 1
                    continue

                director = CompanyDirector(
                    company_id=mention.matched_company_id,
                    name_en=mention.person_name,
                    role=mention.role,
                    company_name_hint=mention.company_name,
                    source="news_ner",
                    source_url=mention.source_url,
                    confidence=mention.confidence,
                    raw_data={
                        "story_id": str(mention.story_id) if mention.story_id else None,
                        "context": mention.raw_context,
                    },
                    fetched_at=datetime.now(timezone.utc),
                )
                self.db.add(director)
                await self.db.flush()
                stats["saved"] += 1

            except Exception as e:
                logger.warning(f"Failed to save director mention '{mention.person_name}': {e}")
                stats["errors"] += 1
                try:
                    await self.db.rollback()
                except Exception:
                    pass

        if stats["saved"] > 0:
            await self.db.commit()

        return stats

    async def process_recent_stories(self, limit: int = 500) -> dict:
        """Process recent stories for director mentions."""
        stmt = (
            select(Story)
            .where(Story.language == "en")
            .order_by(Story.created_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        stories = list(result.scalars().all())

        all_mentions: list[DirectorMention] = []
        for story in stories:
            mentions = await self.process_story(story)
            all_mentions.extend(mentions)

        logger.info(f"Extracted {len(all_mentions)} director mentions from {len(stories)} stories")

        if all_mentions:
            save_stats = await self.save_mentions(all_mentions)
        else:
            save_stats = {"saved": 0, "skipped_duplicate": 0, "errors": 0}

        return {
            "stories_processed": len(stories),
            "mentions_found": len(all_mentions),
            **save_stats,
        }
