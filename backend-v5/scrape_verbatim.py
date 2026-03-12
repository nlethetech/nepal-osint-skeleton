"""One-shot script to scrape all verbatim PDFs and ingest into DB.

Downloads PDFs FIRST (network I/O), then opens DB session to store.
This avoids DB connection timeouts during slow downloads.
"""
import asyncio
from uuid import uuid4
from datetime import datetime, timezone


async def scrape_all():
    from app.tasks.verbatim_scraper import (
        fetch_verbatim_listing, download_pdf, extract_text_from_pdf,
        parse_speeches, extract_session_info, parse_ad_date, translate_party
    )
    from app.core.database import AsyncSessionLocal
    from app.models.parliament import VerbatimSession, ParliamentarySpeech
    from sqlalchemy import select

    listing = await fetch_verbatim_listing("2025-01-01", "2026-12-31")
    print(f"Found {len(listing)} PDFs")

    new_count = 0
    speech_count = 0
    error_count = 0

    for i, item in enumerate(listing):
        pdf_url = item["pdf_url"]

        # Quick DB check for existing
        async with AsyncSessionLocal() as db:
            existing = await db.execute(
                select(VerbatimSession.id).where(VerbatimSession.pdf_url == pdf_url)
            )
            if existing.scalar():
                print(f"  [{i+1}/{len(listing)}] SKIP (exists)")
                continue

        # Download and parse OUTSIDE of DB session
        try:
            title = item["title_ne"][:50] if item["title_ne"] else "?"
            print(f"  [{i+1}/{len(listing)}] DL: {title}...", end=" ", flush=True)
            pdf_bytes = await download_pdf(pdf_url)
            raw_text = extract_text_from_pdf(pdf_bytes)
            speeches_data = parse_speeches(raw_text)
            info = extract_session_info(item.get("title_ne", ""))
            session_date = parse_ad_date(item.get("date_str", ""))
            size_kb = len(pdf_bytes) // 1024
            print(f"{size_kb}KB, {len(speeches_data)} speeches...", end=" ", flush=True)
        except Exception as e:
            error_count += 1
            print(f"DOWNLOAD ERROR: {e}")
            continue

        # Store in DB (fresh connection, fast operation)
        try:
            async with AsyncSessionLocal() as db:
                session_id = uuid4()
                session = VerbatimSession(
                    id=session_id,
                    pdf_url=pdf_url,
                    title_ne=item.get("title_ne"),
                    session_no=info.get("session_no"),
                    meeting_no=info.get("meeting_no"),
                    session_date_bs=info.get("session_date_bs"),
                    session_date=session_date,
                    raw_text=raw_text,
                    page_count=raw_text.count(chr(12)) + 1,
                    speech_count=len(speeches_data),
                    is_processed=True,
                    scraped_at=datetime.now(timezone.utc),
                )
                db.add(session)

                for s in speeches_data:
                    party_en = translate_party(s.get("speaker_party_ne"))
                    speech = ParliamentarySpeech(
                        id=uuid4(),
                        session_id=session_id,
                        speaker_name_ne=s["speaker_name_ne"],
                        speaker_party_ne=s.get("speaker_party_ne"),
                        speaker_party_en=party_en,
                        speaker_role=s.get("speaker_role"),
                        timestamp=s.get("timestamp"),
                        speech_text=s["speech_text"],
                        word_count=s.get("word_count", 0),
                        speech_order=s.get("speech_order", 0),
                    )
                    db.add(speech)

                await db.commit()
                new_count += 1
                speech_count += len(speeches_data)
                print("saved!")

        except Exception as e:
            error_count += 1
            print(f"DB ERROR: {e}")

    print(f"\nDone! New sessions: {new_count}, Speeches: {speech_count}, Errors: {error_count}")


if __name__ == "__main__":
    asyncio.run(scrape_all())
