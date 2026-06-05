"""Shift, attendance-policy, holiday, and leave business logic.

Keeps the shifts router thin: handlers do auth + (de)serialization and delegate
all queries and rules here. Services raise app-level errors (NotFoundError /
ValidationError) which the global handlers translate to HTTP responses.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.attendance import (
    AttendancePolicy,
    Holiday,
    LeaveRequest,
    Shift,
    ShiftAssignment,
)
from app.models.employee import Employee
from app.schemas.attendance import (
    AttendancePolicyCreate,
    HolidayCreate,
    LeaveRequestCreate,
    LeaveRequestUpdate,
    ShiftAssignRequest,
    ShiftCreate,
)


# ── Attendance policies ───────────────────────────────────────────────────────


async def list_policies(db: AsyncSession, org_id: int | None) -> list[AttendancePolicy]:
    stmt = (
        select(AttendancePolicy)
        .where(AttendancePolicy.is_active == True)  # noqa: E712
        .order_by(AttendancePolicy.name)
    )
    stmt = apply_tenant_filter(stmt, org_id, AttendancePolicy.organization_id)
    return list((await db.execute(stmt)).scalars().all())


async def _clear_default_policies(
    db: AsyncSession, organization_id: int, *, exclude_id: int | None = None
) -> None:
    stmt = select(AttendancePolicy).where(
        AttendancePolicy.organization_id == organization_id,
        AttendancePolicy.is_default == True,  # noqa: E712
    )
    if exclude_id is not None:
        stmt = stmt.where(AttendancePolicy.id != exclude_id)
    for policy in (await db.execute(stmt)).scalars().all():
        policy.is_default = False


async def create_policy(
    db: AsyncSession, org_id: int | None, body: AttendancePolicyCreate
) -> AttendancePolicy:
    if org_id is None:
        raise ValidationError("Organization context required")
    if body.is_default:
        await _clear_default_policies(db, org_id)
    policy = AttendancePolicy(organization_id=org_id, **body.model_dump())
    db.add(policy)
    await db.flush()
    await db.refresh(policy)
    return policy


async def get_policy(db: AsyncSession, policy_id: int) -> AttendancePolicy:
    policy = (
        await db.execute(select(AttendancePolicy).where(AttendancePolicy.id == policy_id))
    ).scalar_one_or_none()
    if not policy:
        raise NotFoundError("Policy not found")
    return policy


async def update_policy(
    db: AsyncSession, policy_id: int, body: AttendancePolicyCreate
) -> AttendancePolicy:
    policy = await get_policy(db, policy_id)
    if body.is_default:
        await _clear_default_policies(db, policy.organization_id, exclude_id=policy_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)
    await db.flush()
    await db.refresh(policy)
    return policy


# ── Shifts ────────────────────────────────────────────────────────────────────


async def list_shifts(db: AsyncSession, org_id: int | None) -> list[Shift]:
    stmt = (
        select(Shift).where(Shift.is_active == True).order_by(Shift.name)  # noqa: E712
    )
    stmt = apply_tenant_filter(stmt, org_id, Shift.organization_id)
    return list((await db.execute(stmt)).scalars().all())


async def create_shift(db: AsyncSession, org_id: int | None, body: ShiftCreate) -> Shift:
    if org_id is None:
        raise ValidationError("Organization context required")
    shift = Shift(organization_id=org_id, **body.model_dump())
    db.add(shift)
    await db.flush()
    await db.refresh(shift)
    return shift


async def get_shift(db: AsyncSession, shift_id: int) -> Shift:
    shift = (
        await db.execute(select(Shift).where(Shift.id == shift_id))
    ).scalar_one_or_none()
    if not shift:
        raise NotFoundError("Shift not found")
    return shift


async def update_shift(db: AsyncSession, shift_id: int, body: ShiftCreate) -> Shift:
    shift = await get_shift(db, shift_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)
    await db.flush()
    await db.refresh(shift)
    return shift


async def deactivate_shift(db: AsyncSession, shift_id: int) -> None:
    shift = await get_shift(db, shift_id)
    shift.is_active = False
    await db.flush()


async def assign_shift(
    db: AsyncSession, shift_id: int, body: ShiftAssignRequest
) -> ShiftAssignment:
    await get_shift(db, shift_id)
    assignment = ShiftAssignment(
        shift_id=shift_id,
        employee_id=body.employee_id,
        effective_from=body.effective_from,
        effective_to=body.effective_to,
    )
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment)
    return assignment


# ── Holidays ──────────────────────────────────────────────────────────────────


async def list_holidays(db: AsyncSession, org_id: int | None) -> list[Holiday]:
    stmt = select(Holiday).order_by(Holiday.date)
    stmt = apply_tenant_filter(stmt, org_id, Holiday.organization_id)
    return list((await db.execute(stmt)).scalars().all())


async def create_holiday(
    db: AsyncSession, org_id: int | None, body: HolidayCreate
) -> Holiday:
    if org_id is None:
        raise ValidationError("Organization context required")
    holiday = Holiday(organization_id=org_id, **body.model_dump())
    db.add(holiday)
    await db.flush()
    await db.refresh(holiday)
    return holiday


# ── Leave requests ────────────────────────────────────────────────────────────


def leave_requests_query(org_id: int | None) -> Select:
    """Statement for paginated leave-request listing (router applies paginate)."""
    stmt = select(LeaveRequest).order_by(LeaveRequest.created_at.desc())
    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        stmt = stmt.where(LeaveRequest.employee_id.in_(emp_ids))
    return stmt


async def create_leave_request(
    db: AsyncSession, body: LeaveRequestCreate
) -> LeaveRequest:
    leave = LeaveRequest(
        employee_id=body.employee_id,
        type=body.type,
        start_date=body.start_date,
        end_date=body.end_date,
        reason=body.reason,
    )
    db.add(leave)
    await db.flush()
    await db.refresh(leave)
    return leave


async def decide_leave_request(
    db: AsyncSession, leave_id: int, body: LeaveRequestUpdate, approver_id: int
) -> LeaveRequest:
    leave = (
        await db.execute(select(LeaveRequest).where(LeaveRequest.id == leave_id))
    ).scalar_one_or_none()
    if not leave:
        raise NotFoundError("Leave request not found")
    leave.status = body.status
    leave.approved_by = approver_id
    leave.approved_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(leave)
    return leave
