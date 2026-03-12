"""Re-parse speeches from stored raw_text using updated regex patterns.

Uses normalize_party() to clean garbled Nepali party names and produce
both proper Nepali and English party names.
"""
import asyncio
from uuid import uuid4


async def reparse():
    from app.tasks.verbatim_scraper import parse_speeches, normalize_party
    from app.core.database import AsyncSessionLocal
    from app.models.parliament import VerbatimSession, ParliamentarySpeech
    from sqlalchemy import select, delete

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(VerbatimSession))
        sessions = result.scalars().all()
        print(f"Found {len(sessions)} sessions to re-parse")

        party_stats: dict[str, int] = {}  # Track normalized parties
        total_speeches = 0
        for session in sessions:
            if not session.raw_text:
                print(f"  {str(session.id)[:8]}: no raw_text, skip")
                continue

            # Delete old speeches for this session
            await db.execute(
                delete(ParliamentarySpeech).where(
                    ParliamentarySpeech.session_id == session.id
                )
            )

            # Re-parse
            speeches_data = parse_speeches(session.raw_text)
            for s in speeches_data:
                raw_party = s.get("speaker_party_ne")
                clean_ne, clean_en = normalize_party(raw_party)
                # normalize_party returns (None, None) for invalid/misparse
                # entries AND (cleaned, None) for unrecognized-but-valid.
                # Never fall back to raw_party — trust normalize_party's verdict.
                speech = ParliamentarySpeech(
                    id=uuid4(),
                    session_id=session.id,
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
                key = f"{clean_ne or '(rejected)'} → {clean_en or '?'}"
                party_stats[key] = party_stats.get(key, 0) + 1

            session.speech_count = len(speeches_data)
            total_speeches += len(speeches_data)
            title = (session.title_ne or "?")[:40]
            print(f"  {str(session.id)[:8]}: {len(speeches_data)} speeches — {title}")

        await db.commit()
        print(f"\nDone! Total speeches parsed: {total_speeches}")
        print("\nParty normalization results:")
        for party, count in sorted(party_stats.items(), key=lambda x: -x[1]):
            print(f"  {count:4d}  {party}")


if __name__ == "__main__":
    asyncio.run(reparse())
