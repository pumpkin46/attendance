"""Tests for the recognition identify endpoint.

Focus: a successful (matched) recognition must be recorded as a
RecognitionEvent with result="matched" so it shows up in metrics, the events
list, and exports — not only "unknown" detections (regression guard).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant_org_id
from app.models.recognition import RecognitionEvent
import app.services.attendance_service as attendance_service
import app.services.face_service as face_service
from main import app


class FakeSession:
    """Minimal async session that records added ORM objects."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def get(self, model, pk):
        return SimpleNamespace(
            id=pk, first_name="Ada", last_name="Lovelace", organization_id=1
        )


@pytest.fixture
def fake_session():
    return FakeSession()


@pytest.fixture
def client(fake_session):
    mock_user = SimpleNamespace(
        id=1,
        organization_id=1,
        is_active=True,
        has_role=lambda role: False,
        has_permission=lambda perm: True,
    )
    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.dependency_overrides[get_tenant_org_id] = lambda: 1
    app.dependency_overrides[get_db] = lambda: fake_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_matched_identify_records_matched_event(client, fake_session, monkeypatch):
    async def fake_process_recognition(**kwargs):
        return None

    monkeypatch.setattr(
        attendance_service, "process_recognition", fake_process_recognition
    )
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": "7",
            "confidence": 0.97,
            "liveness_passed": True,
            "processing_ms": 120,
        },
    )

    resp = client.post("/api/v1/recognition/identify", json={"image": "x"})
    assert resp.status_code == 200

    events = [o for o in fake_session.added if isinstance(o, RecognitionEvent)]
    assert len(events) == 1
    assert events[0].result == "matched"
    assert events[0].employee_id == 7
    assert events[0].organization_id == 1  # tenant from the matched employee
    assert float(events[0].confidence) == pytest.approx(0.97)


def test_matched_identify_response_contract(client, monkeypatch):
    """The kiosk/test UI key off matched + employee + attendance; a regression
    here makes every recognition read as "unknown" in the UI.
    """
    async def fake_process_recognition(**kwargs):
        return SimpleNamespace(last_action="check_in")

    monkeypatch.setattr(
        attendance_service, "process_recognition", fake_process_recognition
    )
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": "7",
            "confidence": 0.62,
            "liveness_passed": True,
            "processing_ms": 120,
        },
    )

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()
    assert body["matched"] is True
    assert body["employee"]["id"] == 7
    assert body["attendance"]["action"] == "check_in"


def test_unknown_identify_response_contract(client, monkeypatch):
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": None,
            "confidence": 0.2,
            "reason": "low_confidence",
            "liveness_passed": True,
            "processing_ms": 80,
        },
    )

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()
    assert body["matched"] is False
    assert body["employee"] is None
    assert body["reason"] == "low_confidence"


def test_unknown_identify_records_unknown_event(client, fake_session, monkeypatch):
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": None,
            "confidence": 0.40,
            "liveness_passed": True,
            "processing_ms": 90,
        },
    )

    resp = client.post("/api/v1/recognition/identify", json={"image": "x"})
    assert resp.status_code == 200

    events = [o for o in fake_session.added if isinstance(o, RecognitionEvent)]
    assert len(events) == 1
    assert events[0].result == "unknown"
    assert events[0].employee_id is None
    assert events[0].organization_id == 1  # tenant from the caller context


def test_identify_with_unevaluated_liveness(client, fake_session, monkeypatch):
    """liveness_passed=None (liveness not evaluated) serializes without error."""
    async def fake_process_recognition(**kwargs):
        return None

    monkeypatch.setattr(
        attendance_service, "process_recognition", fake_process_recognition
    )
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": "7",
            "confidence": 0.97,
            "liveness_passed": None,
            "processing_ms": 120,
        },
    )

    resp = client.post("/api/v1/recognition/identify", json={"image": "x"})
    assert resp.status_code == 200
    assert resp.json()["liveness_passed"] is None
