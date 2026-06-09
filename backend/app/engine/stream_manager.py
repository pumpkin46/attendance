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

logger = logging.getLogger(__name__)


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


FrameCallback = Callable[[int, np.ndarray, float], Coroutine[Any, Any, None]]


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
        self._frame_callbacks.append(callback)

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
        stream = self._streams.pop(camera_id, None)
        if stream:
            stream._running = False
            if stream._capture:
                stream._capture.release()
            logger.info("Removed stream for camera %d", camera_id)

    async def start(self) -> None:
        self._running = True
        for camera_id, stream in self._streams.items():
            if stream.mode == StreamMode.LIVE_STREAM:
                stream._task = asyncio.create_task(self._stream_loop(camera_id))
        self._monitor_task = asyncio.create_task(self._health_monitor())
        logger.info("Stream manager started with %d streams", len(self._streams))

    async def stop(self) -> None:
        self._running = False
        for stream in self._streams.values():
            stream._running = False
            if stream._capture:
                stream._capture.release()
                stream._capture = None
        if self._monitor_task:
            self._monitor_task.cancel()
        logger.info("Stream manager stopped")

    async def start_stream(self, camera_id: int) -> bool:
        stream = self._streams.get(camera_id)
        if not stream:
            return False
        if stream._task and not stream._task.done():
            return True
        stream._task = asyncio.create_task(self._stream_loop(camera_id))
        return True

    async def stop_stream(self, camera_id: int) -> bool:
        stream = self._streams.get(camera_id)
        if not stream:
            return False
        stream._running = False
        if stream._capture:
            stream._capture.release()
            stream._capture = None
        stream.status = StreamStatus.OFFLINE
        return True

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

        while stream._running and self._running:
            try:
                if not stream._capture or not stream._capture.isOpened():
                    if not await self._connect_stream(stream):
                        stream.reconnect_attempts += 1
                        if stream.reconnect_attempts > cfg.max_reconnect_attempts:
                            stream.status = StreamStatus.ERROR
                            logger.error(
                                "Camera %d: max reconnect attempts exceeded", camera_id
                            )
                            break
                        await asyncio.sleep(cfg.reconnect_interval_seconds)
                        continue

                t0 = time.perf_counter()
                ok, frame = await asyncio.to_thread(stream._capture.read)
                latency = int((time.perf_counter() - t0) * 1000)

                if not ok or frame is None:
                    stream.health.dropped_frames += 1
                    stream.status = StreamStatus.INTERRUPTED
                    if stream._capture:
                        stream._capture.release()
                        stream._capture = None
                    continue

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
                await asyncio.sleep(cfg.reconnect_interval_seconds)

        if stream._capture:
            stream._capture.release()
            stream._capture = None
        stream.status = StreamStatus.OFFLINE

    async def _connect_stream(self, stream: CameraStream) -> bool:
        try:
            url = stream.stream_url
            if stream.protocol == StreamProtocol.USB:
                url = int(url) if url.isdigit() else url
            elif stream.protocol == StreamProtocol.WEBCAM:
                url = int(url) if url.isdigit() else 0

            cap = await asyncio.to_thread(cv2.VideoCapture, url)
            if not cap.isOpened():
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
            for camera_id, stream in self._streams.items():
                if stream.status == StreamStatus.OFFLINE:
                    continue
                if stream.health.last_frame_at:
                    elapsed = (
                        datetime.now(timezone.utc) - stream.health.last_frame_at
                    ).total_seconds()
                    if elapsed > cfg.health_check_interval_seconds * 2:
                        stream.status = StreamStatus.INTERRUPTED
                        logger.warning("Camera %d: no frames for %.0fs", camera_id, elapsed)


_stream_manager: StreamManager | None = None


def get_stream_manager() -> StreamManager:
    global _stream_manager
    if _stream_manager is None:
        _stream_manager = StreamManager()
    return _stream_manager
