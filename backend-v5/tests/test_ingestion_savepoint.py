from __future__ import annotations

from dataclasses import dataclass
import asyncio

from sqlalchemy.exc import IntegrityError


class _BeginNested:
    async def __aenter__(self):  # noqa: D401
        return self

    async def __aexit__(self, exc_type, exc, tb):  # noqa: D401
        return False


class _FakeSession:
    def __init__(self, *, flush_exc: Exception | None = None):
        self.flush_exc = flush_exc
        self.added = []

    def begin_nested(self):
        return _BeginNested()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        if self.flush_exc:
            raise self.flush_exc


@dataclass
class _RepoStub:
    async def exists_by_external_id(self, external_id: str) -> bool:  # noqa: ARG002
        return False

    async def exists_by_url(self, url: str) -> bool:  # noqa: ARG002
        return False


class _RelevanceStub:
    def classify(self, **kwargs):  # noqa: ANN001, ANN003
        from app.services.relevance_service import RelevanceResult, RelevanceLevel

        return RelevanceResult(
            level=RelevanceLevel.NEPAL_DOMESTIC,
            score=0.9,
            triggers=["test"],
            category=None,
        )


class _SeverityStub:
    def grade(self, **kwargs):  # noqa: ANN001, ANN003
        from app.services.severity_service import SeverityResult, SeverityLevel

        return SeverityResult(level=SeverityLevel.LOW, triggers=["test"])


def test_process_article_integrityerror_treated_as_duplicate():
    asyncio.run(_run())


async def _run():
    from app.ingestion.rss_fetcher import FetchedArticle
    from app.services.ingestion_service import IngestionService

    db = _FakeSession(flush_exc=IntegrityError("stmt", {}, Exception("dup")))
    service = IngestionService(db, use_rl=False)
    service.repo = _RepoStub()
    service.relevance = _RelevanceStub()
    service.severity = _SeverityStub()

    outcome = await service._process_article(
        FetchedArticle(
            source_id="src",
            source_name="Source",
            url="https://example.com/story",
            title="Test story",
            summary="Nepal news",
        )
    )

    assert outcome == "duplicates"
    assert service._new_story_payloads == []
