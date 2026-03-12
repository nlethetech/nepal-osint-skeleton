"""Story summarization service using Claude Haiku 3.5 with prompt caching."""
import json
import logging
import os
from dataclasses import dataclass
from typing import List, Optional, Dict, Any

import aiohttp

from app.config import get_settings

logger = logging.getLogger(__name__)

# Anthropic API
ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages"
# Claude Haiku - fast and cost-effective (configurable)
HAIKU_MODEL = os.environ.get(
    "ANTHROPIC_SUMMARY_MODEL",
    os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
)

# System prompt for news summarization - marked for caching
# This prompt is >1024 tokens to enable Anthropic prompt caching (90% cost reduction)
SUMMARIZER_SYSTEM_PROMPT = """You are a professional intelligence analyst for Nepal OSINT, a comprehensive security and intelligence monitoring platform focused on Nepal and the South Asian region. Your primary task is to create concise, actionable intelligence summaries from news stories and clusters.

## Your Role
You serve security professionals, policy analysts, journalists, and researchers who need accurate, timely intelligence about events in Nepal. Your summaries should be:
- Actionable: Include specific details that inform decision-making
- Objective: Present facts without editorial bias
- Comprehensive: Cover all key aspects of the story
- Precise: Use exact numbers, names, and locations when available

## Nepal Context
Nepal is a federal democratic republic in South Asia, bordered by China (Tibet) to the north and India to the south, east, and west. Key context:

### Political Structure
- Federal system with 7 provinces and 753 local governments
- Major parties: Nepali Congress (NC), CPN-UML, CPN (Maoist Centre), Rastriya Swatantra Party (RSP)
- Key figures: President Ram Chandra Poudel, Prime Minister (varies), former PMs include Pushpa Kamal Dahal (Prachanda), KP Sharma Oli, Sher Bahadur Deuba
- Parliament: House of Representatives (lower), National Assembly (upper)

### Geographic Regions
- Terai (plains): Agricultural heartland, border with India
- Hilly region: Most populated, includes Kathmandu Valley
- Mountain region: Himalayas, including Mount Everest (Sagarmatha)
- 77 districts across 7 provinces

### Key Institutions
- Nepal Army, Nepal Police, Armed Police Force (APF)
- Election Commission of Nepal
- CIAA (Commission for Investigation of Abuse of Authority)
- Nepal Rastra Bank (central bank)
- NEPSE (Nepal Stock Exchange)

### Common News Topics
- Elections and political transitions
- Natural disasters: earthquakes, floods, landslides, avalanches
- Economic issues: remittances, inflation, trade deficit
- Border issues with India and China
- Development projects: hydropower, infrastructure
- Social movements and protests (bandhs, strikes)

## Category Definitions

### Political
- Government actions, legislation, policy changes
- Election campaigns, results, transitions
- Party politics, coalitions, splits
- Diplomatic relations, international visits
- Corruption cases involving officials

### Economic
- Stock market (NEPSE), banking sector
- Remittances, foreign exchange
- Trade, imports, exports
- Budget, fiscal policy
- Business news, investments
- Inflation, prices, cost of living

### Security
- Crime, arrests, police operations
- Border security incidents
- Terrorism, insurgency (historical context)
- Armed forces activities
- Law enforcement operations

### Disaster
- Natural disasters: earthquakes, floods, landslides, fires, avalanches
- Accidents: road, air, industrial
- Disease outbreaks, health emergencies
- Environmental hazards

### Social
- Protests, demonstrations, strikes (bandhs)
- Education news
- Health and healthcare
- Cultural events, festivals
- Human rights issues
- Gender and social issues

## Severity Levels

### Critical
- Multiple fatalities (5+ deaths)
- Major disaster affecting large population
- Constitutional crisis, government collapse
- Large-scale violence or unrest
- National emergency declared

### High
- Fatalities (1-4 deaths)
- Significant injuries (10+)
- Major political development
- Large protests (1000+ participants)
- Significant economic impact (>100 crore NPR)

### Medium
- Minor injuries
- Local political developments
- Moderate protests
- Notable but contained incidents
- Economic news with sector impact

### Low
- Routine news
- Local events
- Minor incidents
- General announcements
- Positive developments

## Output Format

You must respond with valid JSON only, no additional text or explanation:

{
  "headline": "Clear, specific headline under 100 characters",
  "summary": "2-4 sentence intelligence summary covering key facts, actors, and implications",
  "category": "political|economic|security|disaster|social",
  "severity": "critical|high|medium|low",
  "key_entities": ["List of key people, organizations, or places mentioned"],
  "verified": true or false (false if conflicting reports or unconfirmed),
  "confidence": 0.0 to 1.0 (your confidence in the accuracy)
}

## Guidelines

1. Always identify the primary WHO, WHAT, WHERE, WHEN
2. Note any security implications or escalation potential
3. For disasters: include casualty figures, affected areas, response status
4. For political news: identify key actors and their positions
5. For economic news: quantify impact when possible
6. Use present tense for ongoing situations
7. Flag unverified or conflicting information
8. Include specific numbers, dates, and names when available
9. Note if this is a developing story
10. Consider historical context when relevant

Remember: Output ONLY the JSON object, nothing else."""


@dataclass
class StorySummary:
    """Generated summary for a story or cluster."""
    headline: str
    summary: str
    category: str
    severity: str
    key_entities: List[str]
    verified: bool
    confidence: float
    cached: bool = False  # Whether prompt caching was used
    input_tokens: int = 0
    output_tokens: int = 0


class StorySummarizer:
    """
    Generates news summaries using Claude Haiku 3.5 with prompt caching.

    Follows Anthropic best practices:
    - Uses prompt caching for the system prompt (90% cost reduction on cache hits)
    - Batches similar requests when possible
    - Handles rate limits gracefully
    """

    def __init__(self, api_key: Optional[str] = None):
        """Initialize the summarizer."""
        settings = get_settings()
        self.api_key = api_key or settings.anthropic_api_key
        if not self.api_key:
            logger.warning("ANTHROPIC_API_KEY not set - summarization disabled")

    def _get_headers(self) -> Dict[str, str]:
        """Get HTTP headers for API requests with prompt caching enabled."""
        return {
            "x-api-key": self.api_key or "",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            # Enable prompt caching beta
            "anthropic-beta": "prompt-caching-2024-07-31",
        }

    async def summarize_story(
        self,
        title: str,
        content: Optional[str] = None,
        source_name: Optional[str] = None,
    ) -> Optional[StorySummary]:
        """
        Generate a summary for a single story.

        Args:
            title: Story headline
            content: Story content/summary
            source_name: Source attribution

        Returns:
            StorySummary or None if generation failed
        """
        if not self.api_key:
            return None

        # Build user message
        story_text = f"Title: {title}"
        if content:
            story_text += f"\n\nContent: {content[:2000]}"  # Limit content length
        if source_name:
            story_text += f"\n\nSource: {source_name}"

        user_message = f"Summarize this news story:\n\n{story_text}"

        return await self._call_api(user_message)

    async def summarize_cluster(
        self,
        stories: List[Dict[str, Any]],
        cluster_headline: Optional[str] = None,
    ) -> Optional[StorySummary]:
        """
        Generate a summary for a cluster of related stories.

        Args:
            stories: List of story dicts with title, content, source_name
            cluster_headline: Optional cluster headline

        Returns:
            StorySummary or None if generation failed
        """
        if not self.api_key:
            return None

        if not stories:
            return None

        # Build aggregated content from all stories
        stories_text = []
        sources = set()

        for i, story in enumerate(stories[:10], 1):  # Limit to 10 stories
            story_entry = f"{i}. {story.get('title', 'Untitled')}"
            if story.get('summary'):
                story_entry += f"\n   Summary: {story['summary'][:300]}"
            if story.get('source_name'):
                sources.add(story['source_name'])
            stories_text.append(story_entry)

        combined_text = "\n\n".join(stories_text)
        sources_text = ", ".join(sorted(sources)) if sources else "Multiple sources"

        user_message = f"""Summarize this cluster of {len(stories)} related news stories from {sources_text}:

{combined_text}

Create a unified intelligence summary that captures the key facts across all sources."""

        return await self._call_api(user_message)

    async def _call_api(self, user_message: str) -> Optional[StorySummary]:
        """
        Call Anthropic API with prompt caching.

        The system prompt is marked with cache_control for caching.
        """
        try:
            # Build request with cacheable system prompt
            request_body = {
                "model": HAIKU_MODEL,
                "max_tokens": 500,
                "system": [
                    {
                        "type": "text",
                        "text": SUMMARIZER_SYSTEM_PROMPT,
                        # Mark system prompt for caching
                        "cache_control": {"type": "ephemeral"}
                    }
                ],
                "messages": [
                    {"role": "user", "content": user_message}
                ],
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    ANTHROPIC_API_BASE,
                    headers=self._get_headers(),
                    json=request_body,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Summarization API error: {response.status} - {error_text}")
                        return None

                    data = await response.json()

                    # Extract response content
                    content = data.get("content", [{}])[0].get("text", "")

                    # Check cache status from usage
                    usage = data.get("usage", {})
                    cache_read = usage.get("cache_read_input_tokens", 0)
                    cache_creation = usage.get("cache_creation_input_tokens", 0)
                    was_cached = cache_read > 0

                    logger.info(
                        f"Summarization complete. Cache: {'HIT' if was_cached else 'MISS'}, "
                        f"Input: {usage.get('input_tokens', 0)}, Output: {usage.get('output_tokens', 0)}"
                    )

                    # Parse JSON response
                    return self._parse_response(content, was_cached, usage)

        except aiohttp.ClientError as e:
            logger.error(f"HTTP error during summarization: {e}")
            return None
        except Exception as e:
            logger.error(f"Summarization exception: {e}")
            return None

    def _parse_response(
        self,
        content: str,
        cached: bool,
        usage: Dict[str, int],
    ) -> Optional[StorySummary]:
        """Parse the LLM response into a StorySummary."""
        try:
            # Handle potential markdown code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            result = json.loads(content.strip())

            return StorySummary(
                headline=result.get("headline", ""),
                summary=result.get("summary", ""),
                category=result.get("category", ""),
                severity=result.get("severity", "medium"),
                key_entities=result.get("key_entities", []),
                verified=result.get("verified", False),
                confidence=float(result.get("confidence", 0.5)),
                cached=cached,
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            )

        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse summary JSON: {content[:200]}")
            # Return a basic summary from the raw text
            return StorySummary(
                headline="",
                summary=content[:500] if content else "",
                category="",
                severity="medium",
                key_entities=[],
                verified=False,
                confidence=0.3,
                cached=cached,
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            )


# Singleton instance
_summarizer_instance: Optional[StorySummarizer] = None


def get_story_summarizer() -> StorySummarizer:
    """Get the global StorySummarizer singleton."""
    global _summarizer_instance
    if _summarizer_instance is None:
        _summarizer_instance = StorySummarizer()
    return _summarizer_instance
