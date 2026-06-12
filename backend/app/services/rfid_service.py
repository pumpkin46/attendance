"""RFID reader/card management and tap processing.

Owns all queries, the device-tap state machine, audit logging, and realtime
emits. The rfid router only handles auth, request parsing, and responses.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import generate_device_token
from app.core.timeutil import local_date, local_day_bounds_utc
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.location import Location
from app.models.rfid import RfidCard, RfidDirection, RfidEvent, RfidEventResult, RfidReader
from app.realtime.hub import emit
from app.schemas.rfid import (
    EmployeeBrief,
    ReaderBrief,
    RfidCardCreate,
    RfidCardOut,
    RfidEventOut,
    RfidReaderCreate,
    RfidReaderOut,
    RfidReaderUpdate,
    RfidTokenRegeneratedOut,
    SimulateTapResponse,
)
from app.services.attendance_service import process_rfid_tap
from app.services.audit_service import log_action


# ── Formatting helpers ────────────────────────────────────────────────────────


def _online_threshold() -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=settings.rfid_reader_offline_seconds)


def _parse_direction(value: str) -> RfidDirection:
    mapping = {"in": RfidDirection.in_, "out": RfidDirection.out, "both": RfidDirection.both}
    if value not in mapping:
        raise ValidationError(f"Invalid direction: {value}")
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


def format_reader(reader: RfidReader, taps_today: int, threshold: datetime) -> RfidReaderOut:
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


def format_event(event: RfidEvent) -> RfidEventOut:
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


async def _taps_today_by_reader(db: AsyncSession, reader_ids: list[int]) -> dict[int, int]:
    if not reader_ids:
        return {}
    day_start_utc, day_end_utc = local_day_bounds_utc(local_date())
    stmt = (
        select(RfidEvent.rfid_reader_id, func.count())
        .where(
            RfidEvent.rfid_reader_id.in_(reader_ids),
            RfidEvent.tapped_at >= day_start_utc,
            RfidEvent.tapped_at < day_end_utc,
        )
        .group_by(RfidEvent.rfid_reader_id)
    )
    return {reader_id: count for reader_id, count in (await db.execute(stmt)).all()}


async def _generate_device_id(db: AsyncSession, name: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-") or "READER"
    candidate = base
    suffix = 1
    while True:
        existing = await db.execute(select(RfidReader.id).where(RfidReader.device_id == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def get_reader_or_404(db: AsyncSession, reader_id: int, org_id: int | None) -> RfidReader:
    stmt = (
        select(RfidReader)
        .join(Location, RfidReader.location_id == Location.id)
        .where(RfidReader.id == reader_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    reader = (await db.execute(stmt)).scalar_one_or_none()
    if not reader:
        raise NotFoundError("RFID reader not found")
    return reader


async def _employee_in_tenant_or_404(
    db: AsyncSession, employee_id: int, org_id: int | None
) -> Employee:
    stmt = select(Employee).where(Employee.id == employee_id)
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    employee = (await db.execute(stmt)).scalar_one_or_none()
    if employee is None:
        raise NotFoundError("Employee not found")
    return employee


# ── Reader CRUD ───────────────────────────────────────────────────────────────


async def list_readers(db: AsyncSession, org_id: int | None) -> list[RfidReaderOut]:
    stmt = select(RfidReader).join(Location, RfidReader.location_id == Location.id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    stmt = stmt.order_by(RfidReader.name)
    readers = list((await db.execute(stmt)).scalars().unique().all())
    tap_counts = await _taps_today_by_reader(db, [r.id for r in readers])
    threshold = _online_threshold()
    return [format_reader(r, tap_counts.get(r.id, 0), threshold) for r in readers]


async def create_reader(
    db: AsyncSession,
    org_id: int | None,
    body: RfidReaderCreate,
    *,
    user_id: int,
    ip_address: str | None,
) -> tuple[RfidReaderOut, str]:
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
        user_id=user_id,
        action="rfid_reader.created",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=ip_address,
        new_values=body.model_dump(),
    )
    return format_reader(reader, 0, _online_threshold()), plain_token


async def get_reader_out(db: AsyncSession, reader_id: int, org_id: int | None) -> RfidReaderOut:
    reader = await get_reader_or_404(db, reader_id, org_id)
    tap_counts = await _taps_today_by_reader(db, [reader.id])
    return format_reader(reader, tap_counts.get(reader.id, 0), _online_threshold())


async def update_reader(
    db: AsyncSession,
    reader_id: int,
    org_id: int | None,
    body: RfidReaderUpdate,
    *,
    user_id: int,
    ip_address: str | None,
) -> RfidReaderOut:
    reader = await get_reader_or_404(db, reader_id, org_id)
    update_data = body.model_dump(exclude_unset=True)
    if update_data.get("direction") is not None:
        update_data["direction"] = _parse_direction(update_data["direction"])
    for field, value in update_data.items():
        setattr(reader, field, value)
    await db.flush()
    await db.refresh(reader, attribute_names=["location"])

    await log_action(
        db,
        user_id=user_id,
        action="rfid_reader.updated",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=ip_address,
        new_values=update_data,
    )
    tap_counts = await _taps_today_by_reader(db, [reader.id])
    return format_reader(reader, tap_counts.get(reader.id, 0), _online_threshold())


async def deactivate_reader(
    db: AsyncSession,
    reader_id: int,
    org_id: int | None,
    *,
    user_id: int,
    ip_address: str | None,
) -> None:
    reader = await get_reader_or_404(db, reader_id, org_id)
    reader.is_active = False
    await db.flush()
    await log_action(
        db,
        user_id=user_id,
        action="rfid_reader.deactivated",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=ip_address,
    )


async def regenerate_token(
    db: AsyncSession,
    reader_id: int,
    org_id: int | None,
    *,
    user_id: int,
    ip_address: str | None,
) -> RfidTokenRegeneratedOut:
    reader = await get_reader_or_404(db, reader_id, org_id)
    plain_token, hashed_token = generate_device_token()
    reader.api_token = hashed_token
    await db.flush()
    await log_action(
        db,
        user_id=user_id,
        action="rfid_reader.token_regenerated",
        entity_type="rfid_reader",
        entity_id=reader.id,
        ip_address=ip_address,
    )
    return RfidTokenRegeneratedOut(
        id=reader.id,
        api_token_plain=plain_token,
        message="Token regenerated. Update the physical reader with the new token.",
    )


# ── Cards ─────────────────────────────────────────────────────────────────────


async def list_employee_cards(
    db: AsyncSession, employee_id: int, org_id: int | None
) -> list[RfidCardOut]:
    await _employee_in_tenant_or_404(db, employee_id, org_id)
    stmt = (
        select(RfidCard)
        .where(RfidCard.employee_id == employee_id)
        .order_by(RfidCard.assigned_at.desc())
    )
    return [
        RfidCardOut.model_validate(c, from_attributes=True)
        for c in (await db.execute(stmt)).scalars().all()
    ]


async def add_employee_card(
    db: AsyncSession,
    employee_id: int,
    org_id: int | None,
    body: RfidCardCreate,
    *,
    user_id: int,
    ip_address: str | None,
) -> RfidCardOut:
    await _employee_in_tenant_or_404(db, employee_id, org_id)
    uid = body.uid.strip().upper()
    existing = await db.execute(select(RfidCard).where(RfidCard.uid == uid))
    if existing.scalar_one_or_none():
        raise ConflictError("Card UID already registered")

    card = RfidCard(employee_id=employee_id, uid=uid, label=body.label)
    db.add(card)
    await db.flush()
    await db.refresh(card)

    await log_action(
        db,
        user_id=user_id,
        action="rfid_card.assigned",
        entity_type="rfid_card",
        entity_id=card.id,
        ip_address=ip_address,
        new_values={"employee_id": employee_id, **body.model_dump()},
    )
    return RfidCardOut.model_validate(card, from_attributes=True)


async def revoke_card(
    db: AsyncSession,
    card_id: int,
    org_id: int | None,
    *,
    user_id: int,
    ip_address: str | None,
) -> None:
    stmt = (
        select(RfidCard)
        .join(Employee, RfidCard.employee_id == Employee.id)
        .where(RfidCard.id == card_id)
    )
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    card = (await db.execute(stmt)).scalar_one_or_none()
    if not card:
        raise NotFoundError("RFID card not found")

    card.is_active = False
    await db.flush()
    await log_action(
        db,
        user_id=user_id,
        action="rfid_card.revoked",
        entity_type="rfid_card",
        entity_id=card.id,
        ip_address=ip_address,
    )


# ── Events & tap processing ───────────────────────────────────────────────────


def events_query(org_id: int | None) -> Select:
    stmt = (
        select(RfidEvent)
        .join(RfidReader, RfidEvent.rfid_reader_id == RfidReader.id, isouter=True)
        .join(Location, RfidReader.location_id == Location.id, isouter=True)
        .order_by(RfidEvent.tapped_at.desc())
    )
    return apply_tenant_filter(stmt, org_id, Location.organization_id)


async def _record_event(
    db: AsyncSession,
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


async def process_tap(
    db: AsyncSession,
    uid: str,
    reader: RfidReader,
    tapped_at: datetime | None = None,
) -> SimulateTapResponse:
    uid = uid.strip().upper()
    now = tapped_at or datetime.now(timezone.utc)

    card = (
        await db.execute(select(RfidCard).where(RfidCard.uid == uid))
    ).scalar_one_or_none()
    if not card:
        await _record_event(db, reader, uid, RfidEventResult.unknown, None, now)
        return SimulateTapResponse(matched=False, reason="unknown_card", uid=uid)

    employee = (
        await db.execute(select(Employee).where(Employee.id == card.employee_id))
    ).scalar_one_or_none()
    if not card.is_active or employee is None or not employee.is_active:
        await _record_event(db, reader, uid, RfidEventResult.inactive, employee, now)
        return SimulateTapResponse(matched=False, reason="inactive", uid=uid)

    direction = _direction_value(reader.direction)
    record = await process_rfid_tap(db, card.employee_id, direction)
    if record is None:
        # Employee row vanished/deactivated between the check above and the
        # tap processing (or the card outlived the employee).
        await _record_event(db, reader, uid, RfidEventResult.inactive, employee, now)
        return SimulateTapResponse(matched=False, reason="inactive", uid=uid)

    brief = EmployeeBrief(
        id=employee.id,
        first_name=employee.first_name,
        last_name=employee.last_name,
        employee_code=employee.employee_code,
    )

    # Use the action the state machine actually took, not one re-derived from
    # timestamps after the write — the old timestamp heuristic misreported a
    # genuine first check-in as duplicate_ignored.
    action = getattr(record, "last_action", "none") or "none"

    if action == "duplicate_ignored":
        await _record_event(db, reader, uid, RfidEventResult.duplicate_ignored, employee, now)
        return SimulateTapResponse(
            matched=True, uid=uid, attendance_action="duplicate_ignored", employee=brief
        )

    await _record_event(
        db, reader, uid, RfidEventResult.matched, employee, now, {"attendance_action": action}
    )
    return SimulateTapResponse(matched=True, uid=uid, attendance_action=action, employee=brief)
