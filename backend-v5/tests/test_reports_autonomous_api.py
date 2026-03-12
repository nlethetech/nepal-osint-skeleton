from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import APIRouter, Depends, FastAPI
from starlette.testclient import TestClient


@pytest.fixture()
def reports_app() -> FastAPI:
    from app.api.deps import require_analyst
    from app.api.v1 import reports

    app = FastAPI()
    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(reports.router, dependencies=[Depends(require_analyst)])
    app.include_router(api_v1)
    return app


def test_unauthed_autonomous_reports_returns_401(reports_app: FastAPI):
    with TestClient(reports_app) as client:
        res = client.get("/api/v1/reports/autonomous/core-papers")
        assert res.status_code == 401


def test_list_autonomous_reports_supports_filters_and_pagination(
    reports_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
):
    from app.api.deps import get_db, require_analyst
    from app.models.user import User, UserRole
    from app.services.analysis.core_paper_service import CorePaperService

    analyst_id = uuid4()
    captured: dict[str, object] = {}

    async def override_require_analyst() -> User:
        return User(
            id=analyst_id,
            email="analyst@example.com",
            password_hash="x",
            role=UserRole.ANALYST,
            is_active=True,
        )

    async def override_get_db():
        yield object()

    async def fake_list_reports(self, **kwargs):
        captured.update(kwargs)
        return {
            "items": [
                {
                    "id": str(uuid4()),
                    "report_type": "political_developments",
                    "title": "Political Developments",
                    "status": "completed",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "time_window_hours": 168,
                    "generated_with_llm": True,
                    "citations_count": 3,
                    "highlights": ["H1"],
                    "metrics_preview": {"key": 1},
                }
            ],
            "total": 1,
            "limit": kwargs.get("limit", 50),
            "offset": kwargs.get("offset", 0),
        }

    monkeypatch.setattr(CorePaperService, "list_reports", fake_list_reports)
    reports_app.dependency_overrides[require_analyst] = override_require_analyst
    reports_app.dependency_overrides[get_db] = override_get_db

    with TestClient(reports_app) as client:
        res = client.get(
            "/api/v1/reports/autonomous/core-papers",
            params={
                "limit": 5,
                "offset": 10,
                "report_type": "political_developments",
                "generated_by_me": "true",
            },
        )
        assert res.status_code == 200
        payload = res.json()
        assert payload["total"] == 1
        assert payload["limit"] == 5
        assert payload["offset"] == 10
        assert payload["items"][0]["report_type"] == "political_developments"

    assert captured["limit"] == 5
    assert captured["offset"] == 10
    assert captured["report_type"] == "political_developments"
    assert captured["generated_by"] == analyst_id

    reports_app.dependency_overrides.clear()


def test_autonomous_reports_summary_endpoint(reports_app: FastAPI, monkeypatch: pytest.MonkeyPatch):
    from app.api.deps import get_db, require_analyst
    from app.models.user import User, UserRole
    from app.services.analysis.core_paper_service import CorePaperService

    analyst_id = uuid4()
    captured: dict[str, object] = {}

    async def override_require_analyst() -> User:
        return User(
            id=analyst_id,
            email="analyst@example.com",
            password_hash="x",
            role=UserRole.ANALYST,
            is_active=True,
        )

    async def override_get_db():
        yield object()

    async def fake_summary(self, **kwargs):
        captured.update(kwargs)
        return {
            "total_reports": 12,
            "by_report_type": {
                "political_developments": 5,
                "security_developments": 4,
                "singha_durbar_damage_assessment": 3,
            },
            "generated_last_24h": 2,
            "generated_last_7d": 7,
            "last_generated_at": datetime.now(timezone.utc).isoformat(),
        }

    monkeypatch.setattr(CorePaperService, "get_reports_summary", fake_summary)
    reports_app.dependency_overrides[require_analyst] = override_require_analyst
    reports_app.dependency_overrides[get_db] = override_get_db

    with TestClient(reports_app) as client:
        res = client.get(
            "/api/v1/reports/autonomous/core-papers/summary",
            params={"generated_by_me": "true"},
        )
        assert res.status_code == 200
        payload = res.json()
        assert payload["total_reports"] == 12
        assert payload["generated_last_24h"] == 2
        assert "political_developments" in payload["by_report_type"]

    assert captured["generated_by"] == analyst_id

    reports_app.dependency_overrides.clear()
