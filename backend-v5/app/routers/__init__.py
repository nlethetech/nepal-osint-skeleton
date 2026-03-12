"""
NARADA API Routers

FastAPI routers for various API endpoints.
"""

from app.routers.govt_scraper_router import router as govt_scraper_router

__all__ = ["govt_scraper_router"]
