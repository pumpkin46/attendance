"""Tenant-isolation regression tests for shift / policy / leave operations.

Locks the CRITICAL cross-tenant IDOR fix: every by-id operation in
shift_service must scope to the caller's org, and assign_shift /
create_leave_request must reject a client-supplied foreign employee_id.

Rows that have Date/Time columns are built directly with Python date/time
objects: the create schemas type those fields as str, which only the Postgres
driver coerces, so going through them would not bind on the SQLite test DB. The
org-scoping fix lives in the by-id lookups, which these tests exercise.
"""

from __future__ import annotations

from datetime import date, time

import pytest

from app.core.errors import NotFoundError
from app.models.attendance import LeaveRequest, Shift
from app.models.employee import Employee
from app.models.organization import Organization
from app.schemas.attendance import (
    AttendancePolicyCreate,
    LeaveRequestCreate,
    LeaveRequestUpdate,
    ShiftAssignRequest,
    ShiftCreate,
)
from app.services import shift_service, visitor_service


async def _org(session, org_id: int) -> Organization:
    org = Organization(id=org_id, name=f"Org {org_id}", code=f"ORG{org_id}")
    session.add(org)
    await session.flush()
    return org


async def _employee(session, org_id: int) -> Employee:
    emp = Employee(
        organization_id=org_id,
        employee_code=f"EMP-{org_id}",
        first_name="Test",
        last_name="Person",
    )
    session.add(emp)
    await session.flush()
    return emp


async def _shift(session, org_id: int) -> Shift:
    shift = Shift(
        organization_id=org_id,
        name=f"S{org_id}",
        start_time=time(9, 0),
        end_time=time(17, 0),
    )
    session.add(shift)
    await session.flush()
    return shift


@pytest.mark.asyncio
async def test_get_policy_is_tenant_scoped(db_session):
    await _org(db_session, 1)
    await _org(db_session, 2)
    policy = await shift_service.create_policy(db_session, 1, AttendancePolicyCreate(name="P1"))

    assert (await shift_service.get_policy(db_session, policy.id, 1)).id == policy.id
    with pytest.raises(NotFoundError):
        await shift_service.get_policy(db_session, policy.id, 2)


@pytest.mark.asyncio
async def test_update_policy_rejects_cross_tenant(db_session):
    await _org(db_session, 1)
    await _org(db_session, 2)
    policy = await shift_service.create_policy(db_session, 1, AttendancePolicyCreate(name="P1"))
    with pytest.raises(NotFoundError):
        await shift_service.update_policy(
            db_session, policy.id, AttendancePolicyCreate(name="hacked", is_default=True), 2
        )
    # The victim policy is untouched.
    assert (await shift_service.get_policy(db_session, policy.id, 1)).name == "P1"


@pytest.mark.asyncio
async def test_shift_by_id_ops_are_tenant_scoped(db_session):
    await _org(db_session, 1)
    await _org(db_session, 2)
    shift = await _shift(db_session, 1)

    assert (await shift_service.get_shift(db_session, shift.id, 1)).id == shift.id
    with pytest.raises(NotFoundError):
        await shift_service.get_shift(db_session, shift.id, 2)
    with pytest.raises(NotFoundError):
        await shift_service.update_shift(db_session, shift.id, ShiftCreate(name="x"), 2)
    with pytest.raises(NotFoundError):
        await shift_service.deactivate_shift(db_session, shift.id, 2)


@pytest.mark.asyncio
async def test_assign_shift_rejects_foreign_employee(db_session):
    # The foreign-employee guard fires before the assignment row is built.
    await _org(db_session, 1)
    await _org(db_session, 2)
    shift = await _shift(db_session, 1)
    foreign = await _employee(db_session, 2)
    body = ShiftAssignRequest(employee_id=foreign.id, effective_from="2026-01-01")
    with pytest.raises(NotFoundError):
        await shift_service.assign_shift(db_session, shift.id, body, 1)


@pytest.mark.asyncio
async def test_create_leave_request_rejects_foreign_employee(db_session):
    # The foreign-employee guard fires before the leave row is built.
    await _org(db_session, 1)
    await _org(db_session, 2)
    foreign = await _employee(db_session, 2)
    body = LeaveRequestCreate(
        employee_id=foreign.id, type="annual", start_date="2026-01-01", end_date="2026-01-02"
    )
    with pytest.raises(NotFoundError):
        await shift_service.create_leave_request(db_session, body, 1)


@pytest.mark.asyncio
async def test_decide_leave_request_is_tenant_scoped(db_session):
    await _org(db_session, 1)
    await _org(db_session, 2)
    emp1 = await _employee(db_session, 1)
    leave = LeaveRequest(
        employee_id=emp1.id, type="annual", start_date=date(2026, 1, 1), end_date=date(2026, 1, 2)
    )
    db_session.add(leave)
    await db_session.flush()

    with pytest.raises(NotFoundError):
        await shift_service.decide_leave_request(
            db_session, leave.id, LeaveRequestUpdate(status="approved"), approver_id=99, org_id=2
        )
    decided = await shift_service.decide_leave_request(
        db_session, leave.id, LeaveRequestUpdate(status="approved"), approver_id=5, org_id=1
    )
    assert getattr(decided.status, "value", decided.status) == "approved"
    assert decided.approved_by == 5


@pytest.mark.asyncio
async def test_visitor_is_org_employee_rejects_foreign(db_session):
    await _org(db_session, 1)
    await _org(db_session, 2)
    emp1 = await _employee(db_session, 1)
    assert await visitor_service.is_org_employee(db_session, emp1.id, 1) is True
    assert await visitor_service.is_org_employee(db_session, emp1.id, 2) is False
