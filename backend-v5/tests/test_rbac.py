from __future__ import annotations

from uuid import uuid4

from starlette.testclient import TestClient


def test_unauthed_stories_returns_401(test_app):
    with TestClient(test_app) as client:
        res = client.get("/api/v1/stories")
        assert res.status_code == 401


def test_consumer_cannot_trigger_ingest_returns_403(test_app):
    from app.api.deps import get_current_user
    from app.models.user import User, UserRole

    async def override_current_user() -> User:
        return User(
            id=uuid4(),
            email="consumer@example.com",
            password_hash="x",
            role=UserRole.CONSUMER,
            is_active=True,
        )

    test_app.dependency_overrides[get_current_user] = override_current_user

    with TestClient(test_app) as client:
        res = client.post("/api/v1/ingest/trigger")
        assert res.status_code == 403

    test_app.dependency_overrides.clear()

