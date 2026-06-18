"""DB-backed behavioral tests for the attendance check-in/out state machine.

Exercises process_recognition / process_rfid_tap against a real SQLite session
(the prior suite only inspected signatures). Covers the check-in -> check-out
-> already-complete progression, duplicate suppression, the
UNIQUE(employee_id, work_date) single-row-per-day guarantee, and the
deleted/inactive-employee guard from the Tier-1 fix.
"""

from __future__ import annotations

import pytest

from app.models.employee import Employee
from app.models.organization import Organization
from app.services.attendance_service import process_recognition, process_rfid_tap


async def _make_employee(session, *, org_id: int = 1, active: bool = True) -> Employee:
    org = await session.get(Organization, org_id)
    if org is None:
        org = Organization(id=org_id, name=f"Org {org_id}", code=f"ORG{org_id}")
        session.add(org)
        await session.flush()
    emp = Employee(
        organization_id=org_id,
        employee_code=f"EMP-{org_id}-{'A' if active else 'X'}",
        first_name="Test",
        last_name="Person",
        is_active=active,
    )
    session.add(emp)
    await session.flush()
    return emp


@pytest.fixture
def no_dup_window(monkeypatch):
    """Disable the duplicate window so successive calls advance the state."""
    monkeypatch.setattr("app.core.config.settings.face_duplicate_window_seconds", 0)
    monkeypatch.setattr("app.core.config.settings.rfid_duplicate_window_seconds", 0)


@pytest.mark.asyncio
async def test_check_in_then_check_out_progression(db_session, no_dup_window):
    emp = await _make_employee(db_session)

    rec1 = await process_recognition(db_session, emp.id, confidence=0.9)
    assert rec1 is not None
    assert rec1.last_action == "check_in"
    assert rec1.check_in_at is not None
    assert rec1.check_out_at is None
    assert rec1.status in ("present", "late")

    rec2 = await process_recognition(db_session, emp.id, confidence=0.9)
    assert rec2.last_action == "check_out"
    assert rec2.check_out_at is not None
    assert rec2.id == rec1.id  # same day -> same record

    rec3 = await process_recognition(db_session, emp.id, confidence=0.9)
    assert rec3.last_action == "already_complete"


@pytest.mark.asyncio
async def test_single_row_per_employee_per_day(db_session, no_dup_window):
    emp = await _make_employee(db_session)
    await process_recognition(db_session, emp.id)
    await process_recognition(db_session, emp.id)

    from sqlalchemy import func, select
    from app.models.attendance import AttendanceRecord

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(AttendanceRecord)
            .where(AttendanceRecord.employee_id == emp.id)
        )
    ).scalar()
    assert count == 1


@pytest.mark.asyncio
async def test_duplicate_within_window_is_ignored(db_session):
    # Default window (60s) is active: a second recognition right after the
    # first must be suppressed, not flipped into a check-out.
    emp = await _make_employee(db_session)
    rec1 = await process_recognition(db_session, emp.id)
    assert rec1.last_action == "check_in"

    rec2 = await process_recognition(db_session, emp.id)
    assert rec2.last_action == "duplicate_ignored"
    assert rec2.check_out_at is None


@pytest.mark.asyncio
async def test_missing_employee_returns_none(db_session):
    # Stale FAISS vector after a hard delete: no employee row.
    assert await process_recognition(db_session, 999999) is None


@pytest.mark.asyncio
async def test_inactive_employee_returns_none(db_session):
    emp = await _make_employee(db_session, active=False)
    assert await process_recognition(db_session, emp.id) is None


@pytest.mark.asyncio
async def test_check_in_intent_never_toggles_to_check_out(db_session, no_dup_window):
    # Regression for the live-camera corruption bug: a continuously visible
    # person re-emits CHECK_IN events, which must not flip them out.
    emp = await _make_employee(db_session)
    rec1 = await process_recognition(db_session, emp.id, intent="check_in")
    assert rec1.last_action == "check_in"

    rec2 = await process_recognition(db_session, emp.id, intent="check_in")
    assert rec2.last_action == "already_checked_in"
    assert rec2.check_out_at is None
    assert rec2.status == rec1.status


@pytest.mark.asyncio
async def test_check_out_intent_without_record_writes_nothing(db_session, no_dup_window):
    # An exit-camera sighting with no record for the day must not create a
    # bare status='absent' row on its way to deciding "nothing to do".
    emp = await _make_employee(db_session)
    rec = await process_recognition(db_session, emp.id, intent="check_out")
    assert rec is None

    from sqlalchemy import func, select
    from app.models.attendance import AttendanceRecord

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(AttendanceRecord)
            .where(AttendanceRecord.employee_id == emp.id)
        )
    ).scalar()
    assert count == 0


@pytest.mark.asyncio
async def test_check_out_intent_after_check_in_checks_out(db_session, no_dup_window):
    emp = await _make_employee(db_session)
    await process_recognition(db_session, emp.id, intent="check_in")

    rec = await process_recognition(db_session, emp.id, intent="check_out")
    assert rec.last_action == "check_out"
    assert rec.check_out_at is not None

    rec_again = await process_recognition(db_session, emp.id, intent="check_out")
    assert rec_again.last_action == "already_complete"


@pytest.mark.asyncio
async def test_marker_arms_only_on_real_actions(db_session, no_dup_window):
    # The duplicate fast-path must arm only after a successful check-in/out
    # write; no-op outcomes must leave it untouched.
    import app.services.attendance_service as att

    emp = await _make_employee(db_session)
    key = f"face:{emp.id}"

    rec = await process_recognition(db_session, emp.id, intent="check_in")
    assert rec.last_action == "check_in"
    assert key in att._dup_cache  # armed after the successful write

    await att.clear_duplicate_marker(emp.id)
    assert key not in att._dup_cache

    rec2 = await process_recognition(db_session, emp.id, intent="check_in")
    assert rec2.last_action == "already_checked_in"
    assert key not in att._dup_cache  # a no-op must never arm


@pytest.mark.asyncio
async def test_duplicate_noop_does_not_rearm_marker(db_session):
    # Default window active: duplicate_ignored (from persisted state) is a
    # no-op and must not re-arm a cleared marker.
    import app.services.attendance_service as att

    emp = await _make_employee(db_session)
    key = f"face:{emp.id}"

    rec = await process_recognition(db_session, emp.id)
    assert rec.last_action == "check_in"
    assert key in att._dup_cache

    await att.clear_duplicate_marker(emp.id)
    rec2 = await process_recognition(db_session, emp.id)
    assert rec2.last_action == "duplicate_ignored"
    assert key not in att._dup_cache


@pytest.mark.asyncio
async def test_exit_sighting_does_not_suppress_entry_check_in(db_session):
    # Round-1 regression: with the default window active, an exit-camera
    # sighting before any check-in must not arm the duplicate window and
    # swallow the genuine entry punch that follows.
    emp = await _make_employee(db_session)
    assert await process_recognition(db_session, emp.id, intent="check_out") is None

    rec = await process_recognition(db_session, emp.id, intent="check_in")
    assert rec is not None
    assert rec.last_action == "check_in"


@pytest.mark.asyncio
async def test_organization_mismatch_returns_none_and_writes_nothing(db_session):
    emp = await _make_employee(db_session)
    other_org = emp.organization_id + 1

    result = await process_recognition(db_session, emp.id, organization_id=other_org)
    assert result is None

    from sqlalchemy import func, select
    from app.models.attendance import AttendanceRecord

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(AttendanceRecord)
            .where(AttendanceRecord.employee_id == emp.id)
        )
    ).scalar()
    assert count == 0


@pytest.mark.asyncio
async def test_rfid_first_tap_reports_check_in(db_session, no_dup_window):
    # Regression: the first RFID tap must report check_in, not duplicate_ignored.
    emp = await _make_employee(db_session)
    rec = await process_rfid_tap(db_session, emp.id, "in")
    assert rec is not None
    assert rec.last_action == "check_in"

    rec_out = await process_rfid_tap(db_session, emp.id, "out")
    assert rec_out.last_action == "check_out"


@pytest.mark.asyncio
async def test_rfid_inactive_employee_returns_none(db_session):
    emp = await _make_employee(db_session, active=False)
    assert await process_rfid_tap(db_session, emp.id, "in") is None


@pytest.mark.asyncio
async def test_rfid_exit_only_without_checkin_creates_no_row(db_session, no_dup_window):
    # An exit-only reader tapped by someone who never tapped an entry reader
    # must not create a bare status='absent' row (mirrors the face check_out path).
    emp = await _make_employee(db_session)
    result = await process_rfid_tap(db_session, emp.id, "out")
    assert result is None

    from sqlalchemy import func, select
    from app.models.attendance import AttendanceRecord

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(AttendanceRecord)
            .where(AttendanceRecord.employee_id == emp.id)
        )
    ).scalar()
    assert count == 0


def test_resolve_checkout_status_early_leave():
    from types import SimpleNamespace

    from app.services.attendance_service import _resolve_checkout_status

    policy = SimpleNamespace(half_day_minutes=120, min_work_minutes=300)
    assert _resolve_checkout_status(100, policy, "present") == "half_day"
    assert _resolve_checkout_status(200, policy, "present") == "early_leave"
    assert _resolve_checkout_status(350, policy, "present") == "present"
    assert _resolve_checkout_status(350, policy, "late") == "late"


@pytest.mark.asyncio
async def test_apply_manual_attendance_is_idempotent_and_computes_worked(db_session):
    # Re-posting the same day updates the same row (no UNIQUE violation / 500),
    # and worked minutes are computed from the supplied times.
    from datetime import date, datetime, timezone

    from app.services.attendance_service import apply_manual_attendance

    emp = await _make_employee(db_session)
    ci = datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc)
    co = datetime(2026, 1, 5, 17, 0, tzinfo=timezone.utc)

    rec = await apply_manual_attendance(
        db_session,
        employee_id=emp.id,
        organization_id=emp.organization_id,
        work_date=date(2026, 1, 5),
        check_in_at=ci,
        check_out_at=co,
        notes="entered by admin",
    )
    assert rec.check_in_at is not None and rec.check_out_at is not None
    assert rec.worked_minutes > 0

    rec2 = await apply_manual_attendance(
        db_session,
        employee_id=emp.id,
        organization_id=emp.organization_id,
        work_date=date(2026, 1, 5),
        check_in_at=ci,
        check_out_at=co,
        notes="corrected",
    )
    assert rec2.id == rec.id
