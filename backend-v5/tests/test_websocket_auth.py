from __future__ import annotations

from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def test_ws_news_requires_token_closes_1008(test_app):
    with TestClient(test_app) as client:
        try:
            with client.websocket_connect("/ws/news"):
                assert False, "Expected WebSocketDisconnect for missing token"
        except WebSocketDisconnect as e:
            assert e.code == 1008

