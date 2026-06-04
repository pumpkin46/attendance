"""Tests for stream manager health validation."""

from datetime import datetime, timezone

from app.engine.config import engine_config
from app.engine.stream_manager import CameraStream, StreamHealth, StreamManager, StreamStatus


def test_stream_health_is_healthy():
    health = StreamHealth(
        fps=20.0,
        latency_ms=120,
        quality_score=0.9,
    )
    assert health.is_healthy is True


def test_stream_health_degraded_fps():
    health = StreamHealth(
        fps=5.0,
        latency_ms=100,
        quality_score=0.9,
    )
    assert health.is_healthy is False


def test_stream_health_high_latency():
    health = StreamHealth(
        fps=25.0,
        latency_ms=800,
        quality_score=0.9,
    )
    assert health.is_healthy is False


def test_add_and_remove_stream():
    manager = StreamManager()
    stream = manager.add_stream(
        camera_id=10,
        stream_url="rtsp://camera.local/stream",
        target_fps=15,
    )

    assert stream.camera_id == 10
    assert manager.total_streams == 1

    manager.remove_stream(10)
    assert manager.total_streams == 0


def test_get_stream_status():
    manager = StreamManager()
    manager.add_stream(camera_id=3, stream_url="rtsp://example/stream")
    stream = manager._streams[3]
    stream.status = StreamStatus.ACTIVE
    stream.health.fps = 18.5
    stream.health.latency_ms = 90
    stream.health.total_frames = 100

    status = manager.get_stream_status(3)
    assert status is not None
    assert status["camera_id"] == 3
    assert status["status"] == "active"
    assert status["health"]["fps"] == 18.5


def test_validate_stream_marks_degraded():
    manager = StreamManager()
    stream = CameraStream(
        camera_id=1,
        stream_url="rtsp://example",
        protocol=__import__("app.engine.stream_manager", fromlist=["StreamProtocol"]).StreamProtocol.RTSP,
        camera_type=__import__("app.engine.stream_manager", fromlist=["CameraType"]).CameraType.IP_CAMERA,
        status=StreamStatus.ACTIVE,
    )
    stream.health.fps = 5.0
    stream.health.latency_ms = 100
    stream.health.total_frames = 50
    stream.health.dropped_frames = 10

    manager._validate_stream(stream)

    assert stream.status == StreamStatus.DEGRADED
    assert 0.0 <= stream.health.quality_score <= 1.0
