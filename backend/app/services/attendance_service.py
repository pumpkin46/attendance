"""Core attendance business logic: face/RFID recognition → attendance record."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import get_redis
from app.models.attendance import (
    AttendancePolicy,
    AttendanceRecord,
    Shift,
    ShiftAssignment,
)
from app.models.employee import Employee

# In-memory fast-path cache for duplicate suppression. This is a best-effort
# optimisation only — it is per-process and so cannot be relied on for
# correctness across multiple workers/nodes. The authoritative duplicate guard
# is `_recent_action_within`, which is based on the persisted record timestamps
# (shared by all workers), backed by the UNIQUE(employee_id, work_date)
# constraint on attendance_records.
_dup_cache: dict[str, datetime] = {}
_DUP_CACHE_MAX = 10_000


def _is_duplicate(key: str, window_seconds: int) -> bool:
    now = datetime.now(timezone.utc)
    _prune_dup_cache(now)
    last = _dup_cache.get(key)
    if last and (now - last).total_seconds() < window_seconds:
        return True
    _dup_cache[key] = now
    return False


async def _is_duplicate_shared(key: str, window_seconds: int) -> bool:
    """Cross-worker duplicate fast-path.

    Uses an atomic Redis ``SET key 1 NX EX window`` when Redis is enabled — the
    key is created only on the first call within the window, so a second call
    (from any worker) sees it already present and is flagged as a duplicate. Falls
    back to the in-process cache when Redis is disabled or unreachable.
    """
    redis = get_redis()
    if redis is not None:
        try:
            created = await redis.set(f"dupwin:{key}", "1", nx=True, ex=window_seconds)
            return not created
        except RedisError:
            pass  # fall through to the local cache
    return _is_duplicate(key, window_seconds)


def _prune_dup_cache(now: datetime) -> None:
    """Evict stale entries so the in-memory cache cannot grow unbounded."""
    if len(_dup_cache) < _DUP_CACHE_MAX:
        return
    cutoff = now - timedelta(
        seconds=max(
            settings.face_duplicate_window_seconds,
            settings.rfid_duplicate_window_seconds,
        )
    )
    for key in [k for k, ts in _dup_cache.items() if ts < cutoff]:
        _dup_cache.pop(key, None)
    if len(_dup_cache) >= _DUP_CACHE_MAX:
        # Pathological case (all entries still fresh): drop everything rather
        # than leak memory. Worst case is a few missed fast-path hits.
        _dup_cache.clear()


def _recent_action_within(
    record: AttendanceRecord, window_seconds: int, now: datetime
) -> bool:
    """Authoritative, cross-worker duplicate guard based on persisted state."""
    last = record.check_out_at or record.check_in_at
    return last is not None and (now - last).total_seconds() < window_seconds


async def _get_or_create_today_record(
    db: AsyncSession,
    employee_id: int,
    work_date: date,
    *,
    location_id: int | None,
    camera_id: int | None,
    shift_id: int | None,
) -> AttendanceRecord:
    """Fetch today's record or create it, tolerating a concurrent insert.

    The UNIQUE(employee_id, work_date) constraint means two concurrent
    taps/recognitions cannot both create a row; the loser gets an
    IntegrityError, which we recover from by re-selecting the winner's row.
    """
    stmt = select(AttendanceRecord).where(
        AttendanceRecord.employee_id == employee_id,
        AttendanceRecord.work_date == work_date,
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if record is not None:
        return record

    record = AttendanceRecord(
        employee_id=employee_id,
        work_date=work_date,
        location_id=location_id,
        camera_id=camera_id,
        shift_id=shift_id,
        status="absent",
    )
    db.add(record)
    try:
        async with db.begin_nested():
            await db.flush()
    except IntegrityError:
        db.expunge(record)
        record = (await db.execute(stmt)).scalar_one_or_none()
        if record is None:
            raise
    return record


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
    *,
    camera_id: int | None = None,
    confidence: float = 0.0,
    liveness_passed: bool = False,
    processing_ms: int | None = None,
    organization_id: int | None = None,
    method: str = "face",
) -> AttendanceRecord:
    # Note: confidence / liveness_passed / processing_ms describe the recognition
    # event, not the attendance row (which has no columns for them), so they are
    # accepted for a uniform caller interface but not persisted here.
    window = settings.face_duplicate_window_seconds
    dup_key = f"face:{employee_id}"

    emp_stmt = select(Employee).where(Employee.id == employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()
    org_id = employee.organization_id if employee else organization_id

    now = datetime.now(timezone.utc)
    today = now.date()

    shift = await _get_active_shift(db, employee_id, today)
    policy = await _get_policy(db, shift, org_id) if org_id else None

    fast_dup = await _is_duplicate_shared(dup_key, window)
    record = await _get_or_create_today_record(
        db,
        employee_id,
        today,
        location_id=employee.location_id if employee else None,
        camera_id=camera_id,
        shift_id=shift.id if shift else None,
    )

    # Suppress duplicates using persisted state (authoritative across workers)
    # plus the in-process fast path.
    if fast_dup or _recent_action_within(record, window, now):
        # Transient (non-persisted) marker so callers can report what happened.
        record.last_action = "duplicate_ignored"
        return record

    if not record.check_in_at:
        record.check_in_at = now
        record.check_in_method = method
        record.camera_id = camera_id or record.camera_id
        record.shift_id = shift.id if shift else record.shift_id
        record.status = _resolve_status(now, shift, policy)
        record.attendance_type = record.status
        action = "check_in"
    elif not record.check_out_at:
        record.check_out_at = now
        record.check_out_method = method
        worked, overtime = _calc_worked(record.check_in_at, now, policy)
        record.worked_minutes = worked
        record.overtime_minutes = overtime
        record.status = _resolve_checkout_status(worked, policy, record.status)
        record.attendance_type = record.status
        action = "check_out"
    else:
        action = "already_complete"

    await db.flush()
    await db.refresh(record)
    record.last_action = action
    return record


async def process_rfid_tap(
    db: AsyncSession,
    employee_id: int,
    reader_direction: str,
) -> AttendanceRecord:
    window = settings.rfid_duplicate_window_seconds
    dup_key = f"rfid:{employee_id}"

    emp_stmt = select(Employee).where(Employee.id == employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()
    org_id = employee.organization_id if employee else None

    now = datetime.now(timezone.utc)
    today = now.date()

    shift = await _get_active_shift(db, employee_id, today)
    policy = await _get_policy(db, shift, org_id) if org_id else None

    fast_dup = await _is_duplicate_shared(dup_key, window)
    record = await _get_or_create_today_record(
        db,
        employee_id,
        today,
        location_id=employee.location_id if employee else None,
        camera_id=None,
        shift_id=shift.id if shift else None,
    )

    if fast_dup or _recent_action_within(record, window, now):
        return record

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
