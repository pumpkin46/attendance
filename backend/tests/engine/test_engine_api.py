"""Tests for recognition engine API routes."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from main import app


@pytest.fixture
def client():
    mock_user = SimpleNamespace(
        id=1,
        organization_id=1,
        is_active=True,
        has_role=lambda role: role == "super_admin",
        has_permission=lambda perm: True,
    )

    app.dependency_overrides[get_current_user] = lambda: mock_user
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_get_engine_config(client):
    response = client.get("/api/v1/engine/config")
    assert response.status_code == 200
    data = response.json()
    assert "liveness" in data
    assert data["search"]["auto_accept_threshold"] == 0.9


def test_get_performance_requirements(client):
    response = client.get("/api/v1/engine/performance-requirements")
    assert response.status_code == 200
    data = response.json()
    assert data["performance"]["recognition_time"] == "< 300ms"
    assert "100,000+" in data["scalability"]["max_employees"]


def test_get_engine_status(client):
    response = client.get("/api/v1/engine/status")
    assert response.status_code == 200
    data = response.json()
    assert "running" in data
    assert "metrics" in data
    assert "sla_compliance" in data


def test_engine_detect_invalid_image(client):
    response = client.post(
        "/api/v1/engine/detect",
        json={"image": "not-valid"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["face_count"] == 0


def test_list_streams(client):
    response = client.get("/api/v1/engine/streams")
    assert response.status_code == 200
    data = response.json()
    assert "total_streams" in data
    assert "streams" in data


def test_list_streams_with_registered_stream(client):
    """A registered stream serializes without error (keys are stringified)."""
    from app.engine.stream_manager import get_stream_manager

    manager = get_stream_manager()
    manager.add_stream(42, "rtsp://example/stream")
    try:
        response = client.get("/api/v1/engine/streams")
        assert response.status_code == 200
        data = response.json()
        assert "42" in data["streams"]
    finally:
        manager.remove_stream(42)


def test_stream_snapshot_404_when_no_frame(client):
    """A registered-but-not-running stream has no cached frame → 404."""
    from app.engine.stream_manager import get_stream_manager

    manager = get_stream_manager()
    manager.add_stream(43, "0")
    try:
        response = client.get("/api/v1/engine/streams/43/snapshot")
        assert response.status_code == 404
    finally:
        manager.remove_stream(43)


def test_stream_snapshot_returns_jpeg_when_frame_cached(client):
    """Once the stream loop has a frame, the snapshot is served as JPEG bytes."""
    import numpy as np

    from app.engine.stream_manager import get_stream_manager

    manager = get_stream_manager()
    stream = manager.add_stream(44, "0")
    stream._last_frame = np.zeros((360, 640, 3), dtype=np.uint8)
    try:
        response = client.get("/api/v1/engine/streams/44/snapshot")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert len(response.content) > 0
    finally:
        manager.remove_stream(44)


def test_stream_ws_pushes_jpeg_frame(client, monkeypatch):
    """The camera WebSocket pushes the latest frame as binary JPEG."""
    import numpy as np

    import app.api.ws as ws_mod
    from app.engine.stream_manager import get_stream_manager

    async def fake_identity(_token, _org):
        return (1, 1)

    monkeypatch.setattr(ws_mod, "_origin_allowed", lambda _origin: True)
    monkeypatch.setattr(ws_mod, "_resolve_identity", fake_identity)

    manager = get_stream_manager()
    stream = manager.add_stream(45, "0")
    stream._last_frame = np.zeros((360, 640, 3), dtype=np.uint8)
    try:
        with client.websocket_connect(
            "/api/v1/engine/streams/45/ws", subprotocols=["bearer", "tok"]
        ) as ws:
            data = ws.receive_bytes()
            assert len(data) > 0  # a JPEG frame
    finally:
        manager.remove_stream(45)


def test_engine_status_ws_pushes_status(client, monkeypatch):
    """The engine status WebSocket pushes a status + streams payload."""
    import app.api.ws as ws_mod

    async def fake_identity(_token, _org):
        return (1, 1)

    monkeypatch.setattr(ws_mod, "_origin_allowed", lambda _origin: True)
    monkeypatch.setattr(ws_mod, "_resolve_identity", fake_identity)

    with client.websocket_connect(
        "/api/v1/engine/status/ws", subprotocols=["bearer", "tok"]
    ) as ws:
        msg = ws.receive_json()
        assert "status" in msg
        assert "streams" in msg


def test_get_tracking_stats(client):
    response = client.get("/api/v1/engine/tracking/stats")
    assert response.status_code == 200
    assert "total_tracks" in response.json()


def test_get_index_stats(client):
    response = client.get("/api/v1/engine/index/stats")
    assert response.status_code == 200
    data = response.json()
    assert "total_embeddings" in data


def test_patch_engine_config(client):
    response = client.patch(
        "/api/v1/engine/config",
        json={"liveness_min_score": 0.88, "duplicate_window_seconds": 120},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["updated"]["liveness_min_score"] == 0.88


def test_engine_recognize_with_mocks(client, monkeypatch):
    mock_result = MagicMock()
    mock_result.to_dict.return_value = {
        "success": True,
        "matched": True,
        "employee_id": "EMP001",
        "confidence": 0.97,
        "attendance_event": None,
    }
    mock_result.attendance_event = None

    mock_engine = MagicMock()
    mock_engine.recognize_image.return_value = mock_result
    monkeypatch.setattr(
        "app.api.engine.get_recognition_engine",
        lambda: mock_engine,
    )

    response = client.post(
        "/api/v1/engine/recognize",
        json={"image": "abc123"},
    )

    assert response.status_code == 200
    assert response.json()["employee_id"] == "EMP001"
    mock_engine.recognize_image.assert_called_once()
