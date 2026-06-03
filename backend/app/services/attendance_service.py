"""Core attendance business logic: face/RFID recognition → attendance record."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.attendance import (
    AttendancePolicy,
    AttendanceRecord,
    Shift,
    ShiftAssignment,
)
from app.models.employee import Employee

_dup_cache: dict[str, datetime] = {}


def _is_duplicate(key: str, window_seconds: int) -> bool:
    now = datetime.now(timezone.utc)
    last = _dup_cache.get(key)
    if last and (now - last).total_seconds() < window_seconds:
        return True
    _dup_cache[key] = now
    return False


async def _get_active_shift(
    db: AsyncSession, employee_id: int, work_date: date
) -> Shift | None:
    stmt = (
        select(ShiftAssignment)
        .where(
            ShiftAssignment.employee_id == employee_id,
            ShiftAssignment.effective_from <= work_date,
        )
        .where(
            (ShiftAssignment.effective_to.is_(None))
            | (ShiftAssignment.effective_to >= work_date)
        )
        .order_by(ShiftAssignment.effective_from.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()
    if assignment is None:
        return None

    shift_stmt = select(Shift).where(Shift.id == assignment.shift_id, Shift.is_active == True)  # noqa: E712
    shift_result = await db.execute(shift_stmt)
    return shift_result.scalar_one_or_none()


async def _get_policy(
    db: AsyncSession, shift: Shift | None, organization_id: int
) -> AttendancePolicy | None:
    if shift and shift.attendance_policy_id:
        stmt = select(AttendancePolicy).where(AttendancePolicy.id == shift.attendance_policy_id)
        result = await db.execute(stmt)
        policy = result.scalar_one_or_none()
        if policy:
            return policy

    stmt = (
        select(AttendancePolicy)
        .where(
            AttendancePolicy.organization_id == organization_id,
            AttendancePolicy.is_default == True,  # noqa: E712
            AttendancePolicy.is_active == True,  # noqa: E712
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _resolve_status(
    check_in_at: datetime,
    shift: Shift | None,
    policy: AttendancePolicy | None,
) -> str:
    if shift and shift.start_time:
        scheduled = check_in_at.replace(
            hour=shift.start_time.hour,
            minute=shift.start_time.minute,
            second=0,
            microsecond=0,
        )
        grace = (policy.grace_minutes if policy else shift.grace_minutes) or 15
        if check_in_at > scheduled + timedelta(minutes=grace):
            return "late"
    return "present"


def _calc_worked(
    check_in: datetime,
    check_out: datetime,
    policy: AttendancePolicy | None,
) -> tuple[int, int]:
    diff_seconds = (check_out - check_in).total_seconds()
    break_minutes = policy.break_minutes if policy else settings.attendance_break_minutes
    raw_minutes = max(0, int(diff_seconds / 60) - break_minutes)

    overtime_threshold = (
        policy.overtime_after_minutes if policy else settings.attendance_overtime_threshold_minutes
    )
    overtime = max(0, raw_minutes - overtime_threshold)
    return raw_minutes, overtime


def _resolve_checkout_status(
    worked_minutes: int, policy: AttendancePolicy | None, current_status: str
) -> str:
    half_day = policy.half_day_minutes if policy else settings.attendance_half_day_minutes
    min_work = policy.min_work_minutes if policy else settings.attendance_min_work_minutes

    if worked_minutes < half_day:
        return "half_day"
    if current_status == "late":
        return "late"
    return "present"


async def process_recognition(
    db: AsyncSession,
    employee_id: int,
    camera_id: int | None,
    confidence: float,
    liveness_passed: bool,
    method: str = "face",
) -> AttendanceRecord:
    window = settings.face_duplicate_window_seconds
    dup_key = f"face:{employee_id}"
    if _is_duplicate(dup_key, window):
        stmt = (
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.work_date == date.today(),
            )
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            return existing

    emp_stmt = select(Employee).where(Employee.id == employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()
    org_id = employee.organization_id if employee else None

    now = datetime.now(timezone.utc)
    today = now.date()

    shift = await _get_active_shift(db, employee_id, today)
    policy = await _get_policy(db, shift, org_id) if org_id else None

    stmt = select(AttendanceRecord).where(
        AttendanceRecord.employee_id == employee_id,
        AttendanceRecord.work_date == today,
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if record is None:
        record = AttendanceRecord(
            employee_id=employee_id,
            work_date=today,
            location_id=employee.location_id if employee else None,
            camera_id=camera_id,
            shift_id=shift.id if shift else None,
            status="absent",
        )
        db.add(record)
        await db.flush()

    if not record.check_in_at:
        record.check_in_at = now
        record.check_in_method = method
        record.camera_id = camera_id or record.camera_id
        record.shift_id = shift.id if shift else record.shift_id
        record.status = _resolve_status(now, shift, policy)
        record.attendance_type = record.status
    elif not record.check_out_at:
        record.check_out_at = now
        record.check_out_method = method
        worked, overtime = _calc_worked(record.check_in_at, now, policy)
        record.worked_minutes = worked
        record.overtime_minutes = overtime
        record.status = _resolve_checkout_status(worked, policy, record.status)
        record.attendance_type = record.status

    await db.flush()
    await db.refresh(record)
    return record


async def process_rfid_tap(
    db: AsyncSession,
    employee_id: int,
    reader_direction: str,
) -> AttendanceRecord:
    window = settings.rfid_duplicate_window_seconds
    dup_key = f"rfid:{employee_id}"
    if _is_duplicate(dup_key, window):
        stmt = select(AttendanceRecord).where(
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.work_date == date.today(),
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            return existing

    emp_stmt = select(Employee).where(Employee.id == employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()
    org_id = employee.organization_id if employee else None

    now = datetime.now(timezone.utc)
    today = now.date()

    shift = await _get_active_shift(db, employee_id, today)
    policy = await _get_policy(db, shift, org_id) if org_id else None

    stmt = select(AttendanceRecord).where(
        AttendanceRecord.employee_id == employee_id,
        AttendanceRecord.work_date == today,
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if record is None:
        record = AttendanceRecord(
            employee_id=employee_id,
            work_date=today,
            location_id=employee.location_id if employee else None,
            shift_id=shift.id if shift else None,
            status="absent",
        )
        db.add(record)
        await db.flush()

    is_entry = reader_direction in ("in", "both")
    is_exit = reader_direction in ("out", "both")

    if is_entry and not record.check_in_at:
        record.check_in_at = now
        record.check_in_method = "rfid"
        record.shift_id = shift.id if shift else record.shift_id
        record.status = _resolve_status(now, shift, policy)
        record.attendance_type = record.status
    elif is_exit and record.check_in_at and not record.check_out_at:
        record.check_out_at = now
        record.check_out_method = "rfid"
        worked, overtime = _calc_worked(record.check_in_at, now, policy)
        record.worked_minutes = worked
        record.overtime_minutes = overtime
        record.status = _resolve_checkout_status(worked, policy, record.status)
        record.attendance_type = record.status

    await db.flush()
    await db.refresh(record)
    return record
