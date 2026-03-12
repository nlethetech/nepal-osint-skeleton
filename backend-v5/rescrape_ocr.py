"""Re-download and re-extract verbatim PDFs using OCR.

Replaces garbled raw_text with clean OCR output, then re-parses speeches.
Run inside Docker container:
  docker exec osint_backend python3 /app/rescrape_ocr.py          # all
  docker exec osint_backend python3 /app/rescrape_ocr.py --limit 1  # latest only
"""
import argparse
import asyncio
import logging
from uuid import uuid4

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


async def rescrape(limit: int = 0):
    from app.tasks.verbatim_scraper import (
        download_pdf, extract_text_from_pdf,
        parse_speeches, normalize_party,
    )
    from app.core.database import AsyncSessionLocal
    from app.models.parliament import VerbatimSession, ParliamentarySpeech
    from sqlalchemy import select, delete, desc

    # Phase 1: Fetch session metadata (quick DB read, then close)
    async with AsyncSessionLocal() as db:
        q = select(VerbatimSession).order_by(desc(VerbatimSession.session_date))
        if limit > 0:
            q = q.limit(limit)
        result = await db.execute(q)
        sessions = result.scalars().all()
        session_info = [
            {"id": s.id, "pdf_url": s.pdf_url, "title": (s.title_ne or "?")[:50]}
            for s in sessions
        ]
    log.info("Found %d sessions to re-extract with OCR", len(session_info))

    # Phase 2: Download + OCR each PDF (slow, no DB connection needed)
    extracted: list[tuple[str, str, list[dict]]] = []  # (session_id, new_text, speeches)
    for i, info in enumerate(session_info):
        sid = str(info["id"])[:8]
        log.info("[%d/%d] Session %s: %s", i + 1, len(session_info), sid, info["title"])

        try:
            pdf_bytes = await download_pdf(info["pdf_url"])
            log.info("  Downloaded %d KB", len(pdf_bytes) // 1024)
        except Exception as e:
            log.error("  Download failed: %s", e)
            continue

        try:
            new_text = extract_text_from_pdf(pdf_bytes)
            log.info("  Extracted %d chars", len(new_text))
        except Exception as e:
            log.error("  Extraction failed: %s", e)
            continue

        speeches_data = parse_speeches(new_text)
        log.info("  Parsed %d speeches", len(speeches_data))
        extracted.append((info["id"], new_text, speeches_data))

    # Phase 3: Save to DB (quick, fresh connection)
    total_speeches = 0
    for session_id, new_text, speeches_data in extracted:
        async with AsyncSessionLocal() as db:
            session = await db.get(VerbatimSession, session_id)
            if not session:
                continue

            session.raw_text = new_text
            await db.execute(
                delete(ParliamentarySpeech).where(
                    ParliamentarySpeech.session_id == session_id
                )
            )

            for s in speeches_data:
                raw_party = s.get("speaker_party_ne")
                clean_ne, clean_en = normalize_party(raw_party)
                speech = ParliamentarySpeech(
                    id=uuid4(),
                    session_id=session_id,
                    speaker_name_ne=s["speaker_name_ne"],
                    speaker_party_ne=clean_ne,
                    speaker_party_en=clean_en,
                    speaker_role=s.get("speaker_role"),
                    timestamp=s.get("timestamp"),
                    speech_text=s["speech_text"],
                    word_count=s.get("word_count", 0),
                    speech_order=s.get("speech_order", 0),
                )
                db.add(speech)

            session.speech_count = len(speeches_data)
            session.is_analyzed = False
            total_speeches += len(speeches_data)
            await db.commit()
            log.info("  Saved session %s: %d speeches", str(session_id)[:8], len(speeches_data))

    log.info("Done! Total speeches: %d across %d sessions", total_speeches, len(extracted))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Limit sessions (0=all)")
    args = parser.parse_args()
    asyncio.run(rescrape(limit=args.limit))
