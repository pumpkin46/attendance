from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import (
    CurrentUser,
    DbSession,
    TenantOrgId,
    get_visitor_kiosk,
    require_permission,
)
from app.core.pagination import PaginationDep, PaginationParams, paginate
from app.core.security import generate_device_token
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.visitor import Visitor, VisitorKiosk, VisitorStatus
from app.schemas.visitor import (
    HostOut,
    KioskConfigResponse,
    VisitorCreate,
    VisitorKioskCreate,
    VisitorKioskOut,
    VisitorLookupRequest,
    VisitorOut,
    VisitorRegisterRequest,
)
from app.services import face_service
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1", tags=["visitors"])


# ── Admin Visitor Routes ──────────────────────────────────────────────────────


@router.get("/visitors")
async def list_visitors(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = select(Visitor).order_by(Visitor.id.desc())
    stmt = apply_tenant_filter(stmt, org_id, Visitor.organization_id)
    return await paginate(db, stmt, pagination.page, pagination.per_page, VisitorOut)


@router.post("/visitors", response_model=VisitorOut, status_code=status.HTTP_201_CREATED)
async def create_visitor(
    body: VisitorCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: CurrentUser,
):
    if org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization context required")

    check_in_code = _generate_check_in_code()
    badge_number = f"{settings.visitor_badge_prefix}{secrets.randbelow(999999):06d}"
    now = datetime.now(timezone.utc)
    visit_start = body.visit_start_at or now
    if body.visit_end_at:
        visit_end = body.visit_end_at
    elif body.visit_start_at:
        visit_end = body.visit_start_at + timedelta(hours=settings.visitor_default_visit_hours)
    else:
        visit_end = visit_start + timedelta(hours=settings.visitor_default_visit_hours)

    visitor = Visitor(
        organization_id=org_id,
        name=body.name,
        company=body.company,
        phone=body.phone,
        purpose=body.purpose,
        host_employee_id=body.host_employee_id,
        check_in_code=check_in_code,
        badge_number=badge_number,
        visit_start_at=visit_start,
        visit_end_at=visit_end,
        status=VisitorStatus.scheduled,
    )
    db.add(visitor)
    await db.flush()
    await db.refresh(visitor)

    await log_action(
        db,
        user_id=user.id,
        action="visitor.created",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
        new_values=body.model_dump(exclude_none=True),
    )
    return VisitorOut.model_validate(visitor, from_attributes=True)


@router.get("/visitors/{visitor_id}", response_model=VisitorOut)
async def get_visitor(
    visitor_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    return VisitorOut.model_validate(visitor, from_attributes=True)


@router.post("/visitors/{visitor_id}/enroll-face")
async def enroll_visitor_face(
    visitor_id: int,
    request: Request,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    body = await request.json()
    image = body.get("image")
    if not image:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image required")

    result = face_service.enroll(f"visitor-{visitor.id}", image)
    if result.get("success"):
        visitor.face_registered = True
        await db.flush()
    return result


@router.post("/visitors/{visitor_id}/cancel")
async def cancel_visitor(
    visitor_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: CurrentUser,
):
    visitor = await _get_visitor_or_404(db, visitor_id, org_id)
    visitor.status = VisitorStatus.cancelled
    await db.flush()
    await db.refresh(visitor)

    await log_action(
        db,
        user_id=user.id,
        action="visitor.cancelled",
        entity_type="visitor",
        entity_id=visitor.id,
        ip_address=request.client.host if request.client else None,
    )
    return VisitorOut.model_validate(visitor, from_attributes=True)


# ── Kiosk API Routes ─────────────────────────────────────────────────────────


@router.get("/kiosk/visitor/config", response_model=KioskConfigResponse)
async def kiosk_config(kiosk: VisitorKiosk = Depends(get_visitor_kiosk)):
    return KioskConfigResponse(
        default_visit_hours=settings.visitor_kiosk_default_visit_hours,
        face_expiry_buffer_minutes=settings.visitor_face_expiry_buffer_minutes,
        badge_prefix=settings.visitor_badge_prefix,
        require_face_enrollment=True,
    )


@router.get("/kiosk/visitor/hosts", response_model=list[HostOut])
async def kiosk_list_hosts(
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    stmt = select(Employee).where(
        Employee.organization_id == kiosk.organization_id,
        Employee.is_active == True,  # noqa: E712
    ).order_by(Employee.last_name, Employee.first_name)
    result = await db.execute(stmt)
    employees = result.scalars().all()
    return [
        HostOut(
            id=e.id,
            name=f"{e.first_name} {e.last_name}",
            department=e.department,
            email=e.email,
        )
        for e in employees
    ]


@router.post("/kiosk/visitor/lookup", response_model=VisitorOut)
async def kiosk_lookup_visitor(
    body: VisitorLookupRequest,
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    stmt = select(Visitor).where(
        Visitor.organization_id == kiosk.organization_id,
        Visitor.check_in_code == body.check_in_code,
    )
    result = await db.execute(stmt)
    visitor = result.scalar_one_or_none()
    if not visitor:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visitor not found")
    return VisitorOut.model_validate(visitor, from_attributes=True)


@router.post("/kiosk/visitor/register", response_model=VisitorOut, status_code=status.HTTP_201_CREATED)
async def kiosk_register_visitor(
    body: VisitorRegisterRequest,
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    now = datetime.now(timezone.utc)
    check_in_code = _generate_check_in_code()
    badge_number = f"{settings.visitor_badge_prefix}{secrets.randbelow(999999):06d}"
    expires_at = now + timedelta(hours=settings.visitor_kiosk_default_visit_hours)

    visitor = Visitor(
        organization_id=kiosk.organization_id,
        name=body.name,
        company=body.company,
        phone=body.phone,
        purpose=body.purpose,
        host_employee_id=body.host_employee_id,
        check_in_code=check_in_code,
        badge_number=badge_number,
        status=VisitorStatus.scheduled,
        visit_start_at=now,
        visit_end_at=expires_at,
    )
    db.add(visitor)
    await db.flush()
    await db.refresh(visitor)
    return VisitorOut.model_validate(visitor, from_attributes=True)


@router.post("/kiosk/visitor/identify")
async def kiosk_identify_visitor(
    request: Request,
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    body = await request.json()
    image = body.get("image")
    if not image:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image required")

    result = face_service.identify(image, require_liveness=True)
    emp_id = result.get("employee_id")
    if emp_id and str(emp_id).startswith("visitor-"):
        visitor_id = int(str(emp_id).replace("visitor-", ""))
        visitor = await db.get(Visitor, visitor_id)
        if visitor and visitor.organization_id == kiosk.organization_id:
            return {
                "found": True,
                "visitor": VisitorOut.model_validate(visitor, from_attributes=True).model_dump(),
                **result,
            }
    return {"found": False, **result}


@router.post("/kiosk/visitor/visitors/{visitor_id}/enroll-face")
async def kiosk_enroll_visitor_face(
    visitor_id: int,
    request: Request,
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    visitor = await db.get(Visitor, visitor_id)
    if not visitor or visitor.organization_id != kiosk.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visitor not found")

    body = await request.json()
    image = body.get("image")
    if not image:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image required")

    result = face_service.enroll(f"visitor-{visitor.id}", image)
    if result.get("success"):
        visitor.face_registered = True
        await db.flush()
    return result


@router.post("/kiosk/visitor/visitors/{visitor_id}/check-in", response_model=VisitorOut)
async def kiosk_check_in_visitor(
    visitor_id: int,
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    visitor = await db.get(Visitor, visitor_id)
    if not visitor or visitor.organization_id != kiosk.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visitor not found")
    if visitor.status == VisitorStatus.checked_in:
        raise HTTPException(status.HTTP_409_CONFLICT, "Visitor already checked in")

    now = datetime.now(timezone.utc)
    visitor.status = VisitorStatus.checked_in
    visitor.checked_in_at = now
    if not visitor.visit_end_at or visitor.visit_end_at < now:
        visitor.visit_end_at = now + timedelta(hours=settings.visitor_kiosk_default_visit_hours)
    visitor.face_expires_at = visitor.visit_end_at + timedelta(
        minutes=settings.visitor_face_expiry_buffer_minutes
    )
    await db.flush()
    await db.refresh(visitor)
    return VisitorOut.model_validate(visitor, from_attributes=True)


@router.post("/kiosk/visitor/heartbeat")
async def kiosk_heartbeat(
    db: DbSession,
    kiosk: VisitorKiosk = Depends(get_visitor_kiosk),
):
    kiosk.last_heartbeat_at = datetime.now(timezone.utc)
    await db.flush()
    return {"status": "ok"}


# ── Kiosk Management ─────────────────────────────────────────────────────────


def _kiosk_is_online(kiosk: VisitorKiosk) -> bool:
    if not kiosk.is_active or not kiosk.last_heartbeat_at:
        return False
    threshold = datetime.now(timezone.utc) - timedelta(
        seconds=settings.visitor_kiosk_offline_seconds
    )
    return kiosk.last_heartbeat_at >= threshold


def _format_kiosk(kiosk: VisitorKiosk) -> dict:
    data = VisitorKioskOut.model_validate(kiosk, from_attributes=True).model_dump()
    data["online"] = _kiosk_is_online(kiosk)
    return data


def _slugify_kiosk_name(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip()).strip("-").upper()
    return slug[:30] or "KIOSK"


async def _generate_kiosk_device_id(db: DbSession, name: str) -> str:
    base = f"VK-{_slugify_kiosk_name(name)}"
    candidate = base
    suffix = 1
    while True:
        exists = (
            await db.execute(select(VisitorKiosk.id).where(VisitorKiosk.device_id == candidate))
        ).scalar_one_or_none()
        if exists is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


def _kiosk_url(request: Request, plain_token: str) -> str:
    origin = request.headers.get("origin")
    if origin:
        return f"{origin.rstrip('/')}/visitor-kiosk?token={plain_token}"
    return f"/visitor-kiosk?token={plain_token}"


@router.get("/visitor-kiosks")
async def list_kiosks(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("visitor_kiosks.manage"),
):
    stmt = select(VisitorKiosk).order_by(VisitorKiosk.name)
    stmt = apply_tenant_filter(stmt, org_id, VisitorKiosk.organization_id)
    kiosks = list((await db.execute(stmt)).scalars().all())
    return [_format_kiosk(k) for k in kiosks]


@router.post("/visitor-kiosks", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_kiosk(
    body: VisitorKioskCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitor_kiosks.manage"),
):
    if org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization context required")

    plain_token, hashed_token = generate_device_token()
    device_id = await _generate_kiosk_device_id(db, body.name)
    kiosk = VisitorKiosk(
        organization_id=org_id,
        name=body.name,
        location_id=body.location_id,
        device_id=device_id,
        api_token=hashed_token,
        allow_walk_in=body.allow_walk_in,
        require_host=body.require_host,
        require_liveness=body.require_liveness,
    )
    db.add(kiosk)
    await db.flush()
    await db.refresh(kiosk)

    await log_action(
        db,
        user_id=user.id,
        action="visitor_kiosk.created",
        entity_type="visitor_kiosk",
        entity_id=kiosk.id,
        ip_address=request.client.host if request.client else None,
        new_values=body.model_dump(),
    )
    return {
        **_format_kiosk(kiosk),
        "api_token_plain": plain_token,
        "kiosk_url": _kiosk_url(request, plain_token),
    }


@router.patch("/visitor-kiosks/{kiosk_id}", response_model=VisitorKioskOut)
async def update_kiosk(
    kiosk_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitor_kiosks.manage"),
):
    stmt = select(VisitorKiosk).where(VisitorKiosk.id == kiosk_id)
    stmt = apply_tenant_filter(stmt, org_id, VisitorKiosk.organization_id)
    result = await db.execute(stmt)
    kiosk = result.scalar_one_or_none()
    if not kiosk:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kiosk not found")

    body = await request.json()
    for field in ("name", "location_id", "is_active"):
        if field in body:
            setattr(kiosk, field, body[field])
    await db.flush()
    await db.refresh(kiosk)

    await log_action(
        db,
        user_id=user.id,
        action="visitor_kiosk.updated",
        entity_type="visitor_kiosk",
        entity_id=kiosk.id,
        ip_address=request.client.host if request.client else None,
        new_values=body,
    )
    return _format_kiosk(kiosk)


@router.post("/visitor-kiosks/{kiosk_id}/regenerate-token", response_model=dict)
async def regenerate_kiosk_token(
    kiosk_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("visitor_kiosks.manage"),
):
    stmt = select(VisitorKiosk).where(VisitorKiosk.id == kiosk_id)
    stmt = apply_tenant_filter(stmt, org_id, VisitorKiosk.organization_id)
    result = await db.execute(stmt)
    kiosk = result.scalar_one_or_none()
    if not kiosk:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kiosk not found")

    plain_token, hashed_token = generate_device_token()
    kiosk.api_token = hashed_token
    await db.flush()
    await db.refresh(kiosk)

    await log_action(
        db,
        user_id=user.id,
        action="visitor_kiosk.token_regenerated",
        entity_type="visitor_kiosk",
        entity_id=kiosk.id,
        ip_address=request.client.host if request.client else None,
    )
    return {
        "id": kiosk.id,
        "api_token_plain": plain_token,
        "kiosk_url": _kiosk_url(request, plain_token),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

_CHECK_IN_CODE_LEN = 12


def _generate_check_in_code() -> str:
    """URL-safe code that fits visitors.check_in_code VARCHAR(12)."""
    code = secrets.token_urlsafe(9)
    if len(code) > _CHECK_IN_CODE_LEN:
        code = code[:_CHECK_IN_CODE_LEN]
    return code


async def _get_visitor_or_404(
    db: DbSession, visitor_id: int, org_id: int | None
) -> Visitor:
    stmt = select(Visitor).where(Visitor.id == visitor_id)
    stmt = apply_tenant_filter(stmt, org_id, Visitor.organization_id)
    result = await db.execute(stmt)
    visitor = result.scalar_one_or_none()
    if not visitor:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visitor not found")
    return visitor
