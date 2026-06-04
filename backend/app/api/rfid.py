from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.core.config import settings
from app.core.dependencies import (
    CurrentUser,
    DbSession,
    TenantOrgId,
    get_rfid_reader,
    require_permission,
)
from app.core.pagination import paginate, PaginationDep
from app.core.rate_limit import recognition_rate_limit
from app.core.security import generate_device_token
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.location import Location
from app.realtime.hub import emit
from app.models.rfid import RfidCard, RfidDirection, RfidEvent, RfidEventResult, RfidReader
from app.schemas.rfid import (
    DeviceTapResponse,
    EmployeeBrief,
    RfidCardCreate,
    RfidCardOut,
    RfidEventOut,
    RfidReaderCreate,
    RfidReaderOut,
    RfidReaderUpdate,
    ReaderBrief,
    SimulateRequest,
    SimulateTapResponse,
    TapRequest,
)
from app.services.attendance_service import process_rfid_tap
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1", tags=["rfid"])


# ── Reader CRUD ───────────────────────────────────────────────────────────────


@router.get("/rfid-readers", response_model=list[RfidReaderOut])
async def list_readers(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    _: require_permission("rfid.manage"),
):
    stmt = select(RfidReader).join(Location, RfidReader.location_id == Location.id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    stmt = stmt.order_by(RfidReader.name)
    result = await db.execute(stmt)
    readers = list(result.scalars().unique().all())
    tap_counts = await _taps_today_by_reader(db, [r.id for r in readers])
    threshold = _online_threshold()
    return [_format_reader(r, tap_counts.get(r.id, 0), threshold) for r in readers]


@router.post("/rfid-readers", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_reader(
    body: RfidReaderCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    device_id = body.device_id or await _generate_device_id(db, body.name)
    plain_token, hashed_token = generate_device_token()
    reader = RfidReader(
        name=body.name,
        location_id=body.location_id,
        device_id=device_id,
        direction=_parse_direction(body.direction),
        api_token=hashed_token,
    )
    db.add(reader)
    await db.flush()
    await db.refresh(reader, attribute_names=["location"])

    await log_action(
        db,
        user_id=user.id,
        action="rfid_reader.created",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=request.client.host if request.client else None,
        new_values=body.model_dump(),
    )

    out = _format_reader(reader, 0, _online_threshold())
    return {**out.model_dump(mode="json"), "api_token_plain": plain_token}


@router.get("/rfid-readers/{reader_id}", response_model=RfidReaderOut)
async def get_reader(
    reader_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    reader = await _get_reader_or_404(db, reader_id, org_id)
    tap_counts = await _taps_today_by_reader(db, [reader.id])
    return _format_reader(reader, tap_counts.get(reader.id, 0), _online_threshold())


@router.put("/rfid-readers/{reader_id}", response_model=RfidReaderOut)
async def update_reader(
    reader_id: int,
    body: RfidReaderUpdate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    reader = await _get_reader_or_404(db, reader_id, org_id)
    update_data = body.model_dump(exclude_unset=True)
    if "direction" in update_data and update_data["direction"] is not None:
        update_data["direction"] = _parse_direction(update_data["direction"])
    for field, value in update_data.items():
        setattr(reader, field, value)
    await db.flush()
    await db.refresh(reader, attribute_names=["location"])

    await log_action(
        db,
        user_id=user.id,
        action="rfid_reader.updated",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=request.client.host if request.client else None,
        new_values=update_data,
    )
    tap_counts = await _taps_today_by_reader(db, [reader.id])
    return _format_reader(reader, tap_counts.get(reader.id, 0), _online_threshold())


@router.delete("/rfid-readers/{reader_id}", status_code=status.HTTP_200_OK)
async def delete_reader(
    reader_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    reader = await _get_reader_or_404(db, reader_id, org_id)
    reader.is_active = False
    await db.flush()

    await log_action(
        db,
        user_id=user.id,
        action="rfid_reader.deactivated",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "RFID reader deactivated"}


@router.post("/rfid-readers/{reader_id}/regenerate-token", response_model=dict)
async def regenerate_reader_token(
    reader_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    reader = await _get_reader_or_404(db, reader_id, org_id)
    plain_token, hashed_token = generate_device_token()
    reader.api_token = hashed_token
    await db.flush()

    await log_action(
        db,
        user_id=user.id,
        action="rfid_reader.token_regenerated",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=request.client.host if request.client else None,
    )
    return {
        "id": reader.id,
        "api_token_plain": plain_token,
        "message": "Token regenerated. Update the physical reader with the new token.",
    }


# ── RFID Cards ────────────────────────────────────────────────────────────────


@router.get("/employees/{employee_id}/rfid-cards", response_model=list[RfidCardOut])
async def list_employee_cards(
    employee_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    await _employee_in_tenant_or_404(db, employee_id, org_id)
    stmt = (
        select(RfidCard)
        .where(RfidCard.employee_id == employee_id)
        .order_by(RfidCard.assigned_at.desc())
    )
    result = await db.execute(stmt)
    return [RfidCardOut.model_validate(c, from_attributes=True) for c in result.scalars().all()]


@router.post(
    "/employees/{employee_id}/rfid-cards",
    response_model=RfidCardOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_employee_card(
    employee_id: int,
    body: RfidCardCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    await _employee_in_tenant_or_404(db, employee_id, org_id)
    uid = body.uid.strip().upper()
    existing = await db.execute(select(RfidCard).where(RfidCard.uid == uid))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Card UID already registered")

    card = RfidCard(employee_id=employee_id, uid=uid, label=body.label)
    db.add(card)
    await db.flush()
    await db.refresh(card)

    await log_action(
        db,
        user_id=user.id,
        action="rfid_card.assigned",
        entity_type="rfid_card",
        entity_id=card.id,
        ip_address=request.client.host if request.client else None,
        new_values={"employee_id": employee_id, **body.model_dump()},
    )
    return RfidCardOut.model_validate(card, from_attributes=True)


@router.delete("/rfid-cards/{card_id}", status_code=status.HTTP_200_OK)
async def delete_card(
    card_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    stmt = (
        select(RfidCard)
        .join(Employee, RfidCard.employee_id == Employee.id)
        .where(RfidCard.id == card_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    result = await db.execute(stmt)
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RFID card not found")

    card.is_active = False
    await db.flush()

    await log_action(
        db,
        user_id=user.id,
        action="rfid_card.revoked",
        entity_type="rfid_card",
        entity_id=card.id,
        ip_address=request.client.host if request.client else None,
    )
    return {"message": "RFID card revoked"}


# ── RFID Events ───────────────────────────────────────────────────────────────


@router.get("/rfid-events")
async def list_rfid_events(
    db: DbSession,
    org_id: TenantOrgId,
    pagination: PaginationDep,
    _: require_permission("rfid.manage"),
):
    stmt = (
        select(RfidEvent)
        .join(RfidReader, RfidEvent.rfid_reader_id == RfidReader.id, isouter=True)
        .join(Location, RfidReader.location_id == Location.id, isouter=True)
        .order_by(RfidEvent.tapped_at.desc())
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page["data"] = [_format_event(e) for e in page["data"]]
    return page


# ── Simulate Tap ──────────────────────────────────────────────────────────────


@router.post("/rfid/simulate", response_model=SimulateTapResponse)
async def simulate_tap(
    body: SimulateRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    reader = await _get_reader_or_404(db, body.rfid_reader_id, org_id)
    return await _process_tap(db, body.uid, reader, body.timestamp)


# ── Device Tap Endpoint ───────────────────────────────────────────────────────


@router.post(
    "/rfid/tap",
    response_model=DeviceTapResponse,
    dependencies=[recognition_rate_limit()],
)
async def rfid_tap(
    body: TapRequest,
    db: DbSession,
    reader: RfidReader = Depends(get_rfid_reader),
):
    return await _process_tap(db, body.uid, reader, body.timestamp)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _online_threshold() -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=settings.rfid_reader_offline_seconds)


def _parse_direction(value: str) -> RfidDirection:
    mapping = {"in": RfidDirection.in_, "out": RfidDirection.out, "both": RfidDirection.both}
    if value not in mapping:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Invalid direction: {value}")
    return mapping[value]


def _direction_value(direction: RfidDirection | str) -> str:
    if isinstance(direction, RfidDirection):
        return "in" if direction == RfidDirection.in_ else direction.value
    return direction


def _reader_is_online(reader: RfidReader, threshold: datetime) -> bool:
    return bool(
        reader.is_active
        and reader.last_heartbeat_at is not None
        and reader.last_heartbeat_at >= threshold
    )


def _format_reader(reader: RfidReader, taps_today: int, threshold: datetime) -> RfidReaderOut:
    location = None
    if reader.location is not None:
        location = {"id": reader.location.id, "name": reader.location.name}
    return RfidReaderOut(
        id=reader.id,
        name=reader.name,
        device_id=reader.device_id,
        direction=_direction_value(reader.direction),
        is_active=reader.is_active,
        online=_reader_is_online(reader, threshold),
        last_heartbeat_at=reader.last_heartbeat_at,
        taps_today=taps_today,
        location=location,
    )


def _format_event(event: RfidEvent) -> RfidEventOut:
    employee = None
    if event.employee is not None:
        employee = EmployeeBrief(
            id=event.employee.id,
            first_name=event.employee.first_name,
            last_name=event.employee.last_name,
            employee_code=event.employee.employee_code,
        )
    reader = None
    if event.rfid_reader is not None:
        reader = ReaderBrief(id=event.rfid_reader.id, name=event.rfid_reader.name)
    return RfidEventOut(
        id=event.id,
        uid=event.uid,
        result=event.result.value if isinstance(event.result, RfidEventResult) else event.result,
        tapped_at=event.tapped_at,
        metadata=event.meta,
        employee=employee,
        reader=reader,
    )


async def _taps_today_by_reader(db: DbSession, reader_ids: list[int]) -> dict[int, int]:
    if not reader_ids:
        return {}
    today = date.today()
    stmt = (
        select(RfidEvent.rfid_reader_id, func.count())
        .where(
            RfidEvent.rfid_reader_id.in_(reader_ids),
            func.date(RfidEvent.tapped_at) == today,
        )
        .group_by(RfidEvent.rfid_reader_id)
    )
    result = await db.execute(stmt)
    return {reader_id: count for reader_id, count in result.all()}


async def _generate_device_id(db: DbSession, name: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-") or "READER"
    candidate = base
    suffix = 1
    while True:
        existing = await db.execute(select(RfidReader.id).where(RfidReader.device_id == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def _process_tap(
    db: DbSession,
    uid: str,
    reader: RfidReader,
    tapped_at: datetime | None = None,
) -> SimulateTapResponse:
    uid = uid.strip().upper()
    now = tapped_at or datetime.now(timezone.utc)

    card_stmt = select(RfidCard).where(RfidCard.uid == uid)
    card_result = await db.execute(card_stmt)
    card = card_result.scalar_one_or_none()

    if not card:
        await _record_event(db, reader, uid, RfidEventResult.unknown, None, now)
        return SimulateTapResponse(matched=False, reason="unknown_card", uid=uid)

    emp_stmt = select(Employee).where(Employee.id == card.employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()

    if not card.is_active or employee is None or not employee.is_active:
        await _record_event(db, reader, uid, RfidEventResult.inactive, employee, now)
        return SimulateTapResponse(matched=False, reason="inactive", uid=uid)

    direction = _direction_value(reader.direction)
    record = await process_rfid_tap(db, card.employee_id, direction)

    if record.check_in_at and (not record.check_out_at or record.check_out_at >= now):
        if record.check_in_at >= now - timedelta(seconds=settings.rfid_duplicate_window_seconds):
            await _record_event(
                db, reader, uid, RfidEventResult.duplicate_ignored, employee, now
            )
            return SimulateTapResponse(
                matched=True,
                uid=uid,
                attendance_action="duplicate_ignored",
                employee=EmployeeBrief(
                    id=employee.id,
                    first_name=employee.first_name,
                    last_name=employee.last_name,
                    employee_code=employee.employee_code,
                ),
            )

    action = "none"
    if direction in ("in", "both") and record.check_in_at and record.check_in_at >= now - timedelta(seconds=5):
        action = "check_in"
    elif direction in ("out", "both") and record.check_out_at and record.check_out_at >= now - timedelta(seconds=5):
        action = "check_out"

    await _record_event(
        db,
        reader,
        uid,
        RfidEventResult.matched,
        employee,
        now,
        {"attendance_action": action},
    )

    return SimulateTapResponse(
        matched=True,
        uid=uid,
        attendance_action=action,
        employee=EmployeeBrief(
            id=employee.id,
            first_name=employee.first_name,
            last_name=employee.last_name,
            employee_code=employee.employee_code,
        ),
    )


async def _record_event(
    db: DbSession,
    reader: RfidReader,
    uid: str,
    result: RfidEventResult,
    employee: Employee | None,
    tapped_at: datetime,
    metadata: dict | None = None,
) -> None:
    event = RfidEvent(
        rfid_reader_id=reader.id,
        employee_id=employee.id if employee else None,
        uid=uid,
        result=result,
        meta=metadata,
        tapped_at=tapped_at,
    )
    db.add(event)
    await db.flush()

    org_row = await db.execute(
        select(Location.organization_id).where(Location.id == reader.location_id)
    )
    await emit(
        org_row.scalar_one_or_none(),
        "rfid.tap",
        {"reader_id": reader.id, "result": getattr(result, "value", str(result))},
    )


async def _employee_in_tenant_or_404(
    db: DbSession, employee_id: int, org_id: int | None
) -> Employee:
    stmt = select(Employee).where(Employee.id == employee_id)
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    result = await db.execute(stmt)
    employee = result.scalar_one_or_none()
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return employee


async def _get_reader_or_404(
    db: DbSession, reader_id: int, org_id: int | None
) -> RfidReader:
    stmt = (
        select(RfidReader)
        .join(Location, RfidReader.location_id == Location.id)
        .where(RfidReader.id == reader_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    reader = result.scalar_one_or_none()
    if not reader:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RFID reader not found")
    return reader
