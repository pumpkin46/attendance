"""Tests for the live WebSocket feeds (monitoring + engine status)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.api.ws as ws_mod
from main import app


@pytest.fixture
def ws_client(monkeypatch):
    # Bypass origin + token/DB identity resolution; tenant is org 1.
    async def fake_identity(_token, _org):
        return (1, 1)

    monkeypatch.setattr(ws_mod, "_origin_allowed", lambda _origin: True)
    monkeypatch.setattr(ws_mod, "_resolve_identity", fake_identity)
    with TestClient(app) as client:
        yield client


def test_monitoring_ws_pushes_dashboard_and_feed(ws_client, monkeypatch):
    from app.services import monitoring_service

    async def fake_dashboard(_db, _org):
        return {
            "active_cameras": 1,
            "total_cameras": 2,
            "employees_present": 3,
            "employees_absent": 4,
            "employees_late": 0,
            "unknown_persons_today": 5,
            "active_visitors": 0,
            "camera_health": {"online": 1, "offline": 1},
            "cameras": [],
        }

    async def fake_feed(_db, _org):
        return {"events": []}

    monkeypatch.setattr(monitoring_service, "build_dashboard", fake_dashboard)
    monkeypatch.setattr(monitoring_service, "build_live_feed", fake_feed)

    with ws_client.websocket_connect(
        "/api/v1/monitoring/ws", subprotocols=["bearer", "tok"]
    ) as ws:
        msg = ws.receive_json()
        assert msg["dashboard"]["employees_present"] == 3
        assert msg["dashboard"]["camera_health"]["online"] == 1
        assert msg["live_feed"]["events"] == []


def test_engine_status_ws_pushes_status(ws_client):
    with ws_client.websocket_connect(
        "/api/v1/engine/status/ws", subprotocols=["bearer", "tok"]
    ) as ws:
        msg = ws.receive_json()
        assert "status" in msg
        assert "streams" in msg


def test_ws_feed_rejects_unauthenticated(monkeypatch):
    # No identity mock: a connection without a token is closed before accept.
    monkeypatch.setattr(ws_mod, "_origin_allowed", lambda _origin: True)
    with TestClient(app) as client:
        with pytest.raises(Exception):
            with client.websocket_connect("/api/v1/monitoring/ws"):
                pass
