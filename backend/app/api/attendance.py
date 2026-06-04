from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query

from sqlalchemy import func, select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, PaginationParams, paginate, PaginationDep
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.schemas.attendance import (
    SHIFT_TYPES,
    AttendanceConfigResponse,
    AttendanceManualRequest,
    AttendanceRecordOut,
    TodaySummary,
)

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
    employee_id: int | None = Query(None),
    status: str | None = Query(None),
):
    stmt = select(AttendanceRecord).order_by(AttendanceRecord.work_date.desc())

    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        stmt = stmt.where(AttendanceRecord.employee_id.in_(emp_ids))

    if work_date:
        stmt = stmt.where(AttendanceRecord.work_date == work_date)
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
    today = date.today()

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
    user: require_permission("attendance.manage"),
):
    from datetime import datetime, timezone

    stmt = select(AttendanceRecord).where(
        AttendanceRecord.employee_id == body.employee_id,
        AttendanceRecord.work_date == body.work_date,
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if record is None:
        record = AttendanceRecord(
            employee_id=body.employee_id,
            work_date=body.work_date,
            status="absent",
        )
        db.add(record)
        await db.flush()

    if body.check_in_at:
        record.check_in_at = datetime.fromisoformat(body.check_in_at)
        record.check_in_method = "manual"
        record.status = "present"
        record.attendance_type = "present"

    if body.check_out_at:
        record.check_out_at = datetime.fromisoformat(body.check_out_at)
        record.check_out_method = "manual"
        if record.check_in_at and record.check_out_at:
            diff = (record.check_out_at - record.check_in_at).total_seconds()
            record.worked_minutes = max(0, int(diff / 60) - settings.attendance_break_minutes)
            record.overtime_minutes = max(
                0, record.worked_minutes - settings.attendance_overtime_threshold_minutes
            )

    if body.notes:
        record.notes = body.notes

    await db.flush()
    await db.refresh(record)

    return AttendanceRecordOut.model_validate(record, from_attributes=True)
