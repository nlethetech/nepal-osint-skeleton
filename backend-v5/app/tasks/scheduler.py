"""Background task scheduler for RSS polling, clustering, embeddings, analysis, disasters, rivers, and Twitter."""
import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings
from app.core.database import AsyncSessionLocal
from app.services.ingestion_service import IngestionService
from app.services.clustering import ClusteringService
from app.services.embeddings import EmbeddingService
from app.services.analysis import BriefingService
from app.services.disaster_service import DisasterIngestionService
from app.services.river_service import RiverMonitoringService
from app.services.weather_service import WeatherService
from app.services.announcement_service import AnnouncementService
from app.services.twitter_service import TwitterService
from app.services.nitter_service import NitterService
from app.services.market_service import MarketService
from app.services.energy_service import EnergyService
from app.core.realtime_bus import publish_news
from app.ingestion.ratopati_scraper import fetch_ratopati_province
from app.ingestion.rss_fetcher import FetchedArticle

logger = logging.getLogger(__name__)
settings = get_settings()

scheduler = AsyncIOScheduler()

# Task intervals in seconds
CLUSTERING_INTERVAL = 21600     # 6 hours — cheaper cadence for embeddings + clustering
EMBEDDING_INTERVAL = 21600      # 6 hours — capped embedding backfill for cost control
ANALYSIS_BATCH_INTERVAL = 7200  # 2 hours
BATCH_CHECK_INTERVAL = 900      # 15 minutes
BIPAD_POLL_INTERVAL = 300       # 5 minutes
RIVER_POLL_INTERVAL = 600       # 10 minutes (river data updates every ~15 min)
KPI_BROADCAST_INTERVAL = 60     # 1 minute (KPI cache auto-refreshes)
WEATHER_POLL_INTERVAL = 3600    # 1 hour (DHM updates daily)
ANNOUNCEMENT_POLL_INTERVAL = 10800  # 3 hours (govt announcements)
TWITTER_POLL_INTERVAL = 43200       # 12 hours (free tier: 100 tweets/month = ~3/day)
TWEET_DEDUP_BATCH_INTERVAL = 1800   # 30 minutes (tweet dedup + location extraction via Haiku)
MARKET_POLL_INTERVAL = 3600         # 1 hour (market data: NEPSE, forex, gold, fuel)
ENERGY_POLL_INTERVAL = 3600         # 1 hour (NEA power grid data)
GEE_CHANGE_DETECTION_INTERVAL = 21600  # 6 hours (satellite change detection)
ANALYST_AGENT_INTERVAL = 43200  # 12 hours (Narada Analyst Agent situation brief)
ECN_RESULTS_INTERVAL = 180     # 3 minutes (live election result counting from ECN)
PARLIAMENT_MEMBERS_INTERVAL = 86400  # 24 hours (parliament member profiles)
PARLIAMENT_BILLS_INTERVAL = 21600    # 6 hours (parliament bills)
PARLIAMENT_SCORE_INTERVAL = 86400    # 24 hours (performance score recalculation)
PARLIAMENT_COMMITTEES_INTERVAL = 86400  # 24 hours (parliament committees)
PARLIAMENT_VIDEOS_INTERVAL = 86400      # 24 hours (parliament video/speech data)
RATOPATI_SCRAPE_INTERVAL = 1800      # 30 minutes (Ratopati regional news scraping)
NEWS_SCRAPER_INTERVAL = 1800         # 30 minutes (all news scrapers: ekantipur, himalayan, etc.)
ENTITY_EXTRACTION_INTERVAL = 1800    # 30 minutes (backfill entity links for unlinked stories)
ENTITY_RECOUNT_INTERVAL = 3600       # 1 hour (recount entity mention stats)
ENTITY_PATTERN_REFRESH_INTERVAL = 86400  # 24 hours (rebuild Aho-Corasick automaton)
ELECTION_SYNC_INTERVAL = 86400  # 24 hours (nightly unified candidate sync)
HAIKU_REVIEW_INTERVAL = 7200    # 2 hours (batch review borderline stories)
NITTER_ACCOUNTS_INTERVAL = 900  # 15 minutes (Nitter account timelines)
NITTER_HASHTAGS_INTERVAL = 1800 # 30 minutes (Nitter hashtag searches)
PROVINCE_ANOMALY_INTERVAL = 43200  # 12 hours (Province Anomaly Agent)
AVIATION_POLL_INTERVAL = 60       # 1 minute (ADS-B aircraft positions)
OPENSKY_POLL_INTERVAL = 300       # 5 minutes (OpenSky Mode-S — conserve API credits)
AVIATION_CLEANUP_INTERVAL = 86400 # 24 hours (delete old positions)


async def poll_priority_sources():
    """Poll high-priority RSS sources (every 5 min)."""
    logger.info("Polling priority RSS sources...")
    try:
        async with AsyncSessionLocal() as db:
            service = IngestionService(db)
            stats = await service.ingest_all(priority_only=True)
            new_count = stats.get('new', 0)
            logger.info(f"Priority poll complete: {new_count} new stories")

            # Invalidate KPI cache if new data was ingested
            if new_count > 0:
                await invalidate_kpi_cache()
    except Exception as e:
        logger.exception(f"Error in priority poll: {e}")


async def poll_all_sources():
    """Poll all RSS sources (every 15 min)."""
    logger.info("Polling all RSS sources...")
    try:
        async with AsyncSessionLocal() as db:
            service = IngestionService(db)
            stats = await service.ingest_all(priority_only=False)
            new_count = stats.get('new', 0)
            logger.info(
                f"Full poll complete: {new_count} new, "
                f"{stats.get('duplicates', 0)} duplicates"
            )

            # Invalidate KPI cache if new data was ingested
            if new_count > 0:
                await invalidate_kpi_cache()
    except Exception as e:
        logger.exception(f"Error in full poll: {e}")


async def scrape_ratopati_regional():
    """Scrape Ratopati regional news (every 30 min).

    Since Ratopati's RSS feeds require special access, we scrape their
    provincial pages directly. Scrapes ALL 7 provinces for comprehensive coverage.
    """
    logger.info("Scraping Ratopati regional news (all provinces)...")
    try:
        from app.services.news_scraper_service import NewsScraperService

        async with AsyncSessionLocal() as db:
            service = NewsScraperService(db)
            result = await service.scrape_ratopati_all(max_articles_per_province=30)

            total_new = result.get("total", {}).get("new", 0)
            logger.info(f"Ratopati scrape complete: {total_new} new stories from all provinces")

            if total_new > 0:
                await invalidate_kpi_cache()

    except Exception as e:
        logger.exception(f"Error in Ratopati scraping: {e}")


async def scrape_all_news_sources():
    """Scrape all news sources that don't have working RSS feeds (every 30 min).

    Scrapes:
    - Ekantipur (7 provinces + national)
    - Himalayan Times (national)
    - My Republica (national)
    - Nepali Times (national)
    - Kantipur TV (national)
    """
    logger.info("Scraping all news sources (ekantipur, himalayan, republica, etc.)...")
    try:
        from app.services.news_scraper_service import NewsScraperService

        async with AsyncSessionLocal() as db:
            service = NewsScraperService(db)

            # Scrape each source
            total_new = 0

            # Ekantipur - all provinces + national
            ekantipur_result = await service.scrape_ekantipur_all(max_articles_per_province=20)
            total_new += ekantipur_result.get("total", {}).get("new", 0)

            # Himalayan Times
            himalayan_result = await service.scrape_himalayan(max_articles=30)
            total_new += himalayan_result.get("total", {}).get("new", 0)

            # My Republica
            republica_result = await service.scrape_republica(max_articles=30)
            total_new += republica_result.get("total", {}).get("new", 0)

            # Nepali Times
            nepalitimes_result = await service.scrape_nepalitimes(max_articles=20)
            total_new += nepalitimes_result.get("total", {}).get("new", 0)

            # Kantipur TV
            kantipurtv_result = await service.scrape_kantipurtv(max_articles=20)
            total_new += kantipurtv_result.get("total", {}).get("new", 0)

            # Backfill NULL published_at with created_at (HTML scrapers don't parse dates)
            from sqlalchemy import text
            result = await db.execute(
                text("UPDATE stories SET published_at = created_at WHERE published_at IS NULL")
            )
            backfilled = result.rowcount
            if backfilled:
                await db.commit()
                logger.info(f"Backfilled {backfilled} stories with NULL published_at")

            logger.info(f"News scraping complete: {total_new} new stories total")

            if total_new > 0:
                await invalidate_kpi_cache()

    except Exception as e:
        logger.exception(f"Error in news scraping: {e}")


async def run_clustering():
    """Run story clustering (every 6 hours)."""
    logger.info("Running story clustering...")
    try:
        async with AsyncSessionLocal() as db:
            service = ClusteringService(db)
            stats = await service.cluster_stories(hours=72, min_cluster_size=2)
            logger.info(
                f"Clustering complete: {stats.get('clusters_created', 0)} clusters, "
                f"{stats.get('stories_clustered', 0)} stories clustered, "
                f"{stats.get('stories_unclustered', 0)} unclustered"
            )
    except Exception as e:
        logger.exception(f"Error in clustering: {e}")

    # Haiku merge DISABLED on VPS — now runs locally via Claude CLI (Max subscription = free)
    # Local agent: run_local_api.py clustering → GET /ml/clustering/merge-candidates → Claude CLI → POST /ml/clustering/merge-results
    # See run_agents.sh clustering job and launchd plist com.nepalosint.clustering


async def generate_embeddings():
    """Generate embeddings for stories without them (every 6 hours)."""
    logger.info("Generating embeddings for new stories...")
    try:
        async with AsyncSessionLocal() as db:
            service = EmbeddingService(db)
            stats = await service.batch_generate_embeddings(
                hours=72,
                limit=120,
                nepal_only=True,
            )
            logger.info(
                f"Embedding generation complete: {stats.get('created', 0)} created, "
                f"{stats.get('skipped', 0)} skipped, {stats.get('failed', 0)} failed"
            )
    except Exception as e:
        logger.exception(f"Error generating embeddings: {e}")


async def submit_analysis_batch():
    """Submit unanalyzed clusters for batch analysis (every 2 hours)."""
    logger.info("Submitting clusters for batch analysis...")
    try:
        async with AsyncSessionLocal() as db:
            service = BriefingService(db)
            batch_id = await service.analyze_unanalyzed_clusters(
                hours=72,
                limit=50,
            )
            if batch_id:
                logger.info(f"Analysis batch submitted: {batch_id}")
            else:
                logger.info("No clusters to analyze or batch submission skipped")
    except Exception as e:
        logger.exception(f"Error submitting analysis batch: {e}")


async def process_completed_batches():
    """Check and process completed analysis batches (every 15 min)."""
    logger.info("Checking for completed analysis batches...")
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.analysis_batch import AnalysisBatch

            # Find batches that are still processing
            result = await db.execute(
                select(AnalysisBatch).where(
                    AnalysisBatch.status.in_(["pending", "processing"])
                )
            )
            pending_batches = result.scalars().all()

            if not pending_batches:
                logger.debug("No pending batches to check")
                return

            service = BriefingService(db)
            for batch in pending_batches:
                try:
                    status = await service.check_and_process_batch(
                        batch.anthropic_batch_id
                    )
                    if status == "ended":
                        logger.info(
                            f"Batch {batch.anthropic_batch_id} completed and processed"
                        )
                    elif status == "failed":
                        logger.warning(f"Batch {batch.anthropic_batch_id} failed")
                except Exception as e:
                    logger.error(
                        f"Error checking batch {batch.anthropic_batch_id}: {e}"
                    )
    except Exception as e:
        logger.exception(f"Error processing completed batches: {e}")


async def poll_bipad_disasters():
    """Poll BIPAD Portal for real-time disaster data (every 5 min)."""
    logger.info("Polling BIPAD Portal for disasters...")
    try:
        async with AsyncSessionLocal() as db:
            service = DisasterIngestionService(db)
            stats = await service.ingest_all(
                incident_limit=50,
                earthquake_limit=20,
                incident_days_back=7,  # Only recent incidents for frequent polling
                earthquake_days_back=3,
                min_earthquake_magnitude=4.0,
            )
            new_incidents = stats.get('incidents_new', 0)
            new_alerts = stats.get('alerts_new', 0)
            logger.info(
                f"BIPAD poll complete: {new_incidents} new incidents, "
                f"{new_alerts} new alerts"
            )

            # Invalidate KPI cache if new data was ingested
            if new_incidents > 0 or new_alerts > 0:
                await invalidate_kpi_cache()
    except Exception as e:
        logger.exception(f"Error polling BIPAD: {e}")


async def poll_river_monitoring():
    """Poll BIPAD Portal for real-time river monitoring data (every 10 min)."""
    logger.info("Polling BIPAD Portal for river data...")
    try:
        async with AsyncSessionLocal() as db:
            service = RiverMonitoringService(db)
            stats = await service.ingest_all()
            logger.info(
                f"River poll complete: {stats.get('readings_new', 0)} new readings, "
                f"{stats.get('danger_alerts', 0)} danger, {stats.get('warning_alerts', 0)} warning"
            )
    except Exception as e:
        logger.exception(f"Error polling river data: {e}")


async def poll_weather():
    """Poll DHM Nepal for weather forecast (every 1 hour)."""
    logger.info("Polling DHM Nepal for weather data...")
    try:
        from app.core.redis import get_redis

        async with AsyncSessionLocal() as db:
            redis_client = await get_redis()
            service = WeatherService(db, redis_client)
            stats = await service.ingest_forecast()
            if stats["fetched"]:
                action = "created" if stats["created"] else "updated"
                logger.info(f"Weather poll complete: forecast {action}")
            else:
                logger.warning(f"Weather poll failed: {stats.get('error')}")
    except Exception as e:
        logger.exception(f"Error polling weather data: {e}")


async def poll_govt_announcements():
    """Poll government websites for announcements (every 3 hours)."""
    logger.info("Polling government websites for announcements...")
    try:
        async with AsyncSessionLocal() as db:
            service = AnnouncementService(db)
            all_stats = await service.ingest_all_sources(max_pages=3)

            total_new = sum(s.new for s in all_stats)
            total_fetched = sum(s.fetched for s in all_stats)

            logger.info(
                f"Announcement poll complete: {total_fetched} fetched, "
                f"{total_new} new across {len(all_stats)} sources"
            )
    except Exception as e:
        logger.exception(f"Error polling government announcements: {e}")


async def poll_twitter():
    """Poll Twitter/X for Nepal-related tweets (every 1 hour)."""
    try:
        async with AsyncSessionLocal() as db:
            service = TwitterService(db)

            # Skip if not configured
            if not service.is_configured:
                logger.debug("Twitter API not configured, skipping poll")
                return

            logger.info("Polling Twitter/X for Nepal news...")

            # Fetch Nepal-related tweets
            result = await service.fetch_nepal_news(
                max_per_query=settings.twitter_max_per_query,
                classify=True,
            )

            new_count = result.get("total_new", 0)
            fetched = result.get("total_fetched", 0)

            logger.info(
                f"Twitter poll complete: {fetched} fetched, {new_count} new tweets"
            )

            # Also run saved queries if any
            query_result = await service.run_saved_queries(classify=True)
            if query_result.get("queries_run", 0) > 0:
                logger.info(
                    f"Twitter saved queries: {query_result.get('total_new', 0)} new "
                    f"from {query_result.get('queries_run', 0)} queries"
                )

    except Exception as e:
        logger.exception(f"Error polling Twitter: {e}")


async def poll_nitter_accounts():
    """Scrape verified account timelines via Nitter (every 15 min)."""
    try:
        async with AsyncSessionLocal() as db:
            service = NitterService(db)
            logger.info("Scraping Nitter account timelines...")
            result = await service.scrape_all_accounts()

            scraped = result.get("accounts_scraped", 0)
            fetched = result.get("tweets_fetched", 0)
            new = result.get("new_tweets", 0)
            errors = result.get("errors", [])

            logger.info(
                f"Nitter accounts: {scraped} scraped, {fetched} fetched, {new} new"
            )
            if errors:
                logger.warning(f"Nitter account errors: {errors}")

    except Exception as e:
        logger.exception(f"Error polling Nitter accounts: {e}")


async def poll_nitter_hashtags():
    """Scrape hashtag searches via Nitter (every 30 min)."""
    try:
        async with AsyncSessionLocal() as db:
            service = NitterService(db)
            logger.info("Scraping Nitter hashtag searches...")
            result = await service.scrape_all_hashtags()

            scraped = result.get("hashtags_scraped", 0)
            fetched = result.get("tweets_fetched", 0)
            new = result.get("new_tweets", 0)
            errors = result.get("errors", [])

            logger.info(
                f"Nitter hashtags: {scraped} scraped, {fetched} fetched, {new} new"
            )
            if errors:
                logger.warning(f"Nitter hashtag errors: {errors}")

    except Exception as e:
        logger.exception(f"Error polling Nitter hashtags: {e}")


async def poll_nitter_searches():
    """Scrape text search queries via Nitter (every 30 min)."""
    try:
        async with AsyncSessionLocal() as db:
            service = NitterService(db)
            logger.info("Scraping Nitter text searches...")
            result = await service.scrape_all_searches()

            scraped = result.get("searches_scraped", 0)
            fetched = result.get("tweets_fetched", 0)
            new = result.get("new_tweets", 0)
            errors = result.get("errors", [])

            logger.info(
                f"Nitter searches: {scraped} scraped, {fetched} fetched, {new} new"
            )
            if errors:
                logger.warning(f"Nitter search errors: {errors}")

    except Exception as e:
        logger.exception(f"Error polling Nitter searches: {e}")


async def run_tweet_dedup_batch():
    """Run tweet deduplication + location extraction batch (every 30 min)."""
    try:
        async with AsyncSessionLocal() as db:
            from app.services.tweet_dedup_service import TweetDedupService
            service = TweetDedupService(db)
            logger.info("Running tweet dedup batch...")
            stats = await service.run_batch()
            logger.info(
                f"Tweet dedup batch: processed {stats.get('processed', 0)} tweets, "
                f"created {stats.get('clusters_created', 0)} clusters, "
                f"extracted locations for {stats.get('locations_extracted', 0)}"
            )
    except Exception as e:
        logger.exception(f"Error running tweet dedup batch: {e}")


async def poll_market_data():
    """Poll market data sources: NEPSE, forex, gold/silver, fuel (every 1 hour)."""
    logger.info("Polling market data sources...")
    try:
        from app.core.redis import get_redis

        async with AsyncSessionLocal() as db:
            redis_client = await get_redis()
            service = MarketService(db, redis_client)
            stats = await service.ingest_all()
            await service.invalidate_cache()

            # Log results
            forex = stats.get("forex", {})
            gold_silver = stats.get("gold_silver", {})
            fuel = stats.get("fuel", {})
            nepse = stats.get("nepse", {})

            success_count = sum([
                1 if forex.get("saved") else 0,
                1 if gold_silver.get("gold_saved") else 0,
                1 if gold_silver.get("silver_saved") else 0,
                1 if fuel.get("petrol_saved") else 0,
                1 if fuel.get("diesel_saved") else 0,
                1 if nepse.get("saved") else 0,
            ])

            errors = [
                f"forex: {forex.get('error')}" if forex.get("error") else None,
                f"gold_silver: {gold_silver.get('error')}" if gold_silver.get("error") else None,
                f"fuel: {fuel.get('error')}" if fuel.get("error") else None,
                f"nepse: {nepse.get('error')}" if nepse.get("error") else None,
            ]
            errors = [e for e in errors if e]

            logger.info(f"Market poll complete: {success_count}/6 indicators updated")
            if errors:
                logger.warning(f"Market poll errors: {', '.join(errors)}")

    except Exception as e:
        logger.exception(f"Error polling market data: {e}")


async def poll_energy_data():
    """Poll NEA for power grid energy data (every 1 hour)."""
    logger.info("Polling NEA for energy data...")
    try:
        from app.core.redis import get_redis

        async with AsyncSessionLocal() as db:
            redis_client = await get_redis()
            service = EnergyService(db, redis_client)
            stats = await service.ingest_all()

            if stats["fetched"]:
                logger.info(
                    f"Energy poll complete: {stats['saved']} indicators saved "
                    f"({', '.join(stats.get('data_types', []))})"
                )
            else:
                logger.warning(f"Energy poll failed: {stats.get('error')}")

    except Exception as e:
        logger.exception(f"Error polling energy data: {e}")


async def poll_parliament_members():
    """Poll Nepal Parliament for MP profiles (daily)."""
    logger.info("Polling Parliament for MP profiles...")
    try:
        from app.ingestion.parliament_scraper import ParliamentScraper
        from app.repositories.parliament import MPPerformanceRepository
        from app.services.parliament_linker import ParliamentLinker

        async with AsyncSessionLocal() as db:
            async with ParliamentScraper() as scraper:
                # Scrape both houses
                for chamber in ['hor', 'na']:
                    members = await scraper.scrape_members(chamber)
                    logger.info(f"Scraped {len(members)} {chamber.upper()} members")

                    # Upsert to database
                    repo = MPPerformanceRepository(db)
                    for member in members:
                        await repo.upsert({
                            'mp_id': member.mp_id,
                            'name_en': member.name_en,
                            'name_ne': member.name_ne,
                            'party': member.party,
                            'constituency': member.constituency,
                            'chamber': chamber,
                            'photo_url': member.photo_url,
                            'is_minister': member.is_minister,
                            'ministry_portfolio': member.ministry_portfolio,
                        })

            # Run name matching to link MPs to election candidates
            linker = ParliamentLinker(db)
            link_results = await linker.link_all_members()
            logger.info(
                f"Parliament poll complete: linked {link_results['linked']} MPs to candidates"
            )
    except Exception as e:
        logger.exception(f"Error polling parliament members: {e}")


async def poll_parliament_bills():
    """Poll Nepal Parliament for bills (every 6 hours)."""
    logger.info("Polling Parliament for bills...")
    try:
        from app.ingestion.parliament_scraper import ParliamentScraper
        from app.repositories.parliament import BillRepository, MPPerformanceRepository

        async with AsyncSessionLocal() as db:
            async with ParliamentScraper() as scraper:
                bill_repo = BillRepository(db)
                mp_repo = MPPerformanceRepository(db)

                # Scrape bills from both houses (independent per chamber)
                for chamber in ['hor', 'na']:
                    try:
                        for bill_type in ['registered', 'passed', 'state']:
                            bills = await scraper.scrape_bills_with_details(
                                bill_type=bill_type,
                                chamber=chamber,
                                max_pages=5,
                                fetch_details=True,
                            )
                            logger.info(f"Scraped {len(bills)} {bill_type} bills from {chamber.upper()}")

                            # Upsert to database
                            for bill in bills:
                                # Try to find presenting MP
                                presenting_mp_id = None
                                if bill.presenting_mp_name:
                                    mps = await mp_repo.search_by_name(bill.presenting_mp_name, limit=1)
                                    if mps:
                                        presenting_mp_id = mps[0].id

                                # Parse date — may be BS date string like '2082-03-29'
                                from datetime import date as date_type
                                presented = bill.presented_date
                                if isinstance(presented, str):
                                    try:
                                        parts = presented.split('-')
                                        yr = int(parts[0])
                                        if yr > 2050:  # BS date — skip (can't convert without nepali-datetime)
                                            presented = None
                                        else:
                                            presented = date_type(yr, int(parts[1]), int(parts[2]))
                                    except (ValueError, IndexError):
                                        presented = None

                                await bill_repo.upsert({
                                    'external_id': bill.external_id,
                                    'title_en': bill.title_en,
                                    'title_ne': bill.title_ne,
                                    'bill_type': bill.bill_type,
                                    'status': bill.status,
                                    'presented_date': presented,
                                    'presenting_mp_id': presenting_mp_id,
                                    'ministry': bill.ministry,
                                    'chamber': chamber,
                                    'term': bill.term,
                                    'pdf_url': bill.pdf_url,
                                })
                    except Exception as e:
                        logger.exception(f"Error scraping {chamber} bills: {e}")

            logger.info("Parliament bills poll complete")
    except Exception as e:
        logger.exception(f"Error polling parliament bills: {e}")


async def recalculate_parliament_scores():
    """Recalculate MP performance scores (daily)."""
    logger.info("Recalculating MP performance scores...")
    try:
        from app.services.parliament_scorer import PerformanceScorer

        async with AsyncSessionLocal() as db:
            scorer = PerformanceScorer(db)
            stats = await scorer.calculate_all_scores()
            logger.info(
                f"Score calculation complete: {stats['total_scored']} MPs scored, "
                f"avg score: {stats['avg_score']:.1f}"
            )
    except Exception as e:
        logger.exception(f"Error recalculating parliament scores: {e}")


async def poll_parliament_committees():
    """Poll Nepal Parliament for committee data (daily)."""
    logger.info("Polling Parliament for committee data...")
    try:
        from app.ingestion.parliament_scraper import ParliamentScraper
        from app.repositories.parliament import CommitteeRepository, MPPerformanceRepository

        async with AsyncSessionLocal() as db:
            async with ParliamentScraper() as scraper:
                mp_repo = MPPerformanceRepository(db)
                committee_repo = CommitteeRepository(db)
                # CommitteeRepository handles memberships via upsert_membership()

                for chamber in ['hor', 'na']:
                    try:
                        committees = await scraper.scrape_committees(chamber)
                        logger.info(f"Scraped {len(committees)} committees from {chamber.upper()}")

                        for committee in committees:
                            # Upsert committee
                            db_committee = await committee_repo.upsert({
                                'external_id': committee.external_id,
                                'name_en': committee.name_en,
                                'name_ne': committee.name_ne,
                                'committee_type': committee.committee_type,
                                'chamber': chamber,
                                'is_active': committee.is_active,
                            })

                            # Upsert members
                            for member_data in committee.members:
                                # Find MP by name
                                mps = await mp_repo.search_by_name(member_data['name'], limit=1)
                                if mps:
                                    await committee_repo.upsert_membership(
                                        committee_id=db_committee.id,
                                        mp_id=mps[0].id,
                                        role=member_data.get('role', 'member'),
                                    )

                        await db.commit()
                    except Exception as e:
                        logger.exception(f"Error scraping {chamber} committees: {e}")
                        await db.rollback()

            logger.info("Parliament committees poll complete")
    except Exception as e:
        logger.exception(f"Error polling parliament committees: {e}")


async def poll_parliament_videos():
    """Poll Parliament video archives for speech data (daily)."""
    logger.info("Polling Parliament video archives for speech data...")
    try:
        from app.services.parliament_linker import ParliamentLinker

        async with AsyncSessionLocal() as db:
            linker = ParliamentLinker(db)

            for chamber in ['hor', 'na']:
                try:
                    stats = await linker.match_video_speakers(
                        chamber=chamber,
                        max_pages=20,
                        max_sessions=100,
                    )
                    logger.info(
                        f"Video matching ({chamber.upper()}): "
                        f"{stats['matched_speakers']}/{stats['unique_speakers']} speakers matched, "
                        f"{stats['mps_updated']} MPs updated"
                    )
                except Exception as e:
                    logger.exception(f"Error matching {chamber} video speakers: {e}")

            await db.commit()
    except Exception as e:
        logger.exception(f"Error polling parliament videos: {e}")


async def run_full_parliament_sync():
    """Run complete parliament data sync (one-time bootstrap or manual trigger)."""
    logger.info("=== FULL PARLIAMENT SYNC START ===")
    try:
        await poll_parliament_members()
        await poll_parliament_committees()
        await poll_parliament_bills()
        await poll_parliament_videos()
        await recalculate_parliament_scores()
        logger.info("=== FULL PARLIAMENT SYNC COMPLETE ===")
    except Exception as e:
        logger.exception(f"Error in full parliament sync: {e}")


async def run_gee_change_detection():
    """Run satellite change detection for subscribed regions (every 6 hours).

    Uses Google Earth Engine to detect:
    - Flood extent changes (Sentinel-1 SAR)
    - Landslides (NDVI loss + slope)
    - Vegetation anomalies (NDVI below baseline)

    Alerts are saved to database and broadcast via WebSocket.
    """
    if not settings.gee_change_detection_enabled:
        logger.debug("GEE change detection disabled in config")
        return

    logger.info("Running GEE satellite change detection...")
    try:
        from app.services.earth_engine import ChangeDetectorService

        async with AsyncSessionLocal() as db:
            service = ChangeDetectorService(db)
            stats = await service.run_detection_cycle()

            logger.info(
                f"GEE change detection complete: "
                f"{stats.get('subscriptions_checked', 0)} subscriptions checked, "
                f"{stats.get('alerts_created', 0)} alerts created, "
                f"{stats.get('errors', 0)} errors"
            )
    except Exception as e:
        logger.exception(f"Error in GEE change detection: {e}")


async def run_analyst_agent():
    """Run the Narada Analyst Agent to produce a situation brief (every 12 hours)."""
    logger.info("Running Narada Analyst Agent...")
    try:
        from app.services.analyst_agent.agent import NaradaAnalystAgent
        from app.services.editorial_control_service import EditorialControlService

        async with AsyncSessionLocal() as db:
            control_service = EditorialControlService(db)
            if not await control_service.is_enabled("analyst_brief_generation"):
                logger.info("Analyst brief generation paused, skipping scheduled run")
                return
            await control_service.mark_run_started("analyst_brief_generation")
            agent = NaradaAnalystAgent(db=db, hours=4)
            brief = await agent.run()
            logger.info(
                f"Analyst agent complete: run #{brief.run_number}, "
                f"status={brief.status}, duration={brief.duration_seconds:.1f}s, "
                f"claude_calls={brief.claude_calls}"
            )
            await control_service.mark_run_finished("analyst_brief_generation", success=True)
    except Exception as e:
        try:
            async with AsyncSessionLocal() as db:
                control_service = EditorialControlService(db)
                await control_service.mark_run_finished("analyst_brief_generation", success=False, error=str(e))
        except Exception:
            logger.exception("Failed to mark analyst brief generation error")
        logger.exception(f"Error in analyst agent: {e}")


async def run_province_anomaly_agent():
    """Run the Province Anomaly Agent to assess all 7 provinces (every 12 hours)."""
    logger.info("Running Province Anomaly Agent...")
    try:
        from app.services.province_anomaly_agent.agent import ProvinceAnomalyAgent

        async with AsyncSessionLocal() as db:
            agent = ProvinceAnomalyAgent(db=db, hours=6)
            run = await agent.run()
            logger.info(
                "Province Anomaly Agent complete: status=%s, "
                "stories=%d, tweets=%d",
                run.status, run.stories_analyzed, run.tweets_analyzed,
            )
    except Exception as e:
        logger.exception(f"Error in province anomaly agent: {e}")


async def run_entity_extraction():
    """Extract entities from recent unlinked stories (every 30 min)."""
    logger.info("Running entity extraction for unlinked stories...")
    try:
        from app.services.nlp.database_entity_extractor import (
            get_database_entity_extractor,
            initialize_entity_extractor,
        )
        from app.models.story import Story
        from app.models.story_entity_link import StoryEntityLink
        from app.models.political_entity import PoliticalEntity
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            extractor = get_database_entity_extractor()
            if not extractor.is_initialized:
                await initialize_entity_extractor(db)

            # Find stories without entity links from last 2 hours
            from datetime import timedelta
            cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
            result = await db.execute(
                select(Story)
                .outerjoin(StoryEntityLink, StoryEntityLink.story_id == Story.id)
                .where(Story.created_at >= cutoff)
                .where(StoryEntityLink.id.is_(None))
                .where(Story.nepal_relevance != "international")
                .limit(500)
            )
            stories = list(result.scalars().all())

            if not stories:
                logger.debug("No unlinked stories to process")
                return

            # Build canonical_id → entity UUID mapping
            entity_result = await db.execute(
                select(PoliticalEntity.canonical_id, PoliticalEntity.id)
            )
            entity_map = {row[0]: row[1] for row in entity_result.all()}

            link_count = 0
            for story in stories:
                text = f"{story.title} {story.summary or ''}"
                entities = await extractor.extract(text, min_confidence=0.6, session=db)

                for entity in entities:
                    entity_uuid = entity_map.get(entity.canonical_id)
                    if not entity_uuid:
                        continue

                    is_title = entity.text.lower() in story.title.lower() if story.title else False
                    link = StoryEntityLink(
                        story_id=story.id,
                        entity_id=entity_uuid,
                        is_title_mention=is_title,
                        confidence=entity.confidence,
                    )
                    db.add(link)
                    link_count += 1

            await db.commit()
            logger.info(f"Entity extraction complete: {link_count} links created for {len(stories)} stories")

            # Discover co-mentions for newly linked stories
            if link_count > 0:
                try:
                    from app.services.entity_intelligence.relationship_discovery import RelationshipDiscoveryService
                    discovery = RelationshipDiscoveryService(db)
                    for story in stories:
                        await discovery.discover_co_mentions_for_story(story.id)
                    await db.commit()
                except Exception as e:
                    logger.debug(f"Co-mention discovery skipped: {e}")

    except Exception as e:
        logger.exception(f"Error in entity extraction: {e}")


async def recount_entity_mentions():
    """Recount entity mention stats from StoryEntityLink (every 1 hour)."""
    logger.info("Recounting entity mentions...")
    try:
        from app.models.political_entity import PoliticalEntity, EntityTrend
        from app.models.story_entity_link import StoryEntityLink
        from app.models.story import Story
        from sqlalchemy import select, func

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PoliticalEntity))
            entities = list(result.scalars().all())

            now = datetime.now(timezone.utc)
            from datetime import timedelta
            cutoff_24h = now - timedelta(hours=24)
            cutoff_7d = now - timedelta(days=7)

            updated = 0
            for entity in entities:
                # Total mentions
                total_result = await db.execute(
                    select(func.count(StoryEntityLink.id))
                    .where(StoryEntityLink.entity_id == entity.id)
                )
                total = total_result.scalar() or 0

                # 24h mentions
                m24h_result = await db.execute(
                    select(func.count(StoryEntityLink.id))
                    .join(Story, StoryEntityLink.story_id == Story.id)
                    .where(StoryEntityLink.entity_id == entity.id)
                    .where(Story.published_at >= cutoff_24h)
                )
                m24h = m24h_result.scalar() or 0

                # 7d mentions
                m7d_result = await db.execute(
                    select(func.count(StoryEntityLink.id))
                    .join(Story, StoryEntityLink.story_id == Story.id)
                    .where(StoryEntityLink.entity_id == entity.id)
                    .where(Story.published_at >= cutoff_7d)
                )
                m7d = m7d_result.scalar() or 0

                # Determine trend
                prev_7d = entity.mentions_7d or 0
                if m7d > prev_7d * 1.2:
                    trend = EntityTrend.RISING
                elif m7d < prev_7d * 0.8:
                    trend = EntityTrend.FALLING
                else:
                    trend = EntityTrend.STABLE

                entity.total_mentions = total
                entity.mentions_24h = m24h
                entity.mentions_7d = m7d
                entity.trend = trend
                updated += 1

            await db.commit()
            logger.info(f"Entity recount complete: {updated} entities updated")

    except Exception as e:
        logger.exception(f"Error recounting entity mentions: {e}")


async def refresh_entity_patterns():
    """Rebuild Aho-Corasick automaton from latest DB data (every 24 hours)."""
    logger.info("Refreshing entity extraction patterns...")
    try:
        from app.services.nlp.database_entity_extractor import get_database_entity_extractor

        async with AsyncSessionLocal() as db:
            extractor = get_database_entity_extractor()
            await extractor.refresh_patterns(db)
            logger.info(f"Entity patterns refreshed: {extractor.pattern_count} patterns")

    except Exception as e:
        logger.exception(f"Error refreshing entity patterns: {e}")


async def review_borderline_stories():
    """Batch review stories with low relevance scores using Haiku (every 6 hours).

    Safety net: catches stories that passed the keyword filter but weren't
    Haiku-verified (timeout fallbacks, pre-deployment stories).
    """
    if not settings.haiku_relevance_filter_enabled:
        logger.debug("Haiku relevance filter disabled, skipping batch review")
        return

    logger.info("Running Haiku batch review of borderline stories...")
    try:
        from app.services.analysis.haiku_relevance_filter import verify_nepal_relevance
        from app.services.editorial_control_service import EditorialControlService
        from app.models.story import Story
        from sqlalchemy import select, update
        from datetime import timedelta

        async with AsyncSessionLocal() as db:
            control_service = EditorialControlService(db)
            if not await control_service.is_enabled("haiku_relevance"):
                logger.info("Haiku relevance automation paused, skipping borderline review")
                return
            await control_service.mark_run_started("haiku_relevance")
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

            # Find borderline stories: score < 0.75, no HAIKU_VERIFIED trigger, last 24h
            result = await db.execute(
                select(Story)
                .where(Story.created_at >= cutoff)
                .where(Story.nepal_relevance != "INTERNATIONAL")
                .where(Story.relevance_score < 0.75)
                .where(~Story.relevance_triggers.contains(["HAIKU_VERIFIED"]))
                .limit(100)
            )
            stories = list(result.scalars().all())

            if not stories:
                logger.debug("No borderline stories to review")
                return

            downgraded = 0
            verified = 0
            errors = 0

            for story in stories:
                haiku_result = await verify_nepal_relevance(
                    title=story.title,
                    summary=story.summary,
                    source_name=story.source_name,
                )

                if haiku_result is False:
                    story.nepal_relevance = "INTERNATIONAL"
                    downgraded += 1
                elif haiku_result is True:
                    triggers = list(story.relevance_triggers or [])
                    triggers.append("HAIKU_VERIFIED")
                    story.relevance_triggers = triggers
                    verified += 1
                else:
                    errors += 1

            await db.commit()
            await control_service.mark_run_finished("haiku_relevance", success=True)
            logger.info(
                "Haiku batch review complete: %d checked, %d downgraded, "
                "%d verified, %d errors",
                len(stories), downgraded, verified, errors,
            )

    except Exception as e:
        try:
            async with AsyncSessionLocal() as db:
                control_service = EditorialControlService(db)
                await control_service.mark_run_finished("haiku_relevance", success=False, error=str(e))
        except Exception:
            logger.exception("Failed to mark Haiku relevance error")
        logger.exception(f"Error in Haiku batch review: {e}")


async def run_election_candidate_sync():
    """Nightly election sync + unified graph ingest/resolution/reconciliation."""
    logger.info("Running unified election + graph nightly sync...")
    backend_root = Path(__file__).resolve().parents[2]
    script_path = backend_root / "scripts" / "import_election_data.py"
    reconciliation_script = backend_root / "scripts" / "unified_graph_reconciliation.py"
    cmd = [
        sys.executable,
        str(script_path),
        "--all",
        "--replace-existing",
        "--link-entities",
        "--reapply-overrides",
        "--reconcile",
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(backend_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        out_text = stdout.decode("utf-8", errors="ignore").strip()
        err_text = stderr.decode("utf-8", errors="ignore").strip()

        if proc.returncode != 0:
            logger.error(
                "Unified candidate sync failed (code=%s): %s",
                proc.returncode,
                err_text or out_text,
            )
            return

        logger.info("Unified candidate sync complete")
        if out_text:
            logger.info(out_text)

        # Unified graph refresh chain (ingestion -> resolution -> metrics)
        from app.services.graph.graph_ingestion_service import GraphIngestionService
        from app.services.graph.entity_resolution_service import EntityResolutionService
        from app.services.graph.graph_metrics_service import GraphMetricsService

        async with AsyncSessionLocal() as db:
            ingestion = GraphIngestionService(db)
            ingest_stats = await ingestion.run_full_ingestion()
            logger.info("Unified graph ingestion summary: %s", ingest_stats)

            resolver = EntityResolutionService(db)
            resolution_stats = await resolver.run_full_resolution()
            logger.info("Unified graph resolution summary: %s", resolution_stats)

            metrics = GraphMetricsService(db)
            metrics_stats = await metrics.compute_all_metrics()
            logger.info("Unified graph metrics summary: %s", metrics_stats)

        # Reconciliation report with threshold alerts.
        recon_proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(reconciliation_script),
            cwd=str(backend_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        recon_out, recon_err = await recon_proc.communicate()
        recon_text = recon_out.decode("utf-8", errors="ignore").strip()
        if recon_text:
            logger.info("Unified graph reconciliation: %s", recon_text)
        if recon_proc.returncode != 0:
            logger.warning(
                "Unified graph reconciliation thresholds breached: %s",
                recon_err.decode("utf-8", errors="ignore").strip() or recon_text,
            )
    except Exception as e:
        logger.exception(f"Error running unified election+graph sync: {e}")


async def broadcast_kpi_update():
    """Broadcast KPI update to WebSocket clients (every 1 min)."""
    try:
        from app.core.redis import get_redis
        from app.services.kpi_service import KPIService
        from app.services.kpi_cache import KPICacheService, KPICacheManager

        async with AsyncSessionLocal() as db:
            redis_client = await get_redis()
            cache_service = KPICacheService(redis_client)
            kpi_service = KPIService(db)
            cache_manager = KPICacheManager(cache_service, kpi_service)

            # Get KPI snapshot (from cache or compute fresh)
            snapshot = await cache_manager.get_or_compute(hours=24)

            await publish_news(
                {
                    "type": "kpi_update",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": snapshot.model_dump(mode="json"),
                }
            )
    except Exception as e:
        logger.warning(f"Error broadcasting KPI update: {e}")


async def invalidate_kpi_cache():
    """Invalidate KPI cache (called after data ingestion)."""
    try:
        from app.core.redis import get_redis
        from app.services.kpi_cache import KPICacheService

        redis_client = await get_redis()
        cache_service = KPICacheService(redis_client)
        await cache_service.invalidate()
        logger.debug("KPI cache invalidated")
    except Exception as e:
        logger.warning(f"Error invalidating KPI cache: {e}")


async def poll_aviation():
    """Poll adsb.lol for live aircraft in Nepal airspace (every 60s)."""
    try:
        from app.services.aviation_service import AviationService

        async with AsyncSessionLocal() as db:
            service = AviationService(db)
            positions = await service.poll_adsb_lol()
            if positions:
                count = await service.store_positions(positions)
                logger.info(f"Aviation poll: stored {count} aircraft positions")
            else:
                logger.debug("Aviation poll: no aircraft in Nepal airspace")
    except Exception as e:
        logger.exception(f"Error polling aviation data: {e}")


async def poll_opensky():
    """Poll OpenSky Network for Mode-S + satellite data (every 5 min)."""
    try:
        from app.services.aviation_service import AviationService

        async with AsyncSessionLocal() as db:
            service = AviationService(db)
            positions = await service.poll_opensky()
            if positions:
                count = await service.store_positions(positions)
                logger.info(f"OpenSky poll: stored {count} aircraft positions")
            else:
                logger.debug("OpenSky poll: no aircraft found")
    except Exception as e:
        logger.exception(f"Error polling OpenSky data: {e}")


async def cleanup_aviation():
    """Clean up old aircraft positions (daily)."""
    try:
        from app.services.aviation_service import AviationService

        async with AsyncSessionLocal() as db:
            service = AviationService(db)
            deleted = await service.cleanup_old_positions(keep_days=7)
            logger.info(f"Aviation cleanup: deleted {deleted} old positions")
    except Exception as e:
        logger.exception(f"Error cleaning up aviation data: {e}")


async def poll_ecn_election_results():
    """Poll ECN result.election.gov.np for live HOR FPTP vote counts (every 3 min)."""
    try:
        from app.ingestion.ecn_results_scraper import scrape_election_results
        await scrape_election_results()
    except Exception as e:
        logger.exception(f"Error polling ECN election results: {e}")


def start_scheduler():
    """Start the background scheduler."""
    now = datetime.now(timezone.utc)

    # Priority sources every 5 minutes (fire immediately on startup)
    scheduler.add_job(
        poll_priority_sources,
        trigger=IntervalTrigger(seconds=settings.rss_poll_interval_priority),
        id="poll_priority",
        name="Poll Priority RSS Sources",
        replace_existing=True,
        next_run_time=now,
    )

    # All sources every 15 minutes (fire immediately on startup)
    scheduler.add_job(
        poll_all_sources,
        trigger=IntervalTrigger(seconds=settings.rss_poll_interval_all),
        id="poll_all",
        name="Poll All RSS Sources",
        replace_existing=True,
        next_run_time=now,
    )

    # Ratopati regional news scraping every 30 minutes (fire immediately on startup)
    scheduler.add_job(
        scrape_ratopati_regional,
        trigger=IntervalTrigger(seconds=RATOPATI_SCRAPE_INTERVAL),
        id="scrape_ratopati",
        name="Scrape Ratopati Regional News",
        replace_existing=True,
        next_run_time=now,
    )

    # All news sources scraping every 30 minutes (fire immediately on startup)
    scheduler.add_job(
        scrape_all_news_sources,
        trigger=IntervalTrigger(seconds=NEWS_SCRAPER_INTERVAL),
        id="scrape_news_sources",
        name="Scrape All News Sources",
        replace_existing=True,
        next_run_time=now,
    )

    # Clustering every 6 hours (embeddings + gray-zone merge)
    scheduler.add_job(
        run_clustering,
        trigger=IntervalTrigger(seconds=CLUSTERING_INTERVAL),
        id="run_clustering",
        name="Run Story Clustering",
        replace_existing=True,
        next_run_time=now + timedelta(minutes=20),  # wait for embedding backfill first
    )

    # Embedding generation every 6 hours, ahead of clustering
    scheduler.add_job(
        generate_embeddings,
        trigger=IntervalTrigger(seconds=EMBEDDING_INTERVAL),
        id="generate_embeddings",
        name="Generate Story Embeddings",
        replace_existing=True,
        next_run_time=now,
    )

    # Submit analysis batches every 2 hours
    # scheduler.add_job(
    #     submit_analysis_batch,
    #     trigger=IntervalTrigger(seconds=ANALYSIS_BATCH_INTERVAL),
    #     id="submit_analysis_batch",
    #     name="Submit Analysis Batch",
    #     replace_existing=True,
    # )

    # Check completed batches every 15 minutes
    # scheduler.add_job(
    #     process_completed_batches,
    #     trigger=IntervalTrigger(seconds=BATCH_CHECK_INTERVAL),
    #     id="process_completed_batches",
    #     name="Process Completed Batches",
    #     replace_existing=True,
    # )

    # Poll BIPAD Portal — DISABLED election day
    # scheduler.add_job(
    #     poll_bipad_disasters,
    #     trigger=IntervalTrigger(seconds=BIPAD_POLL_INTERVAL),
    #     id="poll_bipad",
    #     name="Poll BIPAD Disasters",
    #     replace_existing=True,
    # )

    # River monitoring DISABLED — heavy queries cause CPU spikes on small instance
    # scheduler.add_job(
    #     poll_river_monitoring,
    #     trigger=IntervalTrigger(seconds=RIVER_POLL_INTERVAL),
    #     id="poll_river",
    #     name="Poll River Monitoring",
    #     replace_existing=True,
    # )

    # Broadcast KPI updates every 1 minute
    scheduler.add_job(
        broadcast_kpi_update,
        trigger=IntervalTrigger(seconds=KPI_BROADCAST_INTERVAL),
        id="broadcast_kpi",
        name="Broadcast KPI Update",
        replace_existing=True,
    )

    # Poll DHM weather — DISABLED election day
    # scheduler.add_job(
    #     poll_weather,
    #     trigger=IntervalTrigger(seconds=WEATHER_POLL_INTERVAL),
    #     id="poll_weather",
    #     name="Poll DHM Weather",
    #     replace_existing=True,
    # )

    # Poll government announcements — DISABLED election day
    # scheduler.add_job(
    #     poll_govt_announcements,
    #     trigger=IntervalTrigger(seconds=ANNOUNCEMENT_POLL_INTERVAL),
    #     id="poll_announcements",
    #     name="Poll Govt Announcements",
    #     replace_existing=True,
    # )

    # ── Claude-heavy agents: DISABLED on VPS ──
    # These run LOCALLY on dev Mac via run_local_api.py (Claude Max subscription = free).
    # VPS SDK calls cost API credits. Local cron handles scheduling.
    # See backend-v5/LOCAL_AGENTS.md for setup instructions.
    #
    # scheduler.add_job(
    #     run_analyst_agent,
    #     trigger=IntervalTrigger(seconds=ANALYST_AGENT_INTERVAL),
    #     id="run_analyst_agent",
    #     name="Run Analyst Agent",
    #     replace_existing=True,
    # )
    #
    # scheduler.add_job(
    #     run_province_anomaly_agent,
    #     trigger=IntervalTrigger(seconds=PROVINCE_ANOMALY_INTERVAL),
    #     id="run_province_anomaly_agent",
    #     name="Run Province Anomaly Agent",
    #     replace_existing=True,
    # )

    # Poll Twitter/X every 12 hours (respects free tier limits)
    scheduler.add_job(
        poll_twitter,
        trigger=IntervalTrigger(seconds=TWITTER_POLL_INTERVAL),
        id="poll_twitter",
        name="Poll Twitter/X",
        replace_existing=True,
    )

    # ── Nitter scraper: DISABLED on VPS ──
    # Nitter instances block VPS/datacenter IPs (403 Forbidden).
    # Runs LOCALLY via cron: run_agents.sh nitter (every 30 min).
    # Uses SSH tunnels for direct DB write.
    #
    # scheduler.add_job(
    #     poll_nitter_accounts,
    #     trigger=IntervalTrigger(seconds=NITTER_ACCOUNTS_INTERVAL),
    #     id="poll_nitter_accounts",
    #     name="Scrape Nitter Accounts",
    #     replace_existing=True,
    #     next_run_time=now,
    # )
    #
    # scheduler.add_job(
    #     poll_nitter_hashtags,
    #     trigger=IntervalTrigger(seconds=NITTER_HASHTAGS_INTERVAL),
    #     id="poll_nitter_hashtags",
    #     name="Scrape Nitter Hashtags",
    #     replace_existing=True,
    # )

    # Tweet dedup + location extraction batch every 30 minutes
    scheduler.add_job(
        run_tweet_dedup_batch,
        trigger=IntervalTrigger(seconds=TWEET_DEDUP_BATCH_INTERVAL),
        id="tweet_dedup_batch",
        name="Tweet Dedup Batch",
        replace_existing=True,
    )

    # Poll market data every 1 hour
    scheduler.add_job(
        poll_market_data,
        trigger=IntervalTrigger(seconds=MARKET_POLL_INTERVAL),
        id="poll_market",
        name="Poll Market Data",
        replace_existing=True,
        next_run_time=now,
    )

    # Poll NEA energy data — DISABLED election day
    # scheduler.add_job(
    #     poll_energy_data,
    #     trigger=IntervalTrigger(seconds=ENERGY_POLL_INTERVAL),
    #     id="poll_energy",
    #     name="Poll NEA Energy Data",
    #     replace_existing=True,
    # )

    # GEE satellite change detection every 6 hours
    if settings.gee_change_detection_enabled:
        scheduler.add_job(
            run_gee_change_detection,
            trigger=IntervalTrigger(seconds=GEE_CHANGE_DETECTION_INTERVAL),
            id="gee_change_detection",
            name="GEE Change Detection",
            replace_existing=True,
        )

    # ── ALL BELOW DISABLED FOR ELECTION DAY — re-enable after counting ──

    # Parliament (all 5 jobs disabled)
    # scheduler.add_job(poll_parliament_members, trigger=IntervalTrigger(seconds=PARLIAMENT_MEMBERS_INTERVAL), id="poll_parliament_members", name="Poll Parliament Members", replace_existing=True)
    # scheduler.add_job(poll_parliament_bills, trigger=IntervalTrigger(seconds=PARLIAMENT_BILLS_INTERVAL), id="poll_parliament_bills", name="Poll Parliament Bills", replace_existing=True)
    # scheduler.add_job(recalculate_parliament_scores, trigger=IntervalTrigger(seconds=PARLIAMENT_SCORE_INTERVAL), id="recalculate_parliament_scores", name="Recalculate Parliament Scores", replace_existing=True)
    # scheduler.add_job(poll_parliament_committees, trigger=IntervalTrigger(seconds=PARLIAMENT_COMMITTEES_INTERVAL), id="poll_parliament_committees", name="Poll Parliament Committees", replace_existing=True, next_run_time=None)
    # scheduler.add_job(poll_parliament_videos, trigger=IntervalTrigger(seconds=PARLIAMENT_VIDEOS_INTERVAL), id="poll_parliament_videos", name="Poll Parliament Video Archives", replace_existing=True, next_run_time=None)

    # Entity extraction (3 jobs disabled)
    # scheduler.add_job(run_entity_extraction, trigger=IntervalTrigger(seconds=ENTITY_EXTRACTION_INTERVAL), id="run_entity_extraction", name="Extract Entities from Stories", replace_existing=True)
    # scheduler.add_job(recount_entity_mentions, trigger=IntervalTrigger(seconds=ENTITY_RECOUNT_INTERVAL), id="recount_entity_mentions", name="Recount Entity Mentions", replace_existing=True)
    # scheduler.add_job(refresh_entity_patterns, trigger=IntervalTrigger(seconds=ENTITY_PATTERN_REFRESH_INTERVAL), id="refresh_entity_patterns", name="Refresh Entity Patterns", replace_existing=True)

    # Haiku review of borderline stories
    if settings.haiku_relevance_filter_enabled:
        scheduler.add_job(review_borderline_stories, trigger=IntervalTrigger(seconds=HAIKU_REVIEW_INTERVAL), id="review_borderline_stories", name="Haiku Review Borderline Stories", replace_existing=True)

    # Election candidate sync disabled (already have data)
    # scheduler.add_job(run_election_candidate_sync, trigger=IntervalTrigger(seconds=ELECTION_SYNC_INTERVAL), id="sync_election_candidates", name="Sync Election Candidates", replace_existing=True, next_run_time=None)

    # Aviation disabled
    # scheduler.add_job(poll_aviation, trigger=IntervalTrigger(seconds=AVIATION_POLL_INTERVAL), id="poll_aviation", name="Poll ADS-B Aviation Data", replace_existing=True, next_run_time=now)
    # scheduler.add_job(cleanup_aviation, trigger=IntervalTrigger(seconds=AVIATION_CLEANUP_INTERVAL), id="cleanup_aviation", name="Cleanup Old Aviation Positions", replace_existing=True, next_run_time=None)

    # ECN live election results disabled after counting completed
    # scheduler.add_job(
    #     poll_ecn_election_results,
    #     trigger=IntervalTrigger(seconds=ECN_RESULTS_INTERVAL),
    #     id="poll_ecn_results",
    #     name="Poll ECN Election Results",
    #     replace_existing=True,
    #     next_run_time=now,
    # )

    scheduler.start()
    job_count = 28 + (1 if settings.gee_change_detection_enabled else 0) + (1 if settings.haiku_relevance_filter_enabled else 0)
    logger.info(f"Background scheduler started with {job_count} jobs")


def stop_scheduler():
    """Stop the background scheduler."""
    scheduler.shutdown()
    logger.info("Background scheduler stopped")
