"""Unit tests for monitoring dashboard formatting (no DB needed)."""

from datetime import datetime, timedelta, timezone

from app.models.camera import Camera, CameraStatus
from app.services.monitoring_service import _camera_is_online, _format_camera


def _camera(**overrides) -> Camera:
    base = dict(
        id=1,
        name="Lobby",
        status=CameraStatus.active,
        frame_rate_fps=14.5,
        latency_ms=107,
        bandwidth_kbps=2048,
        cpu_usage_percent=31.0,
        gpu_usage_percent=12.0,
        dropped_frames=42,
        last_heartbeat_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Camera(**base)


def test_offline_camera_reports_no_live_telemetry():
    """Stale last-known readings must not surface as current health."""
    health = _format_camera(_camera(), online=False, recognition_today=3)["health"]
    assert health["online"] is False
    assert health["fps"] is None
    assert health["latency_ms"] is None
    assert health["bandwidth_kbps"] is None
    assert health["cpu_usage_percent"] is None
    assert health["gpu_usage_percent"] is None
    # Cumulative counter stays meaningful regardless of connectivity.
    assert health["dropped_frames"] == 42
    assert health["recognition_events_today"] == 3


def test_online_camera_reports_telemetry():
    health = _format_camera(_camera(), online=True, recognition_today=0)["health"]
    assert health["fps"] == 14.5
    assert health["latency_ms"] == 107
    assert health["cpu_usage_percent"] == 31.0


def test_camera_is_online_requires_active_status_and_fresh_heartbeat():
    threshold = datetime.now(timezone.utc) - timedelta(seconds=60)

    assert _camera_is_online(_camera(), threshold) is True
    assert _camera_is_online(_camera(status=CameraStatus.inactive), threshold) is False
    assert _camera_is_online(_camera(last_heartbeat_at=None), threshold) is False
    stale = datetime.now(timezone.utc) - timedelta(minutes=10)
    assert _camera_is_online(_camera(last_heartbeat_at=stale), threshold) is False
