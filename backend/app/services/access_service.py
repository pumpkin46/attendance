"""Access points: CRUD, manual action execution, and face-grant flow."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.errors import NotFoundError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.access import AccessEvent, AccessPoint, DefaultAction, DeviceType
from app.models.employee import Employee
from app.models.visitor import Visitor
from app.schemas.access import (
    AccessExecuteResponse,
    AccessPointCreate,
    AccessPointOut,
    AccessPointWithCamera,
    ExecuteRequest,
    FaceGrantRequest,
    FaceGrantResponse,
)
from app.services import face_service, visitor_service
from app.services.audit_service import log_action
from app.services.live_event_service import create_live_event


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def format_access_point(ap: AccessPoint) -> AccessPointWithCamera:
    data = AccessPointOut.model_validate(ap, from_attributes=True).model_dump()
    data["device_type"] = _enum_value(ap.device_type)
    data["default_action"] = _enum_value(ap.default_action)
    camera = {"id": ap.camera.id, "name": ap.camera.name} if ap.camera is not None else None
    return AccessPointWithCamera(**data, camera=camera)


async def _get_access_point_or_404(
    db: AsyncSession, ap_id: int, org_id: int | None
) -> AccessPoint:
    stmt = select(AccessPoint).where(AccessPoint.id == ap_id)
    stmt = apply_tenant_filter(stmt, org_id, AccessPoint.organization_id)
    ap = (await db.execute(stmt)).scalar_one_or_none()
    if not ap:
        raise NotFoundError("Access point not found")
    return ap


async def list_access_points(
    db: AsyncSession, org_id: int | None
) -> list[AccessPointWithCamera]:
    stmt = (
        select(AccessPoint)
        .options(selectinload(AccessPoint.camera))
        .order_by(AccessPoint.name)
    )
    stmt = apply_tenant_filter(stmt, org_id, AccessPoint.organization_id)
    points = list((await db.execute(stmt)).scalars().all())
    return [format_access_point(ap) for ap in points]


async def create_access_point(
    db: AsyncSession,
    org_id: int | None,
    body: AccessPointCreate,
    *,
    user_id: int,
    ip_address: str | None,
) -> AccessPointWithCamera:
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
        user_id=user_id,
        action="access_point.created",
        entity_type="access_point",
        entity_id=ap.id,
        ip_address=ip_address,
        new_values=body.model_dump(),
    )
    return format_access_point(ap)


async def execute_action(
    db: AsyncSession,
    ap_id: int,
    org_id: int | None,
    body: ExecuteRequest,
    *,
    user_id: int,
    ip_address: str | None,
) -> AccessExecuteResponse:
    ap = await _get_access_point_or_404(db, ap_id, org_id)
    action = body.action or _enum_value(ap.default_action)

    db.add(
        AccessEvent(
            access_point_id=ap.id,
            action=action,
            granted=True,
            occurred_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()

    await log_action(
        db,
        user_id=user_id,
        action="access_point.executed",
        entity_type="access_point",
        entity_id=ap.id,
        ip_address=ip_address,
        new_values={"action": action},
    )
    return AccessExecuteResponse(success=True, action=action, access_point_id=ap.id)


def _deny(action: str, reason: str, *, confidence, liveness_passed, processing_ms) -> FaceGrantResponse:
    return FaceGrantResponse(
        granted=False,
        deny_reason=reason,
        confidence=confidence,
        liveness_passed=liveness_passed,
        processing_ms=processing_ms,
    )


async def face_grant(
    db: AsyncSession, ap_id: int, org_id: int | None, body: FaceGrantRequest
) -> FaceGrantResponse:
    """Identify a face at a door and grant access for employees or visitors."""
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

    def record(**kwargs):
        db.add(
            AccessEvent(
                access_point_id=ap.id,
                action=action,
                confidence=confidence,
                liveness_passed=liveness_passed,
                occurred_at=now,
                **kwargs,
            )
        )

    if not result.get("success") or not identity:
        record(granted=False, deny_reason=result.get("reason") or "Face not recognized")
        await db.flush()
        return _deny(
            action, "Face not recognized",
            confidence=confidence, liveness_passed=liveness_passed, processing_ms=processing_ms,
        )

    if confidence < float(ap.min_confidence):
        record(granted=False, deny_reason="Confidence below threshold")
        await db.flush()
        return _deny(
            action, "Confidence below threshold",
            confidence=confidence, liveness_passed=liveness_passed, processing_ms=processing_ms,
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

        record(
            visitor_id=visitor_id if visitor else None,
            granted=granted if visitor else False,
            deny_reason=deny,
        )
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
        record(granted=False, deny_reason="Unknown identity")
        await db.flush()
        return _deny(
            action, "Unknown identity",
            confidence=confidence, liveness_passed=liveness_passed, processing_ms=processing_ms,
        )

    employee = await db.get(Employee, employee_id)
    granted = (
        employee is not None
        and employee.is_active
        and employee.organization_id == ap.organization_id
    )
    deny = None if granted else "Employee not authorized"

    record(
        employee_id=employee_id if granted else None, granted=granted, deny_reason=deny
    )
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
