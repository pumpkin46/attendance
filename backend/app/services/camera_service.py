"""Camera management, health, heartbeat, and frame capture."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import invalidate_prefix
from app.core.config import settings
from app.core.errors import NotFoundError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.camera import Camera, CameraHealthLog
from app.models.location import Location
from app.realtime.hub import emit
from app.schemas.camera import CameraCreate, CameraMonitoringSummary, CameraUpdate, CaptureResult
from app.services.monitoring_service import _camera_is_online, _format_camera
from app.services.stream_capture import capture_stream_frame


def _online_threshold() -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=settings.camera_online_threshold_seconds)


async def _get_camera_or_404(db: AsyncSession, camera_id: int, org_id: int | None) -> Camera:
    stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .where(Camera.id == camera_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    camera = (await db.execute(stmt)).scalar_one_or_none()
    if not camera:
        raise NotFoundError("Camera not found")
    return camera


async def _generate_device_id(db: AsyncSession, name: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-") or "CAMERA"
    candidate = base
    suffix = 1
    while True:
        existing = await db.execute(select(Camera.id).where(Camera.device_id == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def monitoring_summary(db: AsyncSession, org_id: int | None) -> CameraMonitoringSummary:
    threshold = _online_threshold()
    stmt = select(Camera).join(Location, Camera.location_id == Location.id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    cameras = list((await db.execute(stmt)).scalars().all())

    online = offline = 0
    camera_list = []
    for cam in cameras:
        is_online = cam.last_heartbeat_at is not None and cam.last_heartbeat_at >= threshold
        if is_online:
            online += 1
        else:
            offline += 1
        camera_list.append({
            "id": cam.id,
            "name": cam.name,
            "status": "online" if is_online else "offline",
            "last_heartbeat_at": cam.last_heartbeat_at.isoformat() if cam.last_heartbeat_at else None,
        })

    return CameraMonitoringSummary(
        total_cameras=len(cameras), online=online, offline=offline, cameras=camera_list
    )


def cameras_query(org_id: int | None) -> Select:
    stmt = select(Camera).join(Location, Camera.location_id == Location.id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    return stmt.order_by(Camera.id.desc())


def format_monitoring_camera(camera: Camera) -> dict:
    return _format_camera(
        camera, _camera_is_online(camera, _online_threshold()), recognition_today=0
    )


async def create_camera(db: AsyncSession, body: CameraCreate) -> Camera:
    data = body.model_dump()
    data["device_id"] = data.get("device_id") or await _generate_device_id(db, body.name)
    camera = Camera(**data)
    db.add(camera)
    await db.flush()
    await db.refresh(camera)
    await invalidate_prefix("cache:cameras:")
    return camera


async def get_camera(db: AsyncSession, camera_id: int, org_id: int | None) -> Camera:
    return await _get_camera_or_404(db, camera_id, org_id)


async def update_camera(
    db: AsyncSession, camera_id: int, org_id: int | None, body: CameraUpdate
) -> Camera:
    camera = await _get_camera_or_404(db, camera_id, org_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(camera, field, value)
    await db.flush()
    await db.refresh(camera)
    await invalidate_prefix("cache:cameras:")
    return camera


async def delete_camera(db: AsyncSession, camera_id: int, org_id: int | None) -> None:
    camera = await _get_camera_or_404(db, camera_id, org_id)
    await db.delete(camera)
    await invalidate_prefix("cache:cameras:")


def health_query(camera_id: int) -> Select:
    return (
        select(CameraHealthLog)
        .where(CameraHealthLog.camera_id == camera_id)
        .order_by(CameraHealthLog.recorded_at.desc())
    )


async def heartbeat(db: AsyncSession, camera_id: int, org_id: int | None) -> Camera:
    camera = await _get_camera_or_404(db, camera_id, org_id)
    camera.last_heartbeat_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(camera)

    event_org_id = org_id
    if event_org_id is None:
        loc = await db.execute(
            select(Location.organization_id).where(Location.id == camera.location_id)
        )
        event_org_id = loc.scalar_one_or_none()
    await emit(event_org_id, "cameras.changed", {"camera_id": camera.id})
    return camera


async def capture_frame(db: AsyncSession, camera_id: int, org_id: int | None) -> CaptureResult:
    camera = await _get_camera_or_404(db, camera_id, org_id)
    if not camera.stream_url:
        raise ValidationError("Camera has no stream URL configured")
    capture = await run_in_threadpool(capture_stream_frame, camera.stream_url)
    return CaptureResult(
        success=capture["success"], image=capture.get("image"), error=capture.get("error")
    )
