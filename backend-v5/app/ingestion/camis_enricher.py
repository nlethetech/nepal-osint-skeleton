"""CAMIS enrichment worker -- enriches CompanyRegistration records with PAN + metadata.

Supports parallel enrichment with N concurrent workers (default 8).
Each worker gets its own DB session; all share one CAMISClient with a semaphore.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.company import CompanyRegistration
from app.ingestion.camis_client import CAMISClient

logger = logging.getLogger(__name__)


async def _enrich_one(
    company_id,
    reg_number: int,
    client: CAMISClient,
) -> dict:
    """Enrich a single company in its own DB session. Returns result dict."""
    reg_str = str(reg_number)
    result = {"enriched": False, "reg_number": reg_number, "pan": None}

    updates: dict = {}

    # 1. CRO migration endpoint (unmasked PAN)
    try:
        cro_resp = await client.get_cro_detail(reg_str)
        if cro_resp:
            records = cro_resp.get("data", []) if isinstance(cro_resp, dict) else []
            if isinstance(cro_resp, list):
                records = cro_resp
            for rec in records:
                pan = rec.get("panNumber")
                cro_id = rec.get("companyId")
                if pan:
                    clean_pan = str(pan).strip().split("#")[0].strip()
                    updates["pan"] = clean_pan
                    result["pan"] = clean_pan
                if cro_id:
                    updates["cro_company_id"] = str(cro_id)
                break
    except Exception as e:
        logger.warning(f"CRO detail failed for reg #{reg_str}: {e}")

    # 2. eService endpoint (CAMIS ID)
    try:
        eservice_resp = await client.get_company_detail(reg_str)
        if eservice_resp:
            records = eservice_resp.get("data", []) if isinstance(eservice_resp, dict) else []
            if isinstance(eservice_resp, list):
                records = eservice_resp
            for rec in records:
                camis_id = rec.get("companyId")
                if camis_id:
                    updates["camis_company_id"] = int(camis_id)
                addr = rec.get("addressLine") or rec.get("registeredAddress")
                if addr:
                    updates["_address"] = str(addr)
                break
    except Exception as e:
        logger.warning(f"eService detail failed for reg #{reg_str}: {e}")

    # 3. Write to DB in own session
    now = datetime.now(timezone.utc)
    try:
        async with AsyncSessionLocal() as db:
            stmt = (
                update(CompanyRegistration)
                .where(CompanyRegistration.id == company_id)
                .values(
                    camis_enriched=True,
                    camis_enriched_at=now,
                    updated_at=now,
                    **({"pan": updates["pan"]} if "pan" in updates else {}),
                    **({"cro_company_id": updates["cro_company_id"]} if "cro_company_id" in updates else {}),
                    **({"camis_company_id": updates["camis_company_id"]} if "camis_company_id" in updates else {}),
                )
            )
            await db.execute(stmt)
            await db.commit()
            result["enriched"] = True
    except Exception as e:
        logger.error(f"DB update failed for reg #{reg_str}: {e}")
        result["error"] = str(e)

    return result


class CAMISEnricher:
    """Enriches existing company records using the CAMIS API with parallel workers."""

    def __init__(
        self,
        db: AsyncSession,
        client: Optional[CAMISClient] = None,
        workers: int = 8,
    ):
        self.db = db
        self.client = client or CAMISClient(max_concurrency=workers)
        self.workers = workers

    async def enrich_batch(
        self,
        limit: int = 100,
        min_reg_number: int = 0,
    ) -> dict:
        """
        Enrich next batch of un-enriched companies using parallel workers.

        Args:
            limit: Max companies to enrich in this batch.
            min_reg_number: Skip companies with registration_number below this.
        """
        conditions = [CompanyRegistration.camis_enriched == False]  # noqa: E712
        if min_reg_number > 0:
            conditions.append(CompanyRegistration.registration_number >= min_reg_number)

        stmt = (
            select(CompanyRegistration.id, CompanyRegistration.registration_number)
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
            "pans_found": 0,
            "errors": [],
        }

        if not rows:
            logger.info("No un-enriched companies found")
            return stats

        logger.info(
            f"Enriching {len(rows)} companies with {self.workers} parallel workers"
        )
        t0 = time.monotonic()

        # Fire all tasks concurrently -- the CAMISClient semaphore limits to N in-flight
        tasks = [
            _enrich_one(row.id, row.registration_number, self.client)
            for row in rows
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for res in results:
            if isinstance(res, Exception):
                stats["errors"].append(str(res))
                continue
            if res.get("enriched"):
                stats["enriched"] += 1
            if res.get("pan"):
                stats["pans_found"] += 1
            if res.get("error"):
                stats["errors"].append(f"reg #{res['reg_number']}: {res['error']}")

        elapsed = time.monotonic() - t0
        rate = stats["enriched"] / elapsed if elapsed > 0 else 0
        logger.info(
            f"CAMIS enrichment done: {stats['enriched']}/{stats['batch_size']} in {elapsed:.1f}s "
            f"({rate:.1f} companies/sec), {stats['pans_found']} PANs, {len(stats['errors'])} errors"
        )

        return stats

    async def _count_unenriched(self, min_reg_number: int = 0) -> int:
        conditions = [CompanyRegistration.camis_enriched == False]  # noqa: E712
        if min_reg_number > 0:
            conditions.append(CompanyRegistration.registration_number >= min_reg_number)
        stmt = select(func.count(CompanyRegistration.id)).where(*conditions)
        result = await self.db.execute(stmt)
        return result.scalar() or 0
