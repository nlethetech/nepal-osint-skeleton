"""Scraper for Nepal Election Commission live results.

Polls result.election.gov.np for HOR FPTP constituency-level vote counts
and party summaries. Designed to run every 2-5 minutes during counting.

Endpoints used:
  - /Handlers/SecureJson.ashx?file=JSONFiles/Election2082/Common/HoRPartyTop5.txt
  - /Handlers/SecureJson.ashx?file=JSONFiles/Election2082/HOR/FPTP/HOR-{dist}-{const}.json
  - /Handlers/SecureJson.ashx?file=JSONFiles/Election2082/HOR/Lookup/constituencies.json
  - /Handlers/SecureJson.ashx?file=JSONFiles/Election2082/Local/Lookup/districts.json
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select, update, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.election_result import ElectionCandidate, ElectionPartySummary, ElectionScrapeLog

logger = logging.getLogger(__name__)

BASE_URL = "https://result.election.gov.np"
HANDLER = "/Handlers/SecureJson.ashx"
ELECTION_YEAR = "2082"


class ECNResultsClient:
    """HTTP client that handles ECN session + CSRF token."""

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=15.0,
            verify=False,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; OSINT/1.0)"},
        )
        self.csrf_token: str | None = None

    async def init_session(self):
        """Get session cookie + CSRF token by hitting the main page. Retries up to 3 times."""
        for attempt in range(3):
            try:
                r = await self.client.get(f"{BASE_URL}/")
                if r.status_code in (502, 503, 504):
                    logger.warning(f"ECN main page returned {r.status_code}, retry {attempt+1}/3")
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                r.raise_for_status()
                self.csrf_token = self.client.cookies.get("CsrfToken")
                if not self.csrf_token:
                    raise RuntimeError("Failed to get CsrfToken from ECN")
                logger.info(f"ECN session established, CSRF: {self.csrf_token[:8]}...")
                return
            except httpx.ConnectError:
                logger.warning(f"ECN connection error, retry {attempt+1}/3")
                await asyncio.sleep(5 * (attempt + 1))
        raise RuntimeError("ECN unreachable after 3 retries")

    async def fetch_json(self, file_path: str) -> list | dict | None:
        """Fetch a JSON file via SecureJson handler. Retries on 429/403."""
        if not self.csrf_token:
            await self.init_session()

        url = f"{BASE_URL}{HANDLER}?file={file_path}"

        for attempt in range(4):
            r = await self.client.get(
                url,
                headers={
                    "X-CSRF-Token": self.csrf_token,
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"{BASE_URL}/",
                },
            )

            if r.status_code == 429:
                wait = 10 * (2 ** attempt)  # 10, 20, 40, 80s
                logger.warning(f"ECN 429 rate-limited on {file_path}, waiting {wait}s (attempt {attempt+1}/4)")
                await asyncio.sleep(wait)
                continue

            if r.status_code == 403:
                # Session expired — re-init and retry
                logger.info("ECN 403 — refreshing session")
                await self.init_session()
                continue

            break
        else:
            logger.warning(f"ECN gave up after 4 retries for {file_path}")
            return None

        if r.status_code == 404:
            return None

        if r.status_code in (500, 502, 503, 504):
            logger.warning(f"ECN server error {r.status_code} for {file_path}")
            return None

        r.raise_for_status()

        text = r.text.strip()
        if text.startswith("\ufeff"):
            text = text[1:]

        if not text or text == "[]":
            return []

        return json.loads(text)

    async def close(self):
        await self.client.aclose()


async def scrape_election_results():
    """Main scraper entry point. Fetches all HOR FPTP results."""
    log_id = None
    client = ECNResultsClient()

    try:
        await client.init_session()

        async with AsyncSessionLocal() as db:
            # Create scrape log
            log = ElectionScrapeLog()
            db.add(log)
            await db.flush()
            log_id = log.id

            # 1. Fetch constituencies lookup
            consts_data = await client.fetch_json(
                f"JSONFiles/Election{ELECTION_YEAR}/HOR/Lookup/constituencies.json"
            )
            if not consts_data:
                logger.warning("No constituencies data available yet")
                log.error = "No constituencies data"
                log.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return

            # 2. Fetch districts lookup for name mapping
            districts_data = await client.fetch_json(
                f"JSONFiles/Election{ELECTION_YEAR}/Local/Lookup/districts.json"
            )
            dist_map = {}
            if districts_data:
                for d in districts_data:
                    dist_map[d["id"]] = d

            # 3. Fetch states lookup
            states_data = await client.fetch_json(
                f"JSONFiles/Election{ELECTION_YEAR}/Local/Lookup/states.json"
            )
            state_map = {}
            if states_data:
                for s in states_data:
                    state_map[s["id"]] = s["name"]

            # 4. Scrape each constituency (deduplicate — ECN lookup has duplicate distId=77)
            total_scraped = 0
            total_updated = 0
            seen_districts = set()

            for const_entry in consts_data:
                dist_id = const_entry["distId"]
                if dist_id in seen_districts:
                    continue
                seen_districts.add(dist_id)
                num_consts = const_entry["consts"]

                for const_no in range(1, num_consts + 1):
                    try:
                        candidates = await client.fetch_json(
                            f"JSONFiles/Election{ELECTION_YEAR}/HOR/FPTP/HOR-{dist_id}-{const_no}.json"
                        )

                        if not candidates:
                            continue

                        total_scraped += 1

                        updated = await _upsert_candidates(
                            db, candidates, dist_id, const_no, dist_map, state_map
                        )
                        total_updated += updated

                        # Commit every 10 constituencies to avoid losing data
                        if total_scraped % 10 == 0:
                            await db.commit()

                        # Respectful delay to avoid ECN 429 rate limiting
                        await asyncio.sleep(4)

                    except Exception as e:
                        logger.warning(f"Error scraping HOR-{dist_id}-{const_no}: {e}")

            # 5. Fetch party summary
            party_data = await client.fetch_json(
                f"JSONFiles/Election{ELECTION_YEAR}/Common/HoRPartyTop5.txt"
            )
            if party_data:
                await _upsert_party_summary(db, party_data, "hor")

            # Also fetch PA party summaries for each state
            for state_id in range(1, 8):
                pa_data = await client.fetch_json(
                    f"JSONFiles/Election{ELECTION_YEAR}/Common/PAPartyTop5-S{state_id}.txt"
                )
                if pa_data:
                    await _upsert_party_summary(db, pa_data, "pa", state_id=state_id)

            # 6. Update scrape log
            log.constituencies_scraped = total_scraped
            log.candidates_updated = total_updated
            log.finished_at = datetime.now(timezone.utc)
            await db.commit()

            logger.info(
                f"ECN scrape complete: {total_scraped} constituencies, "
                f"{total_updated} candidates updated"
            )

            # Check for constituencies where ECN has no votes — fill from ekantipur
            from sqlalchemy import distinct, tuple_
            zero_vote_consts = await db.execute(
                select(
                    ElectionCandidate.district_cd,
                    ElectionCandidate.constituency_no,
                ).where(
                    ElectionCandidate.election_type == "hor",
                ).group_by(
                    ElectionCandidate.district_cd,
                    ElectionCandidate.constituency_no,
                ).having(func.sum(ElectionCandidate.total_vote_received) == 0)
            )
            missing = zero_vote_consts.all()

            if missing:
                logger.info(f"ECN missing vote data for {len(missing)} constituencies — trying ekantipur fallback")
                try:
                    await scrape_ekantipur_fallback()
                except Exception as e:
                    logger.warning(f"Ekantipur fallback failed: {e}")

    except Exception as e:
        logger.error(f"ECN scraper error: {e}")
        if log_id:
            try:
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(ElectionScrapeLog)
                        .where(ElectionScrapeLog.id == log_id)
                        .values(error=str(e), finished_at=datetime.now(timezone.utc))
                    )
                    await db.commit()
            except Exception:
                pass
    finally:
        await client.close()


async def _upsert_candidates(
    db: AsyncSession,
    candidates: list[dict],
    dist_id: int,
    const_no: int,
    dist_map: dict,
    state_map: dict,
) -> int:
    """Upsert candidates for a constituency. Returns count of updated rows."""
    updated = 0
    now = datetime.now(timezone.utc)

    for c in candidates:
        ecn_id = c.get("CandidateID")
        if not ecn_id:
            continue

        state_id = c.get("State", 0)
        district_name = c.get("DistrictName", "")
        if not district_name and dist_id in dist_map:
            district_name = dist_map[dist_id].get("name", "")

        state_name = c.get("StateName", "")
        if not state_name and state_id in state_map:
            state_name = state_map[state_id]

        rank_val = None
        if c.get("Rank"):
            try:
                rank_val = int(c["Rank"])
            except (ValueError, TypeError):
                pass

        values = {
            "ecn_candidate_id": ecn_id,
            "state_id": state_id,
            "state_name": state_name,
            "district_cd": dist_id,
            "district_name": district_name,
            "constituency_no": const_no,
            "election_type": "hor",
            "candidate_name": c.get("CandidateName", ""),
            "gender": c.get("Gender"),
            "age": c.get("Age"),
            "party_name": c.get("PoliticalPartyName", ""),
            "party_id": c.get("PartyID"),
            "symbol_name": c.get("SymbolName"),
            "symbol_id": c.get("SymbolID"),
            "total_vote_received": c.get("TotalVoteReceived", 0),
            "casted_vote": c.get("CastedVote", 0),
            "total_voters": c.get("TotalVoters", 0),
            "rank": rank_val,
            "remarks": c.get("Remarks"),
            "last_updated": now,
        }

        stmt = pg_insert(ElectionCandidate).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["ecn_candidate_id"],
            set_={
                "total_vote_received": stmt.excluded.total_vote_received,
                "casted_vote": stmt.excluded.casted_vote,
                "total_voters": stmt.excluded.total_voters,
                "rank": stmt.excluded.rank,
                "remarks": stmt.excluded.remarks,
                "is_winner": stmt.excluded.remarks == "Winner" if c.get("Remarks") else False,
                "last_updated": now,
            },
        )
        await db.execute(stmt)
        updated += 1

    return updated


async def _upsert_party_summary(
    db: AsyncSession, data: list[dict], election_type: str, state_id: int | None = None
):
    """Upsert party summary rows."""
    now = datetime.now(timezone.utc)

    for p in data:
        party_name = p.get("PartyName", p.get("PoliticalPartyName", ""))
        if not party_name:
            continue

        values = {
            "election_type": election_type,
            "state_id": state_id or p.get("StateId"),
            "party_name": party_name,
            "party_id": p.get("PartyId", p.get("PartyID")),
            "seats_won": p.get("Winner", p.get("Won", 0)),
            "seats_leading": p.get("Leader", p.get("Leading", 0)),
            "total_votes": p.get("TotalVote", p.get("TotalVotes", 0)),
            "last_updated": now,
        }

        existing = await db.execute(
            select(ElectionPartySummary).where(
                ElectionPartySummary.party_name == party_name,
                ElectionPartySummary.election_type == election_type,
                ElectionPartySummary.state_id == values["state_id"],
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.seats_won = values["seats_won"]
            row.seats_leading = values["seats_leading"]
            row.total_votes = values["total_votes"]
            row.last_updated = now
        else:
            db.add(ElectionPartySummary(**values))


async def scrape_ekantipur_fallback():
    """Fallback scraper: parse ekantipur.com embedded election data.

    Two-phase approach:
    1. Parse competiviveDist from homepage for competitive races
    2. For any constituency still missing votes, scrape its individual page

    Ekantipur embeds candidate data as server-rendered HTML tables.
    Only updates rows where ekantipur has newer/non-zero data.
    """
    import re

    logger.info("Running ekantipur fallback scraper")

    async with httpx.AsyncClient(
        timeout=30.0, verify=False, follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
    ) as client:

        # Phase 1: Homepage competiviveDist (covers competitive races)
        updated = 0
        now = datetime.now(timezone.utc)

        try:
            r = await client.get("https://election.ekantipur.com/?lng=eng")
            r.raise_for_status()
            html = r.text

            m = re.search(r"competiviveDist\s*=\s*(\{.+?\});\s*(?:\n|var|let|const)", html, re.DOTALL)
            if m:
                data = json.loads(m.group(1))
                logger.info(f"Ekantipur homepage: parsed {len(data)} competitive constituencies")

                async with AsyncSessionLocal() as db:
                    for const_key, candidates in data.items():
                        for c in candidates:
                            vote_count = c.get("vote_count", 0) or 0
                            if vote_count <= 0:
                                continue
                            cand_name = c.get("name", "").strip()
                            party_name = c.get("party_name", "").strip()
                            if not cand_name:
                                continue
                            result = await db.execute(
                                select(ElectionCandidate).where(
                                    ElectionCandidate.candidate_name == cand_name,
                                    ElectionCandidate.party_name == party_name,
                                    ElectionCandidate.election_type == "hor",
                                ).limit(1)
                            )
                            row = result.scalar_one_or_none()
                            if row and vote_count > (row.total_vote_received or 0):
                                row.total_vote_received = vote_count
                                row.is_winner = bool(c.get("is_win", 0))
                                row.last_updated = now
                                updated += 1
                    if updated > 0:
                        await db.commit()
        except Exception as e:
            logger.warning(f"Ekantipur homepage parse failed: {e}")

        # Phase 2: Scrape individual pages for constituencies with 0 votes
        async with AsyncSessionLocal() as db:
            zero_vote_consts = await db.execute(
                select(
                    ElectionCandidate.state_id,
                    ElectionCandidate.district_cd,
                    ElectionCandidate.district_name,
                    ElectionCandidate.constituency_no,
                ).where(
                    ElectionCandidate.election_type == "hor",
                ).group_by(
                    ElectionCandidate.state_id,
                    ElectionCandidate.district_cd,
                    ElectionCandidate.district_name,
                    ElectionCandidate.constituency_no,
                ).having(func.sum(ElectionCandidate.total_vote_received) == 0)
            )
            missing = zero_vote_consts.all()

        if not missing:
            logger.info(f"Ekantipur fallback done: {updated} candidates updated, no missing constituencies")
            return

        logger.info(f"Ekantipur phase 2: scraping {len(missing)} constituencies with 0 votes")

        for state_id, dist_cd, dist_name, const_no in missing:
            try:
                page_updated = await _scrape_ekantipur_constituency_page(
                    client, state_id, dist_cd, dist_name, const_no
                )
                updated += page_updated
                await asyncio.sleep(2)  # Be respectful
            except Exception as e:
                logger.warning(f"Ekantipur page scrape failed for dist={dist_cd} const={const_no}: {e}")

    logger.info(f"Ekantipur fallback complete: {updated} total candidates updated")


# District code → ekantipur URL slug mapping
_DISTRICT_SLUG_MAP = {
    1: "taplejung", 2: "panchthar", 3: "ilam", 4: "jhapa", 5: "morang",
    6: "sunsari", 7: "dhankuta", 8: "terhathum", 9: "sankhuwasabha", 10: "bhojpur",
    11: "solukhumbu", 12: "okhaldhunga", 13: "khotang", 14: "udayapur",
    15: "saptari", 16: "siraha", 17: "mahottari", 18: "sarlahi",
    19: "sindhuli", 20: "dhanusa", 21: "dolakha", 22: "ramechhap",
    23: "kavrepalanchok", 24: "sindhupalchok", 25: "rasuwa", 26: "nuwakot",
    27: "dhading", 28: "makwanpur", 29: "rautahat", 30: "bara",
    31: "parsa", 32: "chitwan", 33: "kathmandu", 34: "bhaktapur",
    35: "lalitpur", 36: "gorkha", 37: "lamjung", 38: "tanahun",
    39: "syangja", 40: "kaski", 41: "manang", 42: "mustang",
    43: "myagdi", 44: "parbat", 45: "baglung", 46: "gulmi",
    47: "palpa", 48: "nawalparasi-east", 49: "rupandehi", 50: "kapilvastu",
    51: "arghakhanchi", 52: "pyuthan", 53: "rolpa", 54: "rukum-east",
    55: "salyan", 56: "dang", 57: "banke", 58: "bardiya",
    59: "nawalparasi-west", 60: "surkhet", 61: "dailekh", 62: "jajarkot",
    63: "dolpa", 64: "jumla", 65: "kalikot", 66: "mugu",
    67: "humla", 68: "rukum-west", 69: "bajura", 70: "bajhang",
    71: "achham", 72: "doti", 73: "kailali", 74: "kanchanpur",
    75: "dadeldhura", 76: "baitadi", 77: "darchula",
}

# Province/state → ekantipur URL prefix
_STATE_SLUG_MAP = {
    1: "koshi", 2: "pradesh-2", 3: "bagmati", 4: "gandaki",
    5: "lumbini", 6: "karnali", 7: "sudurpaschim",
}


async def _scrape_ekantipur_constituency_page(
    client: httpx.AsyncClient,
    state_id: int,
    dist_cd: int,
    dist_name: str,
    const_no: int,
) -> int:
    """Scrape an individual ekantipur constituency page for vote data.

    Returns number of candidates updated.
    """
    import re

    state_slug = _STATE_SLUG_MAP.get(state_id)
    dist_slug = _DISTRICT_SLUG_MAP.get(dist_cd)

    if not state_slug or not dist_slug:
        logger.warning(f"No slug mapping for state={state_id} dist={dist_cd} ({dist_name})")
        return 0

    url = f"https://election.ekantipur.com/{state_slug}/district-{dist_slug}/constituency-{const_no}?lng=eng"
    logger.info(f"Fetching ekantipur page: {url}")

    try:
        r = await client.get(url)
        if r.status_code == 404:
            logger.info(f"Ekantipur 404 for {dist_slug}-{const_no}")
            return 0
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"Ekantipur fetch failed for {dist_slug}-{const_no}: {e}")
        return 0

    html = r.text

    # Parse candidate rows from ekantipur HTML
    # Format: <span>Name</span> ... <span class="party-name">Party</span> ... <div class="votecount win|lost"><p>votes</p>
    rows = re.findall(
        r'candidate-name-link[^>]*>.*?<span>(.*?)</span>.*?'
        r'party-name[^>]*>(.*?)</span>.*?'
        r'votecount\s+(win|lost).*?<p>([\d,]+)</p>',
        html, re.DOTALL
    )

    if not rows:
        logger.info(f"No vote table found for {dist_slug}-{const_no}")
        return 0

    logger.info(f"Ekantipur parsed {len(rows)} candidates for {dist_slug}-{const_no}")

    # Ekantipur English party names → ECN Nepali party name mapping
    PARTY_MAP = {
        "CPN-UML": "नेपाल कम्युनिष्ट पार्टी (एकीकृत मार्क्सवादी लेनिनवादी)",
        "Nepali Congress": "नेपाली काँग्रेस",
        "Nepali Communist Party": "नेपाली कम्युनिष्ट पार्टी",
        "CPN (Maoist Centre)": "नेपाल कम्युनिस्ट पार्टी (माओवादी)",
        "CPN (Unified Socialist)": "नेपाल कम्युनिष्ट पार्टी (संयुक्त)",
        "Rastriya Swatantra Party": "राष्ट्रिय स्वतन्त्र पार्टी",
        "Rastriya Prajatantra Party": "राष्ट्रिय प्रजातन्त्र पार्टी",
        "Janamat Party": "जनमत पार्टी",
        "Loktantrik Samajwadi Party": "लोकतान्त्रिक समाजवादी पार्टी",
        "Nagarik Unmukti Party": "नागरिक उन्मुक्ति पार्टी",
        "Nepal Workers Peasants Party": "नेपाल मजदुर किसान पार्टी",
        "Independent": "स्वतन्त्र",
        "Nepal Samajbadi Party": "नेपाल समाजवादी पार्टी",
        "Janata Samajwadi Party, Nepal": "जनता समाजवादी पार्टी, नेपाल",
    }

    now = datetime.now(timezone.utc)
    updated = 0

    async with AsyncSessionLocal() as db:
        # Get all candidates for this constituency
        result = await db.execute(
            select(ElectionCandidate).where(
                ElectionCandidate.district_cd == dist_cd,
                ElectionCandidate.constituency_no == const_no,
                ElectionCandidate.election_type == "hor",
            )
        )
        db_candidates = result.scalars().all()

        if not db_candidates:
            return 0

        # Build lookup by party name (Nepali)
        party_candidates: dict[str, list] = {}
        for cand in db_candidates:
            party_candidates.setdefault(cand.party_name, []).append(cand)

        for name_en, party_en, win_lost, votes_str in rows:
            name_en = name_en.strip()
            party_en = party_en.strip()
            votes = int(votes_str.replace(',', ''))
            is_winner = win_lost == "win"

            if votes <= 0:
                continue

            # Map party name to Nepali
            party_ne = PARTY_MAP.get(party_en, party_en)

            # Find matching candidate by party
            candidates_in_party = party_candidates.get(party_ne, [])

            if len(candidates_in_party) == 1:
                # Only one candidate from this party — guaranteed match
                cand = candidates_in_party[0]
                if votes > (cand.total_vote_received or 0):
                    cand.total_vote_received = votes
                    cand.is_winner = is_winner
                    cand.last_updated = now
                    updated += 1
            elif len(candidates_in_party) > 1:
                # Multiple candidates from same party (rare for major parties)
                # Skip independents with 0 votes to avoid mismatches
                logger.debug(f"Multiple candidates for {party_en} in {dist_slug}-{const_no}, skipping")
            else:
                logger.debug(f"No DB match for party '{party_en}' ({party_ne}) in {dist_slug}-{const_no}")

        if updated > 0:
            await db.commit()

    logger.info(f"Ekantipur page {dist_slug}-{const_no}: updated {updated} candidates")
    return updated


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(scrape_election_results())
