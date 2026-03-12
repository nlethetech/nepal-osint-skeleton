"""
AI-powered Leadership Profile Service.

Uses Claude Haiku to synthesize candidate data (education, news, WikiLeaks)
into an actionable leadership profile answering "What kind of leader is this person?"
"""
import logging
import os
import json
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict

import httpx

logger = logging.getLogger(__name__)

# Anthropic API
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
HAIKU_MODEL = "claude-3-haiku-20240307"

# Cache: candidate_id -> (profile, timestamp)
_profile_cache: Dict[str, tuple] = {}
CACHE_TTL_HOURS = 24  # Regenerate profiles daily


@dataclass
class LeadershipProfile:
    """AI-generated leadership profile."""
    candidate_id: str
    candidate_name: str

    # Core assessment (1-2 sentences each)
    leadership_style: str  # e.g., "Pragmatic coalition builder", "Populist reformer"
    key_strengths: List[str]  # Top 3 strengths
    key_concerns: List[str]  # Top 3 concerns/red flags

    # Political positioning
    ideological_position: str  # e.g., "Center-left nationalist"
    policy_priorities: List[str]  # Top 3 policy areas

    # Track record summary
    experience_summary: str  # 2-3 sentences on experience
    controversy_summary: Optional[str]  # Any controversies from news/WikiLeaks

    # Diplomatic profile (from WikiLeaks)
    international_perception: Optional[str]  # How seen by foreign govts

    # Overall assessment
    analyst_summary: str  # 3-4 sentence executive summary
    confidence_level: str  # "high", "medium", "low" based on data quality

    # Metadata
    generated_at: str
    data_sources: List[str]  # What data was used


def _get_cache_key(candidate_id: str) -> str:
    """Generate cache key for a candidate."""
    return f"profile_{candidate_id}"


def _get_cached_profile(candidate_id: str) -> Optional[LeadershipProfile]:
    """Get cached profile if still valid."""
    key = _get_cache_key(candidate_id)
    if key in _profile_cache:
        profile, timestamp = _profile_cache[key]
        if datetime.utcnow() - timestamp < timedelta(hours=CACHE_TTL_HOURS):
            return profile
    return None


def _cache_profile(profile: LeadershipProfile) -> None:
    """Cache a generated profile."""
    key = _get_cache_key(profile.candidate_id)
    _profile_cache[key] = (profile, datetime.utcnow())


async def generate_leadership_profile(
    candidate_id: str,
    candidate_name: str,
    candidate_name_ne: Optional[str],
    education: Optional[str],
    party: Optional[str],
    age: Optional[int],
    gender: Optional[str],
    constituency: Optional[str],
    election_history: List[Dict[str, Any]],  # previous_runs
    parliamentary_record: Optional[Dict[str, Any]],
    news_stories: List[Dict[str, Any]],  # Recent stories
    wikileaks_docs: List[Dict[str, Any]],  # WikiLeaks documents
    ministerial_positions: Optional[List[Dict[str, Any]]] = None,  # Cabinet positions
    force_regenerate: bool = False,
) -> LeadershipProfile:
    """
    Generate an AI-powered leadership profile using Claude Haiku.

    Synthesizes all available data into an actionable intelligence product.
    Results are cached for 24 hours.
    """
    # Check cache first
    if not force_regenerate:
        cached = _get_cached_profile(candidate_id)
        if cached:
            logger.info(f"[LeadershipProfile] Cache hit for {candidate_name}")
            return cached

    logger.info(f"[LeadershipProfile] Generating profile for {candidate_name}")

    # Build context for the LLM
    context = _build_context(
        candidate_name=candidate_name,
        candidate_name_ne=candidate_name_ne,
        education=education,
        party=party,
        age=age,
        gender=gender,
        constituency=constituency,
        election_history=election_history,
        parliamentary_record=parliamentary_record,
        news_stories=news_stories,
        wikileaks_docs=wikileaks_docs,
        ministerial_positions=ministerial_positions or [],
    )

    # Track what data sources we have
    data_sources = []
    if education:
        data_sources.append("education")
    if election_history:
        data_sources.append(f"election_history ({len(election_history)} elections)")
    if parliamentary_record:
        data_sources.append("parliamentary_record")
    if ministerial_positions:
        data_sources.append(f"ministerial_positions ({len(ministerial_positions)} positions)")
    if news_stories:
        data_sources.append(f"news ({len(news_stories)} articles)")
    if wikileaks_docs:
        data_sources.append(f"wikileaks ({len(wikileaks_docs)} documents)")

    # Determine confidence level based on data richness
    confidence = "high" if len(data_sources) >= 4 else "medium" if len(data_sources) >= 2 else "low"

    # Call Claude Haiku
    try:
        response = await _call_haiku(context, candidate_name)
        profile_data = _parse_response(response)

        profile = LeadershipProfile(
            candidate_id=candidate_id,
            candidate_name=candidate_name,
            leadership_style=profile_data.get("leadership_style", "Data insufficient"),
            key_strengths=profile_data.get("key_strengths", []),
            key_concerns=profile_data.get("key_concerns", []),
            ideological_position=profile_data.get("ideological_position", "Unknown"),
            policy_priorities=profile_data.get("policy_priorities", []),
            experience_summary=profile_data.get("experience_summary", "Limited data available."),
            controversy_summary=profile_data.get("controversy_summary"),
            international_perception=profile_data.get("international_perception"),
            analyst_summary=profile_data.get("analyst_summary", "Insufficient data for comprehensive assessment."),
            confidence_level=confidence,
            generated_at=datetime.utcnow().isoformat(),
            data_sources=data_sources,
        )

        # Cache the result
        _cache_profile(profile)

        return profile

    except Exception as e:
        logger.error(f"[LeadershipProfile] Failed to generate profile: {e}")
        # Return a minimal profile on error
        return LeadershipProfile(
            candidate_id=candidate_id,
            candidate_name=candidate_name,
            leadership_style="Analysis unavailable",
            key_strengths=[],
            key_concerns=[],
            ideological_position="Unknown",
            policy_priorities=[],
            experience_summary="Unable to generate profile due to API error.",
            controversy_summary=None,
            international_perception=None,
            analyst_summary="Profile generation failed. Please try again later.",
            confidence_level="low",
            generated_at=datetime.utcnow().isoformat(),
            data_sources=data_sources,
        )


def _build_context(
    candidate_name: str,
    candidate_name_ne: Optional[str],
    education: Optional[str],
    party: Optional[str],
    age: Optional[int],
    gender: Optional[str],
    constituency: Optional[str],
    election_history: List[Dict[str, Any]],
    parliamentary_record: Optional[Dict[str, Any]],
    news_stories: List[Dict[str, Any]],
    wikileaks_docs: List[Dict[str, Any]],
    ministerial_positions: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Build context string for LLM from all data sources."""

    sections = []

    # Basic Info
    basic = f"CANDIDATE: {candidate_name}"
    if candidate_name_ne:
        basic += f" ({candidate_name_ne})"
    if party:
        basic += f"\nParty: {party}"
    if age:
        basic += f"\nAge: {age}"
    if gender:
        basic += f"\nGender: {gender}"
    if constituency:
        basic += f"\nConstituency: {constituency}"
    if education:
        basic += f"\nEducation: {education}"
    sections.append(basic)

    # EXECUTIVE EXPERIENCE (Ministerial Positions) - CRITICAL for leadership assessment
    # This should come before legislative record as it's often more significant
    if ministerial_positions:
        exec_section = "EXECUTIVE EXPERIENCE (Cabinet/Government Positions):"

        # Separate PM positions, Deputy PM, and other ministerial roles
        pm_positions = [p for p in ministerial_positions if p.get("position_type") == "prime_minister"]
        deputy_pm_positions = [p for p in ministerial_positions if p.get("position_type") == "deputy_pm"]
        minister_positions = [p for p in ministerial_positions if p.get("position_type") == "minister"]
        state_minister_positions = [p for p in ministerial_positions if p.get("position_type") == "state_minister"]

        if pm_positions:
            exec_section += f"\n\n*** PRIME MINISTER ({len(pm_positions)} terms) ***"
            for pos in pm_positions:
                start = pos.get("start_date", "Unknown")
                end = pos.get("end_date", "Present") or "Present"
                govt = pos.get("government_name", "")
                exec_section += f"\n- {start} to {end}: Prime Minister"
                if govt:
                    exec_section += f" ({govt})"
                if pos.get("notes"):
                    exec_section += f"\n  Note: {pos.get('notes')}"

        if deputy_pm_positions:
            exec_section += f"\n\n*** DEPUTY PRIME MINISTER ({len(deputy_pm_positions)} terms) ***"
            for pos in deputy_pm_positions:
                start = pos.get("start_date", "Unknown")
                end = pos.get("end_date", "Present") or "Present"
                ministry = pos.get("ministry", "")
                pm = pos.get("prime_minister", "")
                exec_section += f"\n- {start} to {end}: Deputy PM"
                if ministry:
                    exec_section += f" and Minister of {ministry}"
                if pm:
                    exec_section += f" (under PM {pm})"
                if pos.get("notes"):
                    exec_section += f"\n  Note: {pos.get('notes')}"

        if minister_positions:
            exec_section += f"\n\n*** CABINET MINISTER ({len(minister_positions)} portfolios) ***"
            for pos in minister_positions:
                start = pos.get("start_date", "Unknown")
                end = pos.get("end_date", "Present") or "Present"
                ministry = pos.get("ministry", "Unknown")
                pm = pos.get("prime_minister", "")
                exec_section += f"\n- {start} to {end}: Minister of {ministry}"
                if pm:
                    exec_section += f" (under PM {pm})"
                if pos.get("notes"):
                    exec_section += f"\n  Note: {pos.get('notes')}"

        if state_minister_positions:
            exec_section += f"\n\n*** STATE MINISTER ({len(state_minister_positions)} positions) ***"
            for pos in state_minister_positions:
                start = pos.get("start_date", "Unknown")
                end = pos.get("end_date", "Present") or "Present"
                ministry = pos.get("ministry", "Unknown")
                exec_section += f"\n- {start} to {end}: State Minister of {ministry}"

        sections.append(exec_section)

    # Election History
    if election_history:
        history = "ELECTION HISTORY:"
        for run in election_history:
            year = run.get("election_year", "Unknown")
            party = run.get("party_name", "Unknown")
            won = "WON" if run.get("is_winner") else "LOST"
            votes = run.get("votes_received", 0)
            const = run.get("constituency_name", "")
            history += f"\n- {year}: {won} ({party}) - {votes:,} votes in {const}"
        sections.append(history)

    # Parliamentary Record (Legislative branch)
    if parliamentary_record:
        parl = "PARLIAMENTARY/LEGISLATIVE RECORD:"
        if parliamentary_record.get("is_former_pm"):
            parl += f"\n- Former Prime Minister ({parliamentary_record.get('pm_terms', 0)} terms)"
        score = parliamentary_record.get("performance_score", 0)
        parl += f"\n- Legislative Performance Score: {score:.1f}/100"
        parl += f"\n- Bills Introduced: {parliamentary_record.get('bills_introduced', 0)}"
        parl += f"\n- Questions Asked: {parliamentary_record.get('questions_asked', 0)}"
        parl += f"\n- Speeches: {parliamentary_record.get('speeches_count', 0)}"
        parl += f"\n- Committee Memberships: {parliamentary_record.get('committee_memberships', 0)}"
        if parliamentary_record.get("notable_roles"):
            parl += f"\n- Notable Roles: {parliamentary_record.get('notable_roles')}"
        sections.append(parl)

    # News Stories (summarize)
    if news_stories:
        news = f"NEWS MENTIONS ({len(news_stories)} recent articles):"
        # Group by sentiment/category if available
        categories = {}
        for story in news_stories[:20]:  # Limit to 20
            cat = story.get("category") or "general"  # Handle None explicitly
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(story.get("title") or "Untitled")

        for cat, titles in categories.items():
            news += f"\n[{cat.upper()}]: {len(titles)} articles"
            for title in titles[:3]:
                news += f"\n  - {(title or 'Untitled')[:100]}"
        sections.append(news)

    # WikiLeaks Documents
    if wikileaks_docs:
        wiki = f"WIKILEAKS DOCUMENTS ({len(wikileaks_docs)} mentions):"
        for doc in wikileaks_docs[:5]:  # Top 5 most relevant
            wiki += f"\n- [{doc.get('collection', 'Unknown')}] {doc.get('title', 'Untitled')[:80]}"
            if doc.get("snippet"):
                wiki += f"\n  Excerpt: {doc.get('snippet', '')[:200]}..."
        sections.append(wiki)

    return "\n\n".join(sections)


async def _call_haiku(context: str, candidate_name: str) -> str:
    """Call Claude Haiku API for profile generation."""

    # Try settings first, then fall back to environment variable
    from app.config import get_settings
    settings = get_settings()
    api_key = settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    system_prompt = """You are an intelligence analyst specializing in political leadership assessment for Nepal.
Your task is to synthesize available data into an actionable leadership profile.

Be objective, analytical, and evidence-based. Distinguish between facts and inferences.
If data is limited, clearly note low confidence. Do not fabricate information.

For controversial topics (corruption, WikiLeaks mentions), present facts neutrally without editorializing.

Output your analysis as JSON with this exact structure:
{
  "leadership_style": "2-4 word description, e.g., 'Pragmatic coalition builder'",
  "key_strengths": ["strength 1", "strength 2", "strength 3"],
  "key_concerns": ["concern 1", "concern 2"],
  "ideological_position": "e.g., 'Center-left nationalist'",
  "policy_priorities": ["policy area 1", "policy area 2", "policy area 3"],
  "experience_summary": "2-3 sentences on political experience and track record",
  "controversy_summary": "Any controversies or red flags from news/WikiLeaks, or null if none",
  "international_perception": "How foreign governments perceive them based on WikiLeaks, or null if no data",
  "analyst_summary": "3-4 sentence executive summary answering 'What kind of leader is this person?'"
}"""

    user_prompt = f"""Analyze this Nepali political candidate and generate a leadership profile:

{context}

Generate a comprehensive leadership profile as JSON. Focus on:
1. What kind of leader is {candidate_name}?
2. What are their strengths and weaknesses?
3. What should voters/analysts know about them?
4. Any red flags from news or leaked documents?

If WikiLeaks documents are available, analyze what they reveal about international perception.
Be specific and cite evidence from the provided data."""

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": HAIKU_MODEL,
                "max_tokens": 1500,
                "system": system_prompt,
                "messages": [
                    {"role": "user", "content": user_prompt}
                ],
            },
        )

        if response.status_code != 200:
            logger.error(f"[LeadershipProfile] Haiku API error: {response.status_code} - {response.text}")
            raise Exception(f"API error: {response.status_code}")

        data = response.json()

        # Extract text from response
        content = data.get("content", [])
        if content and content[0].get("type") == "text":
            return content[0].get("text", "")

        raise Exception("No text in API response")


def _parse_response(response_text: str) -> Dict[str, Any]:
    """Parse LLM response JSON."""
    try:
        # Try to extract JSON from the response
        # Sometimes LLM wraps it in markdown code blocks
        text = response_text.strip()

        # Remove markdown code blocks if present
        if text.startswith("```"):
            lines = text.split("\n")
            # Find the JSON content
            json_lines = []
            in_json = False
            for line in lines:
                if line.startswith("```") and not in_json:
                    in_json = True
                    continue
                elif line.startswith("```") and in_json:
                    break
                elif in_json:
                    json_lines.append(line)
            text = "\n".join(json_lines)

        # Parse JSON
        return json.loads(text)

    except json.JSONDecodeError as e:
        logger.warning(f"[LeadershipProfile] Failed to parse JSON: {e}")
        logger.debug(f"Raw response: {response_text[:500]}")

        # Return empty dict, will use defaults
        return {}


def clear_profile_cache(candidate_id: Optional[str] = None) -> int:
    """Clear cached profiles. Returns number of items cleared."""
    global _profile_cache

    if candidate_id:
        key = _get_cache_key(candidate_id)
        if key in _profile_cache:
            del _profile_cache[key]
            return 1
        return 0
    else:
        count = len(_profile_cache)
        _profile_cache = {}
        return count


def profile_to_dict(profile: LeadershipProfile) -> Dict[str, Any]:
    """Convert LeadershipProfile to dict for JSON serialization."""
    return asdict(profile)
