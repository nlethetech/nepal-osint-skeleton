"""IRD enrichment worker -- enriches companies that have PANs with IRD data.

For each company with a PAN, queries IRD PAN search and stores:
  - Public business details (name, registration date, tax office, etc.)
  - Privacy-preserving phone/mobile hashes (HMAC-SHA256, not raw numbers)
  - Tax clearance status

Phone hashes enable detecting connections between companies that share
the same contact number, without storing any PII.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import AsyncSessionLocal
from app.models.company import CompanyRegistration, IRDEnrichment
from app.ingestion.ird_client import IRDClient
from app.ingestion.privacy_hasher import hash_phone

logger = logging.getLogger(__name__)


def _extract_pan_number(pan_field: str) -> Optional[str]:
    """Extract the numeric PAN from CAMIS-style PAN strings.

    CAMIS stores PANs like '609678796#2501' where the number before # is the actual PAN.
    IRD only accepts the numeric part (609678796).
    """
    if not pan_field:
        return None
    # Strip whitespace
    pan = pan_field.strip()
    # If it contains #, take the part before it
    if "#" in pan:
        pan = pan.split("#")[0].strip()
    # Validate: should be all digits
    if not pan.isdigit():
        return None
    return pan


def _sanitise_response(data: dict) -> dict:
    """Remove PII fields from the raw IRD response for safe storage.

    Strips: telephone, mobile, street_name (full address).
    Keeps: ward, vdc/municipality, business name, tax info.
    """
    sanitised = {}
    for key, records in data.items():
        if isinstance(records, list):
            clean_records = []
            for rec in records:
                if isinstance(rec, dict):
                    clean = {
                        k: v for k, v in rec.items()
                        if k not in ("telephone", "mobile", "street_Name")
                    }
                    clean_records.append(clean)
                else:
                    clean_records.append(rec)
            sanitised[key] = clean_records
        else:
            sanitised[key] = records
    return sanitised


async def _enrich_one(
    company_id,
    pan_raw: str,
    client: IRDClient,
) -> dict:
    """Enrich a single company with IRD data. Uses its own DB session."""
    pan = _extract_pan_number(pan_raw)
    result = {"enriched": False, "pan": pan_raw, "pan_clean": pan}

    if not pan:
        result["error"] = f"Invalid PAN format: {pan_raw}"
        return result

    # Query IRD
    try:
        data = await client.search_pan(pan)
    except Exception as e:
        result["error"] = f"IRD search failed: {e}"
        return result

    if not data:
        result["error"] = "No data returned from IRD"
        # Still mark as enriched (attempted) so we don't retry
        await _mark_enriched(company_id)
        result["enriched"] = True
        return result

    # Extract fields from IRD response
    pan_details = data.get("panDetails", [])
    biz_details = data.get("businessDetail", [])
    reg_details = data.get("panRegistrationDetail", [])
    clearance = data.get("panTaxClearance", [])

    # Primary detail record
    detail = pan_details[0] if pan_details else {}
    biz = biz_details[0] if biz_details else {}
    reg = reg_details[0] if reg_details else {}
    clear = clearance[0] if clearance else {}

    # Hash phone/mobile (privacy-preserving)
    phone_raw = detail.get("telephone")
    mobile_raw = detail.get("mobile")
    phone_h = hash_phone(phone_raw)
    mobile_h = hash_phone(mobile_raw)

    result["phone_hash"] = phone_h
    result["mobile_hash"] = mobile_h

    # Build IRDEnrichment record
    now = datetime.now(timezone.utc)
    enrichment_data = dict(
        company_id=company_id,
        pan=pan,
        taxpayer_name_en=biz.get("trade_Name_Eng") or detail.get("trade_Name_Eng"),
        taxpayer_name_np=biz.get("trade_Name_Nep") or detail.get("trade_Name_Nep"),
        account_type=str(reg.get("acctType", "")) or detail.get("acctType"),
        account_status=reg.get("accountStatus") or detail.get("account_Status"),
        registration_date_bs=reg.get("registrationDate") or detail.get("eff_Reg_Date"),
        filing_period=reg.get("filing_Period"),
        tax_office=detail.get("office_Name"),
        is_personal=detail.get("is_Personal"),
        ward_no=detail.get("ward_No"),
        vdc_municipality=detail.get("vdc_Town"),
        phone_hash=phone_h,
        mobile_hash=mobile_h,
        latest_tax_clearance_fy=clear.get("fiscal_Year"),
        tax_clearance_verified=clear.get("exists_Yn") == "Y" if clear.get("exists_Yn") else None,
        raw_data_sanitised=_sanitise_response(data),
        fetched_at=now,
        updated_at=now,
    )

    # Upsert to DB
    try:
        async with AsyncSessionLocal() as db:
            stmt = pg_insert(IRDEnrichment).values(**enrichment_data)
            stmt = stmt.on_conflict_do_update(
                index_elements=["pan"],
                set_={k: v for k, v in enrichment_data.items() if k != "pan"},
            )
            await db.execute(stmt)

            # Mark company as IRD-enriched
            await db.execute(
                update(CompanyRegistration)
                .where(CompanyRegistration.id == company_id)
                .values(ird_enriched=True, ird_enriched_at=now, updated_at=now)
            )
            await db.commit()
            result["enriched"] = True
    except Exception as e:
        logger.error(f"DB write failed for PAN {pan}: {e}")
        result["error"] = str(e)

    return result


async def _mark_enriched(company_id):
    """Mark company as IRD-enriched (even if no data returned)."""
    now = datetime.now(timezone.utc)
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(CompanyRegistration)
                .where(CompanyRegistration.id == company_id)
                .values(ird_enriched=True, ird_enriched_at=now, updated_at=now)
            )
            await db.commit()
    except Exception as e:
        logger.error(f"Failed to mark enriched for {company_id}: {e}")


class IRDEnricher:
    """Enriches companies with IRD PAN search data."""

    def __init__(
        self,
        db: AsyncSession,
        client: Optional[IRDClient] = None,
        concurrency: int = 1,
    ):
        self.db = db
        self.client = client
        self.concurrency = concurrency

    async def enrich_batch(
        self,
        limit: int = 50,
        min_reg_number: int = 0,
    ) -> dict:
        """Enrich next batch of companies that have PANs but no IRD data.

        Returns stats dict.
        """
        # Find companies with PAN but not yet IRD-enriched
        conditions = [
            CompanyRegistration.ird_enriched == False,  # noqa: E712
            CompanyRegistration.pan.isnot(None),
            CompanyRegistration.pan != "",
        ]
        if min_reg_number > 0:
            conditions.append(CompanyRegistration.registration_number >= min_reg_number)

        stmt = (
            select(CompanyRegistration.id, CompanyRegistration.pan, CompanyRegistration.registration_number)
            .where(*conditions)
            .order_by(CompanyRegistration.registration_number)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        rows = result.all()

        total_unenriched = await self._count_unenriched(min_reg_number)

        stats = {
            "total_unenriched": total_unenriched,
            "batch_size": len(rows),
            "enriched": 0,
            "phone_hashes_found": 0,
            "errors": [],
        }

        if not rows:
            logger.info("No companies need IRD enrichment")
            return stats

        logger.info(f"IRD enriching {len(rows)} companies (concurrency={self.concurrency})")
        t0 = time.monotonic()

        # Process sequentially or with limited concurrency
        # reCAPTCHA can be finicky with too many parallel requests
        sem = asyncio.Semaphore(self.concurrency)

        async def bounded_enrich(row):
            async with sem:
                return await _enrich_one(row.id, row.pan, self.client)

        tasks = [bounded_enrich(row) for row in rows]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for res in results:
            if isinstance(res, Exception):
                stats["errors"].append(str(res))
                continue
            if res.get("enriched"):
                stats["enriched"] += 1
            if res.get("phone_hash") or res.get("mobile_hash"):
                stats["phone_hashes_found"] += 1
            if res.get("error"):
                stats["errors"].append(f"PAN {res.get('pan', '?')}: {res['error']}")

        elapsed = time.monotonic() - t0
        rate = stats["enriched"] / elapsed if elapsed > 0 else 0
        logger.info(
            f"IRD enrichment done: {stats['enriched']}/{stats['batch_size']} in {elapsed:.1f}s "
            f"({rate:.1f}/sec), {stats['phone_hashes_found']} phone hashes, "
            f"{len(stats['errors'])} errors"
        )

        return stats

    async def _count_unenriched(self, min_reg_number: int = 0) -> int:
        conditions = [
            CompanyRegistration.ird_enriched == False,  # noqa: E712
            CompanyRegistration.pan.isnot(None),
            CompanyRegistration.pan != "",
        ]
        if min_reg_number > 0:
            conditions.append(CompanyRegistration.registration_number >= min_reg_number)
        stmt = select(func.count(CompanyRegistration.id)).where(*conditions)
        result = await self.db.execute(stmt)
        return result.scalar() or 0
