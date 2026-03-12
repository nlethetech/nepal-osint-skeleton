#!/usr/bin/env python3
"""
OCR Company Registration Backfill Script.

Scrapes company registrations from Nepal's OCR (application.ocr.gov.np)
and stores them in the database. Processes in small batches to keep memory bounded.

Usage:
    Single worker:  venv/bin/python3 backfill_ocr.py --start 16 --end 341871 --delay 0.3
    Launch all:     venv/bin/python3 backfill_ocr.py --launch-all --workers 5
"""

import sys
import os
import asyncio
import argparse
import logging
import time
import subprocess

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.ingestion.ocr_scraper import OCRScraper
from app.core.database import AsyncSessionLocal
from app.repositories.company import CompanyRepository

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


async def upsert_companies(companies: list) -> dict:
    """Insert a batch of scraped companies into the database."""
    stats = {"new": 0, "updated": 0, "errors": 0}

    async with AsyncSessionLocal() as db:
        repo = CompanyRepository(db)

        for company in companies:
            try:
                external_id = OCRScraper.generate_external_id(
                    company.registration_number,
                    company.name_english,
                    company.registration_date_bs,
                )
                type_category = OCRScraper.classify_company_type(company.company_type)
                district = OCRScraper.extract_district(company.company_address)
                province = OCRScraper.extract_province(company.company_address)

                _, created = await repo.upsert(
                    external_id=external_id,
                    registration_number=company.registration_number,
                    name_english=company.name_english,
                    name_nepali=company.name_nepali,
                    registration_date_bs=company.registration_date_bs,
                    company_type=company.company_type,
                    company_type_category=type_category,
                    company_address=company.company_address,
                    district=district,
                    province=province,
                    last_communication_bs=company.last_communication_bs,
                    raw_data=company.raw_data,
                )

                if created:
                    stats["new"] += 1
                else:
                    stats["updated"] += 1

            except Exception as e:
                stats["errors"] += 1
                try:
                    await db.rollback()
                except Exception:
                    pass

    return stats


async def backfill_worker(start: int, end: int, delay: float, batch_size: int):
    """Single worker: scrape range in batches, insert each batch immediately."""
    logger.info(f"Worker starting: reg #{start} to #{end} (delay={delay}s, batch={batch_size})")

    grand = {"new": 0, "updated": 0, "errors": 0, "companies": 0, "queries": 0}
    t0 = time.time()
    total = end - start + 1

    scraper = OCRScraper(delay=delay)
    current = start

    while current <= end:
        batch_end = min(current + batch_size - 1, end)

        # Scrape batch (sync)
        companies = scraper.scrape_range(
            start=current, end=batch_end, max_empty_streak=200,
        )

        # Insert to DB immediately
        if companies:
            stats = await upsert_companies(companies)
            grand["new"] += stats["new"]
            grand["updated"] += stats["updated"]
            grand["errors"] += stats["errors"]
            grand["companies"] += len(companies)

        grand["queries"] += (batch_end - current + 1)
        elapsed = time.time() - t0
        rate = grand["queries"] / elapsed if elapsed > 0 else 0
        remaining = (end - batch_end) / rate if rate > 0 else 0
        pct = grand["queries"] / total * 100

        logger.info(
            f"[{pct:.1f}%] #{current}-{batch_end}: {len(companies)} scraped | "
            f"Total: {grand['companies']} ({grand['new']} new) | "
            f"{rate:.1f} q/s | ETA: {remaining/3600:.1f}h"
        )

        current = batch_end + 1

    elapsed = time.time() - t0
    logger.info(
        f"DONE: {grand['queries']} queries in {elapsed/3600:.1f}h | "
        f"{grand['companies']} companies ({grand['new']} new, "
        f"{grand['updated']} updated, {grand['errors']} errors)"
    )


def launch_all(workers: int, start: int, end: int, delay: float, batch_size: int):
    """Launch N independent worker processes, each handling a chunk of the range."""
    total = end - start + 1
    chunk = total // workers
    script = os.path.abspath(__file__)
    python = os.path.join(os.path.dirname(script), "venv", "bin", "python3")
    log_dir = os.path.dirname(script)

    processes = []
    for i in range(workers):
        w_start = start + i * chunk
        w_end = (start + (i + 1) * chunk - 1) if i < workers - 1 else end
        log_file = os.path.join(log_dir, f"backfill_ocr_w{i}.log")

        cmd = [
            python, script,
            "--start", str(w_start),
            "--end", str(w_end),
            "--delay", str(delay),
            "--batch", str(batch_size),
        ]

        logger.info(f"Launching worker {i}: #{w_start}-{w_end} ({w_end - w_start + 1} numbers) -> {log_file}")

        with open(log_file, "w") as lf:
            proc = subprocess.Popen(
                cmd, stdout=lf, stderr=subprocess.STDOUT,
                cwd=os.path.dirname(script),
            )
            processes.append((i, proc, log_file))

    logger.info(f"\n{workers} workers launched. Monitor with:")
    for i, proc, log_file in processes:
        logger.info(f"  tail -f {log_file}  (PID {proc.pid})")
    logger.info(f"\nOr check all progress:")
    logger.info(f"  tail -1 {log_dir}/backfill_ocr_w*.log")


def main():
    parser = argparse.ArgumentParser(description="OCR Company Backfill")
    parser.add_argument("--start", type=int, default=16, help="Start registration number")
    parser.add_argument("--end", type=int, default=341871, help="End registration number")
    parser.add_argument("--delay", type=float, default=0.3, help="Delay between requests")
    parser.add_argument("--batch", type=int, default=200, help="Batch size")
    parser.add_argument("--launch-all", action="store_true", help="Launch N workers as subprocesses")
    parser.add_argument("--workers", type=int, default=5, help="Number of workers (with --launch-all)")
    args = parser.parse_args()

    if args.launch_all:
        launch_all(args.workers, args.start, args.end, args.delay, args.batch)
    else:
        asyncio.run(backfill_worker(args.start, args.end, args.delay, args.batch))


if __name__ == "__main__":
    main()
