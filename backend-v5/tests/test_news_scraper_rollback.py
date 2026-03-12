from __future__ import annotations

import asyncio


class _FakeSession:
    def __init__(self):
        self.rollback_called = False

    async def commit(self):  # noqa: D401
        raise RuntimeError("commit failed")

    async def rollback(self):  # noqa: D401
        self.rollback_called = True


def test_news_scraper_rolls_back_on_commit_failure(monkeypatch):
    asyncio.run(_run(monkeypatch))


async def _run(monkeypatch):
    import app.services.news_scraper_service as mod
    from app.services.news_scraper_service import NewsScraperService

    async def _empty_results(max_articles: int):  # noqa: ARG001
        return {}

    monkeypatch.setattr(mod, "fetch_nepalitimes_all_categories", _empty_results)

    db = _FakeSession()
    service = NewsScraperService(db)  # type: ignore[arg-type]

    result = await service.scrape_nepalitimes(max_articles=1)
    assert result["source"] == "nepalitimes"
    assert "error" in result
    assert db.rollback_called is True

