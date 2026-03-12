#!/usr/bin/env python3
"""
Batch Government Scraper Orchestrator

Runs multiple scrapers concurrently with rate limiting and error handling.
Coordinates scraping across all government sources: ministries, DAOs, provinces,
constitutional bodies, and specialized sources.
"""

import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict, field
from concurrent.futures import ThreadPoolExecutor
import json

from app.ingestion.ministry_scraper_generic import (
    GenericMinistryScraper,
    GenericMinistryScraperConfig,
    MINISTRY_CONFIGS,
    GovtPost,
)
from app.ingestion.dao_scraper import DAOScraper, DAOPost
from app.ingestion.provincial_scraper import ProvincialScraper, ProvincialPost

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class ScrapeResult:
    """Result from a scrape operation."""
    source_id: str
    source_name: str
    source_type: str  # ministry, dao, province, constitutional, regulatory
    success: bool
    posts_count: int
    posts: List[Dict]
    error: Optional[str] = None
    duration_seconds: float = 0.0
    scraped_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class BatchScrapeStats:
    """Statistics from a batch scrape run."""
    total_sources: int
    successful: int
    failed: int
    total_posts: int
    duration_seconds: float
    started_at: str
    completed_at: str
    results_by_type: Dict[str, int] = field(default_factory=dict)


class GovtBatchScraper:
    """
    Orchestrates batch scraping of all government sources.

    Features:
    - Concurrent scraping with configurable parallelism
    - Rate limiting per domain
    - Error isolation (one failure doesn't stop others)
    - Progress tracking
    - Result aggregation
    """

    def __init__(
        self,
        max_concurrent: int = 10,
        delay_between_sources: float = 1.0,
        max_pages_per_source: int = 3,
    ):
        self.max_concurrent = max_concurrent
        self.delay_between_sources = delay_between_sources
        self.max_pages_per_source = max_pages_per_source
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent)

    async def _scrape_ministry(self, ministry_id: str) -> ScrapeResult:
        """Scrape a single ministry."""
        start_time = datetime.utcnow()

        try:
            if ministry_id not in MINISTRY_CONFIGS:
                return ScrapeResult(
                    source_id=ministry_id,
                    source_name=ministry_id,
                    source_type='ministry',
                    success=False,
                    posts_count=0,
                    posts=[],
                    error=f"Unknown ministry: {ministry_id}",
                    scraped_at=start_time.isoformat(),
                )

            config = MINISTRY_CONFIGS[ministry_id]
            scraper = GenericMinistryScraper(config)

            # Run in thread pool (scrapers are sync)
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                self.executor,
                lambda: scraper.scrape_all(self.max_pages_per_source)
            )

            # Flatten results
            all_posts = []
            for endpoint_posts in results.values():
                all_posts.extend([asdict(p) for p in endpoint_posts])

            duration = (datetime.utcnow() - start_time).total_seconds()

            return ScrapeResult(
                source_id=ministry_id,
                source_name=config.name,
                source_type='ministry',
                success=True,
                posts_count=len(all_posts),
                posts=all_posts,
                duration_seconds=duration,
                scraped_at=start_time.isoformat(),
            )

        except Exception as e:
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.error(f"Error scraping ministry {ministry_id}: {e}")
            return ScrapeResult(
                source_id=ministry_id,
                source_name=ministry_id,
                source_type='ministry',
                success=False,
                posts_count=0,
                posts=[],
                error=str(e),
                duration_seconds=duration,
                scraped_at=start_time.isoformat(),
            )

    async def _scrape_dao(self, district_key: str) -> ScrapeResult:
        """Scrape a single DAO."""
        start_time = datetime.utcnow()

        try:
            scraper = DAOScraper(delay=0.5, verify_ssl=False)

            if district_key not in scraper.DISTRICTS:
                return ScrapeResult(
                    source_id=f"dao_{district_key}",
                    source_name=f"DAO {district_key}",
                    source_type='dao',
                    success=False,
                    posts_count=0,
                    posts=[],
                    error=f"Unknown district: {district_key}",
                    scraped_at=start_time.isoformat(),
                )

            district_info = scraper.DISTRICTS[district_key]

            loop = asyncio.get_event_loop()
            posts = await loop.run_in_executor(
                self.executor,
                lambda: scraper.scrape_district(district_key, 'notice-en', max_pages=self.max_pages_per_source)
            )

            duration = (datetime.utcnow() - start_time).total_seconds()

            return ScrapeResult(
                source_id=f"dao_{district_key}",
                source_name=f"DAO {district_info['name']}",
                source_type='dao',
                success=True,
                posts_count=len(posts),
                posts=[asdict(p) for p in posts],
                duration_seconds=duration,
                scraped_at=start_time.isoformat(),
            )

        except Exception as e:
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.error(f"Error scraping DAO {district_key}: {e}")
            return ScrapeResult(
                source_id=f"dao_{district_key}",
                source_name=f"DAO {district_key}",
                source_type='dao',
                success=False,
                posts_count=0,
                posts=[],
                error=str(e),
                duration_seconds=duration,
                scraped_at=start_time.isoformat(),
            )

    async def _scrape_province(self, province_key: str) -> ScrapeResult:
        """Scrape a single province."""
        start_time = datetime.utcnow()

        try:
            scraper = ProvincialScraper(delay=0.5, verify_ssl=False)

            if province_key not in scraper.PROVINCES:
                return ScrapeResult(
                    source_id=f"prov_{province_key}",
                    source_name=f"Province {province_key}",
                    source_type='province',
                    success=False,
                    posts_count=0,
                    posts=[],
                    error=f"Unknown province: {province_key}",
                    scraped_at=start_time.isoformat(),
                )

            province_info = scraper.PROVINCES[province_key]

            loop = asyncio.get_event_loop()
            posts = await loop.run_in_executor(
                self.executor,
                lambda: scraper.scrape_province(province_key, 'press-release-en', max_pages=self.max_pages_per_source)
            )

            duration = (datetime.utcnow() - start_time).total_seconds()

            return ScrapeResult(
                source_id=f"prov_{province_key}",
                source_name=province_info['name'],
                source_type='province',
                success=True,
                posts_count=len(posts),
                posts=[asdict(p) for p in posts],
                duration_seconds=duration,
                scraped_at=start_time.isoformat(),
            )

        except Exception as e:
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.error(f"Error scraping province {province_key}: {e}")
            return ScrapeResult(
                source_id=f"prov_{province_key}",
                source_name=f"Province {province_key}",
                source_type='province',
                success=False,
                posts_count=0,
                posts=[],
                error=str(e),
                duration_seconds=duration,
                scraped_at=start_time.isoformat(),
            )

    async def scrape_all_ministries(
        self,
        ministry_ids: List[str] = None,
    ) -> List[ScrapeResult]:
        """Scrape all or selected ministries concurrently."""

        if ministry_ids is None:
            ministry_ids = list(MINISTRY_CONFIGS.keys())

        logger.info(f"Starting batch scrape of {len(ministry_ids)} ministries")

        # Create semaphore for concurrency control
        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def scrape_with_semaphore(ministry_id: str) -> ScrapeResult:
            async with semaphore:
                result = await self._scrape_ministry(ministry_id)
                await asyncio.sleep(self.delay_between_sources)
                return result

        # Run all scrapers
        tasks = [scrape_with_semaphore(mid) for mid in ministry_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any exceptions that weren't caught
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                final_results.append(ScrapeResult(
                    source_id=ministry_ids[i],
                    source_name=ministry_ids[i],
                    source_type='ministry',
                    success=False,
                    posts_count=0,
                    posts=[],
                    error=str(result),
                    scraped_at=datetime.utcnow().isoformat(),
                ))
            else:
                final_results.append(result)

        # Log summary
        successful = sum(1 for r in final_results if r.success)
        total_posts = sum(r.posts_count for r in final_results)
        logger.info(f"Ministry batch scrape complete: {successful}/{len(final_results)} successful, {total_posts} total posts")

        return final_results

    async def scrape_priority_daos(self) -> List[ScrapeResult]:
        """Scrape high-priority DAOs (metros/sub-metros)."""
        priority_districts = DAOScraper.PRIORITY_DISTRICTS

        logger.info(f"Starting batch scrape of {len(priority_districts)} priority DAOs")

        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def scrape_with_semaphore(district_key: str) -> ScrapeResult:
            async with semaphore:
                result = await self._scrape_dao(district_key)
                await asyncio.sleep(self.delay_between_sources)
                return result

        tasks = [scrape_with_semaphore(dk) for dk in priority_districts]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                final_results.append(ScrapeResult(
                    source_id=f"dao_{priority_districts[i]}",
                    source_name=f"DAO {priority_districts[i]}",
                    source_type='dao',
                    success=False,
                    posts_count=0,
                    posts=[],
                    error=str(result),
                    scraped_at=datetime.utcnow().isoformat(),
                ))
            else:
                final_results.append(result)

        successful = sum(1 for r in final_results if r.success)
        total_posts = sum(r.posts_count for r in final_results)
        logger.info(f"DAO batch scrape complete: {successful}/{len(final_results)} successful, {total_posts} total posts")

        return final_results

    async def scrape_all_provinces(self) -> List[ScrapeResult]:
        """Scrape all 7 provinces."""
        province_keys = list(ProvincialScraper.PROVINCES.keys())

        logger.info(f"Starting batch scrape of {len(province_keys)} provinces")

        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def scrape_with_semaphore(province_key: str) -> ScrapeResult:
            async with semaphore:
                result = await self._scrape_province(province_key)
                await asyncio.sleep(self.delay_between_sources)
                return result

        tasks = [scrape_with_semaphore(pk) for pk in province_keys]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                final_results.append(ScrapeResult(
                    source_id=f"prov_{province_keys[i]}",
                    source_name=f"Province {province_keys[i]}",
                    source_type='province',
                    success=False,
                    posts_count=0,
                    posts=[],
                    error=str(result),
                    scraped_at=datetime.utcnow().isoformat(),
                ))
            else:
                final_results.append(result)

        successful = sum(1 for r in final_results if r.success)
        total_posts = sum(r.posts_count for r in final_results)
        logger.info(f"Province batch scrape complete: {successful}/{len(final_results)} successful, {total_posts} total posts")

        return final_results

    async def scrape_all_sources(
        self,
        include_ministries: bool = True,
        include_daos: bool = True,
        include_provinces: bool = True,
    ) -> Dict[str, List[ScrapeResult]]:
        """
        Scrape ALL government sources: ministries, DAOs, provinces.

        Returns:
            Dict with keys 'ministries', 'daos', 'provinces' mapping to result lists
        """
        start_time = datetime.utcnow()
        results = {}

        tasks = []
        keys = []

        if include_ministries:
            tasks.append(self.scrape_all_ministries())
            keys.append('ministries')

        if include_daos:
            tasks.append(self.scrape_priority_daos())
            keys.append('daos')

        if include_provinces:
            tasks.append(self.scrape_all_provinces())
            keys.append('provinces')

        # Run all source types in parallel
        all_results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, key in enumerate(keys):
            result = all_results[i]
            if isinstance(result, Exception):
                logger.error(f"Error scraping {key}: {result}")
                results[key] = []
            else:
                results[key] = result

        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"Full batch scrape completed in {duration:.1f}s")

        return results

    def get_batch_stats(self, results: Dict[str, List[ScrapeResult]]) -> BatchScrapeStats:
        """Calculate statistics from batch scrape results."""
        all_results = []
        results_by_type = {}

        for source_type, type_results in results.items():
            all_results.extend(type_results)
            results_by_type[source_type] = sum(r.posts_count for r in type_results)

        return BatchScrapeStats(
            total_sources=len(all_results),
            successful=sum(1 for r in all_results if r.success),
            failed=sum(1 for r in all_results if not r.success),
            total_posts=sum(r.posts_count for r in all_results),
            duration_seconds=sum(r.duration_seconds for r in all_results),
            started_at=min(r.scraped_at for r in all_results) if all_results else "",
            completed_at=max(r.scraped_at for r in all_results) if all_results else "",
            results_by_type=results_by_type,
        )


# ============ CLI Entry Point ============

async def main():
    """Run batch scraper from command line."""
    import argparse

    parser = argparse.ArgumentParser(description='Batch Government Scraper')
    parser.add_argument('--ministries', nargs='*', help='Specific ministry IDs to scrape')
    parser.add_argument('--daos', action='store_true', help='Scrape priority DAOs')
    parser.add_argument('--provinces', action='store_true', help='Scrape provinces')
    parser.add_argument('--all', action='store_true', help='Scrape all sources')
    parser.add_argument('--max-concurrent', type=int, default=10, help='Max concurrent scrapers')
    parser.add_argument('--max-pages', type=int, default=3, help='Max pages per source')
    parser.add_argument('--output', type=str, default='scrape_results.json', help='Output file')

    args = parser.parse_args()

    scraper = GovtBatchScraper(
        max_concurrent=args.max_concurrent,
        max_pages_per_source=args.max_pages,
    )

    results = {}

    if args.all:
        results = await scraper.scrape_all_sources()
    else:
        if args.ministries is not None:
            results['ministries'] = await scraper.scrape_all_ministries(args.ministries if args.ministries else None)
        if args.daos:
            results['daos'] = await scraper.scrape_priority_daos()
        if args.provinces:
            results['provinces'] = await scraper.scrape_all_provinces()

    if not results:
        # Default: scrape ministries
        results['ministries'] = await scraper.scrape_all_ministries()

    # Get stats
    stats = scraper.get_batch_stats(results)
    print("\n" + "=" * 60)
    print("BATCH SCRAPE RESULTS")
    print("=" * 60)
    print(f"Total sources: {stats.total_sources}")
    print(f"Successful: {stats.successful}")
    print(f"Failed: {stats.failed}")
    print(f"Total posts: {stats.total_posts}")
    print(f"Duration: {stats.duration_seconds:.1f}s")
    print(f"\nPosts by type:")
    for source_type, count in stats.results_by_type.items():
        print(f"  {source_type}: {count}")

    # Save results
    output_data = {
        'stats': asdict(stats),
        'results': {k: [asdict(r) for r in v] for k, v in results.items()},
    }

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"\nResults saved to {args.output}")


if __name__ == '__main__':
    asyncio.run(main())
