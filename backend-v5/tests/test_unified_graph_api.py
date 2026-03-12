from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_db, require_dev
from app.api.v1 import unified_graph


class DummyDB:
    async def execute(self, *args, **kwargs):
        return None


def _build_app() -> FastAPI:
    app = FastAPI()
    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(unified_graph.router, dependencies=[Depends(get_current_user)])
    app.include_router(api_v1)

    async def _fake_db():
        yield DummyDB()

    fake_user = SimpleNamespace(id="00000000-0000-0000-0000-000000000001")

    async def _fake_user():
        return fake_user

    app.dependency_overrides[get_db] = _fake_db
    app.dependency_overrides[get_current_user] = _fake_user
    app.dependency_overrides[require_dev] = _fake_user
    return app


def test_ingest_honors_selected_phases(monkeypatch):
    calls: dict[str, list[str]] = {}

    class FakeIngestionService:
        def __init__(self, _db):
            pass

        async def run_ingestion(self, phases):
            calls["phases"] = list(phases)
            return {
                "run_id": "run-1",
                "phases_executed": list(phases),
                "steps": {p: {"ok": True} for p in phases},
            }

        async def run_full_ingestion(self):
            raise AssertionError("run_full_ingestion should not be called")

    monkeypatch.setattr(unified_graph, "GraphIngestionService", FakeIngestionService)

    app = _build_app()
    client = TestClient(app)
    res = client.post("/api/v1/unified-graph/ingest", params={"phases": "districts,trade"})

    assert res.status_code == 200
    payload = res.json()
    assert calls["phases"] == ["districts", "trade"]
    assert payload["run_id"] == "run-1"
    assert payload["phases_requested"] == ["districts", "trade"]
    assert set(payload["results"].keys()) == {"districts", "trade"}


def test_ingest_all_uses_full_pipeline(monkeypatch):
    calls: dict[str, int] = {"full": 0}

    class FakeIngestionService:
        def __init__(self, _db):
            pass

        async def run_ingestion(self, phases):
            raise AssertionError("run_ingestion should not be called for phases=all")

        async def run_full_ingestion(self):
            calls["full"] += 1
            return {
                "run_id": "run-full",
                "phases_executed": ["districts", "companies"],
                "steps": {"districts": {"ok": True}, "companies": {"ok": True}},
            }

    monkeypatch.setattr(unified_graph, "GraphIngestionService", FakeIngestionService)

    app = _build_app()
    client = TestClient(app)
    res = client.post("/api/v1/unified-graph/ingest", params={"phases": "all"})

    assert res.status_code == 200
    payload = res.json()
    assert calls["full"] == 1
    assert payload["run_id"] == "run-full"
    assert payload["phases_requested"] == ["districts", "companies"]


def test_graph_health_endpoint_returns_contract(monkeypatch):
    class FakeQueryService:
        def __init__(self, _db):
            pass

        async def get_health(self):
            return {
                "status": "healthy",
                "total_nodes": 100,
                "total_edges": 220,
                "connected_node_ratio": 0.82,
                "largest_component_ratio": 0.61,
                "per_domain_coverage": [
                    {
                        "source_table": "company_registrations",
                        "total_nodes": 80,
                        "connected_nodes": 65,
                        "coverage_ratio": 0.8125,
                    }
                ],
                "thresholds_breached": [],
            }

    monkeypatch.setattr(unified_graph, "GraphQueryService", FakeQueryService)

    app = _build_app()
    client = TestClient(app)
    res = client.get("/api/v1/unified-graph/health")

    assert res.status_code == 200
    payload = res.json()
    assert payload["status"] == "healthy"
    assert payload["total_nodes"] == 100
    assert payload["per_domain_coverage"][0]["source_table"] == "company_registrations"


def test_graph_timeseries_value_error_is_422(monkeypatch):
    class FakeQueryService:
        def __init__(self, _db):
            pass

        async def get_timeseries(self, **kwargs):
            raise ValueError("Invalid bucket")

    monkeypatch.setattr(unified_graph, "GraphQueryService", FakeQueryService)

    app = _build_app()
    client = TestClient(app)
    res = client.get("/api/v1/unified-graph/timeseries", params={"bucket": "month"})

    assert res.status_code == 422
    assert "Invalid bucket" in res.json()["detail"]
