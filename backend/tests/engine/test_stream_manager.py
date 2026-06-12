"""Tests for stream manager health validation and stream-loop orchestration."""

import asyncio
import threading

import cv2
import pytest

from app.engine import stream_manager as stream_manager_module
from app.engine.config import engine_config
from app.engine.stream_manager import (
    CameraStream,
    CameraType,
    StreamHealth,
    StreamManager,
    StreamProtocol,
    StreamStatus,
)


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


# --- Orchestration: idempotent start / callback registration ---------------


@pytest.mark.asyncio
async def test_start_twice_does_not_respawn_live_loops(monkeypatch):
    manager = StreamManager()
    manager.add_stream(1, "rtsp://example/stream")
    spawned = []

    async def fake_loop(camera_id):
        spawned.append(camera_id)
        await asyncio.Event().wait()

    async def fake_monitor():
        await asyncio.Event().wait()

    monkeypatch.setattr(manager, "_stream_loop", fake_loop)
    monkeypatch.setattr(manager, "_health_monitor", fake_monitor)

    await manager.start()
    stream = manager.get_stream(1)
    first_task = stream._task
    first_monitor = manager._monitor_task
    await asyncio.sleep(0)  # let the tasks begin running

    await manager.start()
    assert stream._task is first_task
    assert manager._monitor_task is first_monitor
    assert spawned == [1]

    first_task.cancel()
    first_monitor.cancel()
    await asyncio.gather(first_task, first_monitor, return_exceptions=True)


def test_register_callback_dedupes_bound_methods():
    manager = StreamManager()

    class Engine:
        async def process(self, camera_id, frame, ts):
            pass

    engine = Engine()
    # Each attribute access creates a new (but equal) bound-method object,
    # exactly what a double engine.start() passes in.
    manager.register_callback(engine.process)
    manager.register_callback(engine.process)
    assert len(manager._frame_callbacks) == 1


@pytest.mark.asyncio
async def test_start_stream_resets_reconnect_attempts(monkeypatch):
    manager = StreamManager()
    stream = manager.add_stream(2, "rtsp://example/stream")
    stream.reconnect_attempts = 7

    async def fake_loop(camera_id):
        pass

    monkeypatch.setattr(manager, "_stream_loop", fake_loop)
    assert await manager.start_stream(2) is True
    assert stream.reconnect_attempts == 0
    await stream._task


# --- Orchestration: failure handling in the stream loop --------------------


class FakeCapture:
    """Capture whose read() always fails (camera answers but sends nothing)."""

    def __init__(self):
        self.released = False
        self.reads = 0

    def isOpened(self):
        return not self.released

    def read(self):
        self.reads += 1
        return False, None

    def release(self):
        self.released = True


@pytest.mark.asyncio
async def test_read_failure_streak_routes_to_reconnect_and_alerts(monkeypatch):
    manager = StreamManager()
    manager._running = True
    stream = manager.add_stream(3, "rtsp://example/stream")

    capture = FakeCapture()
    connects = []
    offline = []

    async def fake_connect(s):
        connects.append(1)
        capture.released = False
        s._capture = capture
        s.status = StreamStatus.ACTIVE
        return True

    monkeypatch.setattr(manager, "_connect_stream", fake_connect)
    monkeypatch.setattr(manager, "_record_camera_offline", offline.append)
    monkeypatch.setattr(engine_config.stream, "reconnect_interval_seconds", 0)

    task = asyncio.create_task(manager._stream_loop(3))
    for _ in range(500):
        if len(connects) >= 2 and offline:
            break
        await asyncio.sleep(0.01)
    stream._running = False
    manager._running = False
    await asyncio.wait_for(task, timeout=5)

    assert capture.reads >= 5  # full failure streak before giving up
    assert len(connects) >= 2  # fell into the reconnect branch and reopened
    assert offline == [3]  # offline alert fired once, on the first attempt
    assert stream.reconnect_attempts >= 1
    assert capture.released is True
    assert stream.health.fps == 0.0
    assert stream.status == StreamStatus.OFFLINE


@pytest.mark.asyncio
async def test_health_errors_stay_bounded(monkeypatch):
    manager = StreamManager()
    manager._running = True
    stream = manager.add_stream(4, "rtsp://example/stream")
    stream.health.errors = ["old-%d" % i for i in range(80)]

    class RaisingCapture:
        def isOpened(self):
            return True

        def read(self):
            raise RuntimeError("boom")

        def release(self):
            pass

    async def fake_connect(s):
        s._capture = RaisingCapture()
        return True

    monkeypatch.setattr(manager, "_connect_stream", fake_connect)
    monkeypatch.setattr(manager, "_record_camera_offline", lambda cid: None)
    monkeypatch.setattr(engine_config.stream, "reconnect_interval_seconds", 0)

    task = asyncio.create_task(manager._stream_loop(4))
    for _ in range(500):
        if stream.health.errors and stream.health.errors[-1] == "boom":
            break
        await asyncio.sleep(0.01)
    stream._running = False
    manager._running = False
    await asyncio.wait_for(task, timeout=5)

    assert len(stream.health.errors) == 50
    assert stream.health.errors[-1] == "boom"
    assert stream.reconnect_attempts >= 1  # exception routed into reconnect path


@pytest.mark.asyncio
async def test_cancel_mid_read_defers_release_until_read_returns(monkeypatch):
    manager = StreamManager()
    manager._running = True
    stream = manager.add_stream(5, "rtsp://example/stream")

    events = []
    read_started = threading.Event()
    read_unblock = threading.Event()

    class SlowCapture:
        def isOpened(self):
            return True

        def read(self):
            read_started.set()
            read_unblock.wait(5)
            events.append("read_returned")
            return False, None

        def release(self):
            events.append("released")

    async def fake_connect(s):
        s._capture = SlowCapture()
        return True

    monkeypatch.setattr(manager, "_connect_stream", fake_connect)

    task = asyncio.create_task(manager._stream_loop(5))
    assert await asyncio.to_thread(read_started.wait, 5)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    # The loop exited but must NOT have released while read() is in flight.
    assert "released" not in events
    assert stream._capture is None

    read_unblock.set()
    for _ in range(500):
        if "released" in events:
            break
        await asyncio.sleep(0.01)
    assert events == ["read_returned", "released"]


# --- Orchestration: construction-time FFmpeg timeouts -----------------------


class _FakeCap:
    def __init__(self, opened=True):
        self._opened = opened
        self.released = False

    def isOpened(self):
        return self._opened

    def set(self, *_args):
        return True

    def release(self):
        self.released = True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "rtsp://example/stream",
        "rtmp://example/live",
        "rtmps://example/live",
    ],
)
async def test_connect_passes_timeouts_at_construction(monkeypatch, url):
    calls = []

    def fake_video_capture(*args):
        calls.append(args)
        return _FakeCap()

    monkeypatch.setattr(cv2, "VideoCapture", fake_video_capture)

    manager = StreamManager()
    stream = manager.add_stream(6, url)
    assert await manager._connect_stream(stream) is True
    assert len(calls) == 1
    called_url, backend, params = calls[0]
    assert called_url == url
    assert backend == cv2.CAP_FFMPEG
    assert params == [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
        engine_config.stream.open_timeout_ms,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC,
        engine_config.stream.read_timeout_ms,
    ]
    assert stream._capture is not None


@pytest.mark.asyncio
async def test_connect_unopened_timed_capture_fails_without_fallback(monkeypatch):
    # An offline camera fails the timed open; it must NOT be retried with an
    # untimed open, which would hang for the full TCP/RTSP timeout on every
    # backoff cycle for the very camera that is known to be down.
    calls = []
    caps = []

    def fake_video_capture(*args):
        calls.append(args)
        cap = _FakeCap(opened=False)
        caps.append(cap)
        return cap

    monkeypatch.setattr(cv2, "VideoCapture", fake_video_capture)

    manager = StreamManager()
    stream = manager.add_stream(7, "rtsp://example/stream")
    assert await manager._connect_stream(stream) is False
    assert [len(c) for c in calls] == [3]  # one timed attempt, no fallback
    assert caps[0].released is True
    assert stream.status == StreamStatus.ERROR


@pytest.mark.asyncio
async def test_connect_falls_back_when_params_constructor_raises(monkeypatch):
    # Only an OpenCV build that rejects the params constructor itself may
    # fall back to an untimed open.
    calls = []

    def fake_video_capture(*args):
        calls.append(args)
        if len(args) == 3:
            raise TypeError("VideoCapture() takes at most 2 arguments")
        return _FakeCap()

    monkeypatch.setattr(cv2, "VideoCapture", fake_video_capture)

    manager = StreamManager()
    stream = manager.add_stream(7, "rtsp://example/stream")
    assert await manager._connect_stream(stream) is True
    assert [len(c) for c in calls] == [3, 1]
    assert stream._capture is not None


@pytest.mark.asyncio
async def test_connect_uses_default_backend_for_device_index(monkeypatch):
    calls = []

    def fake_video_capture(*args):
        calls.append(args)
        return _FakeCap()

    monkeypatch.setattr(cv2, "VideoCapture", fake_video_capture)

    manager = StreamManager()
    stream = manager.add_stream(
        8, "0", protocol=StreamProtocol.USB, camera_type=CameraType.USB_CAMERA
    )
    assert await manager._connect_stream(stream) is True
    assert calls == [(0,)]


# --- Orchestration: file sources loop at EOF without alerting ---------------


def test_is_file_source_from_protocol_and_url_shape():
    manager = StreamManager()
    assert manager._is_file_source(
        manager.add_stream(20, "C:/videos/loop.mp4", protocol=StreamProtocol.FILE)
    )
    # Registered without an explicit protocol the URL falls back to RTSP
    # (stream_sync.protocol_for_url), so the URL shape must decide.
    assert manager._is_file_source(manager.add_stream(21, "videos/loop.avi"))
    assert not manager._is_file_source(manager.add_stream(22, "rtsp://example/s"))
    assert not manager._is_file_source(manager.add_stream(23, "rtmp://example/s"))
    assert not manager._is_file_source(manager.add_stream(24, "https://example/s"))
    assert not manager._is_file_source(
        manager.add_stream(25, "0", protocol=StreamProtocol.USB)
    )


@pytest.mark.asyncio
async def test_file_source_eof_reopens_without_offline_alert(monkeypatch):
    manager = StreamManager()
    manager._running = True
    stream = manager.add_stream(
        9, "C:/videos/loop.mp4", protocol=StreamProtocol.FILE
    )

    capture = FakeCapture()
    connects = []
    offline = []

    async def fake_connect(s):
        connects.append(1)
        capture.released = False
        s._capture = capture
        s.status = StreamStatus.ACTIVE
        return True

    monkeypatch.setattr(manager, "_connect_stream", fake_connect)
    monkeypatch.setattr(manager, "_record_camera_offline", offline.append)
    monkeypatch.setattr(stream_manager_module, "_FILE_REOPEN_DELAY_SECONDS", 0)

    task = asyncio.create_task(manager._stream_loop(9))
    for _ in range(500):
        if len(connects) >= 3:
            break
        await asyncio.sleep(0.01)
    stream._running = False
    manager._running = False
    await asyncio.wait_for(task, timeout=5)

    assert len(connects) >= 3  # each EOF loop-around re-opened the file
    assert offline == []  # routine EOF must not fire CAMERA_OFFLINE
    assert stream.reconnect_attempts == 0  # backoff path never entered
