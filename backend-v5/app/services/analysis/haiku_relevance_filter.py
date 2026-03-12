"""Haiku-based relevance verification for borderline Nepal stories.

Uses Claude Haiku to verify whether a story is primarily about Nepal
when the keyword-based classifier is uncertain. This catches international
stories from Nepal sources about India/China/Pakistan internal affairs.

Cost: ~$0.06/day (~$1.73/month) at ~720 borderline stories/day.
"""
import json
import logging
import os
from typing import Optional

import aiohttp

from app.config import get_settings

logger = logging.getLogger(__name__)

ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages"

HAIKU_MODEL = os.environ.get(
    "HAIKU_RELEVANCE_MODEL",
    "claude-haiku-4-5-20251001",
)

# System prompt — kept concise for cost. Marked for prompt caching (~90% reduction).
RELEVANCE_SYSTEM_PROMPT = (
    "You are a Nepal intelligence relevance classifier. Determine if this story is "
    "primarily about Nepal or directly relevant to Nepal's domestic affairs.\n\n"
    "RELEVANT: Events IN Nepal, Nepal government/economy/society, Nepal bilateral issues "
    "where Nepal is a primary actor, treaties/agreements Nepal signs, disasters in Nepal, "
    "Nepali diaspora issues.\n"
    "NOT RELEVANT (even if written in Nepali by Nepal media):\n"
    "- Foreign conflicts: Israel-Iran, Russia-Ukraine, Gaza, Syria, Yemen, etc.\n"
    "- Other countries' internal politics, elections, economy, military operations\n"
    "- International sports/entertainment where Nepal is not competing\n"
    "- Stories where Nepal is mentioned only in passing\n"
    "- Regional summits where Nepal is listed but not the focus\n"
    "Nepal media often republishes international news in Nepali language. "
    "These are NOT relevant unless Nepal is directly affected or involved.\n\n"
    'Respond with ONLY valid JSON: {"relevant": true/false, "reason": "one sentence"}'
)

HAIKU_TIMEOUT = 10  # seconds — fail-open on timeout


async def verify_nepal_relevance(
    title: str,
    summary: Optional[str] = None,
    source_name: Optional[str] = None,
) -> Optional[bool]:
    """Call Haiku to verify if a story is primarily about Nepal.

    Returns:
        True  — story IS relevant to Nepal (keep it)
        False — story is NOT relevant (filter it out)
        None  — API error / timeout (fail-open, caller should allow through)
    """
    settings = get_settings()
    api_key = settings.anthropic_api_key
    if not api_key:
        logger.debug("No ANTHROPIC_API_KEY — skipping Haiku relevance check")
        return None

    # Build user message (keep short to minimize cost)
    parts = [f"Title: {title}"]
    if summary:
        parts.append(f"Summary: {summary[:300]}")
    if source_name:
        parts.append(f"Source: {source_name}")
    user_message = "\n".join(parts)

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-beta": "prompt-caching-2024-07-31",
    }

    request_body = {
        "model": HAIKU_MODEL,
        "max_tokens": 100,
        "system": [
            {
                "type": "text",
                "text": RELEVANCE_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [{"role": "user", "content": user_message}],
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                ANTHROPIC_API_BASE,
                headers=headers,
                json=request_body,
                timeout=aiohttp.ClientTimeout(total=HAIKU_TIMEOUT),
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.warning(
                        "Haiku relevance API error %s: %s",
                        response.status,
                        error_text[:200],
                    )
                    return None

                data = await response.json()
                content = data.get("content", [{}])[0].get("text", "")

                # Log cache status
                usage = data.get("usage", {})
                cache_hit = usage.get("cache_read_input_tokens", 0) > 0
                logger.debug(
                    "Haiku relevance check: cache=%s, in=%d, out=%d",
                    "HIT" if cache_hit else "MISS",
                    usage.get("input_tokens", 0),
                    usage.get("output_tokens", 0),
                )

                return _parse_response(content, title)

    except aiohttp.ClientError as e:
        logger.warning("Haiku relevance HTTP error: %s", e)
        return None
    except TimeoutError:
        logger.warning("Haiku relevance timeout for: %s", title[:60])
        return None
    except Exception as e:
        logger.warning("Haiku relevance exception: %s", e)
        return None


def _parse_response(content: str, title: str) -> Optional[bool]:
    """Parse Haiku JSON response."""
    try:
        # Handle markdown code blocks
        text = content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        result = json.loads(text)
        is_relevant = result.get("relevant", True)
        reason = result.get("reason", "")

        if not is_relevant:
            logger.info(
                "Haiku filtered: '%s' — %s",
                title[:60],
                reason[:100],
            )
        else:
            logger.debug("Haiku verified: '%s'", title[:60])

        return bool(is_relevant)

    except (json.JSONDecodeError, KeyError) as e:
        logger.warning("Haiku relevance parse error: %s — raw: %s", e, content[:200])
        return None


def should_haiku_verify(
    relevance_score: float,
    triggers: list[str],
    title: str,
) -> bool:
    """Decide whether a story needs Haiku verification.

    Skip Haiku if:
    - High confidence: score >= 0.90 AND has both SOURCE and CONTENT triggers
    - Devanagari title AND has strong Nepal markers (नेपाल, काठमाडौं, etc.)

    Verify with Haiku if:
    - Score < 0.75 (borderline)
    - Fewer than 3 triggers (thin evidence)
    - Devanagari title WITHOUT Nepal markers (foreign news in Nepali script)
    """
    # High confidence with strong evidence — skip
    has_source = any("SOURCE" in t for t in triggers)
    has_content = any("CONTENT" in t for t in triggers)
    if relevance_score >= 0.90 and has_source and has_content:
        return False

    is_devanagari = any("\u0900" <= ch <= "\u097F" for ch in title)
    if is_devanagari:
        # Devanagari title WITH Nepal-SPECIFIC markers = safe, skip Haiku
        # IMPORTANT: Only truly Nepal-specific markers here!
        # Do NOT include generic words like "मन्त्री" (minister),
        # "सरकार" (government), "राष्ट्रपति" (president) — these also
        # appear in stories about Iran, India, etc.
        nepal_markers_in_title = [
            "नेपाल", "नेपाली",
            "काठमाडौं", "काठमाण्डौ", "काठमाण्डू",
            "प्रचण्ड", "प्रचंड", "ओली", "देउवा", "बालेन", "कार्की",
            "नेप्से", "राष्ट्र बैंक",
            "पोखरा", "विराटनगर", "भक्तपुर", "ललितपुर", "जनकपुर",
            "बागमती", "गण्डकी", "लुम्बिनी", "कर्णाली", "मधेश", "कोशी",
            "सुदूरपश्चिम",
            "कांग्रेस", "एमाले", "माओवादी", "रास्वपा",
        ]
        title_lower = title.lower()
        if any(m in title_lower for m in nepal_markers_in_title):
            return False

        # Devanagari WITHOUT Nepal-specific markers = likely foreign news in Nepali
        # Send to Haiku for verification
        return True

    # Non-Devanagari borderline — verify
    if relevance_score < 0.75 or len(triggers) < 3:
        return True

    return False
