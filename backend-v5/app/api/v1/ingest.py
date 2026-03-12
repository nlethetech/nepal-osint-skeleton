"""Ingestion API endpoints for manual RSS triggering and web scraping."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.services.ingestion_service import IngestionService
from app.ingestion.ratopati_scraper import (
    fetch_ratopati_province,
    fetch_all_ratopati_provinces,
    RATOPATI_PROVINCES,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingestion"])


@router.post("/trigger")
async def trigger_ingestion(
    background_tasks: BackgroundTasks,
    priority_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger RSS ingestion.

    Args:
        priority_only: If true, only fetch priority 1-2 sources
    """
    service = IngestionService(db)
    stats = await service.ingest_all(priority_only=priority_only)
    return {
        "status": "completed",
        "stats": stats,
    }


@router.get("/status")
async def ingestion_status(db: AsyncSession = Depends(get_db)):
    """Get ingestion status and source count."""
    service = IngestionService(db)
    sources = service.get_sources()
    priority_sources = service.get_priority_sources()

    return {
        "total_sources": len(sources),
        "priority_sources": len(priority_sources),
        "source_ids": [s["id"] for s in sources],
    }


# ============ Ratopati Regional News Scraping ============

@router.post("/ratopati/{province}")
async def scrape_ratopati_province(
    province: str,
    max_articles: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Scrape news from a specific Ratopati regional site.

    Since Ratopati's RSS feeds require special access, this scrapes
    the HTML pages directly.

    Available provinces: gandaki, koshi, madhesh, bagmati, lumbini, karnali, sudurpashchim
    """
    province_key = province.lower()

    if province_key not in RATOPATI_PROVINCES:
        return {
            "error": f"Unknown province: {province}",
            "valid_provinces": list(RATOPATI_PROVINCES.keys()),
        }

    try:
        articles = await fetch_ratopati_province(province_key, max_articles)

        # Process articles through the ingestion service
        service = IngestionService(db)
        stats = {"scraped": len(articles), "new": 0, "duplicates": 0, "international": 0, "failed": 0}

        for article in articles:
            # Create a FetchedArticle-like object for processing
            from app.ingestion.rss_fetcher import FetchedArticle
            fetched = FetchedArticle(
                source_id=article["source_id"],
                source_name=article["source_name"],
                url=article["url"],
                title=article["title"],
                summary=article.get("summary"),
                published_at=None,  # Ratopati pages don't have reliable timestamps
                language=article.get("language", "ne"),
            )
            outcome = await service._process_article(fetched)
            stats[outcome] += 1

        await db.commit()
        await service._broadcast_new_stories()

        return {
            "status": "completed",
            "province": province_key,
            "stats": stats,
        }

    except Exception as e:
        logger.exception(f"Error scraping {province}: {e}")
        return {"error": str(e), "province": province}


@router.post("/ratopati")
async def scrape_all_ratopati(
    max_articles_per_province: int = Query(default=30, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Scrape news from all Ratopati regional sites.

    This is useful for getting a broad view of regional news across all provinces.
    """
    try:
        all_results = await fetch_all_ratopati_provinces(max_articles_per_province)

        # Process all articles
        service = IngestionService(db)
        total_stats = {"scraped": 0, "new": 0, "duplicates": 0, "international": 0, "failed": 0}
        province_stats = {}

        for province_key, articles in all_results.items():
            stats = {"scraped": len(articles), "new": 0, "duplicates": 0, "international": 0, "failed": 0}

            for article in articles:
                from app.ingestion.rss_fetcher import FetchedArticle
                fetched = FetchedArticle(
                    source_id=article["source_id"],
                    source_name=article["source_name"],
                    url=article["url"],
                    title=article["title"],
                    summary=article.get("summary"),
                    published_at=None,
                    language=article.get("language", "ne"),
                )
                outcome = await service._process_article(fetched)
                stats[outcome] += 1
                total_stats[outcome] += 1

            total_stats["scraped"] += len(articles)
            province_stats[province_key] = stats

        await db.commit()
        await service._broadcast_new_stories()

        return {
            "status": "completed",
            "total": total_stats,
            "by_province": province_stats,
        }

    except Exception as e:
        logger.exception(f"Error scraping all provinces: {e}")
        return {"error": str(e)}


@router.get("/ratopati/provinces")
async def list_ratopati_provinces():
    """List available Ratopati regional sites for scraping."""
    return {
        "provinces": [
            {
                "key": key,
                "name": info["name"],
                "province_name": info["province_name"],
                "source_id": info["source_id"],
                "base_url": info["base_url"],
            }
            for key, info in RATOPATI_PROVINCES.items()
        ]
    }


# ============ All News Scrapers ============

@router.post("/scrape/all")
async def scrape_all_news_sources(
    max_articles: int = Query(default=30, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Scrape all news sources that don't have working RSS feeds.

    This triggers scraping from:
    - Ratopati (all 7 provinces)
    - Ekantipur (all 7 provinces + national)
    - Himalayan Times
    - My Republica
    - Nepali Times
    - Kantipur TV
    """
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_all_sources(max_articles_per_source=max_articles)

        return {
            "status": "completed",
            **result,
        }
    except Exception as e:
        logger.exception(f"Error scraping all sources: {e}")
        return {"error": str(e)}


@router.post("/scrape/provincial")
async def scrape_provincial_sources(
    province: Optional[str] = Query(None, description="Specific province (e.g., 'gandaki') or all if empty"),
    max_articles: int = Query(default=30, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Scrape all provincial news sources (Ratopati + Ekantipur).

    Args:
        province: Specific province key or None for all provinces
        max_articles: Max articles per source
    """
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_provincial_sources(province=province, max_articles=max_articles)

        return {
            "status": "completed",
            **result,
        }
    except Exception as e:
        logger.exception(f"Error scraping provincial sources: {e}")
        return {"error": str(e)}


@router.post("/scrape/ekantipur")
async def scrape_ekantipur(
    province: Optional[str] = Query(None, description="Specific province or 'national' or None for all"),
    max_articles: int = Query(default=30, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Scrape Ekantipur news."""
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_ekantipur_all(
            max_articles_per_province=max_articles,
            include_national=(province is None or province == "national"),
        )

        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"Error scraping Ekantipur: {e}")
        return {"error": str(e)}


@router.post("/scrape/himalayan")
async def scrape_himalayan(
    max_articles: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Scrape Himalayan Times news."""
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_himalayan(max_articles=max_articles)

        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"Error scraping Himalayan Times: {e}")
        return {"error": str(e)}


@router.post("/scrape/republica")
async def scrape_republica(
    max_articles: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Scrape My Republica news."""
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_republica(max_articles=max_articles)

        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"Error scraping My Republica: {e}")
        return {"error": str(e)}


@router.post("/scrape/nepalitimes")
async def scrape_nepalitimes(
    max_articles: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Scrape Nepali Times news."""
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_nepalitimes(max_articles=max_articles)

        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"Error scraping Nepali Times: {e}")
        return {"error": str(e)}


@router.post("/scrape/kantipurtv")
async def scrape_kantipurtv(
    max_articles: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Scrape Kantipur TV news."""
    try:
        from app.services.news_scraper_service import NewsScraperService

        service = NewsScraperService(db)
        result = await service.scrape_kantipurtv(max_articles=max_articles)

        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"Error scraping Kantipur TV: {e}")
        return {"error": str(e)}
