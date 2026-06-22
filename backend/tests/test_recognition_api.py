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
from app.models.live_event import LiveEvent
from app.models.recognition import RecognitionEvent
import app.services.attendance_service as attendance_service
import app.services.face_service as face_service
from main import app


class FakeSession:
    """Minimal async session that records added ORM objects."""

    _DEFAULT = object()  # sentinel: "use the stock employee"

    def __init__(self):
        self.added = []
        # Single row returned by execute().scalar_one_or_none() (event feedback)
        self.event = None
        # Override what db.get() returns (None = employee row missing)
        self.employee = self._DEFAULT
        # Ids returned by execute().scalars().all() (single-org lookup)
        self.org_ids = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        # Mimic primary-key assignment so handlers reading obj.id after a
        # flush (e.g. issue_token on register) keep working.
        for i, obj in enumerate(self.added, start=1):
            if getattr(obj, "id", None) is None:
                obj.id = i

    async def refresh(self, obj, attribute_names=None):
        pass

    async def get(self, model, pk):
        if self.employee is not self._DEFAULT:
            return self.employee
        return SimpleNamespace(
            id=pk,
            first_name="Ada",
            last_name="Lovelace",
            organization_id=1,
            is_active=True,
        )

    async def execute(self, stmt):
        return SimpleNamespace(
            scalar_one_or_none=lambda: self.event,
            scalars=lambda: SimpleNamespace(all=lambda: list(self.org_ids)),
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


def _identify_returns_employee_7(monkeypatch):
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": "7",
            "confidence": 0.95,
            "liveness_passed": True,
            "processing_ms": 100,
        },
    )


def test_cross_tenant_match_is_suppressed(client, fake_session, monkeypatch):
    """A FAISS hit on another org's employee must read as a plain non-match:
    no identity leak, no attendance write, event logged under the caller's org.
    """
    _identify_returns_employee_7(monkeypatch)
    fake_session.employee = SimpleNamespace(
        id=7, first_name="Eve", last_name="Other", organization_id=2, is_active=True
    )

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()

    assert body["matched"] is False
    assert body["employee"] is None
    assert body["employee_id"] is None  # raw FAISS identity must not leak
    events = [o for o in fake_session.added if isinstance(o, RecognitionEvent)]
    assert len(events) == 1
    assert events[0].result == "unknown"
    assert events[0].employee_id is None
    assert events[0].organization_id == 1  # caller org, not the victim's


def test_match_on_missing_employee_row_is_unknown(client, fake_session, monkeypatch):
    """Stale FAISS vectors after a delete must not 500 or claim a match."""
    _identify_returns_employee_7(monkeypatch)
    fake_session.employee = None

    resp = client.post("/api/v1/recognition/identify", json={"image": "x"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["matched"] is False
    assert body["reason"] == "stale_identity"


def test_match_on_inactive_employee_is_unknown(client, fake_session, monkeypatch):
    _identify_returns_employee_7(monkeypatch)
    fake_session.employee = SimpleNamespace(
        id=7, first_name="Ada", last_name="Lovelace", organization_id=1, is_active=False
    )

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()

    assert body["matched"] is False
    assert body["reason"] == "stale_identity"


def _identify_returns_visitor_3(monkeypatch):
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": "visitor-3",
            "confidence": 0.93,
            "liveness_passed": True,
            "processing_ms": 100,
        },
    )


def test_same_org_visitor_match_passes(client, fake_session, monkeypatch):
    _identify_returns_visitor_3(monkeypatch)
    fake_session.employee = SimpleNamespace(id=3, name="Guest", organization_id=1)

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()

    assert body["matched"] is True
    assert body["employee_id"] == "visitor-3"
    live = [o for o in fake_session.added if isinstance(o, LiveEvent)]
    assert [e.event_type for e in live] == ["recognition.visitor"]
    assert live[0].visitor_id == 3


def test_cross_tenant_visitor_match_is_suppressed(client, fake_session, monkeypatch):
    """A FAISS hit on another org's visitor must read as a plain non-match:
    no visitor identity leak, event logged as unknown under the caller's org.
    """
    _identify_returns_visitor_3(monkeypatch)
    fake_session.employee = SimpleNamespace(id=3, name="Guest", organization_id=2)

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()

    assert body["matched"] is False
    assert body["employee_id"] is None  # raw "visitor-N" identity must not leak
    events = [o for o in fake_session.added if isinstance(o, RecognitionEvent)]
    assert len(events) == 1
    assert events[0].result == "unknown"
    assert events[0].organization_id == 1  # caller org, not the victim's
    live = [o for o in fake_session.added if isinstance(o, LiveEvent)]
    assert all(e.event_type != "recognition.visitor" for e in live)


def test_missing_visitor_row_is_unknown(client, fake_session, monkeypatch):
    _identify_returns_visitor_3(monkeypatch)
    fake_session.employee = None

    body = client.post("/api/v1/recognition/identify", json={"image": "x"}).json()

    assert body["matched"] is False
    assert body["employee_id"] is None
    assert body["reason"] == "stale_identity"


def test_raw_recognize_cross_org_match_is_stripped(client, fake_session, monkeypatch):
    """/recognition/recognize must not return another tenant's FAISS identity."""
    monkeypatch.setattr(
        face_service,
        "recognize",
        lambda **kwargs: {
            "success": True,
            "employee_id": "7",
            "matched": True,
            "confidence": 0.95,
            "processing_ms": 100,
        },
    )
    fake_session.employee = SimpleNamespace(id=7, organization_id=2, is_active=True)

    body = client.post("/api/v1/recognition/recognize", json={"image": "x"}).json()

    assert body["employee_id"] is None
    assert body["matched"] is False


def test_raw_recognize_same_org_match_passes(client, fake_session, monkeypatch):
    monkeypatch.setattr(
        face_service,
        "recognize",
        lambda **kwargs: {
            "success": True,
            "employee_id": "7",
            "matched": True,
            "confidence": 0.95,
            "processing_ms": 100,
        },
    )

    body = client.post("/api/v1/recognition/recognize", json={"image": "x"}).json()

    assert body["employee_id"] == "7"
    assert body["matched"] is True


def _engine_result(identity, attendance_event=None):
    payload = {
        "success": True,
        "employee_id": identity,
        "employee_name": "Ada Lovelace",
        "confidence": 0.91,
        "matched": True,
        "is_unknown": False,
        "event_type": "check_in",
        "processing_ms": 50,
    }
    return SimpleNamespace(
        employee_id=identity,
        attendance_event=attendance_event,
        confidence=0.91,
        liveness_passed=True,
        to_dict=lambda: dict(payload),
    )


def _mock_engine_pipeline(monkeypatch, result):
    monkeypatch.setattr(
        "app.api.engine.get_recognition_engine",
        lambda: SimpleNamespace(
            recognize_image=lambda *a, **k: result,
            recognize_stream=lambda *a, **k: result,
        ),
    )


def _pending_engine_events() -> int:
    from app.engine.attendance_generator import get_attendance_generator

    return get_attendance_generator().stats["pending_events"]


def test_engine_recognize_same_org_match_writes_attendance(
    client, fake_session, monkeypatch
):
    calls = []

    async def fake_process_recognition(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(last_action="check_in")

    monkeypatch.setattr(
        attendance_service, "process_recognition", fake_process_recognition
    )
    _mock_engine_pipeline(monkeypatch, _engine_result("7", object()))

    resp = client.post(
        "/api/v1/engine/recognize", json={"image": "x", "direction": "in"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["employee_id"] == "7"
    assert body["matched"] is True
    assert len(calls) == 1
    assert calls[0]["employee_id"] == 7
    assert calls[0]["organization_id"] == 1
    assert calls[0]["intent"] == "check_in"
    # enqueue=False: the inline write is the only writer; nothing is queued
    # for the background consumer.
    assert _pending_engine_events() == 0


def test_engine_recognize_stream_persists_inline(client, fake_session, monkeypatch):
    """/engine/recognize-stream persists inline too (it used to leave its
    event to the background consumer, which bypassed the tenancy veto)."""
    calls = []

    async def fake_process_recognition(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(last_action="check_out")

    monkeypatch.setattr(
        attendance_service, "process_recognition", fake_process_recognition
    )
    monkeypatch.setattr(
        "app.services.stream_capture.validate_stream_url", lambda url: None
    )
    _mock_engine_pipeline(monkeypatch, _engine_result("7", object()))

    resp = client.post(
        "/api/v1/engine/recognize-stream",
        json={"stream_url": "rtsp://cam.example/1", "direction": "out"},
    )

    assert resp.status_code == 200
    assert resp.json()["employee_id"] == "7"
    assert len(calls) == 1
    assert calls[0]["employee_id"] == 7
    assert calls[0]["organization_id"] == 1
    assert calls[0]["intent"] == "check_out"
    assert _pending_engine_events() == 0


def test_engine_recognize_cross_org_match_is_stripped(
    client, fake_session, monkeypatch
):
    """A cross-org engine match leaks neither identity nor attendance; with
    enqueue=False nothing is queued for the background consumer to persist.
    """
    fake_session.employee = SimpleNamespace(
        id=7, first_name="Eve", last_name="Other", organization_id=2, is_active=True
    )
    calls = []

    async def fake_process_recognition(**kwargs):
        calls.append(kwargs)
        return None

    monkeypatch.setattr(
        attendance_service, "process_recognition", fake_process_recognition
    )
    _mock_engine_pipeline(monkeypatch, _engine_result("7", object()))

    resp = client.post(
        "/api/v1/engine/recognize", json={"image": "x", "direction": "in"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["employee_id"] is None
    assert body["employee_name"] is None
    assert body["matched"] is False
    assert body["is_unknown"] is True
    assert calls == []
    assert _pending_engine_events() == 0


def test_register_succeeds_without_org_assignment(client, fake_session, monkeypatch):
    """Self-registration no longer binds the account to an organization — a
    user's tenant is resolved from the single active company at request time."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "registration_enabled", True)
    fake_session.org_ids = [42]

    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "New User", "email": "new@example.com", "password": "password123"},
    )

    assert resp.status_code == 201
    # The per-user organization link was removed from the model and response.
    assert "organization_id" not in resp.json()["user"]


def test_register_unaffected_by_org_count(client, fake_session, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "registration_enabled", True)
    fake_session.org_ids = [1, 2]

    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "New User", "email": "new2@example.com", "password": "password123"},
    )

    assert resp.status_code == 201
    assert "organization_id" not in resp.json()["user"]


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


def test_unknown_identify_broadcasts_unknown_event(client, fake_session, monkeypatch):
    """A searched-but-unmatched face (no gate reason) fires the org-wide toast."""
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

    live = [o for o in fake_session.added if isinstance(o, LiveEvent)]
    assert [e.event_type for e in live] == ["recognition.unknown"]


def test_no_face_identify_records_nothing(client, fake_session, monkeypatch):
    """A frame with no usable face (person left view between the kiosk's detect
    and identify ticks) must not create an "unknown face" event or toast."""
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": None,
            "confidence": 0.0,
            "reason": "no_face",
            "liveness_passed": False,
            "processing_ms": 30,
        },
    )

    resp = client.post("/api/v1/recognition/identify", json={"image": "x"})
    assert resp.status_code == 200
    assert resp.json()["matched"] is False
    assert fake_session.added == []


def test_gate_rejection_broadcasts_rejected_not_unknown(client, fake_session, monkeypatch):
    """Liveness/quality rejections are kept for review but must not fire the
    org-wide "Unknown face detected" toast (recognition.unknown)."""
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda **kwargs: {
            "success": True,
            "employee_id": None,
            "confidence": 0.0,
            "reason": "spoof_detected",
            "liveness_passed": False,
            "processing_ms": 95,
        },
    )

    resp = client.post("/api/v1/recognition/identify", json={"image": "x"})
    assert resp.status_code == 200

    events = [o for o in fake_session.added if isinstance(o, RecognitionEvent)]
    assert len(events) == 1  # still lands in the Unknown Faces review queue
    live = [o for o in fake_session.added if isinstance(o, LiveEvent)]
    assert [e.event_type for e in live] == ["recognition.rejected"]
    assert live[0].message == "Face rejected (spoof_detected)"


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


def test_event_feedback_labels_false_accept(client, fake_session, monkeypatch):
    """Reviewer marks a matched event as wrong -> false accept in metrics."""
    import app.engine.metrics as engine_metrics

    fresh = engine_metrics.EngineMetricsCollector()
    monkeypatch.setattr(engine_metrics, "_metrics", fresh)
    fake_session.event = SimpleNamespace(
        id=42, organization_id=1, result="matched", meta=None
    )

    resp = client.post(
        "/api/v1/recognition/events/42/feedback",
        json={"outcome": "incorrect", "note": "wrong person"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "false_accept"
    assert body["result"] == "matched"
    assert fresh.recognition.false_accepts == 1
    assert fake_session.event.meta["feedback"]["label"] == "false_accept"
    assert fake_session.event.meta["feedback"]["note"] == "wrong person"


def test_event_feedback_labels_false_reject(client, fake_session, monkeypatch):
    """Reviewer marks an unknown event as wrong -> false reject (missed match)."""
    import app.engine.metrics as engine_metrics

    fresh = engine_metrics.EngineMetricsCollector()
    monkeypatch.setattr(engine_metrics, "_metrics", fresh)
    fake_session.event = SimpleNamespace(
        id=43, organization_id=1, result="unknown", meta={"existing": True}
    )

    resp = client.post(
        "/api/v1/recognition/events/43/feedback", json={"outcome": "incorrect"}
    )

    assert resp.status_code == 200
    assert resp.json()["label"] == "false_reject"
    assert fresh.recognition.false_rejects == 1
    assert fake_session.event.meta["existing"] is True  # prior metadata kept


def test_event_feedback_missing_event_404(client, fake_session):
    fake_session.event = None
    resp = client.post(
        "/api/v1/recognition/events/999/feedback", json={"outcome": "correct"}
    )
    assert resp.status_code == 404


def test_performance_compliance_report(client, monkeypatch):
    """Required metrics table: measured accuracy/FPR/FNR + pipeline latency."""
    import app.engine.metrics as engine_metrics

    fresh = engine_metrics.EngineMetricsCollector()
    monkeypatch.setattr(engine_metrics, "_metrics", fresh)
    fresh.record_pipeline_stage("face_detection", 80)
    fresh.record_pipeline_stage("liveness_detection", 200)
    for _ in range(99):
        fresh.record_match_outcome("true_accept")
    fresh.record_match_outcome("true_reject")

    resp = client.get("/api/v1/recognition/performance-compliance")

    assert resp.status_code == 200
    data = resp.json()
    assert data["labeled_samples"] == 100
    rows = {r["metric"]: r for r in data["requirements"]}
    assert rows["recognition_accuracy"]["measured"] == 1.0
    assert rows["recognition_accuracy"]["met"] is True
    assert rows["recognition_time_ms"]["measured"] == 80.0  # excludes liveness
    assert rows["recognition_time_ms"]["met"] is True
    assert rows["liveness_verification_ms"]["measured"] == 200.0
    assert rows["liveness_verification_ms"]["met"] is True


def test_performance_compliance_unmeasured_is_null(client, monkeypatch):
    import app.engine.metrics as engine_metrics

    monkeypatch.setattr(
        engine_metrics, "_metrics", engine_metrics.EngineMetricsCollector()
    )

    data = client.get("/api/v1/recognition/performance-compliance").json()
    rows = {r["metric"]: r for r in data["requirements"]}
    assert all(r["met"] is None for r in rows.values())
    assert data["labeled_samples"] == 0


def test_evaluate_endpoint(client, monkeypatch):
    monkeypatch.setattr(
        face_service,
        "identify",
        lambda image_b64, require_liveness=True, **kw: {
            "success": True,
            "employee_id": "1" if image_b64 == "genuine" else None,
            "confidence": 0.95,
            "processing_ms": 100,
            "recognition_ms": 80,
            "liveness_ms": 20,
        },
    )

    resp = client.post(
        "/api/v1/recognition/evaluate",
        json={
            "samples": [
                {"image": "genuine", "employee_id": "1"},
                {"image": "impostor", "employee_id": None},
            ],
            "record_metrics": False,
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_samples"] == 2
    assert data["true_accepts"] == 1
    assert data["true_rejects"] == 1
    assert data["accuracy"] == 1.0
    rows = {r["metric"]: r for r in data["compliance"]}
    assert rows["recognition_accuracy"]["met"] is True


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
