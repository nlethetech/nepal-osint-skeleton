"""Data collection and province classification for the Province Anomaly Agent.

Classifies stories and tweets by province using pure Python keyword matching
against Nepal's 77 districts and 7 provinces. Zero Claude cost.
"""
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.nepal_districts import NEPAL_PROVINCES, NEPAL_DISTRICTS
from app.models.story import Story
from app.models.tweet import Tweet

logger = logging.getLogger(__name__)

# ── Build keyword → province_id map ──

_KEYWORD_TO_PROVINCE: dict[str, int] = {}

# Province names + aliases
for prov in NEPAL_PROVINCES:
    pid = prov["id"]
    _KEYWORD_TO_PROVINCE[prov["name_en"].lower()] = pid
    for alias in prov.get("aliases", []):
        _KEYWORD_TO_PROVINCE[alias.lower()] = pid

# District names + aliases + headquarters
for dist in NEPAL_DISTRICTS:
    pid = dist["province_id"]
    _KEYWORD_TO_PROVINCE[dist["name_en"].lower()] = pid
    _KEYWORD_TO_PROVINCE[dist["headquarters"].lower()] = pid
    for alias in dist.get("aliases", []):
        # Skip very short aliases and Nepali script (matched separately)
        low = alias.lower()
        if len(low) >= 3:
            _KEYWORD_TO_PROVINCE[low] = pid

# Sort keywords by length descending for greedy matching
_SORTED_KEYWORDS = sorted(_KEYWORD_TO_PROVINCE.keys(), key=len, reverse=True)

PROVINCE_NAMES = {p["id"]: p["name_en"] for p in NEPAL_PROVINCES}


@dataclass
class ClassifiedItem:
    """A story or tweet classified to a province."""
    title: str
    snippet: str
    source: str
    published_at: str | None = None


@dataclass
class ProvinceData:
    """Collected data for a single province."""
    province_id: int
    province_name: str
    stories: list[ClassifiedItem] = field(default_factory=list)
    tweets: list[ClassifiedItem] = field(default_factory=list)

    @property
    def story_count(self) -> int:
        return len(self.stories)

    @property
    def tweet_count(self) -> int:
        return len(self.tweets)


def classify_province(text: str) -> int | None:
    """Classify text to a province_id via keyword matching.

    Returns province_id (1-7) or None if no match.
    Uses greedy matching: longest keyword wins. If multiple provinces match,
    returns the one with more keyword hits.
    """
    if not text:
        return None

    text_lower = text.lower()
    hits: dict[int, int] = defaultdict(int)

    for keyword in _SORTED_KEYWORDS:
        if keyword in text_lower:
            hits[_KEYWORD_TO_PROVINCE[keyword]] += 1

    if not hits:
        return None

    return max(hits, key=hits.get)


async def collect_province_data(
    db: AsyncSession,
    hours: int = 6,
    max_stories: int = 500,
    max_tweets: int = 500,
) -> dict[int, ProvinceData]:
    """Collect recent stories and tweets, classify by province.

    Returns dict mapping province_id (1-7) to ProvinceData.
    Always returns all 7 provinces (even if empty).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Initialize all 7 provinces
    provinces: dict[int, ProvinceData] = {
        pid: ProvinceData(province_id=pid, province_name=name)
        for pid, name in PROVINCE_NAMES.items()
    }

    # Fetch recent stories
    story_result = await db.execute(
        select(Story)
        .where(Story.published_at >= cutoff)
        .where(Story.nepal_relevance != "INTERNATIONAL")
        .order_by(Story.published_at.desc())
        .limit(max_stories)
    )
    stories = story_result.scalars().all()

    total_stories = 0
    for story in stories:
        search_text = f"{story.title or ''} {story.summary or ''}"
        pid = classify_province(search_text)
        if pid and pid in provinces:
            provinces[pid].stories.append(ClassifiedItem(
                title=story.title or "Untitled",
                snippet=(story.summary or "")[:200],
                source=story.source_name or "Unknown",
                published_at=story.published_at.isoformat() if story.published_at else None,
            ))
            total_stories += 1

    # Fetch recent tweets
    tweet_result = await db.execute(
        select(Tweet)
        .where(Tweet.tweeted_at >= cutoff)
        .order_by(Tweet.tweeted_at.desc())
        .limit(max_tweets)
    )
    tweets = tweet_result.scalars().all()

    total_tweets = 0
    for tweet in tweets:
        search_text = tweet.text or ""
        pid = classify_province(search_text)
        if pid and pid in provinces:
            provinces[pid].tweets.append(ClassifiedItem(
                title=f"@{tweet.author_username or 'unknown'}",
                snippet=search_text[:200],
                source=tweet.author_username or "twitter",
                published_at=tweet.tweeted_at.isoformat() if tweet.tweeted_at else None,
            ))
            total_tweets += 1

    logger.info(
        "Province classification: %d/%d stories and %d/%d tweets classified",
        total_stories, len(stories), total_tweets, len(tweets),
    )

    return provinces
