#!/usr/bin/env python3
"""
FastAPI Router for Government Scrapers

Provides API endpoints to trigger and manage government source scraping.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel
import asyncio
import logging

from app.ingestion.ministry_scraper_generic import (
    GenericMinistryScraper,
    MINISTRY_CONFIGS,
    scrape_ministry_async,
)
from app.ingestion.dao_scraper import DAOScraper, scrape_all_daos_async
from app.ingestion.provincial_scraper import ProvincialScraper, scrape_all_provinces_async
from app.ingestion.constitutional_scraper import ConstitutionalScraper
from app.ingestion.municipality_scraper import MunicipalityScraper
from app.ingestion.govt_batch_scraper import GovtBatchScraper

# Dedicated scrapers for key government sources
from app.ingestion.mofa_scraper import MoFAScraper, fetch_mofa_posts_async
from app.ingestion.moha_scraper import MoHAScraper, fetch_moha_posts_async
from app.ingestion.opmcm_scraper import OPMCMScraper, fetch_opmcm_posts_async
from app.ingestion.ecn_scraper import ECNScraper

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/govt", tags=["Government Scrapers"])


# ============ Pydantic Models ============

class ScrapeRequest(BaseModel):
    """Request model for scrape endpoints."""
    source_ids: Optional[List[str]] = None
    max_pages: int = 3
    endpoints: Optional[List[str]] = None


class ScrapeResponse(BaseModel):
    """Response model for scrape endpoints."""
    success: bool
    source_id: str
    source_name: str
    posts_count: int
    duration_seconds: float
    scraped_at: str
    error: Optional[str] = None


class BatchScrapeResponse(BaseModel):
    """Response model for batch scrape endpoints."""
    total_sources: int
    successful: int
    failed: int
    total_posts: int
    duration_seconds: float
    results: List[ScrapeResponse]


class SourceInfo(BaseModel):
    """Information about a source."""
    id: str
    name: str
    name_ne: Optional[str] = None
    base_url: str
    priority: int
    poll_interval_mins: int
    endpoints: List[str]


# ============ Ministry Endpoints ============

@router.get("/ministries", response_model=List[SourceInfo])
async def list_ministries():
    """List all available ministry sources."""
    sources = []
    for source_id, config in MINISTRY_CONFIGS.items():
        sources.append(SourceInfo(
            id=source_id,
            name=config.name,
            name_ne=config.name_ne,
            base_url=config.base_url,
            priority=config.priority,
            poll_interval_mins=config.poll_interval_mins,
            endpoints=list(config.endpoints.keys())
        ))
    return sources


@router.post("/ministries/scrape", response_model=BatchScrapeResponse)
async def scrape_ministries(request: ScrapeRequest):
    """
    Scrape multiple ministry sources.

    - If source_ids is empty, scrapes all ministries
    - Returns aggregated results
    """
    start_time = datetime.utcnow()

    source_ids = request.source_ids or list(MINISTRY_CONFIGS.keys())
    results = []

    for source_id in source_ids:
        if source_id not in MINISTRY_CONFIGS:
            results.append(ScrapeResponse(
                success=False,
                source_id=source_id,
                source_name=source_id,
                posts_count=0,
                duration_seconds=0,
                scraped_at=datetime.utcnow().isoformat(),
                error=f"Unknown ministry: {source_id}"
            ))
            continue

        try:
            config = MINISTRY_CONFIGS[source_id]
            scrape_start = datetime.utcnow()

            data = await scrape_ministry_async(
                config,
                endpoints=request.endpoints,
                max_pages=request.max_pages
            )

            # Count total posts
            total_posts = sum(len(posts) for posts in data.values())
            duration = (datetime.utcnow() - scrape_start).total_seconds()

            results.append(ScrapeResponse(
                success=True,
                source_id=source_id,
                source_name=config.name,
                posts_count=total_posts,
                duration_seconds=duration,
                scraped_at=scrape_start.isoformat()
            ))

        except Exception as e:
            logger.error(f"Error scraping ministry {source_id}: {e}")
            results.append(ScrapeResponse(
                success=False,
                source_id=source_id,
                source_name=MINISTRY_CONFIGS[source_id].name,
                posts_count=0,
                duration_seconds=0,
                scraped_at=datetime.utcnow().isoformat(),
                error=str(e)
            ))

    total_duration = (datetime.utcnow() - start_time).total_seconds()
    successful = sum(1 for r in results if r.success)

    return BatchScrapeResponse(
        total_sources=len(results),
        successful=successful,
        failed=len(results) - successful,
        total_posts=sum(r.posts_count for r in results),
        duration_seconds=total_duration,
        results=results
    )


@router.get("/ministries/{ministry_id}", response_model=SourceInfo)
async def get_ministry(ministry_id: str):
    """Get information about a specific ministry."""
    if ministry_id not in MINISTRY_CONFIGS:
        raise HTTPException(status_code=404, detail=f"Ministry not found: {ministry_id}")

    config = MINISTRY_CONFIGS[ministry_id]
    return SourceInfo(
        id=ministry_id,
        name=config.name,
        name_ne=config.name_ne,
        base_url=config.base_url,
        priority=config.priority,
        poll_interval_mins=config.poll_interval_mins,
        endpoints=list(config.endpoints.keys())
    )


@router.post("/ministries/{ministry_id}/scrape")
async def scrape_single_ministry(
    ministry_id: str,
    max_pages: int = Query(3, ge=1, le=10),
    endpoints: Optional[List[str]] = Query(None)
):
    """Scrape a single ministry source."""
    if ministry_id not in MINISTRY_CONFIGS:
        raise HTTPException(status_code=404, detail=f"Ministry not found: {ministry_id}")

    config = MINISTRY_CONFIGS[ministry_id]
    start_time = datetime.utcnow()

    try:
        data = await scrape_ministry_async(config, endpoints=endpoints, max_pages=max_pages)
        total_posts = sum(len(posts) for posts in data.values())
        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "success": True,
            "source_id": ministry_id,
            "source_name": config.name,
            "posts_count": total_posts,
            "duration_seconds": duration,
            "scraped_at": start_time.isoformat(),
            "data": data
        }
    except Exception as e:
        logger.error(f"Error scraping ministry {ministry_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Key Government Sources (MOFA, MOHA, OPMCM, ECN) ============

@router.get("/key-sources")
async def list_key_sources():
    """List key government sources (MOFA, MOHA, OPMCM, ECN)."""
    return {
        "sources": [
            {
                "id": "mofa",
                "name": "Ministry of Foreign Affairs",
                "name_ne": "परराष्ट्र मन्त्रालय",
                "base_url": "https://mofa.gov.np",
                "endpoints": ["press-release-en", "news-en", "travel-advisory-en"]
            },
            {
                "id": "moha",
                "name": "Ministry of Home Affairs",
                "name_ne": "गृह मन्त्रालय",
                "base_url": "https://moha.gov.np",
                "endpoints": ["press-release-en", "notice-en", "circular-en"]
            },
            {
                "id": "opmcm",
                "name": "Office of the Prime Minister and Council of Ministers",
                "name_ne": "प्रधानमन्त्री तथा मन्त्रिपरिषद्को कार्यालय",
                "base_url": "https://opmcm.gov.np",
                "endpoints": ["press-release-en", "cabinet-decision-en", "news-en"]
            },
            {
                "id": "ecn",
                "name": "Election Commission Nepal",
                "name_ne": "निर्वाचन आयोग नेपाल",
                "base_url": "https://election.gov.np",
                "endpoints": ["press-release", "notice"]
            }
        ]
    }


@router.post("/key-sources/scrape")
async def scrape_key_sources(
    source_ids: Optional[List[str]] = Query(None, description="Source IDs: mofa, moha, opmcm, ecn"),
    max_pages: int = Query(3, ge=1, le=10)
):
    """
    Scrape key government sources (MOFA, MOHA, OPMCM, Election Commission).

    These are critical sources for press releases and official announcements.
    """
    start_time = datetime.utcnow()
    all_sources = ["mofa", "moha", "opmcm", "ecn"]
    sources_to_scrape = source_ids or all_sources

    results = {}

    for source_id in sources_to_scrape:
        try:
            if source_id == "mofa":
                scraper = MoFAScraper(delay=0.3, verify_ssl=False)
                data = scraper.scrape_all_categories(max_pages=max_pages)
                posts = []
                for cat_posts in data.values():
                    posts.extend([{
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date": p.date_published,
                        "date_bs": p.date_bs,
                        "category": p.category,
                        "source": p.source,
                        "source_name": "Ministry of Foreign Affairs"
                    } for p in cat_posts])
                results["mofa"] = {
                    "success": True,
                    "posts_count": len(posts),
                    "posts": posts
                }

            elif source_id == "moha":
                scraper = MoHAScraper(delay=0.3, verify_ssl=False)
                data = scraper.scrape_all_categories(max_pages=max_pages)
                posts = []
                for cat_posts in data.values():
                    posts.extend([{
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date_bs": p.date_bs,
                        "category": p.category,
                        "source": p.source,
                        "source_name": "Ministry of Home Affairs"
                    } for p in cat_posts])
                results["moha"] = {
                    "success": True,
                    "posts_count": len(posts),
                    "posts": posts
                }

            elif source_id == "opmcm":
                scraper = OPMCMScraper(delay=0.3, verify_ssl=False)
                data = scraper.scrape_all_categories(max_pages=max_pages)
                posts = []
                for cat_posts in data.values():
                    posts.extend([{
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date_bs": p.date_bs,
                        "category": p.category,
                        "source": p.source,
                        "source_name": "Prime Minister's Office"
                    } for p in cat_posts])
                results["opmcm"] = {
                    "success": True,
                    "posts_count": len(posts),
                    "posts": posts
                }

            elif source_id == "ecn":
                async with ECNScraper() as scraper:
                    data = await scraper.scrape_all_categories(max_pages=max_pages)
                    posts = []
                    for cat_posts in data.values():
                        posts.extend([{
                            "id": p.id,
                            "title": p.title,
                            "url": p.url,
                            "date_bs": p.date_bs,
                            "category": p.category,
                            "source": p.source,
                            "source_name": "Election Commission Nepal"
                        } for p in cat_posts])
                    results["ecn"] = {
                        "success": True,
                        "posts_count": len(posts),
                        "posts": posts
                    }

        except Exception as e:
            logger.error(f"Error scraping {source_id}: {e}")
            results[source_id] = {
                "success": False,
                "posts_count": 0,
                "error": str(e)
            }

    duration = (datetime.utcnow() - start_time).total_seconds()
    total_posts = sum(r.get("posts_count", 0) for r in results.values())

    return {
        "success": True,
        "sources_scraped": len(results),
        "total_posts": total_posts,
        "duration_seconds": duration,
        "scraped_at": start_time.isoformat(),
        "results": results
    }


@router.post("/key-sources/{source_id}/scrape")
async def scrape_single_key_source(
    source_id: str,
    max_pages: int = Query(3, ge=1, le=10),
    categories: Optional[List[str]] = Query(None)
):
    """Scrape a single key government source."""
    valid_sources = ["mofa", "moha", "opmcm", "ecn"]
    if source_id not in valid_sources:
        raise HTTPException(status_code=404, detail=f"Unknown source: {source_id}. Valid: {valid_sources}")

    start_time = datetime.utcnow()

    try:
        if source_id == "mofa":
            scraper = MoFAScraper(delay=0.3, verify_ssl=False)
            if categories:
                data = {cat: scraper.scrape_category(cat, max_pages=max_pages) for cat in categories}
            else:
                data = scraper.scrape_all_categories(max_pages=max_pages)
            posts = []
            for cat, cat_posts in data.items():
                posts.extend([{
                    "id": p.id,
                    "title": p.title,
                    "url": p.url,
                    "date": p.date_published,
                    "date_bs": p.date_bs,
                    "category": cat,
                    "source": "mofa.gov.np",
                    "source_name": "Ministry of Foreign Affairs"
                } for p in cat_posts])

        elif source_id == "moha":
            scraper = MoHAScraper(delay=0.3, verify_ssl=False)
            if categories:
                data = {cat: scraper.scrape_category(cat, max_pages=max_pages) for cat in categories}
            else:
                data = scraper.scrape_all_categories(max_pages=max_pages)
            posts = []
            for cat, cat_posts in data.items():
                posts.extend([{
                    "id": p.id,
                    "title": p.title,
                    "url": p.url,
                    "date_bs": p.date_bs,
                    "category": cat,
                    "source": "moha.gov.np",
                    "source_name": "Ministry of Home Affairs"
                } for p in cat_posts])

        elif source_id == "opmcm":
            scraper = OPMCMScraper(delay=0.3, verify_ssl=False)
            if categories:
                data = {cat: scraper.scrape_category(cat, max_pages=max_pages) for cat in categories}
            else:
                data = scraper.scrape_all_categories(max_pages=max_pages)
            posts = []
            for cat, cat_posts in data.items():
                posts.extend([{
                    "id": p.id,
                    "title": p.title,
                    "url": p.url,
                    "date_bs": p.date_bs,
                    "category": cat,
                    "source": "opmcm.gov.np",
                    "source_name": "Prime Minister's Office"
                } for p in cat_posts])

        elif source_id == "ecn":
            async with ECNScraper() as scraper:
                data = await scraper.scrape_all_categories(max_pages=max_pages)
                posts = []
                for cat, cat_posts in data.items():
                    posts.extend([{
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date_bs": p.date_bs,
                        "category": cat,
                        "source": "election.gov.np",
                        "source_name": "Election Commission Nepal"
                    } for p in cat_posts])

        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "success": True,
            "source_id": source_id,
            "posts_count": len(posts),
            "duration_seconds": duration,
            "scraped_at": start_time.isoformat(),
            "posts": posts
        }

    except Exception as e:
        logger.error(f"Error scraping {source_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Unified Government Announcements ============

@router.get("/announcements")
async def get_government_announcements(
    max_pages: int = Query(2, ge=1, le=5),
    include_key_sources: bool = Query(True, description="Include MOFA, MOHA, OPMCM, ECN"),
    include_ministries: bool = Query(True, description="Include generic ministries"),
):
    """
    Get all government announcements from key sources.

    This is the main endpoint for the Government Announcements tab.
    Returns press releases, notices, and circulars from:
    - Key sources: MOFA, MOHA, OPMCM, Election Commission
    - Generic ministries: All configured in MINISTRY_CONFIGS
    """
    start_time = datetime.utcnow()
    all_posts = []
    source_stats = {}

    # Key sources (MOFA, MOHA, OPMCM, ECN)
    if include_key_sources:
        # MOFA
        try:
            scraper = MoFAScraper(delay=0.2, verify_ssl=False)
            data = scraper.scrape_all_categories(max_pages=max_pages)
            count = 0
            for cat, cat_posts in data.items():
                for p in cat_posts:
                    all_posts.append({
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date": p.date_published,
                        "date_bs": p.date_bs,
                        "category": cat.replace("-en", "").replace("-ne", ""),
                        "source": "mofa.gov.np",
                        "source_name": "Ministry of Foreign Affairs",
                        "source_type": "key"
                    })
                    count += 1
            source_stats["mofa"] = count
        except Exception as e:
            logger.error(f"Error scraping MOFA: {e}")
            source_stats["mofa"] = 0

        # MOHA
        try:
            scraper = MoHAScraper(delay=0.2, verify_ssl=False)
            data = scraper.scrape_all_categories(max_pages=max_pages)
            count = 0
            for cat, cat_posts in data.items():
                for p in cat_posts:
                    all_posts.append({
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date_bs": p.date_bs,
                        "category": cat.replace("-en", "").replace("-ne", ""),
                        "source": "moha.gov.np",
                        "source_name": "Ministry of Home Affairs",
                        "source_type": "key"
                    })
                    count += 1
            source_stats["moha"] = count
        except Exception as e:
            logger.error(f"Error scraping MOHA: {e}")
            source_stats["moha"] = 0

        # OPMCM
        try:
            scraper = OPMCMScraper(delay=0.2, verify_ssl=False)
            data = scraper.scrape_all_categories(max_pages=max_pages)
            count = 0
            for cat, cat_posts in data.items():
                for p in cat_posts:
                    all_posts.append({
                        "id": p.id,
                        "title": p.title,
                        "url": p.url,
                        "date_bs": p.date_bs,
                        "category": cat.replace("-en", "").replace("-ne", ""),
                        "source": "opmcm.gov.np",
                        "source_name": "Prime Minister's Office",
                        "source_type": "key"
                    })
                    count += 1
            source_stats["opmcm"] = count
        except Exception as e:
            logger.error(f"Error scraping OPMCM: {e}")
            source_stats["opmcm"] = 0

        # ECN (async)
        try:
            async with ECNScraper() as scraper:
                data = await scraper.scrape_all_categories(max_pages=max_pages)
                count = 0
                for cat, cat_posts in data.items():
                    for p in cat_posts:
                        all_posts.append({
                            "id": p.id,
                            "title": p.title,
                            "url": p.url,
                            "date_bs": p.date_bs,
                            "category": cat,
                            "source": "election.gov.np",
                            "source_name": "Election Commission Nepal",
                            "source_type": "key"
                        })
                        count += 1
                source_stats["ecn"] = count
        except Exception as e:
            logger.error(f"Error scraping ECN: {e}")
            source_stats["ecn"] = 0

    # Generic ministries
    if include_ministries:
        for ministry_id, config in MINISTRY_CONFIGS.items():
            try:
                scraper = GenericMinistryScraper(config, delay=0.2)
                data = scraper.scrape_all(max_pages_per_endpoint=max_pages)
                count = 0
                for endpoint, posts in data.items():
                    for p in posts:
                        all_posts.append({
                            "id": p.id,
                            "title": p.title,
                            "url": p.url,
                            "date_bs": p.date_bs,
                            "category": endpoint.replace("_", "-"),
                            "source": config.base_url.replace("https://", ""),
                            "source_name": config.name,
                            "source_type": "ministry"
                        })
                        count += 1
                source_stats[ministry_id] = count
            except Exception as e:
                logger.error(f"Error scraping {ministry_id}: {e}")
                source_stats[ministry_id] = 0

    # Sort by date (most recent first) - use date_bs as proxy
    all_posts.sort(key=lambda x: x.get("date_bs", "") or "", reverse=True)

    duration = (datetime.utcnow() - start_time).total_seconds()

    return {
        "success": True,
        "total_posts": len(all_posts),
        "sources_scraped": len(source_stats),
        "source_stats": source_stats,
        "duration_seconds": duration,
        "scraped_at": start_time.isoformat(),
        "posts": all_posts
    }


# ============ DAO Endpoints ============

@router.get("/daos")
async def list_daos():
    """List all 77 district administration offices."""
    scraper = DAOScraper()
    return {
        "total_districts": len(scraper.DISTRICTS),
        "priority_districts": scraper.PRIORITY_DISTRICTS,
        "districts": [
            {
                "id": district,
                "name": info["name"],
                "name_ne": info["name_ne"],
                "province": info["province"],
                "province_id": info["province_id"],
                "url": scraper.get_dao_url(district)
            }
            for district, info in scraper.DISTRICTS.items()
        ]
    }


@router.post("/daos/scrape")
async def scrape_daos(
    districts: Optional[List[str]] = Query(None),
    province_id: Optional[int] = Query(None, ge=1, le=7),
    priority_only: bool = Query(False),
    max_pages: int = Query(2, ge=1, le=5)
):
    """
    Scrape DAO websites.

    - districts: Specific district IDs to scrape
    - province_id: Scrape all districts in a province (1-7)
    - priority_only: Only scrape priority districts
    - max_pages: Max pages per endpoint
    """
    start_time = datetime.utcnow()
    scraper = DAOScraper()

    try:
        if districts:
            # Scrape specific districts
            results = {}
            for district in districts:
                if district in scraper.DISTRICTS:
                    results[district] = scraper.scrape_district(district, max_pages=max_pages)
        elif province_id:
            # Scrape province
            results = scraper.scrape_province(province_id, max_pages=max_pages)
        elif priority_only:
            # Scrape priority districts
            results = scraper.scrape_priority_districts(max_pages=max_pages)
        else:
            # Scrape all (async)
            results = await scrape_all_daos_async(max_pages=max_pages, max_concurrent=10)

        # Count posts
        total_posts = 0
        for district_data in results.values():
            for endpoint_posts in district_data.values():
                total_posts += len(endpoint_posts)

        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "success": True,
            "districts_scraped": len(results),
            "total_posts": total_posts,
            "duration_seconds": duration,
            "scraped_at": start_time.isoformat(),
            "data": results
        }

    except Exception as e:
        logger.error(f"Error scraping DAOs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daos/{district_id}")
async def get_dao(district_id: str):
    """Get information about a specific DAO."""
    scraper = DAOScraper()

    if district_id not in scraper.DISTRICTS:
        raise HTTPException(status_code=404, detail=f"District not found: {district_id}")

    info = scraper.DISTRICTS[district_id]
    return {
        "id": district_id,
        "name": info["name"],
        "name_ne": info["name_ne"],
        "province": info["province"],
        "province_id": info["province_id"],
        "url": scraper.get_dao_url(district_id),
        "endpoints": list(scraper.ENDPOINTS.keys())
    }


# ============ Province Endpoints ============

@router.get("/provinces")
async def list_provinces():
    """List all 7 provinces."""
    scraper = ProvincialScraper()
    return {
        "total_provinces": len(scraper.PROVINCES),
        "provinces": [
            {
                "id": province,
                "name": info["name"],
                "name_ne": info["name_ne"],
                "capital": info["capital"],
                "capital_ne": info["capital_ne"],
                "districts": info["districts"],
                "url": info["base_url"]
            }
            for province, info in scraper.PROVINCES.items()
        ]
    }


@router.post("/provinces/scrape")
async def scrape_provinces(
    provinces: Optional[List[str]] = Query(None),
    max_pages: int = Query(3, ge=1, le=5)
):
    """
    Scrape provincial government websites.

    - provinces: Specific province IDs to scrape
    - max_pages: Max pages per endpoint
    """
    start_time = datetime.utcnow()

    try:
        if provinces:
            scraper = ProvincialScraper()
            results = {}
            for province in provinces:
                if province in scraper.PROVINCES:
                    results[province] = scraper.scrape_province(province, max_pages=max_pages)
        else:
            results = await scrape_all_provinces_async(max_pages=max_pages)

        # Count posts
        total_posts = 0
        for province_data in results.values():
            for endpoint_posts in province_data.values():
                total_posts += len(endpoint_posts)

        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "success": True,
            "provinces_scraped": len(results),
            "total_posts": total_posts,
            "duration_seconds": duration,
            "scraped_at": start_time.isoformat(),
            "data": results
        }

    except Exception as e:
        logger.error(f"Error scraping provinces: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Constitutional Bodies Endpoints ============

@router.get("/constitutional")
async def list_constitutional_bodies():
    """List all constitutional bodies and regulatory agencies."""
    scraper = ConstitutionalScraper()

    bodies = []
    for body_id, config in scraper.CONSTITUTIONAL_BODIES.items():
        bodies.append({
            "id": body_id,
            "name": config["name"],
            "name_ne": config.get("name_ne", ""),
            "category": config.get("category", "constitutional"),
            "url": config["base_url"],
            "endpoints": list(config.get("endpoints", {}).keys())
        })

    return {
        "total_bodies": len(bodies),
        "bodies": bodies
    }


@router.post("/constitutional/scrape")
async def scrape_constitutional_bodies(
    body_ids: Optional[List[str]] = Query(None),
    max_pages: int = Query(3, ge=1, le=5)
):
    """Scrape constitutional bodies and regulatory agencies."""
    start_time = datetime.utcnow()
    scraper = ConstitutionalScraper()

    try:
        if body_ids:
            results = {}
            for body_id in body_ids:
                results[body_id] = scraper.scrape_body(body_id, max_pages=max_pages)
        else:
            results = scraper.scrape_all(max_pages=max_pages)

        # Count posts
        total_posts = 0
        for body_data in results.values():
            if isinstance(body_data, dict):
                for endpoint_posts in body_data.values():
                    if isinstance(endpoint_posts, list):
                        total_posts += len(endpoint_posts)
            elif isinstance(body_data, list):
                total_posts += len(body_data)

        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "success": True,
            "bodies_scraped": len(results),
            "total_posts": total_posts,
            "duration_seconds": duration,
            "scraped_at": start_time.isoformat(),
            "data": results
        }

    except Exception as e:
        logger.error(f"Error scraping constitutional bodies: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Municipality Endpoints ============

@router.get("/municipalities")
async def list_municipalities():
    """List all metropolitan and sub-metropolitan cities."""
    scraper = MunicipalityScraper()

    return {
        "total_municipalities": len(scraper.MUNICIPALITIES),
        "metropolitan_count": sum(1 for m in scraper.MUNICIPALITIES.values() if m.get("category") == "metropolitan"),
        "sub_metropolitan_count": sum(1 for m in scraper.MUNICIPALITIES.values() if m.get("category") == "sub_metropolitan"),
        "municipalities": [
            {
                "id": mun_id,
                "name": info["name"],
                "name_ne": info.get("name_ne", ""),
                "category": info.get("category", ""),
                "province": info.get("province", ""),
                "district": info.get("district", ""),
                "url": info["base_url"]
            }
            for mun_id, info in scraper.MUNICIPALITIES.items()
        ]
    }


@router.post("/municipalities/scrape")
async def scrape_municipalities(
    municipality_ids: Optional[List[str]] = Query(None),
    category: Optional[str] = Query(None, regex="^(metropolitan|sub_metropolitan)$"),
    max_pages: int = Query(3, ge=1, le=5)
):
    """Scrape municipality websites."""
    start_time = datetime.utcnow()
    scraper = MunicipalityScraper()

    try:
        if municipality_ids:
            results = {}
            for mun_id in municipality_ids:
                results[mun_id] = scraper.scrape_municipality(mun_id, max_pages=max_pages)
        elif category:
            results = scraper.scrape_by_category(category, max_pages=max_pages)
        else:
            results = scraper.scrape_all(max_pages=max_pages)

        # Count posts
        total_posts = 0
        for mun_data in results.values():
            if isinstance(mun_data, dict):
                for endpoint_posts in mun_data.values():
                    if isinstance(endpoint_posts, list):
                        total_posts += len(endpoint_posts)

        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "success": True,
            "municipalities_scraped": len(results),
            "total_posts": total_posts,
            "duration_seconds": duration,
            "scraped_at": start_time.isoformat(),
            "data": results
        }

    except Exception as e:
        logger.error(f"Error scraping municipalities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Batch Scrape All Sources ============

@router.post("/batch/scrape-all")
async def batch_scrape_all(
    background_tasks: BackgroundTasks,
    categories: Optional[List[str]] = Query(
        None,
        description="Categories to scrape: ministries, daos, provinces, constitutional, municipalities"
    ),
    priority: Optional[int] = Query(None, ge=1, le=3, description="Only scrape sources with this priority or higher"),
    max_concurrent: int = Query(10, ge=1, le=20),
    max_pages: int = Query(2, ge=1, le=5)
):
    """
    Batch scrape all government sources.

    This is a long-running operation that scrapes multiple source categories concurrently.
    """
    start_time = datetime.utcnow()

    all_categories = ["ministries", "daos", "provinces", "constitutional", "municipalities"]
    categories_to_scrape = categories or all_categories

    batch_scraper = GovtBatchScraper(
        max_concurrent=max_concurrent,
        max_pages_per_source=max_pages
    )

    results = {
        "total_sources": 0,
        "total_posts": 0,
        "categories": {}
    }

    try:
        # Ministries
        if "ministries" in categories_to_scrape:
            ministry_results = await batch_scraper.scrape_all_ministries()
            results["categories"]["ministries"] = {
                "sources_scraped": len(ministry_results),
                "successful": sum(1 for r in ministry_results if r.success),
                "posts": sum(r.posts_count for r in ministry_results)
            }
            results["total_sources"] += len(ministry_results)
            results["total_posts"] += sum(r.posts_count for r in ministry_results)

        # DAOs (priority districts only for batch)
        if "daos" in categories_to_scrape:
            dao_scraper = DAOScraper()
            dao_results = dao_scraper.scrape_priority_districts(max_pages=max_pages)
            dao_posts = sum(
                len(posts) for district_data in dao_results.values()
                for posts in district_data.values()
            )
            results["categories"]["daos"] = {
                "sources_scraped": len(dao_results),
                "successful": len(dao_results),
                "posts": dao_posts
            }
            results["total_sources"] += len(dao_results)
            results["total_posts"] += dao_posts

        # Provinces
        if "provinces" in categories_to_scrape:
            province_results = await scrape_all_provinces_async(max_pages=max_pages)
            province_posts = sum(
                len(posts) for province_data in province_results.values()
                for posts in province_data.values()
            )
            results["categories"]["provinces"] = {
                "sources_scraped": len(province_results),
                "successful": len(province_results),
                "posts": province_posts
            }
            results["total_sources"] += len(province_results)
            results["total_posts"] += province_posts

        # Constitutional
        if "constitutional" in categories_to_scrape:
            const_scraper = ConstitutionalScraper()
            const_results = const_scraper.scrape_all(max_pages=max_pages)
            const_posts = sum(
                len(posts) for body_data in const_results.values()
                for posts in (body_data.values() if isinstance(body_data, dict) else [body_data])
                if isinstance(posts, list)
            )
            results["categories"]["constitutional"] = {
                "sources_scraped": len(const_results),
                "successful": len(const_results),
                "posts": const_posts
            }
            results["total_sources"] += len(const_results)
            results["total_posts"] += const_posts

        # Municipalities
        if "municipalities" in categories_to_scrape:
            mun_scraper = MunicipalityScraper()
            mun_results = mun_scraper.scrape_all(max_pages=max_pages)
            mun_posts = sum(
                len(posts) for mun_data in mun_results.values()
                for posts in mun_data.values()
                if isinstance(posts, list)
            )
            results["categories"]["municipalities"] = {
                "sources_scraped": len(mun_results),
                "successful": len(mun_results),
                "posts": mun_posts
            }
            results["total_sources"] += len(mun_results)
            results["total_posts"] += mun_posts

        duration = (datetime.utcnow() - start_time).total_seconds()
        results["duration_seconds"] = duration
        results["scraped_at"] = start_time.isoformat()
        results["success"] = True

        return results

    except Exception as e:
        logger.error(f"Error in batch scrape: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Status Endpoints ============

@router.get("/status")
async def get_scraper_status():
    """Get overall status of government scrapers."""
    return {
        "status": "operational",
        "available_categories": [
            "ministries",
            "daos",
            "provinces",
            "constitutional",
            "municipalities"
        ],
        "total_sources": {
            "ministries": len(MINISTRY_CONFIGS),
            "daos": 77,
            "provinces": 7,
            "constitutional": 15,
            "municipalities": 17
        },
        "timestamp": datetime.utcnow().isoformat()
    }


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "govt-scraper",
        "timestamp": datetime.utcnow().isoformat()
    }
