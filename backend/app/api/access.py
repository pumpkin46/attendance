from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.middleware.tenant import apply_tenant_filter
from app.models.access import AccessEvent, AccessPoint, DefaultAction, DeviceType
from app.schemas.access import (
    AccessConfigResponse,
    AccessPointCreate,
    AccessPointOut,
    ExecuteRequest,
)
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1", tags=["access"])

ACCESS_ACTIONS = {
    "unlock_door": "Unlock door",
    "lock_door": "Lock door",
    "open_turnstile": "Open turnstile",
    "open_gate": "Open gate",
}

ACCESS_DEVICE_TYPES = {
    "door": "Door",
    "turnstile": "Turnstile",
    "gate": "Gate",
}


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _format_access_point(ap: AccessPoint) -> dict:
    data = AccessPointOut.model_validate(ap, from_attributes=True).model_dump()
    data["device_type"] = _enum_value(ap.device_type)
    data["default_action"] = _enum_value(ap.default_action)
    data["camera"] = (
        {"id": ap.camera.id, "name": ap.camera.name} if ap.camera is not None else None
    )
    return data


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


@router.get("/access-points")
async def list_access_points(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("cameras.manage"),
):
    stmt = (
        select(AccessPoint)
        .options(selectinload(AccessPoint.camera))
        .order_by(AccessPoint.name)
    )
    stmt = apply_tenant_filter(stmt, org_id, AccessPoint.organization_id)
    points = list((await db.execute(stmt)).scalars().all())
    return [_format_access_point(ap) for ap in points]


@router.post("/access-points", response_model=AccessPointOut, status_code=status.HTTP_201_CREATED)
async def create_access_point(
    body: AccessPointCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    if org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization context required")

    try:
        device_type = DeviceType(body.device_type)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid device type") from exc

    try:
        default_action = DefaultAction(body.default_action)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid default action") from exc

    ap = AccessPoint(
        organization_id=org_id,
        name=body.name,
        location_id=body.location_id,
        camera_id=body.camera_id,
        device_type=device_type,
        default_action=default_action,
        controller_url=body.controller_url,
        require_liveness=body.require_liveness
        if body.require_liveness is not None
        else settings.liveness_enabled,
        min_confidence=body.min_confidence
        if body.min_confidence is not None
        else settings.attendance_min_confidence,
    )
    db.add(ap)
    await db.flush()
    await db.refresh(ap, attribute_names=["camera"])

    await log_action(
        db,
        user_id=user.id,
        action="access_point.created",
        entity_type="access_point",
        entity_id=ap.id,
        ip_address=request.client.host if request.client else None,
        new_values=body.model_dump(),
    )
    return _format_access_point(ap)


@router.post("/access-points/{ap_id}/execute")
async def execute_access_action(
    ap_id: int,
    body: ExecuteRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    stmt = select(AccessPoint).where(AccessPoint.id == ap_id)
    stmt = apply_tenant_filter(stmt, org_id, AccessPoint.organization_id)
    result = await db.execute(stmt)
    ap = result.scalar_one_or_none()
    if not ap:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Access point not found")

    action = body.action or _enum_value(ap.default_action)

    event = AccessEvent(
        access_point_id=ap.id,
        action=action,
        granted=True,
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(event)
    await db.flush()

    await log_action(
        db,
        user_id=user.id,
        action="access_point.executed",
        entity_type="access_point",
        entity_id=ap.id,
        ip_address=request.client.host if request.client else None,
        new_values={"action": action},
    )
    return {"success": True, "action": action, "access_point_id": ap.id}
