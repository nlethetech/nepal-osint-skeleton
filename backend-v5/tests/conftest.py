from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends, FastAPI


# Ensure `import app` works when running pytest from repo root.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture()
def test_app() -> FastAPI:
    from app.api.deps import get_current_user, require_dev
    from app.api.v1 import ingest, stories
    from app.api.v1.websocket import router as ws_router

    app = FastAPI()

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(stories.router, dependencies=[Depends(get_current_user)])
    api_v1.include_router(ingest.router, dependencies=[Depends(require_dev)])
    app.include_router(api_v1)

    app.include_router(ws_router)
    return app
