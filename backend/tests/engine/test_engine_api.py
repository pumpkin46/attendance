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
        "app.api.engine_api.get_recognition_engine",
        lambda: mock_engine,
    )

    response = client.post(
        "/api/v1/engine/recognize",
        json={"image": "abc123"},
    )

    assert response.status_code == 200
    assert response.json()["employee_id"] == "EMP001"
    mock_engine.recognize_image.assert_called_once()
