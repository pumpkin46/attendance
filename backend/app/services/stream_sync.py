"""Keeps the engine's in-memory stream registry in sync with the cameras table.

The StreamManager holds streams only in process memory, so registrations are
lost on every restart or dev reload. The cameras table is the durable source
of truth: the engine hydrates from it on start, and the streams/add endpoint
persists stream settings back to it.

Sync is additive: streams registered directly on the manager (tests, ad-hoc
API use) are left alone; only cameras whose URL changed are re-registered.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.stream_manager import (
    CameraType,
    StreamManager,
    StreamMode,
    StreamProtocol,
    get_stream_manager,
)
from app.models.camera import Camera, CameraStatus
from app.models.location import Location

logger = logging.getLogger(__name__)

# cameras.camera_type (admin-facing value) → engine camera type
_DB_CAMERA_TYPES: dict[str, CameraType] = {
    "rtsp": CameraType.IP_CAMERA,
    "ip": CameraType.IP_CAMERA,
    "usb": CameraType.USB_CAMERA,
    "nvr": CameraType.NVR_CUSTOM,
    "cctv": CameraType.CCTV_DIGITAL,
    "mobile": CameraType.MOBILE_ANDROID,
}


def protocol_for_url(
    url: str, fallback: StreamProtocol = StreamProtocol.RTSP
) -> StreamProtocol:
    """Derive the stream protocol from the URL; a bare device index means USB."""
    u = url.strip().lower()
    if u.isdigit():
        return StreamProtocol.USB
    for scheme, proto in (
        ("rtsp://", StreamProtocol.RTSP),
        ("rtmp://", StreamProtocol.RTMP),
        ("https://", StreamProtocol.HTTPS),
        ("http://", StreamProtocol.HTTP),
    ):
        if u.startswith(scheme):
            return proto
    return fallback


def register_camera(
    manager: StreamManager,
    camera: Camera,
    organization_id: int | None,
    *,
    protocol: StreamProtocol | None = None,
    mode: StreamMode = StreamMode.LIVE_STREAM,
) -> None:
    """Register a camera row's stream in the in-memory manager."""
    url = camera.stream_url or ""
    fallback = (
        StreamProtocol.USB if camera.camera_type == "usb" else StreamProtocol.RTSP
    )
    manager.add_stream(
        camera_id=camera.id,
        stream_url=url,
        protocol=protocol or protocol_for_url(url, fallback),
        camera_type=_DB_CAMERA_TYPES.get(camera.camera_type, CameraType.IP_CAMERA),
        mode=mode,
        organization_id=organization_id,
        location_id=camera.location_id,
        zone=camera.zone,
        direction=camera.direction.value,
        target_fps=camera.target_fps or 30,
        resolution=(camera.resolution_width or 1920, camera.resolution_height or 1080),
    )


async def sync_streams_from_db(db: AsyncSession) -> int:
    """Register every active camera that has a stream URL.

    Returns the number of cameras now backed by a registered stream. Cameras
    already registered with the same URL are left untouched (their capture
    loop may be running); a changed URL stops the old stream and re-registers.
    """
    manager = get_stream_manager()
    rows = await db.execute(
        select(Camera, Location.organization_id)
        .join(Location, Camera.location_id == Location.id)
        .where(
            Camera.is_active.is_(True),
            Camera.status == CameraStatus.active,
            Camera.stream_url.is_not(None),
            Camera.stream_url != "",
        )
    )
    count = 0
    for camera, organization_id in rows.all():
        count += 1
        existing = manager.get_stream(camera.id)
        if existing is not None:
            if existing.stream_url == camera.stream_url:
                continue
            manager.remove_stream(camera.id)
        register_camera(manager, camera, organization_id)
        logger.info("Registered stream for camera %d from DB", camera.id)
    return count
