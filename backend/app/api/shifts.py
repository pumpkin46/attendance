from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status

from sqlalchemy import select

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.core.pagination import PaginatedResponse, PaginationParams, paginate, PaginationDep
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
    AttendancePolicyOut,
    HolidayCreate,
    HolidayOut,
    LeaveRequestCreate,
    LeaveRequestOut,
    LeaveRequestUpdate,
    ShiftAssignmentOut,
    ShiftAssignRequest,
    ShiftCreate,
    ShiftOut,
)

router = APIRouter(prefix="/api/v1", tags=["shifts"])


# ── Attendance Policies ──────────────────────────────────────────────────────


@router.get("/attendance-policies", response_model=list[AttendancePolicyOut])
async def list_policies(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = (
        select(AttendancePolicy)
        .where(AttendancePolicy.is_active == True)  # noqa: E712
        .order_by(AttendancePolicy.name)
    )
    stmt = apply_tenant_filter(stmt, org_id, AttendancePolicy.organization_id)
    result = await db.execute(stmt)
    items = list(result.scalars().all())
    return [AttendancePolicyOut.model_validate(p, from_attributes=True) for p in items]


@router.post("/attendance-policies", status_code=201, response_model=AttendancePolicyOut)
async def create_policy(
    body: AttendancePolicyCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")

    if body.is_default:
        reset = (
            select(AttendancePolicy)
            .where(
                AttendancePolicy.organization_id == org_id,
                AttendancePolicy.is_default == True,  # noqa: E712
            )
        )
        result = await db.execute(reset)
        for p in result.scalars().all():
            p.is_default = False

    policy = AttendancePolicy(organization_id=org_id, **body.model_dump())
    db.add(policy)
    await db.flush()
    await db.refresh(policy)
    return AttendancePolicyOut.model_validate(policy, from_attributes=True)


@router.get("/attendance-policies/{policy_id}", response_model=AttendancePolicyOut)
async def get_policy(
    policy_id: int,
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(AttendancePolicy).where(AttendancePolicy.id == policy_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    if not policy:
        raise NotFoundError("Policy not found")
    return AttendancePolicyOut.model_validate(policy, from_attributes=True)


@router.put("/attendance-policies/{policy_id}", response_model=AttendancePolicyOut)
async def update_policy(
    policy_id: int,
    body: AttendancePolicyCreate,
    db: DbSession,
    user: require_permission("shifts.manage"),
):
    stmt = select(AttendancePolicy).where(AttendancePolicy.id == policy_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    if not policy:
        raise NotFoundError("Policy not found")

    if body.is_default:
        reset_stmt = (
            select(AttendancePolicy)
            .where(
                AttendancePolicy.organization_id == policy.organization_id,
                AttendancePolicy.id != policy_id,
                AttendancePolicy.is_default == True,  # noqa: E712
            )
        )
        reset_result = await db.execute(reset_stmt)
        for p in reset_result.scalars().all():
            p.is_default = False

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)

    await db.flush()
    await db.refresh(policy)
    return AttendancePolicyOut.model_validate(policy, from_attributes=True)


# ── Shifts ────────────────────────────────────────────────────────────────────


@router.get("/shifts", response_model=list[ShiftOut])
async def list_shifts(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = (
        select(Shift)
        .where(Shift.is_active == True)  # noqa: E712
        .order_by(Shift.name)
    )
    stmt = apply_tenant_filter(stmt, org_id, Shift.organization_id)
    result = await db.execute(stmt)
    items = list(result.scalars().all())
    return [ShiftOut.model_validate(s, from_attributes=True) for s in items]


@router.post("/shifts", status_code=201, response_model=ShiftOut)
async def create_shift(
    body: ShiftCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")

    shift = Shift(organization_id=org_id, **body.model_dump())
    db.add(shift)
    await db.flush()
    await db.refresh(shift)
    return ShiftOut.model_validate(shift, from_attributes=True)


@router.get("/shifts/{shift_id}", response_model=ShiftOut)
async def get_shift(
    shift_id: int,
    db: DbSession,
    user: CurrentUser,
):
    stmt = select(Shift).where(Shift.id == shift_id)
    result = await db.execute(stmt)
    shift = result.scalar_one_or_none()
    if not shift:
        raise NotFoundError("Shift not found")
    return ShiftOut.model_validate(shift, from_attributes=True)


@router.put("/shifts/{shift_id}", response_model=ShiftOut)
async def update_shift(
    shift_id: int,
    body: ShiftCreate,
    db: DbSession,
    user: require_permission("shifts.manage"),
):
    stmt = select(Shift).where(Shift.id == shift_id)
    result = await db.execute(stmt)
    shift = result.scalar_one_or_none()
    if not shift:
        raise NotFoundError("Shift not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)

    await db.flush()
    await db.refresh(shift)
    return ShiftOut.model_validate(shift, from_attributes=True)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: int,
    db: DbSession,
    user: require_permission("shifts.manage"),
):
    stmt = select(Shift).where(Shift.id == shift_id)
    result = await db.execute(stmt)
    shift = result.scalar_one_or_none()
    if not shift:
        raise NotFoundError("Shift not found")

    shift.is_active = False
    await db.flush()
    return None


@router.post("/shifts/{shift_id}/assign", status_code=201, response_model=ShiftAssignmentOut)
async def assign_shift(
    shift_id: int,
    body: ShiftAssignRequest,
    db: DbSession,
    user: require_permission("shifts.manage"),
):
    stmt = select(Shift).where(Shift.id == shift_id)
    result = await db.execute(stmt)
    shift = result.scalar_one_or_none()
    if not shift:
        raise NotFoundError("Shift not found")

    assignment = ShiftAssignment(
        shift_id=shift_id,
        employee_id=body.employee_id,
        effective_from=body.effective_from,
        effective_to=body.effective_to,
    )
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment)

    return ShiftAssignmentOut(
        id=assignment.id,
        shift_id=assignment.shift_id,
        employee_id=assignment.employee_id,
        effective_from=str(assignment.effective_from),
        effective_to=str(assignment.effective_to) if assignment.effective_to else None,
    )


# ── Holidays ──────────────────────────────────────────────────────────────────


@router.get("/holidays", response_model=list[HolidayOut])
async def list_holidays(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = select(Holiday).order_by(Holiday.date)
    stmt = apply_tenant_filter(stmt, org_id, Holiday.organization_id)
    result = await db.execute(stmt)
    items = list(result.scalars().all())
    return [HolidayOut.model_validate(h, from_attributes=True) for h in items]


@router.post("/holidays", status_code=201, response_model=HolidayOut)
async def create_holiday(
    body: HolidayCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("holidays.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")

    holiday = Holiday(organization_id=org_id, **body.model_dump())
    db.add(holiday)
    await db.flush()
    await db.refresh(holiday)
    return HolidayOut.model_validate(holiday, from_attributes=True)


# ── Leave Requests ────────────────────────────────────────────────────────────


@router.get("/leave-requests", response_model=PaginatedResponse[LeaveRequestOut])
async def list_leave_requests(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = select(LeaveRequest).order_by(LeaveRequest.created_at.desc())
    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        stmt = stmt.where(LeaveRequest.employee_id.in_(emp_ids))

    return await paginate(db, stmt, pagination.page, pagination.per_page, LeaveRequestOut)


@router.post("/leave-requests", status_code=201, response_model=LeaveRequestOut)
async def create_leave_request(
    body: LeaveRequestCreate,
    db: DbSession,
    user: CurrentUser,
):
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
    return LeaveRequestOut.model_validate(leave, from_attributes=True)


@router.patch("/leave-requests/{leave_id}", response_model=LeaveRequestOut)
async def update_leave_request(
    leave_id: int,
    body: LeaveRequestUpdate,
    db: DbSession,
    user: require_permission("leave.approve"),
):
    stmt = select(LeaveRequest).where(LeaveRequest.id == leave_id)
    result = await db.execute(stmt)
    leave = result.scalar_one_or_none()
    if not leave:
        raise NotFoundError("Leave request not found")

    leave.status = body.status
    leave.approved_by = user.id
    leave.approved_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(leave)
    return LeaveRequestOut.model_validate(leave, from_attributes=True)
