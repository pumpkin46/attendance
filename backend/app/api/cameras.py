from __future__ import annotations

import math

from fastapi import APIRouter, status

from app.core.cache import cached_json
from app.core.config import settings
from app.core.dependencies import (
    CurrentUser,
    DbSession,
    TenantOrgId,
    TenantScope,
    require_permission,
)
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
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
from app.schemas.monitoring import MonitoringCameraOut
from app.services import camera_service

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
async def get_camera_monitoring(db: DbSession, user: CurrentUser, org_id: TenantScope):
    return await camera_service.monitoring_summary(db, org_id)


@router.get("/cameras", response_model=PaginatedResponse[MonitoringCameraOut])
async def list_cameras(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantScope,
    pagination: PaginationDep,
):
    # Cap is small (settings.max_cameras), so cache the whole formatted per-org
    # list once and paginate in memory — turns N page queries into one cached
    # read. Invalidated on camera create/update/delete; online-status drift from
    # heartbeats is bounded by the TTL.
    async def compute_all() -> list[dict]:
        stmt = camera_service.cameras_query(org_id)
        rows = list((await db.execute(stmt)).scalars().all())
        return [camera_service.format_monitoring_camera(c) for c in rows]

    items = await cached_json(
        f"cache:cameras:{org_id}", settings.cache_cameras_ttl_seconds, compute_all
    )

    total = len(items)
    start = (pagination.page - 1) * pagination.per_page
    data = items[start : start + pagination.per_page]
    last_page = max(1, math.ceil(total / pagination.per_page))
    return PaginatedResponse(
        data=data,
        current_page=pagination.page,
        last_page=last_page,
        per_page=pagination.per_page,
        total=total,
    )


@router.post("/cameras", response_model=CameraOut, status_code=status.HTTP_201_CREATED)
async def create_camera(
    body: CameraCreate,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId = None,
):
    camera = await camera_service.create_camera(db, org_id, body)
    return CameraOut.model_validate(camera, from_attributes=True)


@router.get("/cameras/{camera_id}", response_model=CameraOut)
async def get_camera(camera_id: int, db: DbSession, user: CurrentUser, org_id: TenantScope):
    camera = await camera_service.get_camera(db, camera_id, org_id)
    return CameraOut.model_validate(camera, from_attributes=True)


@router.put("/cameras/{camera_id}", response_model=CameraOut)
async def update_camera(
    camera_id: int,
    body: CameraUpdate,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId = None,
):
    camera = await camera_service.update_camera(db, camera_id, org_id, body)
    return CameraOut.model_validate(camera, from_attributes=True)


@router.delete("/cameras/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(
    camera_id: int,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId = None,
):
    await camera_service.delete_camera(db, camera_id, org_id)


@router.get("/cameras/{camera_id}/health", response_model=PaginatedResponse[CameraHealthLogOut])
async def get_camera_health(
    camera_id: int,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantScope,
    pagination: PaginationDep,
):
    stmt = camera_service.health_query(camera_id)
    return await paginate(db, stmt, pagination.page, pagination.per_page, CameraHealthLogOut)


@router.post("/cameras/{camera_id}/heartbeat", response_model=CameraOut)
async def camera_heartbeat(camera_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    camera = await camera_service.heartbeat(db, camera_id, org_id)
    return CameraOut.model_validate(camera, from_attributes=True)


@router.post("/cameras/{camera_id}/capture", response_model=CaptureResult)
async def capture_camera_frame(
    camera_id: int,
    db: DbSession,
    user: require_permission("cameras.manage"),
    org_id: TenantScope = None,
):
    return await camera_service.capture_frame(db, camera_id, org_id)
