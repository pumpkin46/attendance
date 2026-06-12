"""Unit tests for AI security monitoring: detection helpers, schema bridging
and alert exports (no DB needed)."""

from datetime import datetime, time, timezone

import pytest

from app.models.security import AlertSeverity, AlertStatus, SecurityAlert
from app.schemas.security_monitoring import SecurityAlertOut
from app.services import security_monitoring_service as svc
from app.services.report_export import ExportContext
from app.services.security_export import export_security_alerts


# ── After-hours window ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("t", "expected"),
    [
        (time(23, 0), True),
        (time(5, 59), True),
        (time(20, 0), True),
        (time(6, 0), False),
        (time(12, 0), False),
        (time(19, 59), False),
    ],
)
def test_after_hours_window_crossing_midnight(t, expected):
    assert svc._in_after_hours(t, time(20, 0), time(6, 0)) is expected


def test_after_hours_window_same_day():
    assert svc._in_after_hours(time(13, 0), time(12, 0), time(14, 0)) is True
    assert svc._in_after_hours(time(14, 0), time(12, 0), time(14, 0)) is False
    assert svc._in_after_hours(time(11, 59), time(12, 0), time(14, 0)) is False


def test_after_hours_empty_window_never_matches():
    assert svc._in_after_hours(time(0, 0), time(9, 0), time(9, 0)) is False


def test_parse_hhmm():
    assert svc._parse_hhmm("20:30") == time(20, 30)
    assert svc._parse_hhmm("garbage") is None
    assert svc._parse_hhmm(None) is None


# ── Alert cooldown ───────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def clear_cooldown_cache():
    svc._last_alert_at.clear()
    yield
    svc._last_alert_at.clear()


def test_alert_cooldown_throttles_repeats(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.security_alert_cooldown", 120)
    assert svc._alert_throttled(1, "unknown_person", 5) is False
    assert svc._alert_throttled(1, "unknown_person", 5) is True
    # Different camera / type / org are independent keys.
    assert svc._alert_throttled(1, "unknown_person", 6) is False
    assert svc._alert_throttled(1, "tailgating", 5) is False
    assert svc._alert_throttled(2, "unknown_person", 5) is False


def test_alert_cooldown_disabled(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.security_alert_cooldown", 0)
    assert svc._alert_throttled(1, "unknown_person", 5) is False
    assert svc._alert_throttled(1, "unknown_person", 5) is False


# ── Schema bridging (ORM enums / legacy column names → API strings) ─────────


def _alert(**overrides) -> SecurityAlert:
    base = dict(
        id=7,
        organization_id=1,
        alert_type="spoof_attempt",
        severity=AlertSeverity.critical,
        title="Possible spoofing attempt blocked",
        message="The liveness check rejected a face presentation (static_image).",
        status=AlertStatus.open,
        meta={"reason": "static_image", "confidence": 0.41},
        camera_id=3,
        snapshot_path="data/snapshots/alert_7.jpg",
        occurred_at=datetime(2026, 6, 11, 22, 15, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return SecurityAlert(**base)


def test_alert_out_bridges_legacy_columns_and_enums():
    out = SecurityAlertOut.model_validate(_alert(), from_attributes=True)
    assert out.severity == "critical"
    assert out.status == "open"
    assert out.description == "The liveness check rejected a face presentation (static_image)."
    assert out.metadata_json == {"reason": "static_image", "confidence": 0.41}
    assert out.snapshot_path == "data/snapshots/alert_7.jpg"


# ── Exports ──────────────────────────────────────────────────────────────────


def _ctx() -> ExportContext:
    return ExportContext(
        org_name="Acme",
        generated_at=datetime(2026, 6, 11, 10, 0, tzinfo=timezone.utc),
        tz_offset=0,
    )


def test_csv_export_contains_alert_fields():
    alerts = [
        _alert(),
        _alert(id=8, alert_type="unknown_person", severity=AlertSeverity.medium,
               title="Unknown person detected", status=AlertStatus.resolved),
    ]
    raw = export_security_alerts(alerts, "csv", _ctx()).decode("utf-8-sig")
    assert raw.splitlines()[0].startswith("ID,Occurred,Type,Severity,Title")
    assert "spoof_attempt" in raw
    assert "critical" in raw
    assert "unknown_person" in raw
    assert "resolved" in raw


def test_xlsx_export_renders():
    content = export_security_alerts([_alert()], "xlsx", _ctx())
    # XLSX files are zip archives.
    assert content[:2] == b"PK"


def test_export_rejects_unknown_format():
    with pytest.raises(ValueError):
        export_security_alerts([], "pdf", _ctx())
