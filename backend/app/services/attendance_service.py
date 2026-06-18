"""Core attendance business logic: face/RFID recognition → attendance record."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import get_redis
from app.core.timeutil import local_date, to_local
from app.models.attendance import (
    AttendancePolicy,
    AttendanceRecord,
    Shift,
    ShiftAssignment,
)
from app.models.employee import Employee

logger = logging.getLogger(__name__)

# In-memory fast-path cache for duplicate suppression. This is a best-effort
# optimisation only — it is per-process and so cannot be relied on for
# correctness across multiple workers/nodes. The authoritative duplicate guard
# is `_recent_action_within`, which is based on the persisted record timestamps
# (shared by all workers), backed by the UNIQUE(employee_id, work_date)
# constraint on attendance_records.
_dup_cache: dict[str, datetime] = {}
_DUP_CACHE_MAX = 10_000


def _check_duplicate_local(key: str, window_seconds: int) -> bool:
    last = _dup_cache.get(key)
    if last is None:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() < window_seconds


def _arm_duplicate_local(key: str) -> None:
    now = datetime.now(timezone.utc)
    _prune_dup_cache(now)
    _dup_cache[key] = now


async def _check_duplicate_shared(key: str, window_seconds: int) -> bool:
    """Cross-worker duplicate fast-path: read-only, no side effects.

    Arming is a separate explicit step (``_arm_duplicate_shared``) taken only
    after a successful write. Arming on read meant a failed commit kept the
    key armed (the retried event read as duplicate_ignored for the whole
    window), and a no-op sighting (e.g. an exit camera seeing someone not
    yet checked in) suppressed a later genuine punch. Falls back to the
    in-process cache when Redis is disabled or unreachable.
    """
    redis = get_redis()
    if redis is not None:
        try:
            return await redis.get(f"dupwin:{key}") is not None
        except RedisError:
            pass  # fall through to the local cache
    return _check_duplicate_local(key, window_seconds)


async def _arm_duplicate_shared(key: str, window_seconds: int) -> None:
    """Open the duplicate window after a check-in/out actually flushed."""
    redis = get_redis()
    if redis is not None:
        try:
            await redis.set(f"dupwin:{key}", "1", nx=True, ex=window_seconds)
            return
        except RedisError:
            pass  # fall through to the local cache
    _arm_duplicate_local(key)


async def clear_duplicate_marker(employee_id: int, method: str = "face") -> None:
    """Best-effort unarm of the duplicate fast-path for one employee.

    Called by the engine consumer when a commit fails after the marker was
    armed, so the retried event is not misread as a duplicate.
    """
    key = f"{method}:{employee_id}"
    _dup_cache.pop(key, None)
    redis = get_redis()
    if redis is not None:
        try:
            await redis.delete(f"dupwin:{key}")
        except RedisError:
            pass


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


def _as_utc(dt: datetime) -> datetime:
    """Coerce a possibly-naive datetime to aware UTC.

    Timestamps are stored in timestamptz columns, but a naive value can come
    back from some drivers (notably SQLite in tests). Normalizing here keeps
    arithmetic against the aware ``now`` from raising the naive/aware
    TypeError.
    """
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _recent_action_within(
    record: AttendanceRecord, window_seconds: int, now: datetime
) -> bool:
    """Authoritative, cross-worker duplicate guard based on persisted state."""
    last = record.check_out_at or record.check_in_at
    return last is not None and (now - _as_utc(last)).total_seconds() < window_seconds


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
        # Shift.start_time is a local wall-clock time; compare in the app
        # timezone, not UTC, or lateness is off by the UTC offset.
        check_in_local = to_local(check_in_at)
        scheduled = check_in_local.replace(
            hour=shift.start_time.hour,
            minute=shift.start_time.minute,
            second=0,
            microsecond=0,
        )
        grace = (policy.grace_minutes if policy else shift.grace_minutes) or 15
        if check_in_local > scheduled + timedelta(minutes=grace):
            return "late"
    return "present"


def _calc_worked(
    check_in: datetime,
    check_out: datetime,
    policy: AttendancePolicy | None,
) -> tuple[int, int]:
    diff_seconds = (_as_utc(check_out) - _as_utc(check_in)).total_seconds()
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
    # Worked at least half a day but below the policy's minimum full day: an
    # early departure. With the default min_work <= half_day this never triggers
    # (so default behavior is unchanged); it only applies when an operator sets
    # min_work_minutes above half_day_minutes.
    if worked_minutes < min_work:
        return "early_leave"
    if current_status == "late":
        return "late"
    return "present"


def _apply_check_in(
    record: AttendanceRecord,
    now: datetime,
    *,
    method: str,
    camera_id: int | None,
    shift: Shift | None,
    policy: AttendancePolicy | None,
) -> None:
    record.check_in_at = now
    record.check_in_method = method
    record.camera_id = camera_id or record.camera_id
    record.shift_id = shift.id if shift else record.shift_id
    record.status = _resolve_status(now, shift, policy)
    record.attendance_type = record.status


def _apply_check_out(
    record: AttendanceRecord,
    now: datetime,
    *,
    method: str,
    policy: AttendancePolicy | None,
) -> None:
    record.check_out_at = now
    record.check_out_method = method
    worked, overtime = _calc_worked(record.check_in_at, now, policy)
    record.worked_minutes = worked
    record.overtime_minutes = overtime
    record.status = _resolve_checkout_status(worked, policy, record.status)
    record.attendance_type = record.status


async def apply_manual_attendance(
    db: AsyncSession,
    *,
    employee_id: int,
    organization_id: int,
    work_date: date,
    check_in_at: datetime | None,
    check_out_at: datetime | None,
    notes: str | None = None,
) -> AttendanceRecord:
    """Create/update an attendance row from an admin manual entry.

    Reuses the same shift/policy status derivation as the camera/RFID paths
    (lateness, half_day/early_leave, per-policy break minutes) instead of
    hardcoding 'present', and the same UNIQUE(employee_id, work_date) race
    recovery as the live paths (a manual post racing a live writer no longer
    500s).
    """
    shift = await _get_active_shift(db, employee_id, work_date)
    policy = await _get_policy(db, shift, organization_id)
    record = await _get_or_create_today_record(
        db,
        employee_id,
        work_date,
        location_id=None,
        camera_id=None,
        shift_id=shift.id if shift else None,
    )

    if check_in_at is not None:
        _apply_check_in(
            record, check_in_at, method="manual", camera_id=None, shift=shift, policy=policy
        )

    if check_out_at is not None:
        if record.check_in_at is not None:
            _apply_check_out(record, check_out_at, method="manual", policy=policy)
        else:
            # Checkout without a check-in: store the time but there is no
            # duration/status to derive.
            record.check_out_at = check_out_at
            record.check_out_method = "manual"

    if notes:
        record.notes = notes

    await db.flush()
    await db.refresh(record, attribute_names=["created_at", "updated_at"])
    return record


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
    intent: str | None = None,
) -> AttendanceRecord | None:
    # Note: confidence / liveness_passed / processing_ms describe the recognition
    # event, not the attendance row (which has no columns for them), so they are
    # accepted for a uniform caller interface but not persisted here.
    #
    # intent carries the camera's configured purpose ("check_in" for entry
    # cameras, "check_out" for exit cameras); None keeps the historical kiosk
    # toggle (first sighting checks in, the next checks out).
    window = settings.face_duplicate_window_seconds
    dup_key = f"face:{employee_id}"

    emp_stmt = select(Employee).where(Employee.id == employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()
    if employee is None or not employee.is_active:
        # Stale FAISS vector (deleted/deactivated employee): writing a record
        # would violate the FK / resurrect attendance for a removed person.
        return None
    if organization_id is not None and employee.organization_id != organization_id:
        # Caller-supplied tenant context (e.g. the camera's org) must match the
        # matched employee: a cross-org recognition writes nothing.
        logger.warning(
            "suppressing recognition for employee %s: organization mismatch",
            employee_id,
        )
        return None
    org_id = employee.organization_id

    now = datetime.now(timezone.utc)
    today = local_date(now)

    if intent == "check_out":
        # No row for today means nothing to close out: short-circuit before
        # _get_or_create_today_record, which would otherwise pollute the day
        # with a bare status='absent' row on every exit-camera sighting.
        existing_stmt = select(AttendanceRecord).where(
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.work_date == today,
        )
        if (await db.execute(existing_stmt)).scalar_one_or_none() is None:
            return None

    shift = await _get_active_shift(db, employee_id, today)
    policy = await _get_policy(db, shift, org_id) if org_id else None

    fast_dup = await _check_duplicate_shared(dup_key, window)
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

    if intent == "check_in":
        if not record.check_in_at:
            _apply_check_in(
                record, now, method=method, camera_id=camera_id, shift=shift, policy=policy
            )
            action = "check_in"
        else:
            # An entry camera re-sighting someone already checked in must
            # never toggle them into a check-out.
            action = "already_checked_in"
    elif intent == "check_out":
        if record.check_in_at and not record.check_out_at:
            _apply_check_out(record, now, method=method, policy=policy)
            action = "check_out"
        elif not record.check_in_at:
            # Cannot check out a day that never checked in.
            action = "none"
        else:
            action = "already_complete"
    elif not record.check_in_at:
        _apply_check_in(
            record, now, method=method, camera_id=camera_id, shift=shift, policy=policy
        )
        action = "check_in"
    elif not record.check_out_at:
        _apply_check_out(record, now, method=method, policy=policy)
        action = "check_out"
    else:
        action = "already_complete"

    await db.flush()
    # Refresh only the server-generated timestamps. A bare db.refresh() would
    # re-trigger the AttendanceRecord employee/location/shift selectin loads on
    # this hot recognition path (three extra queries per recognition) for
    # relationships no caller reads here.
    await db.refresh(record, attribute_names=["created_at", "updated_at"])
    if action in ("check_in", "check_out"):
        # Arm only after the write flushed: a failed write or a no-op outcome
        # must not open the duplicate window (see _check_duplicate_shared).
        await _arm_duplicate_shared(dup_key, window)
    record.last_action = action
    return record


async def process_rfid_tap(
    db: AsyncSession,
    employee_id: int,
    reader_direction: str,
) -> AttendanceRecord | None:
    window = settings.rfid_duplicate_window_seconds
    dup_key = f"rfid:{employee_id}"

    emp_stmt = select(Employee).where(Employee.id == employee_id)
    emp_result = await db.execute(emp_stmt)
    employee = emp_result.scalar_one_or_none()
    if employee is None or not employee.is_active:
        return None
    org_id = employee.organization_id

    now = datetime.now(timezone.utc)
    today = local_date(now)

    if reader_direction == "out":
        # Exit-only reader with no row yet: nothing to close out. Short-circuit
        # before _get_or_create_today_record so an exit tap by someone who never
        # tapped an entry reader does not create a bare status='absent' row
        # (mirrors the face check_out path above).
        existing_stmt = select(AttendanceRecord).where(
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.work_date == today,
        )
        if (await db.execute(existing_stmt)).scalar_one_or_none() is None:
            return None

    shift = await _get_active_shift(db, employee_id, today)
    policy = await _get_policy(db, shift, org_id) if org_id else None

    fast_dup = await _check_duplicate_shared(dup_key, window)
    record = await _get_or_create_today_record(
        db,
        employee_id,
        today,
        location_id=employee.location_id if employee else None,
        camera_id=None,
        shift_id=shift.id if shift else None,
    )

    if fast_dup or _recent_action_within(record, window, now):
        # Transient marker so the caller reports the real outcome instead of
        # re-deriving it from timestamps after the write (which misreported a
        # first check-in as duplicate_ignored).
        record.last_action = "duplicate_ignored"
        return record

    is_entry = reader_direction in ("in", "both")
    is_exit = reader_direction in ("out", "both")

    action = "none"
    if is_entry and not record.check_in_at:
        record.check_in_at = now
        record.check_in_method = "rfid"
        record.shift_id = shift.id if shift else record.shift_id
        record.status = _resolve_status(now, shift, policy)
        record.attendance_type = record.status
        action = "check_in"
    elif is_exit and record.check_in_at and not record.check_out_at:
        record.check_out_at = now
        record.check_out_method = "rfid"
        worked, overtime = _calc_worked(record.check_in_at, now, policy)
        record.worked_minutes = worked
        record.overtime_minutes = overtime
        record.status = _resolve_checkout_status(worked, policy, record.status)
        record.attendance_type = record.status
        action = "check_out"

    await db.flush()
    await db.refresh(record, attribute_names=["created_at", "updated_at"])
    if action in ("check_in", "check_out"):
        await _arm_duplicate_shared(dup_key, window)
    record.last_action = action
    return record
