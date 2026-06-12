"""
Stage 1: Video Acquisition — Multi-camera stream manager.

Supports:
- Webcam (USB 2.0/3.0, built-in, HD, 4K)
- IP Cameras (RTSP, RTMP, HTTP/HTTPS Stream, ONVIF)
- NVR Systems (Hikvision, Dahua, Uniview, Axis, Custom)
- CCTV (Analog, Digital, Hybrid)
- Mobile Devices (Android, iOS, Tablet)
- Resolutions: 720p, 1080p, 1440p, 4K
"""

from __future__ import annotations

import asyncio
import base64
import enum
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

import cv2
import numpy as np

from app.engine.config import engine_config
from app.services.stream_capture import is_network_stream_url, open_network_capture

logger = logging.getLogger(__name__)

# Reads that return False this many times in a row are treated as a lost
# connection and routed through the reconnect/backoff path.
_READ_FAILURE_STREAK = 5

# A looping local-file source re-opens at EOF after this fixed delay: long
# enough not to spin on a corrupt/unreadable file, short enough that the loop
# restarts without a visible gap (no offline alert, no exponential backoff).
_FILE_REOPEN_DELAY_SECONDS = 0.5

# Cap on health.errors so a flapping camera cannot grow the list unboundedly.
_MAX_HEALTH_ERRORS = 50


class StreamProtocol(enum.Enum):
    RTSP = "rtsp"
    RTMP = "rtmp"
    HTTP = "http"
    HTTPS = "https"
    ONVIF = "onvif"
    USB = "usb"
    WEBCAM = "webcam"
    MOBILE = "mobile"
    FILE = "file"


class StreamStatus(enum.Enum):
    CONNECTING = "connecting"
    ACTIVE = "active"
    DEGRADED = "degraded"
    INTERRUPTED = "interrupted"
    OFFLINE = "offline"
    ERROR = "error"


class CameraType(enum.Enum):
    WEBCAM_USB = "webcam_usb"
    WEBCAM_BUILTIN = "webcam_builtin"
    WEBCAM_HD = "webcam_hd"
    WEBCAM_4K = "webcam_4k"
    USB_CAMERA = "usb_camera"
    IP_CAMERA = "ip_camera"
    NVR_HIKVISION = "nvr_hikvision"
    NVR_DAHUA = "nvr_dahua"
    NVR_UNIVIEW = "nvr_uniview"
    NVR_AXIS = "nvr_axis"
    NVR_CUSTOM = "nvr_custom"
    CCTV_ANALOG = "cctv_analog"
    CCTV_DIGITAL = "cctv_digital"
    CCTV_HYBRID = "cctv_hybrid"
    MOBILE_ANDROID = "mobile_android"
    MOBILE_IOS = "mobile_ios"
    MOBILE_TABLET = "mobile_tablet"


class StreamMode(enum.Enum):
    LIVE_STREAM = "live_stream"
    PHOTO_UPLOAD = "photo_upload"
    MANUAL_VERIFICATION = "manual_verification"


@dataclass
class StreamHealth:
    fps: float = 0.0
    latency_ms: int = 0
    resolution: tuple[int, int] = (0, 0)
    dropped_frames: int = 0
    total_frames: int = 0
    last_frame_at: datetime | None = None
    started_at: datetime | None = None
    uptime_seconds: float = 0.0
    quality_score: float = 0.0
    errors: list[str] = field(default_factory=list)

    @property
    def is_healthy(self) -> bool:
        cfg = engine_config.stream
        return (
            self.fps >= cfg.min_fps
            and self.latency_ms < cfg.max_latency_ms
            and self.quality_score >= 0.5
        )


@dataclass
class CameraStream:
    camera_id: int
    stream_url: str
    protocol: StreamProtocol
    camera_type: CameraType
    mode: StreamMode = StreamMode.LIVE_STREAM
    status: StreamStatus = StreamStatus.OFFLINE
    health: StreamHealth = field(default_factory=StreamHealth)
    organization_id: int | None = None
    location_id: int | None = None
    zone: str | None = None
    direction: str = "both"
    target_fps: int = 30
    resolution: tuple[int, int] = (1920, 1080)
    reconnect_attempts: int = 0
    _capture: Any = field(default=None, repr=False)
    _task: Any = field(default=None, repr=False)
    _running: bool = False
    # Most recent decoded frame, kept so the API can serve a live snapshot without
    # opening the camera a second time (which would conflict with this loop —
    # especially for USB devices that allow only one reader).
    _last_frame: Any = field(default=None, repr=False)
    _last_processed: float = 0.0


FrameCallback = Callable[[int, np.ndarray, float], Coroutine[Any, Any, None]]


def _safe_release(capture: Any) -> None:
    try:
        if capture is not None:
            capture.release()
    except Exception:
        pass


def _drain_and_release(fut: "asyncio.Future", capture: Any) -> None:
    """Done-callback for an abandoned read: consume the outcome (so asyncio
    does not log 'exception was never retrieved') and release the capture.
    By the time this runs the thread call has returned, so release cannot
    race an in-flight read."""
    try:
        fut.result()
    except (asyncio.CancelledError, Exception):
        pass
    _safe_release(capture)


def _release_open_result(fut: "asyncio.Future") -> None:
    """Done-callback for an abandoned open: release the constructed capture
    (if any) instead of orphaning its RTSP session."""
    try:
        cap = fut.result()
    except (asyncio.CancelledError, Exception):
        return
    _safe_release(cap)


class StreamManager:
    """Manages multiple camera streams with health monitoring and auto-reconnect."""

    def __init__(self) -> None:
        self._streams: dict[int, CameraStream] = {}
        self._frame_callbacks: list[FrameCallback] = []
        self._running = False
        self._monitor_task: asyncio.Task | None = None

    @property
    def active_streams(self) -> int:
        return sum(1 for s in self._streams.values() if s.status == StreamStatus.ACTIVE)

    @property
    def total_streams(self) -> int:
        return len(self._streams)

    def register_callback(self, callback: FrameCallback) -> None:
        # Equality (not identity) check: bound methods are recreated on each
        # attribute access, so `is` would never catch a re-registration of
        # engine._process_frame on a double start.
        if callback in self._frame_callbacks:
            logger.debug("Frame callback already registered; skipping")
            return
        self._frame_callbacks.append(callback)

    def get_stream(self, camera_id: int) -> CameraStream | None:
        return self._streams.get(camera_id)

    def add_stream(
        self,
        camera_id: int,
        stream_url: str,
        *,
        protocol: StreamProtocol = StreamProtocol.RTSP,
        camera_type: CameraType = CameraType.IP_CAMERA,
        mode: StreamMode = StreamMode.LIVE_STREAM,
        organization_id: int | None = None,
        location_id: int | None = None,
        zone: str | None = None,
        direction: str = "both",
        target_fps: int = 30,
        resolution: tuple[int, int] = (1920, 1080),
    ) -> CameraStream:
        stream = CameraStream(
            camera_id=camera_id,
            stream_url=stream_url,
            protocol=protocol,
            camera_type=camera_type,
            mode=mode,
            organization_id=organization_id,
            location_id=location_id,
            zone=zone,
            direction=direction,
            target_fps=target_fps,
            resolution=resolution,
        )
        self._streams[camera_id] = stream
        logger.info("Added stream for camera %d: %s (%s)", camera_id, protocol.value, camera_type.value)
        return stream

    def remove_stream(self, camera_id: int) -> None:
        """Remove a stream. Safe to call from sync contexts.

        Signals the read loop to stop and removes the stream from the registry.
        The loop releases its own VideoCapture in its finally block (within one
        read timeout) — we must NOT release it here, because the loop may be
        mid-``read()`` on a worker thread and cv2 is not thread-safe.
        """
        stream = self._streams.pop(camera_id, None)
        if stream:
            stream._running = False
            # If the loop never started, no task owns the capture — but in that
            # case _capture is None anyway (it is created inside the loop), so
            # there is nothing to release here.
            logger.info("Removed stream for camera %d", camera_id)

    async def start(self) -> None:
        self._running = True
        for camera_id, stream in self._streams.items():
            if stream.mode != StreamMode.LIVE_STREAM:
                continue
            # Never spawn a second loop over a live one: two loops would share
            # one capture (the release-vs-read race) and double-process frames.
            if stream._task and not stream._task.done():
                logger.debug("Camera %d: stream loop already running; not respawning", camera_id)
                continue
            stream.reconnect_attempts = 0
            stream._task = asyncio.create_task(self._stream_loop(camera_id))
        if self._monitor_task is None or self._monitor_task.done():
            self._monitor_task = asyncio.create_task(self._health_monitor())
        logger.info("Stream manager started with %d streams", len(self._streams))

    async def stop(self) -> None:
        self._running = False
        for stream in self._streams.values():
            stream._running = False
        # Let each loop finish its current read and release its own capture.
        await asyncio.gather(
            *(self._await_stream_task(s) for s in self._streams.values()),
            return_exceptions=True,
        )
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except (asyncio.CancelledError, Exception):
                pass
            self._monitor_task = None
        logger.info("Stream manager stopped")

    async def start_stream(self, camera_id: int) -> bool:
        stream = self._streams.get(camera_id)
        if not stream:
            return False
        if stream._task and not stream._task.done():
            return True
        stream.reconnect_attempts = 0
        stream._task = asyncio.create_task(self._stream_loop(camera_id))
        return True

    async def stop_stream(self, camera_id: int) -> bool:
        stream = self._streams.get(camera_id)
        if not stream:
            return False
        # Signal the loop to stop, then wait for it to exit and release its own
        # capture. Never release here while a read may be in flight.
        stream._running = False
        await self._await_stream_task(stream)
        stream.status = StreamStatus.OFFLINE
        return True

    async def _await_stream_task(self, stream: CameraStream) -> None:
        """Wait for a stream's read loop to finish, force-cancelling if it hangs.

        The loop owns its VideoCapture and releases it on exit, so by the time
        this returns the capture is released with no read in flight.
        """
        task = stream._task
        if task is None or task.done():
            stream._task = None
            return
        grace = engine_config.stream.stop_grace_seconds
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=grace)
        except asyncio.TimeoutError:
            # Read genuinely stuck past the FFmpeg read timeout — cancel it.
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        except (asyncio.CancelledError, Exception):
            pass
        finally:
            stream._task = None

    def snapshot_jpeg(self, camera_id: int, max_width: int = 960) -> bytes | None:
        """JPEG-encode the most recent frame of a running stream (for live preview).

        Returns None if the stream is unknown or hasn't produced a frame yet
        (e.g. registered but not started). Never opens the device itself.
        """
        stream = self._streams.get(camera_id)
        if stream is None or stream._last_frame is None:
            return None
        frame = stream._last_frame  # local ref; loop may reassign concurrently
        h, w = frame.shape[:2]
        if w > max_width:
            scale = max_width / float(w)
            frame = cv2.resize(frame, (max_width, max(1, int(h * scale))))
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else None

    def capture_frame(self, stream_url: str, warmup_frames: int = 5) -> dict:
        """Capture a single frame from a stream URL (for photo upload mode)."""
        started = time.perf_counter()
        if is_network_stream_url(stream_url):
            cfg = engine_config.stream
            cap = open_network_capture(
                stream_url, cfg.open_timeout_ms, cfg.read_timeout_ms
            )
        else:
            # Device index or local file: default backend, no timeouts needed.
            cap = cv2.VideoCapture(stream_url)
        if not cap.isOpened():
            return {
                "success": False,
                "error": "Cannot open stream",
                "processing_ms": int((time.perf_counter() - started) * 1000),
            }
        try:
            for _ in range(max(warmup_frames, 1)):
                cap.grab()
            ok, frame = cap.read()
            if not ok or frame is None:
                return {
                    "success": False,
                    "error": "Failed to read frame",
                    "processing_ms": int((time.perf_counter() - started) * 1000),
                }
            h, w = frame.shape[:2]
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not ok:
                return {
                    "success": False,
                    "error": "Failed to encode frame",
                    "processing_ms": int((time.perf_counter() - started) * 1000),
                }
            b64 = base64.b64encode(buf.tobytes()).decode("ascii")
            return {
                "success": True,
                "image": b64,
                "frame": frame,
                "width": w,
                "height": h,
                "processing_ms": int((time.perf_counter() - started) * 1000),
            }
        finally:
            cap.release()

    def get_stream_status(self, camera_id: int) -> dict | None:
        stream = self._streams.get(camera_id)
        if not stream:
            return None
        return {
            "camera_id": camera_id,
            "status": stream.status.value,
            "protocol": stream.protocol.value,
            "camera_type": stream.camera_type.value,
            "mode": stream.mode.value,
            "health": {
                "fps": round(stream.health.fps, 2),
                "latency_ms": stream.health.latency_ms,
                "resolution": stream.health.resolution,
                "dropped_frames": stream.health.dropped_frames,
                "total_frames": stream.health.total_frames,
                "uptime_seconds": stream.health.uptime_seconds,
                "is_healthy": stream.health.is_healthy,
            },
        }

    def get_all_status(self) -> dict:
        return {
            "total_streams": self.total_streams,
            "active_streams": self.active_streams,
            "streams": {
                str(cam_id): self.get_stream_status(cam_id)
                for cam_id in self._streams
            },
        }

    async def _stream_loop(self, camera_id: int) -> None:
        stream = self._streams.get(camera_id)
        if not stream:
            return

        stream._running = True
        stream.status = StreamStatus.CONNECTING
        cfg = engine_config.stream
        read_failures = 0

        try:
            while stream._running and self._running:
                try:
                    if not stream._capture or not stream._capture.isOpened():
                        if not await self._connect_stream(stream):
                            await self._reconnect_backoff(stream)
                            continue
                        read_failures = 0

                    t0 = time.perf_counter()
                    capture = stream._capture
                    read_fut = asyncio.ensure_future(asyncio.to_thread(capture.read))
                    try:
                        # Shield so a force-cancel does not mark read_fut done
                        # while the worker thread is still inside read().
                        ok, frame = await asyncio.shield(read_fut)
                    except asyncio.CancelledError:
                        # The thread may still be mid-read(); releasing now
                        # would race it (cv2 is not thread-safe). Defer the
                        # release to when the read actually returns, and null
                        # the capture so the finally below skips it.
                        stream._capture = None
                        read_fut.add_done_callback(
                            lambda fut, cap=capture: _drain_and_release(fut, cap)
                        )
                        raise
                    latency = int((time.perf_counter() - t0) * 1000)

                    if not ok or frame is None:
                        stream.health.dropped_frames += 1
                        stream.status = StreamStatus.INTERRUPTED
                        read_failures += 1
                        if read_failures < _READ_FAILURE_STREAK:
                            continue
                        # Persistent read failure. Release is safe: this read
                        # has returned, so no call is in flight on a worker
                        # thread.
                        read_failures = 0
                        self._release_capture(stream)
                        if self._is_file_source(stream):
                            # EOF on a looping local file is routine, not an
                            # outage: re-open without the offline alert or
                            # exponential backoff.
                            await asyncio.sleep(_FILE_REOPEN_DELAY_SECONDS)
                            continue
                        # Treat like a failed open so backoff, the attempt
                        # counter, and the offline alert all apply.
                        await self._reconnect_backoff(stream)
                        continue

                    read_failures = 0
                    stream.health.total_frames += 1
                    stream.health.latency_ms = latency
                    stream.health.last_frame_at = datetime.now(timezone.utc)
                    stream.health.resolution = (frame.shape[1], frame.shape[0])
                    stream.reconnect_attempts = 0
                    stream._last_frame = frame

                    if stream.health.started_at:
                        elapsed = (datetime.now(timezone.utc) - stream.health.started_at).total_seconds()
                        stream.health.uptime_seconds = elapsed
                        if elapsed > 0:
                            stream.health.fps = stream.health.total_frames / elapsed

                    self._validate_stream(stream)

                    # Analyze at process_fps, not stream fps: frames keep flowing
                    # for preview/health, but recognition only sees a bounded rate.
                    now = time.perf_counter()
                    if now - stream._last_processed >= 1.0 / max(cfg.process_fps, 1):
                        stream._last_processed = now
                        timestamp = time.time()
                        for callback in self._frame_callbacks:
                            try:
                                await callback(camera_id, frame, timestamp)
                            except Exception as e:
                                logger.error("Frame callback error for camera %d: %s", camera_id, e)

                    frame_interval = 1.0 / max(stream.target_fps, 1)
                    await asyncio.sleep(max(0, frame_interval - (time.perf_counter() - t0)))

                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error("Stream loop error for camera %d: %s", camera_id, e)
                    stream.status = StreamStatus.ERROR
                    stream.health.errors.append(str(e))
                    del stream.health.errors[:-_MAX_HEALTH_ERRORS]
                    # A read exception means the thread call has returned, so
                    # release is safe; route into the same backoff/alert path
                    # as a failed open.
                    read_failures = 0
                    self._release_capture(stream)
                    await self._reconnect_backoff(stream)
        finally:
            # The loop exclusively owns release() of its own capture, so stop
            # paths only signal _running=False and never race this. (After a
            # cancelled read the capture is already nulled and its release is
            # owned by the read's done-callback.)
            self._release_capture(stream)
            stream.status = StreamStatus.OFFLINE
            stream.health.fps = 0.0
            stream.health.latency_ms = 0

    def _release_capture(self, stream: CameraStream) -> None:
        """Release a stream's capture. Only safe when no thread call is in
        flight on it."""
        _safe_release(stream._capture)
        stream._capture = None

    def _is_file_source(self, stream: CameraStream) -> bool:
        """True for local video files, which hit EOF as a matter of course.

        The FILE protocol is decisive, and device/network protocols that are
        only ever set explicitly are never files. RTSP, however, is also the
        fallback protocol for unrecognized URLs (stream_sync.protocol_for_url),
        so otherwise the URL shape decides: not a network scheme and not a
        digit device index means a local path.
        """
        if stream.protocol == StreamProtocol.FILE:
            return True
        if stream.protocol in (
            StreamProtocol.ONVIF,
            StreamProtocol.USB,
            StreamProtocol.WEBCAM,
            StreamProtocol.MOBILE,
        ):
            return False
        url = stream.stream_url.strip()
        return not url.isdigit() and not is_network_stream_url(url)

    async def _reconnect_backoff(self, stream: CameraStream) -> None:
        """Shared reconnect branch for open failures, read-failure streaks,
        and read exceptions.

        Capped exponential backoff, retrying indefinitely: a routine NVR
        reboot / network blip must self-heal instead of stopping attendance
        until a manual restart. Fires the CAMERA_OFFLINE alert on the first
        attempt of an outage and zeroes live health numbers so the monitor
        stops reporting stale-good fps/latency for a dead camera.
        """
        cfg = engine_config.stream
        stream.reconnect_attempts += 1
        if stream.reconnect_attempts == 1:
            self._record_camera_offline(stream.camera_id)
        stream.status = StreamStatus.INTERRUPTED
        stream.health.fps = 0.0
        stream.health.latency_ms = 0
        backoff = min(
            cfg.reconnect_interval_seconds * (2 ** (stream.reconnect_attempts - 1)),
            cfg.max_reconnect_interval_seconds,
        )
        logger.warning(
            "Camera %d: reconnect attempt %d failed; retrying in %ds",
            stream.camera_id,
            stream.reconnect_attempts,
            backoff,
        )
        await asyncio.sleep(backoff)

    def _record_camera_offline(self, camera_id: int) -> None:
        """Emit a CAMERA_OFFLINE alert (best effort)."""
        try:
            from app.engine.metrics import get_metrics

            get_metrics().record_camera_offline(camera_id)
        except Exception:  # never let metrics break the stream loop
            logger.debug("record_camera_offline failed for camera %d", camera_id, exc_info=True)

    async def _connect_stream(self, stream: CameraStream) -> bool:
        try:
            url = stream.stream_url
            if stream.protocol == StreamProtocol.USB:
                url = int(url) if url.isdigit() else url
            elif stream.protocol == StreamProtocol.WEBCAM:
                url = int(url) if url.isdigit() else 0

            cfg = engine_config.stream

            def _open():
                # FFmpeg open/read timeouts so a dead network source can't
                # block read() forever in a worker thread (which would also
                # make clean shutdown impossible). A timed open that fails is
                # an offline camera: it falls straight into backoff below --
                # never retried untimed, which would hang on the same host.
                if is_network_stream_url(url):
                    return open_network_capture(
                        url, cfg.open_timeout_ms, cfg.read_timeout_ms
                    )
                # Local device index or non-network source: default backend.
                return cv2.VideoCapture(url)

            open_fut = asyncio.ensure_future(asyncio.to_thread(_open))
            try:
                cap = await asyncio.shield(open_fut)
            except asyncio.CancelledError:
                # Force-cancel landed mid-open: release whatever capture the
                # thread constructs instead of orphaning the RTSP session.
                open_fut.add_done_callback(_release_open_result)
                raise
            if not cap.isOpened():
                _safe_release(cap)
                stream.status = StreamStatus.ERROR
                return False

            if stream.resolution[0] > 0:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, stream.resolution[0])
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, stream.resolution[1])

            stream._capture = cap
            stream.status = StreamStatus.ACTIVE
            stream.health.started_at = datetime.now(timezone.utc)
            stream.health.total_frames = 0
            stream.health.dropped_frames = 0
            logger.info("Camera %d connected: %s", stream.camera_id, stream.protocol.value)
            return True

        except Exception as e:
            logger.error("Failed to connect camera %d: %s", stream.camera_id, e)
            stream.status = StreamStatus.ERROR
            return False

    def _validate_stream(self, stream: CameraStream) -> None:
        cfg = engine_config.stream
        health = stream.health

        if health.fps < cfg.min_fps and health.total_frames > 30:
            stream.status = StreamStatus.DEGRADED
        elif health.latency_ms > cfg.max_latency_ms:
            stream.status = StreamStatus.DEGRADED
        else:
            stream.status = StreamStatus.ACTIVE

        total = health.total_frames or 1
        drop_rate = health.dropped_frames / total
        quality = 1.0 - drop_rate
        if health.fps > 0:
            quality *= min(1.0, health.fps / cfg.min_fps)
        if health.latency_ms > 0:
            quality *= min(1.0, cfg.max_latency_ms / max(health.latency_ms, 1))
        health.quality_score = max(0.0, min(1.0, quality))

    async def _health_monitor(self) -> None:
        cfg = engine_config.stream
        while self._running:
            await asyncio.sleep(cfg.health_check_interval_seconds)
            try:
                from app.engine.metrics import get_metrics

                metrics = get_metrics()
            except Exception:
                metrics = None

            for camera_id, stream in list(self._streams.items()):
                # Surface live fps/latency to the metrics collector (which fires
                # HIGH_LATENCY alerts) for every stream that has produced frames.
                if metrics is not None and stream.health.last_frame_at:
                    try:
                        metrics.record_camera_health(
                            camera_id, stream.health.fps, stream.health.latency_ms
                        )
                    except Exception:
                        pass

                if stream.status == StreamStatus.OFFLINE:
                    continue
                if stream.health.last_frame_at:
                    elapsed = (
                        datetime.now(timezone.utc) - stream.health.last_frame_at
                    ).total_seconds()
                    if elapsed > cfg.health_check_interval_seconds * 2:
                        stream.status = StreamStatus.INTERRUPTED
                        logger.warning("Camera %d: no frames for %.0fs", camera_id, elapsed)
                        # Restart a read loop that died (task finished) while the
                        # stream is still supposed to be running.
                        if (
                            self._running
                            and stream.mode == StreamMode.LIVE_STREAM
                            and (stream._task is None or stream._task.done())
                        ):
                            logger.info("Camera %d: restarting dead stream loop", camera_id)
                            stream._task = asyncio.create_task(self._stream_loop(camera_id))


_stream_manager: StreamManager | None = None


def get_stream_manager() -> StreamManager:
    global _stream_manager
    if _stream_manager is None:
        _stream_manager = StreamManager()
    return _stream_manager
