from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.schemas.access import (
    AccessConfigResponse,
    AccessExecuteResponse,
    AccessPointCreate,
    AccessPointWithCamera,
    ExecuteRequest,
    FaceGrantRequest,
    FaceGrantResponse,
)
from app.services import access_service

router = APIRouter(prefix="/api/v1", tags=["access"])

ACCESS_ACTIONS = {
    "unlock_door": "Unlock door",
    "lock_door": "Lock door",
    "open_turnstile": "Open turnstile",
    "open_gate": "Open gate",
}

ACCESS_DEVICE_TYPES = {"door": "Door", "turnstile": "Turnstile", "gate": "Gate"}


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/access-points/config", response_model=AccessConfigResponse)
async def get_access_config(user: CurrentUser):
    return AccessConfigResponse(
        actions=ACCESS_ACTIONS,
        device_types=ACCESS_DEVICE_TYPES,
        grant_conditions={
            "face_recognized": True,
            "liveness_passed": settings.liveness_enabled,
            "access_authorized": True,
        },
    )


@router.get("/access-points", response_model=list[AccessPointWithCamera])
async def list_access_points(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("cameras.manage"),
):
    return await access_service.list_access_points(db, org_id)


@router.post("/access-points", response_model=AccessPointWithCamera, status_code=status.HTTP_201_CREATED)
async def create_access_point(
    body: AccessPointCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    return await access_service.create_access_point(
        db, org_id, body, user_id=user.id, ip_address=_ip(request)
    )


@router.post("/access-points/{ap_id}/execute", response_model=AccessExecuteResponse)
async def execute_access_action(
    ap_id: int,
    body: ExecuteRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    return await access_service.execute_action(
        db, ap_id, org_id, body, user_id=user.id, ip_address=_ip(request)
    )


@router.post("/access-points/{ap_id}/face-grant", response_model=FaceGrantResponse)
async def face_grant_access(
    ap_id: int,
    body: FaceGrantRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    return await access_service.face_grant(db, ap_id, org_id, body)
