from __future__ import annotations

import json
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.employee import Employee
from app.models.visitor import (
    ApprovalStatus,
    BlacklistReason,
    DocumentType,
    IdType,
    NotificationChannel,
    VisitType,
    Visitor,
    VisitorAccessPermission,
    VisitorBadge,
    VisitorBlacklist,
    VisitorCategory,
    VisitorCheckin,
    VisitorCheckout,
    VisitorFace,
    VisitorHost,
    VisitorLog,
    VisitorNotification,
    VisitorStatus,
)
from app.services import face_service


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_visitor_code() -> str:
    return f"V-{secrets.token_hex(4).upper()}"


def _generate_check_in_code() -> str:
    code = secrets.token_urlsafe(9)
    return code[:12] if len(code) > 12 else code


def _generate_badge_number() -> str:
    return f"{settings.visitor_badge_prefix}{secrets.randbelow(999999):06d}"


def _generate_pin_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def _visitor_identity_id(visitor_id: int) -> str:
    return f"visitor-{visitor_id}"


def _resolve_name(body: dict) -> tuple[str | None, str | None, str]:
    first = body.get("first_name")
    last = body.get("last_name")
    name = body.get("name")
    if first and last:
        return first, last, f"{first} {last}"
    if name:
        parts = name.strip().split(None, 1)
        if len(parts) == 2:
            return parts[0], parts[1], name.strip()
        return name.strip(), None, name.strip()
    raise ValueError("Name or first_name/last_name required")


async def check_blacklist(
    db: AsyncSession, org_id: int, name: str, id_number: str | None = None
) -> VisitorBlacklist | None:
    stmt = select(VisitorBlacklist).where(
        VisitorBlacklist.organization_id == org_id,
        VisitorBlacklist.is_active == True,  # noqa: E712
    )
    conditions = [VisitorBlacklist.name.ilike(name)]
    if id_number:
        conditions.append(VisitorBlacklist.id_number == id_number)
    stmt = stmt.where(or_(*conditions))
    return (await db.execute(stmt)).scalar_one_or_none()


async def log_visitor_event(
    db: AsyncSession,
    visitor_id: int,
    event_type: str,
    description: str | None = None,
    user_id: int | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        VisitorLog(
            visitor_id=visitor_id,
            event_type=event_type,
            description=description,
            user_id=user_id,
            meta=json.dumps(meta) if meta else None,
        )
    )


async def notify_host(
    db: AsyncSession,
    visitor: Visitor,
    event_type: str,
    message: str,
    channel: NotificationChannel = NotificationChannel.email,
) -> None:
    if not visitor.host_employee_id:
        return
    db.add(
        VisitorNotification(
            visitor_id=visitor.id,
            recipient_employee_id=visitor.host_employee_id,
            event_type=event_type,
            channel=channel,
            message=message,
            sent_at=_now(),
            status="sent",
        )
    )


def _parse_enum(enum_cls, value):
    if value is None:
        return None
    if isinstance(value, enum_cls):
        return value
    return enum_cls(value)


async def create_visitor(
    db: AsyncSession,
    org_id: int,
    body: dict,
    *,
    user_id: int | None = None,
    pre_registered: bool = False,
) -> Visitor:
    first_name, last_name, full_name = _resolve_name(body)

    blocked = await check_blacklist(
        db, org_id, full_name, body.get("id_number") or body.get("national_id_number")
    )
    if blocked:
        raise ValueError(f"Visitor is blacklisted: {blocked.reason.value}")

    now = _now()
    visit_start = body.get("visit_start_at") or now
    visit_end = body.get("visit_end_at") or (
        visit_start + timedelta(hours=settings.visitor_default_visit_hours)
    )

    requires_approval = pre_registered or body.get("visitor_category") == "pre_registered"
    approval_status = ApprovalStatus.pending if requires_approval else ApprovalStatus.approved
    status = VisitorStatus.pending_approval if requires_approval else VisitorStatus.scheduled

    visitor = Visitor(
        organization_id=org_id,
        visitor_code=_generate_visitor_code(),
        first_name=first_name,
        last_name=last_name,
        name=full_name,
        photo_url=body.get("photo_url"),
        gender=body.get("gender"),
        date_of_birth=body.get("date_of_birth"),
        nationality=body.get("nationality"),
        language=body.get("language"),
        phone=body.get("phone"),
        email=body.get("email"),
        emergency_contact=body.get("emergency_contact"),
        emergency_phone=body.get("emergency_phone"),
        id_type=_parse_enum(IdType, body.get("id_type")),
        id_number=body.get("id_number"),
        id_expiration_date=body.get("id_expiration_date"),
        passport_number=body.get("passport_number"),
        driving_license_number=body.get("driving_license_number"),
        national_id_number=body.get("national_id_number"),
        company=body.get("company"),
        job_title=body.get("job_title"),
        department=body.get("department"),
        business_category=body.get("business_category"),
        website=body.get("website"),
        visitor_category=_parse_enum(
            VisitorCategory, body.get("visitor_category")
        ) or VisitorCategory.walk_in,
        purpose=body.get("purpose"),
        visit_type=_parse_enum(VisitType, body.get("visit_type")),
        visit_description=body.get("visit_description"),
        meeting_subject=body.get("meeting_subject"),
        expected_duration_minutes=body.get("expected_duration_minutes"),
        visit_priority=body.get("visit_priority"),
        host_employee_id=body.get("host_employee_id"),
        pre_registered_by_user_id=user_id if pre_registered else None,
        visit_start_at=visit_start,
        visit_end_at=visit_end,
        expected_arrival=body.get("expected_arrival") or visit_start,
        expected_departure=body.get("expected_departure") or visit_end,
        check_in_code=_generate_check_in_code(),
        badge_number=_generate_badge_number(),
        pin_code=_generate_pin_code(),
        status=status,
        approval_status=approval_status,
        contract_start_date=body.get("contract_start_date"),
        contract_end_date=body.get("contract_end_date"),
        safety_training_status=body.get("safety_training_status"),
        work_permit_number=body.get("work_permit_number"),
        vehicle_number=body.get("vehicle_number"),
        vehicle_type=body.get("vehicle_type"),
        parking_zone=body.get("parking_zone"),
        driver_info=body.get("driver_info"),
    )
    db.add(visitor)
    await db.flush()

    if visitor.host_employee_id:
        db.add(
            VisitorHost(
                visitor_id=visitor.id,
                employee_id=visitor.host_employee_id,
                is_primary=True,
            )
        )

    badge = VisitorBadge(
        visitor_id=visitor.id,
        badge_number=visitor.badge_number,
        qr_code_data=f"VISITOR:{visitor.id}:{visitor.check_in_code}",
        barcode_data=visitor.badge_number,
        expires_at=visit_end,
        access_zones=body.get("access_zones"),
    )
    db.add(badge)

    access_zones = body.get("access_zones")
    if access_zones:
        zones = [z.strip() for z in access_zones.split(",") if z.strip()]
        if zones:
            await set_access_permissions(db, visitor, zones)

    await log_visitor_event(
        db, visitor.id, "created", f"Visitor {full_name} registered", user_id
    )
    await db.refresh(visitor)
    return visitor


async def enroll_visitor_face(
    db: AsyncSession,
    visitor: Visitor,
    image: str,
    *,
    method: str = "webcam",
) -> dict:
    identity = _visitor_identity_id(visitor.id)
    result = face_service.enroll(identity, image)
    if result.get("success"):
        visitor.face_registered = True
        visitor.ai_identity_id = identity
        expires_at = visitor.face_expires_at or (
            visitor.visit_end_at + timedelta(minutes=settings.visitor_face_expiry_buffer_minutes)
        )
        db.add(
            VisitorFace(
                visitor_id=visitor.id,
                embedding_id=identity,
                enrollment_method=method,
                is_active=True,
                expires_at=expires_at,
            )
        )
        await log_visitor_event(
            db, visitor.id, "face_enrolled", f"Face enrolled via {method}"
        )
        await db.flush()
    return result


async def check_in_visitor(
    db: AsyncSession,
    visitor: Visitor,
    *,
    user_id: int | None = None,
    method: str = "manual",
) -> Visitor:
    if visitor.status == VisitorStatus.checked_in:
        raise ValueError("Visitor already checked in")
    if visitor.approval_status not in (ApprovalStatus.approved, ApprovalStatus.security_approved):
        raise ValueError("Visitor not approved for check-in")

    now = _now()
    visitor.status = VisitorStatus.checked_in
    visitor.checked_in_at = now
    if not visitor.visit_end_at or visitor.visit_end_at < now:
        visitor.visit_end_at = now + timedelta(hours=settings.visitor_default_visit_hours)
    visitor.face_expires_at = visitor.visit_end_at + timedelta(
        minutes=settings.visitor_face_expiry_buffer_minutes
    )
    visitor.current_zone = "Reception"

    db.add(
        VisitorCheckin(
            visitor_id=visitor.id,
            checked_in_at=now,
            checked_in_by_user_id=user_id,
            method=method,
        )
    )
    await log_visitor_event(db, visitor.id, "checked_in", f"Checked in via {method}", user_id)
    await notify_host(
        db,
        visitor,
        "visitor_checked_in",
        f"Visitor {visitor.name} has checked in.",
    )
    await db.flush()
    await db.refresh(visitor)
    return visitor


async def check_out_visitor(
    db: AsyncSession,
    visitor: Visitor,
    *,
    user_id: int | None = None,
    method: str = "manual",
    notes: str | None = None,
) -> Visitor:
    if visitor.status != VisitorStatus.checked_in:
        raise ValueError("Visitor is not checked in")

    now = _now()
    visitor.status = VisitorStatus.checked_out
    visitor.checked_out_at = now
    visitor.current_zone = None

    db.add(
        VisitorCheckout(
            visitor_id=visitor.id,
            checked_out_at=now,
            checked_out_by_user_id=user_id,
            method=method,
            notes=notes,
        )
    )

    identity = _visitor_identity_id(visitor.id)
    face_service.delete_employee(identity)
    visitor.face_registered = False
    visitor.ai_identity_id = None
    visitor.face_expires_at = now

    for face in (await db.execute(
        select(VisitorFace).where(
            VisitorFace.visitor_id == visitor.id, VisitorFace.is_active == True  # noqa: E712
        )
    )).scalars():
        face.is_active = False

    for badge in (await db.execute(
        select(VisitorBadge).where(
            VisitorBadge.visitor_id == visitor.id, VisitorBadge.is_active == True  # noqa: E712
        )
    )).scalars():
        badge.is_active = False

    await log_visitor_event(
        db, visitor.id, "checked_out", f"Checked out via {method}", user_id
    )
    await notify_host(
        db,
        visitor,
        "visitor_checked_out",
        f"Visitor {visitor.name} has checked out.",
    )
    await db.flush()
    await db.refresh(visitor)
    return visitor


async def reject_visitor(
    db: AsyncSession,
    visitor: Visitor,
    *,
    user_id: int | None = None,
    notes: str | None = None,
) -> Visitor:
    visitor.approval_status = ApprovalStatus.rejected
    visitor.status = VisitorStatus.cancelled
    await log_visitor_event(
        db, visitor.id, "approval_rejected", notes or "Visit rejected", user_id
    )
    await db.flush()
    await db.refresh(visitor)
    return visitor


async def get_pending_approvals(db: AsyncSession, org_id: int) -> list[Visitor]:
    stmt = (
        select(Visitor)
        .where(
            Visitor.organization_id == org_id,
            Visitor.status == VisitorStatus.pending_approval,
        )
        .order_by(Visitor.created_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def set_access_permissions(
    db: AsyncSession,
    visitor: Visitor,
    zones: list[str],
) -> list[VisitorAccessPermission]:
    await db.execute(
        delete(VisitorAccessPermission).where(
            VisitorAccessPermission.visitor_id == visitor.id
        )
    )
    await db.flush()

    perms = []
    expires = visitor.visit_end_at
    for zone in zones:
        zone = zone.strip()
        if not zone:
            continue
        perm = VisitorAccessPermission(
            visitor_id=visitor.id,
            zone_name=zone,
            granted=True,
            expires_at=expires,
        )
        db.add(perm)
        perms.append(perm)
    await db.flush()
    return perms


async def approve_visitor(
    db: AsyncSession,
    visitor: Visitor,
    stage: str,
    *,
    user_id: int | None = None,
    notes: str | None = None,
) -> Visitor:
    stage_map = {
        "manager": ApprovalStatus.manager_approved,
        "security": ApprovalStatus.security_approved,
        "final": ApprovalStatus.approved,
    }
    new_status = stage_map.get(stage)
    if not new_status:
        raise ValueError("Invalid approval stage")

    visitor.approval_status = new_status
    visitor.approval_notes = notes
    if new_status == ApprovalStatus.approved:
        visitor.status = VisitorStatus.scheduled
    await log_visitor_event(
        db, visitor.id, f"approval_{stage}", notes or f"Approved at {stage} stage", user_id
    )
    await db.flush()
    await db.refresh(visitor)
    return visitor


async def expire_visitors(db: AsyncSession) -> int:
    """Expire visitors past visit end or face expiry; purge temporary face access."""
    now = _now()
    stmt = select(Visitor).where(
        Visitor.status.in_([VisitorStatus.checked_in, VisitorStatus.scheduled]),
        or_(
            Visitor.face_expires_at <= now,
            Visitor.visit_end_at <= now,
            and_(
                Visitor.contract_end_date.isnot(None),
                Visitor.contract_end_date < now.date(),
            ),
        ),
    )
    visitors = list((await db.execute(stmt)).scalars())
    count = 0
    for visitor in visitors:
        identity = _visitor_identity_id(visitor.id)
        face_service.delete_employee(identity)
        visitor.face_registered = False
        visitor.ai_identity_id = None
        visitor.status = VisitorStatus.expired
        visitor.face_expires_at = now

        for face in (await db.execute(
            select(VisitorFace).where(
                VisitorFace.visitor_id == visitor.id, VisitorFace.is_active == True  # noqa: E712
            )
        )).scalars():
            face.is_active = False

        for badge in (await db.execute(
            select(VisitorBadge).where(
                VisitorBadge.visitor_id == visitor.id, VisitorBadge.is_active == True  # noqa: E712
            )
        )).scalars():
            badge.is_active = False

        await log_visitor_event(
            db, visitor.id, "expired", "Visitor access expired automatically"
        )
        await notify_host(
            db,
            visitor,
            "visitor_access_expired",
            f"Visitor {visitor.name} access has expired.",
        )
        count += 1

    if count:
        await db.flush()
    return count


async def get_dashboard_stats(db: AsyncSession, org_id: int) -> dict:
    now = _now()
    base = select(func.count()).select_from(Visitor).where(Visitor.organization_id == org_id)

    on_site = (await db.execute(
        base.where(Visitor.status == VisitorStatus.checked_in)
    )).scalar() or 0

    expected = (await db.execute(
        base.where(
            Visitor.status == VisitorStatus.scheduled,
            Visitor.visit_start_at <= now + timedelta(hours=24),
            Visitor.visit_end_at >= now,
        )
    )).scalar() or 0

    checked_in_today = (await db.execute(
        base.where(
            Visitor.checked_in_at >= now.replace(hour=0, minute=0, second=0, microsecond=0)
        )
    )).scalar() or 0

    checked_out_today = (await db.execute(
        base.where(
            Visitor.checked_out_at >= now.replace(hour=0, minute=0, second=0, microsecond=0)
        )
    )).scalar() or 0

    overdue = (await db.execute(
        base.where(
            Visitor.status == VisitorStatus.checked_in,
            Visitor.visit_end_at < now,
        )
    )).scalar() or 0

    pending = (await db.execute(
        base.where(Visitor.status == VisitorStatus.pending_approval)
    )).scalar() or 0

    return {
        "on_site": on_site,
        "expected": expected,
        "checked_in_today": checked_in_today,
        "checked_out_today": checked_out_today,
        "overdue": overdue,
        "pending_approval": pending,
    }


async def get_active_visitors(db: AsyncSession, org_id: int) -> list[Visitor]:
    stmt = (
        select(Visitor)
        .where(
            Visitor.organization_id == org_id,
            Visitor.status == VisitorStatus.checked_in,
        )
        .order_by(Visitor.checked_in_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_daily_report(db: AsyncSession, org_id: int, report_date: date | None = None) -> dict:
    d = report_date or _now().date()
    day_start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    base = select(Visitor).where(
        Visitor.organization_id == org_id,
        Visitor.created_at >= day_start,
        Visitor.created_at < day_end,
    )
    visitors = list((await db.execute(base)).scalars().all())
    return {
        "date": d.isoformat(),
        "total": len(visitors),
        "checked_in": sum(1 for v in visitors if v.checked_in_at and v.checked_in_at < day_end),
        "checked_out": sum(1 for v in visitors if v.checked_out_at and v.checked_out_at < day_end),
        "pending": sum(1 for v in visitors if v.status == VisitorStatus.scheduled),
        "overdue": sum(
            1 for v in visitors
            if v.status == VisitorStatus.checked_in and v.visit_end_at < _now()
        ),
    }


def format_host(employee: Employee | None) -> dict | None:
    if not employee:
        return None
    return {
        "id": employee.id,
        "first_name": employee.first_name,
        "last_name": employee.last_name,
        "employee_code": employee.employee_code,
        "department": employee.department,
        "email": employee.email,
        "job_title": employee.job_title,
    }
