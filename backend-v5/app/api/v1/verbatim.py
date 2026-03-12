"""Verbatim / Parliamentary Speech API endpoints.

Provides endpoints for:
- Verbatim session listing and detail
- Speech search and analytics
- MP activity leaderboard from speech data
- Scraper trigger + agent ingest
"""
from datetime import date, datetime
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, desc, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import require_dev
from app.models.parliament import VerbatimSession, ParliamentarySpeech

router = APIRouter(prefix="/verbatim", tags=["verbatim"])


# ─── Schemas ───────────────────────────────────────────────

class VerbatimSessionOut(BaseModel):
    id: str
    pdf_url: str
    title_ne: Optional[str] = None
    session_no: Optional[int] = None
    meeting_no: Optional[int] = None
    session_date_bs: Optional[str] = None
    session_date: Optional[str] = None
    chamber: str = "na"
    page_count: int = 0
    speech_count: int = 0
    is_processed: bool = False
    is_analyzed: bool = False
    session_summary: Optional[str] = None
    key_topics: Optional[list] = None
    bills_discussed: Optional[list] = None
    agenda_items: Optional[list] = None
    speaker_scores: Optional[list] = None


class SpeechOut(BaseModel):
    id: str
    session_id: str
    speaker_name_ne: str
    speaker_name_en: Optional[str] = None
    speaker_party_ne: Optional[str] = None
    speaker_party_en: Optional[str] = None
    speaker_role: Optional[str] = None
    timestamp: Optional[str] = None
    speech_text: str
    word_count: int = 0
    speech_order: int = 0
    topics: Optional[list] = None
    bills_referenced: Optional[list] = None
    stance: Optional[str] = None
    key_quotes: Optional[list] = None
    summary_en: Optional[str] = None
    session_date: Optional[str] = None


class MPActivityEntry(BaseModel):
    speaker_name_ne: str
    speaker_name_en: Optional[str] = None
    speaker_party_ne: Optional[str] = None
    speaker_party_en: Optional[str] = None
    mp_id: Optional[str] = None
    total_speeches: int
    total_words: int
    sessions_active: int
    avg_words_per_speech: float
    topics: Optional[list] = None


class SpeechAnalysisIngest(BaseModel):
    """Ingest payload from local Haiku agent."""
    session_id: str
    session_summary: Optional[str] = None
    key_topics: Optional[list] = None
    bills_discussed: Optional[list] = None
    agenda_items: Optional[list] = None  # [{topic, description, intensity, supporters, opponents, outcome}]
    speaker_scores: Optional[list] = None  # [{speaker_name_ne, name_en, party, scores...}]
    speeches: list[dict] = []  # [{speech_id, topics, bills_referenced, stance, key_quotes, summary_en}]


class BillScrapeIngest(BaseModel):
    """Ingest scraped bill data."""
    bills: list[dict]  # [{external_id, title_en, title_ne, bill_type, status, ...}]


# ─── Session Endpoints ─────────────────────────────────────

@router.get("/sessions")
async def list_sessions(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    analyzed_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """List verbatim sessions, most recent first."""
    q = select(VerbatimSession).order_by(desc(VerbatimSession.session_date))
    if analyzed_only:
        q = q.where(VerbatimSession.is_analyzed == True)
    q = q.offset(offset).limit(limit)

    result = await db.execute(q)
    sessions = result.scalars().all()

    count_q = select(func.count(VerbatimSession.id))
    if analyzed_only:
        count_q = count_q.where(VerbatimSession.is_analyzed == True)
    total = (await db.execute(count_q)).scalar() or 0

    return {
        "items": [s.to_dict() for s in sessions],
        "total": total,
    }


@router.get("/sessions/{session_id}")
async def get_session_detail(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get session detail with all speeches."""
    session = await db.get(VerbatimSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    speeches_q = (
        select(ParliamentarySpeech)
        .where(ParliamentarySpeech.session_id == session_id)
        .order_by(ParliamentarySpeech.speech_order)
    )
    result = await db.execute(speeches_q)
    speeches = result.scalars().all()

    session_dict = session.to_dict()
    session_dict["speeches"] = [
        {
            "id": str(s.id),
            "speaker_name_ne": s.speaker_name_ne,
            "speaker_name_en": s.speaker_name_en,
            "speaker_party_ne": s.speaker_party_ne,
            "speaker_party_en": s.speaker_party_en,
            "speaker_role": s.speaker_role,
            "timestamp": s.timestamp,
            "word_count": s.word_count,
            "speech_order": s.speech_order,
            "topics": s.topics,
            "stance": s.stance,
            "summary_en": s.summary_en,
            "speech_text": s.speech_text[:500] if s.speech_text else None,
        }
        for s in speeches
    ]
    return session_dict


# ─── Speech Search ─────────────────────────────────────────

@router.get("/speeches")
async def search_speeches(
    speaker: Optional[str] = Query(default=None, description="Speaker name (partial match)"),
    party: Optional[str] = Query(default=None, description="Party name filter"),
    topic: Optional[str] = Query(default=None, description="Topic keyword"),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Search speeches with filters."""
    q = (
        select(ParliamentarySpeech, VerbatimSession.session_date)
        .join(VerbatimSession, ParliamentarySpeech.session_id == VerbatimSession.id)
        .order_by(desc(VerbatimSession.session_date), ParliamentarySpeech.speech_order)
    )

    if speaker:
        q = q.where(
            (ParliamentarySpeech.speaker_name_ne.ilike(f"%{speaker}%")) |
            (ParliamentarySpeech.speaker_name_en.ilike(f"%{speaker}%"))
        )
    if party:
        q = q.where(
            (ParliamentarySpeech.speaker_party_ne.ilike(f"%{party}%")) |
            (ParliamentarySpeech.speaker_party_en.ilike(f"%{party}%"))
        )

    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    rows = result.all()

    items = []
    for speech, session_date in rows:
        items.append({
            "id": str(speech.id),
            "session_id": str(speech.session_id),
            "speaker_name_ne": speech.speaker_name_ne,
            "speaker_name_en": speech.speaker_name_en,
            "speaker_party_ne": speech.speaker_party_ne,
            "speaker_party_en": speech.speaker_party_en,
            "speaker_role": speech.speaker_role,
            "timestamp": speech.timestamp,
            "word_count": speech.word_count,
            "topics": speech.topics,
            "stance": speech.stance,
            "summary_en": speech.summary_en,
            "speech_text": speech.speech_text[:300] if speech.speech_text else None,
            "session_date": session_date.isoformat() if session_date else None,
        })

    return {"items": items, "total": len(items)}


# ─── MP Activity Leaderboard ──────────────────────────────

@router.get("/activity")
async def mp_activity_leaderboard(
    party: Optional[str] = Query(default=None, description="Filter by party"),
    limit: int = Query(default=30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """MP activity leaderboard based on speech data.

    Returns speakers ranked by total speeches, with word counts
    and session participation.
    """
    q = text("""
        SELECT
            ps.speaker_name_ne,
            ps.speaker_name_en,
            ps.speaker_party_ne,
            ps.speaker_party_en,
            ps.mp_id::text,
            COUNT(*) as total_speeches,
            SUM(ps.word_count) as total_words,
            COUNT(DISTINCT ps.session_id) as sessions_active,
            ROUND(AVG(ps.word_count)::numeric, 0) as avg_words
        FROM parliamentary_speeches ps
        WHERE ps.speaker_role != 'सम्माननीय अध्यक्ष'
        GROUP BY ps.speaker_name_ne, ps.speaker_name_en,
                 ps.speaker_party_ne, ps.speaker_party_en, ps.mp_id
        ORDER BY total_speeches DESC, total_words DESC
        LIMIT :limit
    """)

    result = await db.execute(q, {"limit": limit})
    rows = result.fetchall()

    items = [
        MPActivityEntry(
            speaker_name_ne=r[0],
            speaker_name_en=r[1],
            speaker_party_ne=r[2],
            speaker_party_en=r[3],
            mp_id=r[4],
            total_speeches=r[5],
            total_words=r[6] or 0,
            sessions_active=r[7],
            avg_words_per_speech=float(r[8] or 0),
        ).model_dump()
        for r in rows
    ]

    return {"items": items, "total": len(items)}


@router.get("/activity/party-summary")
async def party_activity_summary(
    db: AsyncSession = Depends(get_db),
):
    """Aggregate speech activity by party."""
    q = text("""
        SELECT
            COALESCE(ps.speaker_party_en, ps.speaker_party_ne, 'Unknown') as party,
            COUNT(*) as total_speeches,
            COUNT(DISTINCT ps.speaker_name_ne) as unique_speakers,
            SUM(ps.word_count) as total_words,
            COUNT(DISTINCT ps.session_id) as sessions_active
        FROM parliamentary_speeches ps
        WHERE ps.speaker_role != 'सम्माननीय अध्यक्ष'
        GROUP BY COALESCE(ps.speaker_party_en, ps.speaker_party_ne, 'Unknown')
        ORDER BY total_speeches DESC
    """)

    result = await db.execute(q)
    rows = result.fetchall()

    return {
        "items": [
            {
                "party": r[0],
                "total_speeches": r[1],
                "unique_speakers": r[2],
                "total_words": r[3] or 0,
                "sessions_active": r[4],
            }
            for r in rows
        ]
    }


# ─── Scoreboard & Agenda Timeline ─────────────────────────

@router.get("/scoreboard")
async def mp_scoreboard(
    limit: int = Query(default=30, ge=1, le=100),
    min_sessions: int = Query(default=1, ge=1),
    chamber: Optional[str] = Query(default=None, description="Filter by chamber: hor or na"),
    db: AsyncSession = Depends(get_db),
):
    """MP scoreboard — hybrid quantitative + AI quality scores.

    Scoring methodology:
    ─────────────────────────────────────────────
    1. participation_rate = (sessions_active / total_sessions) × 100
       How often the MP shows up and speaks.

    2. activity_score = percentile rank of total_speeches among all MPs (0-100)
       How many times they spoke compared to peers.

    3. quality_score = AI-assessed debate quality (0-100)
       Average of Haiku relevance_score and engagement_score across sessions,
       normalized to 0-100 scale. Measures policy substance, factual depth,
       and constructive engagement — not just word count.
       Falls back to word count percentile if no AI analysis exists.

    4. overall_score = (participation × 0.35) + (activity × 0.25) + (quality × 0.40)
       Quality weighted highest because substantive debate matters most.

    Data source: parliamentary verbatim PDFs from hr.parliament.gov.np
    AI quality assessment: Claude Haiku analysis of speech content
    Only includes MPs (excludes chair/procedural speakers).
    """
    # Get total analyzed sessions for participation rate denominator
    chamber_clause = "AND vs.chamber = :chamber" if chamber else ""
    total_sessions_q = text(
        f"SELECT COUNT(*) FROM verbatim_sessions vs WHERE vs.is_analyzed = true {chamber_clause}"
    )
    total_analyzed = (await db.execute(total_sessions_q, {"chamber": chamber} if chamber else {})).scalar() or 1

    # Raw MP stats from speech data (exclude chair speakers, only analyzed sessions)
    q = text(f"""
        SELECT
            ps.speaker_name_ne,
            ps.speaker_party_ne,
            ps.speaker_party_en,
            COUNT(*) as total_speeches,
            SUM(ps.word_count) as total_words,
            COUNT(DISTINCT ps.session_id) as sessions_active,
            ROUND(AVG(ps.word_count)::numeric, 0) as avg_words
        FROM parliamentary_speeches ps
        JOIN verbatim_sessions vs ON vs.id = ps.session_id
        WHERE ps.speaker_role != 'सम्माननीय अध्यक्ष'
          AND ps.speaker_name_ne != ''
          AND ps.speaker_name_ne NOT LIKE 'अध्यक्ष%%'
          AND ps.word_count > 20
          AND vs.is_analyzed = true
          {chamber_clause}
        GROUP BY ps.speaker_name_ne, ps.speaker_party_ne, ps.speaker_party_en
        HAVING COUNT(*) >= 1
        ORDER BY COUNT(*) DESC
    """)
    result = await db.execute(q, {"chamber": chamber} if chamber else {})
    rows = result.fetchall()

    if not rows:
        return {"items": [], "total": 0, "methodology": _METHODOLOGY, "total_sessions": total_analyzed}

    # Load AI quality scores from speaker_scores JSONB across all analyzed sessions
    ai_scores_q = text(f"""
        SELECT speaker_scores
        FROM verbatim_sessions vs
        WHERE vs.is_analyzed = true AND vs.speaker_scores IS NOT NULL
        {chamber_clause}
    """)
    ai_result = await db.execute(ai_scores_q, {"chamber": chamber} if chamber else {})
    ai_rows = ai_result.fetchall()

    # Aggregate AI scores per speaker (average relevance + engagement across sessions)
    ai_quality: dict[str, list[float]] = {}  # name_ne → [score1, score2, ...]
    ai_contributions: dict[str, list[str]] = {}  # name_ne → [contribution1, ...]
    for row in ai_rows:
        scores_list = row[0] or []
        for entry in scores_list:
            name = entry.get("speaker_name_ne", "")
            if not name:
                continue
            relevance = entry.get("relevance_score", 0)
            engagement = entry.get("engagement_score", 0)
            # Average of relevance and engagement, both 1-10 scale
            combined = (relevance + engagement) / 2.0
            ai_quality.setdefault(name, []).append(combined)
            contribution = entry.get("key_contribution")
            if contribution:
                ai_contributions.setdefault(name, []).append(contribution)

    # Compute percentile-based scores
    all_speeches = sorted([r[3] for r in rows])
    all_avg_words = sorted([float(r[6] or 0) for r in rows])

    def percentile(sorted_list, value):
        """Rank as percentile (0-100)."""
        if len(sorted_list) <= 1:
            return 100.0
        count_below = sum(1 for v in sorted_list if v < value)
        return round((count_below / (len(sorted_list) - 1)) * 100, 1)

    items = []
    for r in rows:
        name_ne = r[0]
        party_ne = r[1]
        party_en = r[2]
        speeches = r[3]
        words = r[4] or 0
        sessions = r[5]
        avg_w = float(r[6] or 0)

        participation = round((sessions / total_analyzed) * 100, 1)
        activity = percentile(all_speeches, speeches)

        # Quality score: use AI if available, fall back to word count percentile
        ai_scores_for_mp = ai_quality.get(name_ne)
        if ai_scores_for_mp:
            # Average AI score (1-10) → normalize to 0-100
            avg_ai = sum(ai_scores_for_mp) / len(ai_scores_for_mp)
            quality = round(avg_ai * 10, 1)  # 1-10 → 10-100
            quality_source = "ai"
        else:
            quality = percentile(all_avg_words, avg_w)
            quality_source = "word_count"

        overall = round(
            participation * 0.35 + activity * 0.25 + quality * 0.40, 1
        )

        item = {
            "name_ne": name_ne,
            "party_ne": party_ne,
            "party_en": party_en,
            "sessions_active": sessions,
            "total_speeches": speeches,
            "total_words": words,
            "avg_words_per_speech": avg_w,
            "participation_rate": min(participation, 100),
            "activity_score": activity,
            "quality_score": quality,
            "quality_source": quality_source,
            "overall_score": overall,
        }

        # Include key contributions from AI if available
        contributions = ai_contributions.get(name_ne)
        if contributions:
            item["key_contributions"] = contributions[:3]  # Top 3

        items.append(item)

    # Sort by overall score descending
    items.sort(key=lambda x: x["overall_score"], reverse=True)
    items = items[:limit]

    return {
        "items": items,
        "total": len(items),
        "total_sessions": total_analyzed,
        "methodology": _METHODOLOGY,
    }


_METHODOLOGY = {
    "description": "Hybrid quantitative + AI quality scores from verbatim speech records",
    "data_source": "hr.parliament.gov.np verbatim PDFs, text-extracted and parsed",
    "ai_model": "Claude Haiku — analyzes speech content for policy substance and debate quality",
    "excludes": "Chair/procedural speakers (सम्माननीय अध्यक्ष), speeches under 20 words",
    "scores": {
        "participation_rate": "sessions_active / total_sessions × 100 — How often the MP speaks across sessions (35%)",
        "activity_score": "Percentile rank of total speeches among all MPs (0-100) — Speaking frequency (25%)",
        "quality_score": "AI-assessed debate quality (0-100) — Average of relevance + engagement scores from Claude Haiku analysis. Measures policy substance, factual depth, and constructive engagement. Falls back to word count percentile if AI analysis unavailable. (40%)",
        "overall_score": "(participation × 0.35) + (activity × 0.25) + (quality × 0.40)",
    },
    "weights": {"participation": 0.35, "activity": 0.25, "quality": 0.40},
    "note": "Quality scores are AI-assessed by Claude Haiku on a 1-10 scale (relevance + engagement), normalized to 0-100. A concise, factual MP scores higher than a verbose one with low substance.",
}


@router.get("/agenda-timeline")
async def agenda_timeline(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Agenda items across sessions, chronologically."""
    q = text("""
        SELECT
            vs.session_date,
            vs.meeting_no,
            vs.session_date_bs,
            vs.session_summary,
            item
        FROM verbatim_sessions vs,
             jsonb_array_elements(vs.agenda_items) as item
        WHERE vs.is_analyzed = true
          AND vs.agenda_items IS NOT NULL
        ORDER BY vs.session_date DESC
        LIMIT :limit
    """)
    result = await db.execute(q, {"limit": limit})
    rows = result.fetchall()

    return {
        "items": [
            {
                "session_date": r[0].isoformat() if r[0] else None,
                "meeting_no": r[1],
                "session_date_bs": r[2],
                "session_summary": r[3],
                **r[4],  # Unpack the JSONB agenda item
            }
            for r in rows
        ],
        "total": len(rows),
    }


# ─── Summary for Dashboard Widget ─────────────────────────

@router.get("/summary")
async def verbatim_summary(
    db: AsyncSession = Depends(get_db),
):
    """Dashboard summary of verbatim data."""
    stats = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM verbatim_sessions) as total_sessions,
            (SELECT COUNT(*) FROM verbatim_sessions WHERE is_analyzed = true) as analyzed_sessions,
            (SELECT COUNT(*) FROM parliamentary_speeches ps
             JOIN verbatim_sessions vs ON vs.id = ps.session_id
             WHERE vs.is_analyzed = true) as total_speeches,
            (SELECT COUNT(DISTINCT ps.speaker_name_ne) FROM parliamentary_speeches ps
             JOIN verbatim_sessions vs ON vs.id = ps.session_id
             WHERE ps.speaker_role != 'सम्माननीय अध्यक्ष'
               AND vs.is_analyzed = true) as unique_speakers,
            (SELECT SUM(ps.word_count) FROM parliamentary_speeches ps
             JOIN verbatim_sessions vs ON vs.id = ps.session_id
             WHERE vs.is_analyzed = true) as total_words
    """))
    row = stats.fetchone()

    # Top speakers (only from analyzed sessions)
    top = await db.execute(text("""
        SELECT
            ps.speaker_name_ne,
            ps.speaker_name_en,
            ps.speaker_party_en,
            COUNT(*) as speeches,
            SUM(ps.word_count) as words
        FROM parliamentary_speeches ps
        JOIN verbatim_sessions vs ON vs.id = ps.session_id
        WHERE ps.speaker_role != 'सम्माननीय अध्यक्ष'
          AND vs.is_analyzed = true
        GROUP BY ps.speaker_name_ne, ps.speaker_name_en, ps.speaker_party_en
        ORDER BY speeches DESC
        LIMIT 10
    """))
    top_rows = top.fetchall()

    # Recent sessions (only analyzed)
    recent = await db.execute(
        select(VerbatimSession)
        .where(VerbatimSession.is_analyzed == True)
        .order_by(desc(VerbatimSession.session_date))
        .limit(5)
    )
    recent_sessions = recent.scalars().all()

    return {
        "total_sessions": row[0] or 0,
        "analyzed_sessions": row[1] or 0,
        "total_speeches": row[2] or 0,
        "unique_speakers": row[3] or 0,
        "total_words": row[4] or 0,
        "top_speakers": [
            {
                "name_ne": r[0],
                "name_en": r[1],
                "party": r[2],
                "speeches": r[3],
                "words": r[4] or 0,
            }
            for r in top_rows
        ],
        "recent_sessions": [s.to_dict() for s in recent_sessions],
    }


# ─── Pending Analysis (for local Haiku runner) ───────────

@router.get("/pending-analysis", dependencies=[Depends(require_dev)])
async def get_pending_analysis(
    limit: int = Query(default=5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Get unanalyzed sessions with speeches for local Claude CLI runner."""
    sessions_q = (
        select(VerbatimSession)
        .where(VerbatimSession.is_analyzed == False)
        .where(VerbatimSession.is_processed == True)
        .order_by(desc(VerbatimSession.session_date))
        .limit(limit)
    )
    result = await db.execute(sessions_q)
    sessions = result.scalars().all()

    items = []
    for session in sessions:
        speeches_q = (
            select(ParliamentarySpeech)
            .where(ParliamentarySpeech.session_id == session.id)
            .order_by(ParliamentarySpeech.speech_order)
        )
        speeches_result = await db.execute(speeches_q)
        speeches = speeches_result.scalars().all()

        items.append({
            "session_id": str(session.id),
            "title_ne": session.title_ne,
            "session_date": session.session_date.isoformat() if session.session_date else None,
            "session_date_bs": session.session_date_bs,
            "speech_count": len(speeches),
            "speeches": [
                {
                    "speech_id": str(s.id),
                    "speaker_name_ne": s.speaker_name_ne,
                    "speaker_party_ne": s.speaker_party_ne,
                    "speaker_party_en": s.speaker_party_en,
                    "speaker_role": s.speaker_role,
                    "timestamp": s.timestamp,
                    "speech_text": s.speech_text[:3000] if s.speech_text else "",
                    "word_count": s.word_count,
                }
                for s in speeches
            ],
        })

    return {"sessions": items, "total": len(items)}


# ─── Admin: Scrape & Ingest ───────────────────────────────

@router.post("/admin/scrape", tags=["verbatim-admin"])
async def trigger_verbatim_scrape(
    start_date: str = Query(default="2025-01-01"),
    end_date: str = Query(default="2026-12-31"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_dev),
):
    """Scrape verbatim PDFs, extract text, parse speeches (dev-only)."""
    from app.tasks.verbatim_scraper import (
        fetch_verbatim_listing,
        download_pdf,
        extract_text_from_pdf,
        parse_speeches,
        extract_session_info,
        parse_ad_date,
        translate_party,
    )

    listing = await fetch_verbatim_listing(start_date, end_date)
    stats = {"found": len(listing), "new": 0, "speeches_added": 0, "errors": []}

    for item in listing:
        pdf_url = item["pdf_url"]

        # Check if already exists
        existing = await db.execute(
            select(VerbatimSession).where(VerbatimSession.pdf_url == pdf_url)
        )
        if existing.scalar():
            continue

        try:
            # Download and extract
            pdf_bytes = await download_pdf(pdf_url)
            raw_text = extract_text_from_pdf(pdf_bytes)
            page_count = raw_text.count("\n\n") + 1

            # Parse session info from title
            info = extract_session_info(item["title_ne"])
            session_date = parse_ad_date(item["date_str"])

            # Detect chamber from raw text: राष्ट्रिय सभा = NA, प्रतिनिधि सभा = HoR
            if "राष्ट्रिय सभा" in raw_text[:2000]:
                chamber = "na"
            elif "प्रतिनिधि सभा" in raw_text[:2000]:
                chamber = "hor"
            else:
                chamber = "na"  # Default for na.parliament.gov.np source

            # Create session record
            session = VerbatimSession(
                id=uuid4(),
                pdf_url=pdf_url,
                title_ne=item["title_ne"],
                session_no=info["session_no"],
                meeting_no=info["meeting_no"],
                session_date_bs=info["session_date_bs"],
                session_date=session_date,
                chamber=chamber,
                raw_text=raw_text,
                page_count=page_count,
                is_processed=True,
                scraped_at=datetime.utcnow(),
            )
            db.add(session)

            # Parse speeches
            speeches = parse_speeches(raw_text)
            for s in speeches:
                party_en = translate_party(s["speaker_party_ne"])
                speech = ParliamentarySpeech(
                    id=uuid4(),
                    session_id=session.id,
                    speaker_name_ne=s["speaker_name_ne"],
                    speaker_party_ne=s["speaker_party_ne"],
                    speaker_party_en=party_en,
                    speaker_role=s["speaker_role"],
                    timestamp=s["timestamp"],
                    speech_text=s["speech_text"],
                    word_count=s["word_count"],
                    speech_order=s["speech_order"],
                )
                db.add(speech)

            session.speech_count = len(speeches)
            stats["new"] += 1
            stats["speeches_added"] += len(speeches)

        except Exception as e:
            stats["errors"].append({"url": pdf_url, "error": str(e)})

    await db.commit()
    return stats


@router.post("/admin/ingest-analysis", tags=["verbatim-admin"])
async def ingest_speech_analysis(
    payload: SpeechAnalysisIngest,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_dev),
):
    """Ingest AI analysis results from local Sonnet agent (dev-only)."""
    session = await db.get(VerbatimSession, UUID(payload.session_id))
    if not session:
        raise HTTPException(404, "Session not found")

    # Update session-level analysis
    if payload.session_summary:
        session.session_summary = payload.session_summary
    if payload.key_topics:
        session.key_topics = payload.key_topics
    if payload.bills_discussed:
        session.bills_discussed = payload.bills_discussed
    if payload.agenda_items:
        session.agenda_items = payload.agenda_items
    if payload.speaker_scores:
        session.speaker_scores = payload.speaker_scores

    # Update individual speeches
    updated = 0
    for s_data in payload.speeches:
        speech_id = s_data.get("speech_id")
        if not speech_id:
            continue
        speech = await db.get(ParliamentarySpeech, UUID(speech_id))
        if not speech:
            continue

        if s_data.get("topics"):
            speech.topics = s_data["topics"]
        if s_data.get("bills_referenced"):
            speech.bills_referenced = s_data["bills_referenced"]
        if s_data.get("stance"):
            speech.stance = s_data["stance"]
        if s_data.get("key_quotes"):
            speech.key_quotes = s_data["key_quotes"]
        if s_data.get("summary_en"):
            speech.summary_en = s_data["summary_en"]
        if s_data.get("speaker_name_en"):
            speech.speaker_name_en = s_data["speaker_name_en"]
        updated += 1

    session.is_analyzed = True
    session.analyzed_at = datetime.utcnow()

    await db.commit()
    return {"message": f"Analysis ingested for session {payload.session_id}", "speeches_updated": updated}


@router.post("/admin/scrape-bills", tags=["verbatim-admin"])
async def scrape_and_ingest_bills(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_dev),
):
    """Scrape HoR bills from parliament website with full details (dev-only).

    Phase 1: Scrape bill listing pages (title, date, ministry, status)
    Phase 2: Scrape individual detail pages (presenter, status timeline, session, category)
    """
    import ssl
    import re
    import httpx
    from app.models.parliament import ParliamentBill

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    stats = {"found": 0, "new": 0, "updated": 0, "details_fetched": 0, "errors": []}

    # Status mapping from parliament display text
    STATUS_MAP = {
        "General Discussion": "first_reading",
        "Discussion in Committee": "committee",
        "Discussion in house": "second_reading",
        "Report Submitted by Committee": "committee",
        "Passed by House": "passed",
        "Distribution to member": "registered",
        "Authenticated": "passed",
    }

    # Status timeline keys → date field names (from detail page)
    TIMELINE_KEYS = [
        "Distribution to member",
        "Present in house",
        "General Discussion",
        "Discussion in house",
        "Discussion in Committee",
        "Report Submitted by Committee",
        "Passed by House",
        "Passed/Return By National Assembly",
        "Repassed",
        "Authenticated",
    ]

    bill_types = [
        ("state", "BILL", "government"),
        ("reg", "BILL", "private_member"),
        ("auth", "BILL", "money"),
    ]

    # ── Phase 1: Scrape listing pages ──
    seen_slugs: set[str] = set()
    async with httpx.AsyncClient(verify=ssl_ctx, timeout=30.0) as client:
        for type_param, ref_param, bill_type in bill_types:
            try:
                url = f"https://hr.parliament.gov.np/en/bills?type={type_param}&ref={ref_param}"
                resp = await client.get(url)
                html = resp.text

                tables = re.findall(r'<table[^>]*>(.*?)</table>', html, re.DOTALL)
                for table in tables:
                    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.DOTALL)
                    for row in rows:
                        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.DOTALL)
                        if len(cells) < 5:
                            continue
                        cells_clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                        if cells_clean[0] == "Session":
                            continue
                        links = re.findall(r'href="([^"]+/bills/[^"]+)"', row)
                        if not links:
                            continue

                        slug = links[0].split("/bills/")[-1]
                        if slug in seen_slugs:
                            continue
                        seen_slugs.add(slug)

                        session_no = cells_clean[0] if cells_clean[0].isdigit() else None
                        reg_no = cells_clean[1] if len(cells_clean) > 1 else None
                        date_str = cells_clean[2] if len(cells_clean) > 2 else ""
                        title = cells_clean[3] if len(cells_clean) > 3 else ""
                        ministry = cells_clean[4] if len(cells_clean) > 4 else ""
                        status_raw = cells_clean[5] if len(cells_clean) > 5 else ""

                        if not title:
                            continue
                        stats["found"] += 1
                        status = STATUS_MAP.get(status_raw, "registered")

                        existing = await db.execute(
                            select(ParliamentBill).where(ParliamentBill.external_id == slug)
                        )
                        bill = existing.scalar()
                        if bill:
                            bill.status = status
                            bill.title_en = title
                            bill.ministry = ministry
                            if session_no:
                                bill.term = f"Session {session_no}"
                            stats["updated"] += 1
                        else:
                            bill = ParliamentBill(
                                id=uuid4(),
                                external_id=slug,
                                title_en=title,
                                bill_type=bill_type,
                                status=status,
                                ministry=ministry,
                                chamber="hor",
                                term=f"Session {session_no}" if session_no else None,
                                summary=f"Presented: {date_str}" if date_str else None,
                                scraped_at=datetime.utcnow(),
                            )
                            db.add(bill)
                            stats["new"] += 1

            except Exception as e:
                stats["errors"].append({"type": type_param, "error": str(e)})

    await db.flush()  # Ensure all bills have IDs before detail fetch

    # ── Phase 2: Scrape individual bill detail pages ──
    bills_needing_detail = await db.execute(
        select(ParliamentBill)
        .where(ParliamentBill.chamber == "hor")
        .where(
            (ParliamentBill.summary == None) |
            (~ParliamentBill.summary.like("Presenter:%"))
        )
        .limit(50)
    )
    async with httpx.AsyncClient(verify=ssl_ctx, timeout=15.0) as client:
        for bill in bills_needing_detail.scalars():
            if not bill.external_id:
                continue
            try:
                detail_url = f"https://hr.parliament.gov.np/en/bills/{bill.external_id}"
                resp = await client.get(detail_url)
                html = resp.text

                idx = html.find("single-bill-view")
                if idx < 0:
                    continue
                chunk = html[idx:idx + 8000]

                # Extract key-value pairs from detail table
                detail_rows = re.findall(r'<tr[^>]*>(.*?)</tr>', chunk, re.DOTALL)
                detail = {}
                for drow in detail_rows:
                    dcells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', drow, re.DOTALL)
                    if len(dcells) >= 2:
                        key = re.sub(r'<[^>]+>', '', dcells[0]).strip()
                        val = re.sub(r'<[^>]+>', '', dcells[1]).strip()
                        if key and val:
                            detail[key] = val

                # Extract presenter
                presenter = detail.get("Presenter", "")
                if presenter:
                    bill.summary = f"Presenter: {presenter}"

                # Extract status timeline dates
                # The first row has status labels, second row has dates
                timeline_row = detail_rows[1] if len(detail_rows) > 1 else ""
                timeline_cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', timeline_row, re.DOTALL)
                timeline_dates = [re.sub(r'<[^>]+>', '', c).strip() for c in timeline_cells]

                # Build timeline dict
                timeline = {}
                for i, key in enumerate(TIMELINE_KEYS):
                    if i < len(timeline_dates) and timeline_dates[i]:
                        timeline[key] = timeline_dates[i]

                # Derive accurate status from timeline (most advanced stage wins)
                if timeline.get("Authenticated") or timeline.get("Repassed"):
                    bill.status = "passed"
                elif timeline.get("Passed by House"):
                    bill.status = "passed"
                elif timeline.get("Discussion in house"):
                    bill.status = "second_reading"
                elif timeline.get("Report Submitted by Committee") or timeline.get("Discussion in Committee"):
                    bill.status = "committee"
                elif timeline.get("General Discussion"):
                    bill.status = "first_reading"

                # Store timeline + other details in summary
                parts = []
                if presenter:
                    parts.append(f"Presenter: {presenter}")
                category = detail.get("Category", "")
                if category:
                    parts.append(f"Category: {category}")
                orig_amend = detail.get("Original/Amendment", "")
                if orig_amend:
                    parts.append(f"Type: {orig_amend}")
                if timeline:
                    dates_str = " → ".join(f"{k}: {v}" for k, v in timeline.items())
                    parts.append(f"Timeline: {dates_str}")
                if parts:
                    bill.summary = "\n".join(parts)

                stats["details_fetched"] += 1

            except Exception as e:
                stats["errors"].append({"bill": bill.external_id, "error": str(e)})

    await db.commit()
    return stats
