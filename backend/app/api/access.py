from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.access import AccessEvent, AccessPoint, DefaultAction, DeviceType
from app.models.employee import Employee
from app.models.visitor import Visitor
from app.schemas.access import (
    AccessConfigResponse,
    AccessExecuteResponse,
    AccessPointCreate,
    AccessPointOut,
    AccessPointWithCamera,
    ExecuteRequest,
    FaceGrantRequest,
    FaceGrantResponse,
)
from app.services import face_service
from app.services.audit_service import log_action
from app.services import visitor_service
from app.services.live_event_service import create_live_event

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


def _format_access_point(ap: AccessPoint) -> AccessPointWithCamera:
    data = AccessPointOut.model_validate(ap, from_attributes=True).model_dump()
    data["device_type"] = _enum_value(ap.device_type)
    data["default_action"] = _enum_value(ap.default_action)
    camera = (
        {"id": ap.camera.id, "name": ap.camera.name} if ap.camera is not None else None
    )
    return AccessPointWithCamera(**data, camera=camera)


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
    stmt = (
        select(AccessPoint)
        .options(selectinload(AccessPoint.camera))
        .order_by(AccessPoint.name)
    )
    stmt = apply_tenant_filter(stmt, org_id, AccessPoint.organization_id)
    points = list((await db.execute(stmt)).scalars().all())
    return [_format_access_point(ap) for ap in points]


@router.post("/access-points", response_model=AccessPointWithCamera, status_code=status.HTTP_201_CREATED)
async def create_access_point(
    body: AccessPointCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")

    try:
        device_type = DeviceType(body.device_type)
    except ValueError as exc:
        raise ValidationError("Invalid device type") from exc

    try:
        default_action = DefaultAction(body.default_action)
    except ValueError as exc:
        raise ValidationError("Invalid default action") from exc

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


@router.post("/access-points/{ap_id}/execute", response_model=AccessExecuteResponse)
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
        raise NotFoundError("Access point not found")

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
    return AccessExecuteResponse(success=True, action=action, access_point_id=ap.id)


@router.post("/access-points/{ap_id}/face-grant", response_model=FaceGrantResponse)
async def face_grant_access(
    ap_id: int,
    body: FaceGrantRequest,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("cameras.manage"),
):
    """Identify face at a door and grant access for employees or visitors."""
    stmt = select(AccessPoint).where(AccessPoint.id == ap_id)
    stmt = apply_tenant_filter(stmt, org_id, AccessPoint.organization_id)
    ap = (await db.execute(stmt)).scalar_one_or_none()
    if not ap or not ap.is_active:
        raise NotFoundError("Access point not found")

    require_liveness = (
        body.require_liveness if body.require_liveness is not None else ap.require_liveness
    )
    result = await run_in_threadpool(
        face_service.identify, body.image, require_liveness=require_liveness
    )
    identity = result.get("employee_id")
    confidence = result.get("confidence", 0.0)
    liveness_passed = result.get("liveness_passed", False)
    processing_ms = result.get("processing_ms", 0)
    action = _enum_value(ap.default_action)
    now = datetime.now(timezone.utc)

    if not result.get("success") or not identity:
        event = AccessEvent(
            access_point_id=ap.id,
            action=action,
            granted=False,
            deny_reason=result.get("reason") or "Face not recognized",
            confidence=confidence,
            liveness_passed=liveness_passed,
            occurred_at=now,
        )
        db.add(event)
        await db.flush()
        return FaceGrantResponse(
            granted=False,
            deny_reason="Face not recognized",
            confidence=confidence,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
        )

    if confidence < float(ap.min_confidence):
        event = AccessEvent(
            access_point_id=ap.id,
            action=action,
            granted=False,
            deny_reason="Confidence below threshold",
            confidence=confidence,
            liveness_passed=liveness_passed,
            occurred_at=now,
        )
        db.add(event)
        await db.flush()
        return FaceGrantResponse(
            granted=False,
            deny_reason="Confidence below threshold",
            confidence=confidence,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
        )

    # Visitor access
    if str(identity).startswith("visitor-"):
        visitor_id = int(str(identity).replace("visitor-", ""))
        visitor = await db.get(Visitor, visitor_id)
        granted = False
        deny = "Visitor not found"
        if visitor and visitor.organization_id == ap.organization_id:
            granted, deny = await visitor_service.verify_visitor_door_access(db, visitor, ap)
            if granted and body.pin_code and visitor.pin_code != body.pin_code:
                granted, deny = False, "Invalid PIN"
            if granted and body.badge_number and visitor.badge_number != body.badge_number:
                granted, deny = False, "Invalid badge"

        event = AccessEvent(
            access_point_id=ap.id,
            visitor_id=visitor_id if visitor else None,
            action=action,
            granted=granted if visitor else False,
            deny_reason=deny,
            confidence=confidence,
            liveness_passed=liveness_passed,
            occurred_at=now,
        )
        db.add(event)
        await db.flush()

        if visitor and granted:
            await visitor_service.grant_visitor_zone_access(db, visitor, ap)
            await create_live_event(
                db=db,
                organization_id=ap.organization_id,
                event_type="visitor.access_granted",
                message=f"Visitor {visitor.name} granted access at {ap.name}",
                visitor_id=visitor.id,
            )

        return FaceGrantResponse(
            granted=bool(visitor and granted),
            action=action if visitor and granted else None,
            identity_type="visitor",
            identity_id=str(identity),
            visitor_id=visitor_id,
            confidence=confidence,
            liveness_passed=liveness_passed,
            deny_reason=deny,
            processing_ms=processing_ms,
        )

    # Employee access
    try:
        employee_id = int(identity)
    except (TypeError, ValueError):
        event = AccessEvent(
            access_point_id=ap.id,
            action=action,
            granted=False,
            deny_reason="Unknown identity",
            confidence=confidence,
            liveness_passed=liveness_passed,
            occurred_at=now,
        )
        db.add(event)
        await db.flush()
        return FaceGrantResponse(
            granted=False,
            deny_reason="Unknown identity",
            confidence=confidence,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
        )

    employee = await db.get(Employee, employee_id)
    granted = employee is not None and employee.is_active and employee.organization_id == ap.organization_id
    deny = None if granted else "Employee not authorized"

    event = AccessEvent(
        access_point_id=ap.id,
        employee_id=employee_id if granted else None,
        action=action,
        granted=granted,
        deny_reason=deny,
        confidence=confidence,
        liveness_passed=liveness_passed,
        occurred_at=now,
    )
    db.add(event)
    await db.flush()

    if granted:
        await create_live_event(
            db=db,
            organization_id=ap.organization_id,
            event_type="access.granted",
            message=f"Employee {employee.full_name} granted access at {ap.name}",
            payload={"employee_id": employee_id},
        )

    return FaceGrantResponse(
        granted=granted,
        action=action if granted else None,
        identity_type="employee",
        identity_id=str(employee_id),
        employee_id=employee_id if granted else None,
        confidence=confidence,
        liveness_passed=liveness_passed,
        deny_reason=deny,
        processing_ms=processing_ms,
    )

