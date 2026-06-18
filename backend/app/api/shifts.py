from __future__ import annotations

from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
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
from app.services import shift_service

router = APIRouter(prefix="/api/v1", tags=["shifts"])


# ── Attendance Policies ──────────────────────────────────────────────────────


@router.get("/attendance-policies", response_model=list[AttendancePolicyOut])
async def list_policies(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    policies = await shift_service.list_policies(db, org_id)
    return [AttendancePolicyOut.model_validate(p, from_attributes=True) for p in policies]


@router.post("/attendance-policies", status_code=201, response_model=AttendancePolicyOut)
async def create_policy(
    body: AttendancePolicyCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    policy = await shift_service.create_policy(db, org_id, body)
    return AttendancePolicyOut.model_validate(policy, from_attributes=True)


@router.get("/attendance-policies/{policy_id}", response_model=AttendancePolicyOut)
async def get_policy(policy_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    policy = await shift_service.get_policy(db, policy_id, org_id)
    return AttendancePolicyOut.model_validate(policy, from_attributes=True)


@router.put("/attendance-policies/{policy_id}", response_model=AttendancePolicyOut)
async def update_policy(
    policy_id: int,
    body: AttendancePolicyCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    policy = await shift_service.update_policy(db, policy_id, body, org_id)
    return AttendancePolicyOut.model_validate(policy, from_attributes=True)


# ── Shifts ────────────────────────────────────────────────────────────────────


@router.get("/shifts", response_model=list[ShiftOut])
async def list_shifts(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    shifts = await shift_service.list_shifts(db, org_id)
    return [ShiftOut.model_validate(s, from_attributes=True) for s in shifts]


@router.post("/shifts", status_code=201, response_model=ShiftOut)
async def create_shift(
    body: ShiftCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    shift = await shift_service.create_shift(db, org_id, body)
    return ShiftOut.model_validate(shift, from_attributes=True)


@router.get("/shifts/{shift_id}", response_model=ShiftOut)
async def get_shift(shift_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    shift = await shift_service.get_shift(db, shift_id, org_id)
    return ShiftOut.model_validate(shift, from_attributes=True)


@router.put("/shifts/{shift_id}", response_model=ShiftOut)
async def update_shift(
    shift_id: int,
    body: ShiftCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    shift = await shift_service.update_shift(db, shift_id, body, org_id)
    return ShiftOut.model_validate(shift, from_attributes=True)


@router.delete("/shifts/{shift_id}", status_code=204)
async def delete_shift(
    shift_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    await shift_service.deactivate_shift(db, shift_id, org_id)
    return None


@router.post("/shifts/{shift_id}/assign", status_code=201, response_model=ShiftAssignmentOut)
async def assign_shift(
    shift_id: int,
    body: ShiftAssignRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("shifts.manage"),
):
    assignment = await shift_service.assign_shift(db, shift_id, body, org_id)
    return ShiftAssignmentOut(
        id=assignment.id,
        shift_id=assignment.shift_id,
        employee_id=assignment.employee_id,
        effective_from=str(assignment.effective_from),
        effective_to=str(assignment.effective_to) if assignment.effective_to else None,
    )


# ── Holidays ──────────────────────────────────────────────────────────────────


@router.get("/holidays", response_model=list[HolidayOut])
async def list_holidays(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    holidays = await shift_service.list_holidays(db, org_id)
    return [HolidayOut.model_validate(h, from_attributes=True) for h in holidays]


@router.post("/holidays", status_code=201, response_model=HolidayOut)
async def create_holiday(
    body: HolidayCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("holidays.manage"),
):
    holiday = await shift_service.create_holiday(db, org_id, body)
    return HolidayOut.model_validate(holiday, from_attributes=True)


# ── Leave Requests ────────────────────────────────────────────────────────────


@router.get("/leave-requests", response_model=PaginatedResponse[LeaveRequestOut])
async def list_leave_requests(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = shift_service.leave_requests_query(org_id)
    return await paginate(db, stmt, pagination.page, pagination.per_page, LeaveRequestOut)


@router.post("/leave-requests", status_code=201, response_model=LeaveRequestOut)
async def create_leave_request(
    body: LeaveRequestCreate,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    leave = await shift_service.create_leave_request(db, body, org_id)
    return LeaveRequestOut.model_validate(leave, from_attributes=True)


@router.patch("/leave-requests/{leave_id}", response_model=LeaveRequestOut)
async def update_leave_request(
    leave_id: int,
    body: LeaveRequestUpdate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("leave.approve"),
):
    leave = await shift_service.decide_leave_request(db, leave_id, body, user.id, org_id)
    return LeaveRequestOut.model_validate(leave, from_attributes=True)
