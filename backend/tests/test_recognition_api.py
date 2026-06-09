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


@pytest.fixture(autouse=True)
def _reset_unknown_throttle():
    """Isolate the per-process unknown-event throttle state between tests."""
    import app.services.recognition_service as rs

    rs._last_unknown_at.clear()
    yield
    rs._last_unknown_at.clear()


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


def test_save_event_snapshot_writes_file(tmp_path, monkeypatch):
    """A submitted frame is persisted so the Unknown Faces thumbnail can load."""
    import base64

    from app.core.config import settings
    import app.services.recognition_service as rs

    monkeypatch.setattr(settings, "engine_snapshot_dir", str(tmp_path))
    monkeypatch.setattr(settings, "unknown_snapshot_enabled", True)

    jpeg = base64.b64encode(b"\xff\xd8\xff\xe0\x00\x10JFIF-fake").decode()
    path = rs._save_event_snapshot(f"data:image/jpeg;base64,{jpeg}", 123)

    assert path is not None
    from pathlib import Path

    saved = Path(path)
    assert saved.exists()
    assert saved.read_bytes().startswith(b"\xff\xd8")  # JPEG magic


def test_save_event_snapshot_disabled(monkeypatch):
    from app.core.config import settings
    import app.services.recognition_service as rs

    monkeypatch.setattr(settings, "unknown_snapshot_enabled", False)
    assert rs._save_event_snapshot("data:image/jpeg;base64,AAAA", 1) is None


def test_save_event_snapshot_no_image():
    import app.services.recognition_service as rs

    assert rs._save_event_snapshot(None, 1) is None


def test_unknown_event_throttle(monkeypatch):
    """With the window set, repeat unknowns within it are suppressed per tenant."""
    from app.core.config import settings
    import app.services.recognition_service as rs

    monkeypatch.setattr(settings, "unknown_event_throttle_seconds", 30)
    rs._last_unknown_at.clear()

    assert rs._unknown_throttled(1) is False  # first → record
    assert rs._unknown_throttled(1) is True  # within window → skip
    assert rs._unknown_throttled(2) is False  # different tenant → record


def test_unknown_event_throttle_disabled(monkeypatch):
    from app.core.config import settings
    import app.services.recognition_service as rs

    monkeypatch.setattr(settings, "unknown_event_throttle_seconds", 0)
    rs._last_unknown_at.clear()

    assert rs._unknown_throttled(1) is False
    assert rs._unknown_throttled(1) is False  # 0 = never throttle


def test_purge_old_snapshots_removes_expired(tmp_path, monkeypatch):
    """Files older than the retention window are deleted; fresh ones kept."""
    import os
    import time

    from app.core.config import settings
    import app.services.recognition_service as rs

    monkeypatch.setattr(settings, "engine_snapshot_dir", str(tmp_path))
    monkeypatch.setattr(settings, "unknown_snapshot_retention_days", 30)

    old = tmp_path / "event_1.jpg"
    fresh = tmp_path / "event_2.jpg"
    old.write_bytes(b"\xff\xd8old")
    fresh.write_bytes(b"\xff\xd8new")
    # Backdate the old file 40 days.
    old_ts = time.time() - 40 * 86400
    os.utime(old, (old_ts, old_ts))

    removed = rs.purge_old_snapshots()

    assert removed == 1
    assert not old.exists()
    assert fresh.exists()
