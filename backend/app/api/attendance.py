from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from sqlalchemy import func, select
from sqlalchemy.orm import lazyload

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.core.timeutil import local_date
from app.core.pagination import PaginatedResponse, paginate, PaginationDep
from app.middleware.tenant import apply_tenant_filter
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.schemas.attendance import (
    SHIFT_TYPES,
    AttendanceConfigResponse,
    AttendanceManualRequest,
    AttendanceRecordOut,
    TodaySummary,
)
from app.services import attendance_service

router = APIRouter(prefix="/api/v1", tags=["attendance"])


@router.get("/attendance/config", response_model=AttendanceConfigResponse)
async def attendance_config(user: CurrentUser) -> AttendanceConfigResponse:
    return AttendanceConfigResponse(
        attendance_grace_minutes=settings.attendance_grace_minutes,
        attendance_min_work_minutes=settings.attendance_min_work_minutes,
        attendance_max_work_minutes=settings.attendance_max_work_minutes,
        attendance_break_minutes=settings.attendance_break_minutes,
        attendance_half_day_minutes=settings.attendance_half_day_minutes,
        attendance_min_confidence=settings.attendance_min_confidence,
        attendance_overtime_threshold_minutes=settings.attendance_overtime_threshold_minutes,
        face_duplicate_window_seconds=settings.face_duplicate_window_seconds,
        rfid_duplicate_window_seconds=settings.rfid_duplicate_window_seconds,
        anomaly_detection_enabled=settings.anomaly_detection_enabled,
        anomaly_lookback_days=settings.anomaly_lookback_days,
        shift_types=SHIFT_TYPES,
    )


@router.get("/attendance", response_model=PaginatedResponse[AttendanceRecordOut])
async def list_attendance(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    pagination: PaginationDep,
    work_date: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    employee_id: int | None = Query(None),
    status: str | None = Query(None),
):
    def _parse(label: str, value: str) -> date:
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise ValidationError(f"{label} must be an ISO date (YYYY-MM-DD)")
    # AttendanceRecordOut is flat (scalar FK columns only), but the model marks
    # employee/location/shift as lazy="selectin" — which would fire several extra
    # queries per page (and employee cascades into its own selectins). Suppress
    # them; the serializer never touches these relationships.
    stmt = (
        select(AttendanceRecord)
        .options(
            lazyload(AttendanceRecord.employee),
            lazyload(AttendanceRecord.location),
            lazyload(AttendanceRecord.shift),
        )
        .order_by(AttendanceRecord.work_date.desc())
    )

    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        stmt = stmt.where(AttendanceRecord.employee_id.in_(emp_ids))

    if work_date:
        stmt = stmt.where(AttendanceRecord.work_date == _parse("work_date", work_date))
    # Date-range filter — keeps the scan/count bounded to the requested window
    # instead of the whole table (the dashboard/list both query recent days).
    if date_from:
        stmt = stmt.where(AttendanceRecord.work_date >= _parse("date_from", date_from))
    if date_to:
        stmt = stmt.where(AttendanceRecord.work_date <= _parse("date_to", date_to))
    if employee_id:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    if status:
        stmt = stmt.where(AttendanceRecord.status == status)

    return await paginate(db, stmt, pagination.page, pagination.per_page, AttendanceRecordOut)


@router.get("/attendance/today", response_model=TodaySummary)
async def today_summary(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
) -> TodaySummary:
    today = local_date()

    emp_stmt = select(func.count(Employee.id)).where(Employee.is_active == True)  # noqa: E712
    if org_id:
        emp_stmt = emp_stmt.where(Employee.organization_id == org_id)
    total_employees = (await db.execute(emp_stmt)).scalar() or 0

    base = select(AttendanceRecord).where(AttendanceRecord.work_date == today)
    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        base = base.where(AttendanceRecord.employee_id.in_(emp_ids))

    result = await db.execute(base)
    records = list(result.scalars().all())

    present = sum(1 for r in records if r.status in ("present", "late"))
    late = sum(1 for r in records if r.status == "late")
    on_leave = sum(1 for r in records if r.status == "on_leave")
    absent = total_employees - present - on_leave

    return TodaySummary(
        total_employees=total_employees,
        present=present,
        late=late,
        absent=max(0, absent),
        on_leave=on_leave,
    )


@router.post("/attendance/manual", response_model=AttendanceRecordOut)
async def create_manual_attendance(
    body: AttendanceManualRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("attendance.manage"),
):
    # Tenant scope: an org admin must not be able to write attendance for an
    # employee in another org. Loading the employee through the tenant filter
    # gives a clean 404 instead of an orphaned record on a bad id, and its org
    # drives the shift/policy used to classify the entry.
    emp_stmt = select(Employee).where(Employee.id == body.employee_id)
    emp_stmt = apply_tenant_filter(emp_stmt, org_id, Employee.organization_id)
    employee = (await db.execute(emp_stmt)).scalar_one_or_none()
    if employee is None:
        raise NotFoundError("Employee not found")

    # check_in_at / check_out_at arrive already tz-aware (the schema coerces
    # naive UI input to the app timezone). The service derives status from the
    # employee's shift/policy (lateness, half_day/early_leave) instead of
    # hardcoding 'present', and recovers from a concurrent-insert race.
    record = await attendance_service.apply_manual_attendance(
        db,
        employee_id=employee.id,
        organization_id=employee.organization_id,
        work_date=body.work_date,
        check_in_at=body.check_in_at,
        check_out_at=body.check_out_at,
        notes=body.notes,
    )

    return AttendanceRecordOut.model_validate(record, from_attributes=True)
