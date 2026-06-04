from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginationParams, paginate, PaginationDep
from app.middleware.tenant import apply_tenant_filter
from app.models.camera import Camera, CameraHealthLog
from app.models.location import Location
from app.realtime.hub import emit
from app.schemas.camera import (
    CAMERA_STATUSES,
    CAMERA_TYPES,
    CAMERA_ZONES,
    CameraConfigResponse,
    CameraCreate,
    CameraHealthLogOut,
    CameraMonitoringSummary,
    CameraOut,
    CameraUpdate,
    CaptureResult,
)
from app.api.monitoring import _camera_is_online, _format_camera
from app.services.stream_capture import capture_stream_frame

router = APIRouter(prefix="/api/v1", tags=["cameras"])


@router.get("/cameras/config", response_model=CameraConfigResponse)
async def get_camera_config(user: CurrentUser):
    return CameraConfigResponse(
        poll_interval_seconds=settings.camera_stream_poll_interval_seconds,
        online_threshold_seconds=settings.camera_online_threshold_seconds,
        health_log_retention_days=settings.camera_health_log_retention_days,
        health_log_interval_seconds=settings.camera_health_log_interval_seconds,
        max_cameras=settings.max_cameras,
        camera_types=CAMERA_TYPES,
        zones=CAMERA_ZONES,
        statuses=CAMERA_STATUSES,
    )


@router.get("/cameras/monitoring", response_model=CameraMonitoringSummary)
async def get_camera_monitoring(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    threshold = datetime.now(timezone.utc) - timedelta(seconds=settings.camera_online_threshold_seconds)

    stmt = select(Camera).join(Location, Camera.location_id == Location.id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)

    result = await db.execute(stmt)
    cameras = list(result.scalars().all())

    online = 0
    offline = 0
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
        total_cameras=len(cameras),
        online=online,
        offline=offline,
        cameras=camera_list,
    )


@router.get("/cameras")
async def list_cameras(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = select(Camera).join(Location, Camera.location_id == Location.id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    stmt = stmt.order_by(Camera.id.desc())
    threshold = datetime.now(timezone.utc) - timedelta(
        seconds=settings.camera_online_threshold_seconds
    )
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page["data"] = [
        _format_camera(c, _camera_is_online(c, threshold), recognition_today=0)
        for c in page["data"]
    ]
    return page


@router.post("/cameras", response_model=CameraOut, status_code=status.HTTP_201_CREATED)
async def create_camera(
    body: CameraCreate,
    db: DbSession,
    user: require_permission("cameras.manage"),
):
    camera = Camera(**body.model_dump())
    db.add(camera)
    await db.flush()
    await db.refresh(camera)
    return CameraOut.model_validate(camera, from_attributes=True)


@router.get("/cameras/{camera_id}", response_model=CameraOut)
async def get_camera(
    camera_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .where(Camera.id == camera_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    return CameraOut.model_validate(camera, from_attributes=True)


@router.put("/cameras/{camera_id}", response_model=CameraOut)
async def update_camera(
    camera_id: int,
    body: CameraUpdate,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId = None,
):
    stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .where(Camera.id == camera_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(camera, field, value)

    await db.flush()
    await db.refresh(camera)
    return CameraOut.model_validate(camera, from_attributes=True)


@router.delete("/cameras/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(
    camera_id: int,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId = None,
):
    stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .where(Camera.id == camera_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    await db.delete(camera)


@router.get("/cameras/{camera_id}/health")
async def get_camera_health(
    camera_id: int,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = (
        select(CameraHealthLog)
        .where(CameraHealthLog.camera_id == camera_id)
        .order_by(CameraHealthLog.recorded_at.desc())
    )
    return await paginate(db, stmt, pagination.page, pagination.per_page, CameraHealthLogOut)


@router.post("/cameras/{camera_id}/heartbeat", response_model=CameraOut)
async def camera_heartbeat(
    camera_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .where(Camera.id == camera_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")

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

    return CameraOut.model_validate(camera, from_attributes=True)


@router.post("/cameras/{camera_id}/capture", response_model=CaptureResult)
async def capture_camera_frame(
    camera_id: int,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId = None,
):
    stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .where(Camera.id == camera_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    if not camera.stream_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Camera has no stream URL configured")

    capture = capture_stream_frame(camera.stream_url)
    return CaptureResult(
        success=capture["success"],
        image=capture.get("image"),
        error=capture.get("error"),
    )
