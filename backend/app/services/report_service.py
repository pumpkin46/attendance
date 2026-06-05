"""Attendance reporting: daily/monthly/summary/overtime + CSV export.

All querying and aggregation lives here; the reports router only resolves query
params and wraps results (response models, CSV streaming).
"""

from __future__ import annotations

import csv
import io
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.tenant import apply_tenant_filter
from app.models.attendance import AttendanceRecord, Holiday, LeaveRequest
from app.models.employee import Employee
from app.models.recognition import RecognitionEvent, RecognitionResult
from app.schemas.report import (
    AttendanceSummaryReport,
    DailyEmployeeEntry,
    DailyReport,
    MonthlyEmployeeEntry,
    MonthlyReport,
    MonthlySummary,
    OvertimeEntry,
    OvertimeReport,
)


def _employee_name(employee: Employee | None) -> str:
    if employee is None:
        return "Unknown"
    return f"{employee.first_name} {employee.last_name}"


async def _fetch_working_days(
    db: AsyncSession, start: date, end: date, org_id: int | None
) -> int:
    holiday_stmt = select(Holiday.date).where(Holiday.date >= start, Holiday.date <= end)
    if org_id is not None:
        holiday_stmt = holiday_stmt.where(Holiday.organization_id == org_id)
    holidays = {row[0] for row in (await db.execute(holiday_stmt)).all()}

    count = 0
    day = start
    while day <= end:
        if day.weekday() < 5 and day not in holidays:
            count += 1
        day += timedelta(days=1)
    return count


def format_unknown_person_event(event: RecognitionEvent) -> dict:
    result = event.result.value if isinstance(event.result, RecognitionResult) else event.result
    camera = None
    if event.camera is not None:
        camera = {"id": event.camera.id, "name": event.camera.name}
    return {
        "id": event.id,
        "camera_id": event.camera_id,
        "result": result,
        "confidence": float(event.confidence) if event.confidence is not None else None,
        "snapshot_path": event.snapshot_path,
        "snapshot_url": (
            f"/api/v1/recognition/events/{event.id}/snapshot" if event.snapshot_path else None
        ),
        "notified_at": event.notified_at,
        "recognized_at": event.recognized_at,
        "metadata": event.meta,
        "camera": camera,
    }


async def daily_report(
    db: AsyncSession, org_id: int | None, target: date, location_id: int | None
) -> DailyReport:
    att_stmt = select(AttendanceRecord).where(AttendanceRecord.work_date == target)
    if location_id is not None:
        att_stmt = att_stmt.where(AttendanceRecord.location_id == location_id)
    att_stmt = att_stmt.join(Employee, AttendanceRecord.employee_id == Employee.id)
    att_stmt = apply_tenant_filter(att_stmt, org_id, Employee.organization_id)
    records = list((await db.execute(att_stmt)).scalars().unique().all())

    employees = [
        DailyEmployeeEntry(
            employee_code=r.employee.employee_code if r.employee else "",
            employee_name=_employee_name(r.employee),
            status=r.status,
            check_in_at=r.check_in_at,
            check_out_at=r.check_out_at,
            worked_minutes=r.worked_minutes or 0,
            overtime_minutes=r.overtime_minutes or 0,
        )
        for r in records
    ]

    return DailyReport(
        date=target,
        present=sum(1 for r in records if r.status == "present"),
        absent=sum(1 for r in records if r.status == "absent"),
        late=sum(1 for r in records if r.status == "late"),
        on_leave=sum(1 for r in records if r.status == "on_leave"),
        total_records=len(records),
        employees=employees,
    )


async def monthly_report(
    db: AsyncSession,
    org_id: int | None,
    year: int,
    month: int,
    location_id: int | None,
) -> MonthlyReport:
    _, days_in_month = monthrange(year, month)
    start = date(year, month, 1)
    end = date(year, month, days_in_month)
    working_days = await _fetch_working_days(db, start, end, org_id)

    att_stmt = select(AttendanceRecord).where(
        AttendanceRecord.work_date >= start,
        AttendanceRecord.work_date <= end,
    )
    if location_id is not None:
        att_stmt = att_stmt.where(AttendanceRecord.location_id == location_id)
    att_stmt = att_stmt.join(Employee, AttendanceRecord.employee_id == Employee.id)
    att_stmt = apply_tenant_filter(att_stmt, org_id, Employee.organization_id)
    records = list((await db.execute(att_stmt)).scalars().unique().all())

    by_employee: dict[int, list[AttendanceRecord]] = {}
    for r in records:
        by_employee.setdefault(r.employee_id, []).append(r)

    emp_stmt = select(Employee).where(Employee.is_active == True)  # noqa: E712
    if location_id is not None:
        emp_stmt = emp_stmt.where(Employee.location_id == location_id)
    emp_stmt = apply_tenant_filter(emp_stmt, org_id, Employee.organization_id)
    emp_stmt = emp_stmt.order_by(Employee.employee_code)
    employees = list((await db.execute(emp_stmt)).scalars().all())

    rows: list[MonthlyEmployeeEntry] = []
    for employee in employees:
        emp_records = by_employee.get(employee.id, [])
        present_days = sum(1 for r in emp_records if r.status in ("present", "late"))
        overtime_minutes = sum(r.overtime_minutes or 0 for r in emp_records)
        attendance_percent = round((present_days / working_days) * 100, 1) if working_days else 0.0
        rows.append(
            MonthlyEmployeeEntry(
                employee_id=employee.id,
                employee_code=employee.employee_code,
                employee_name=_employee_name(employee),
                department=employee.department,
                total_working_days=working_days,
                present_days=present_days,
                attendance_percent=attendance_percent,
                overtime_minutes=overtime_minutes,
                overtime_hours=round(overtime_minutes / 60, 1),
                absence_count=sum(1 for r in emp_records if r.status == "absent"),
                late_count=sum(1 for r in emp_records if r.status == "late"),
                on_leave_count=sum(1 for r in emp_records if r.status == "on_leave"),
            )
        )

    total_present = sum(1 for r in records if r.status in ("present", "late"))
    total_possible = working_days * max(len(employees), 1)

    return MonthlyReport(
        year=year,
        month=month,
        total_working_days=working_days,
        employee_count=len(employees),
        summary=MonthlySummary(
            total_working_days=working_days,
            attendance_percent=round((total_present / total_possible) * 100, 1)
            if total_possible
            else 0.0,
            overtime_minutes=sum(r.overtime_minutes or 0 for r in records),
            absence_count=sum(1 for r in records if r.status == "absent"),
        ),
        employees=rows,
    )


async def attendance_summary(
    db: AsyncSession, org_id: int | None, start_date: date, end_date: date
) -> AttendanceSummaryReport:
    emp_stmt = select(func.count(Employee.id)).where(Employee.is_active == True)  # noqa: E712
    emp_stmt = apply_tenant_filter(emp_stmt, org_id, Employee.organization_id)
    total_employees = (await db.execute(emp_stmt)).scalar() or 0

    att_stmt = select(AttendanceRecord).where(
        AttendanceRecord.work_date >= start_date,
        AttendanceRecord.work_date <= end_date,
    )
    att_stmt = att_stmt.join(Employee, AttendanceRecord.employee_id == Employee.id)
    att_stmt = apply_tenant_filter(att_stmt, org_id, Employee.organization_id)
    records = list((await db.execute(att_stmt)).scalars().all())

    leave_stmt = select(func.count(LeaveRequest.id)).where(
        LeaveRequest.start_date <= end_date,
        LeaveRequest.end_date >= start_date,
        LeaveRequest.status == "approved",
    )
    leave_stmt = leave_stmt.join(Employee, LeaveRequest.employee_id == Employee.id)
    leave_stmt = apply_tenant_filter(leave_stmt, org_id, Employee.organization_id)
    on_leave = (await db.execute(leave_stmt)).scalar() or 0

    total_present = sum(1 for r in records if r.status in ("present", "late", "half_day"))
    days_span = (end_date - start_date).days + 1
    expected = total_employees * days_span

    return AttendanceSummaryReport(
        period_start=start_date,
        period_end=end_date,
        total_employees=total_employees,
        avg_attendance_rate=round(total_present / expected * 100, 1) if expected else 0,
        total_present=total_present,
        total_absent=sum(1 for r in records if r.status == "absent"),
        total_late=sum(1 for r in records if r.status == "late"),
        total_on_leave=on_leave,
        total_half_days=sum(1 for r in records if r.status == "half_day"),
    )


async def overtime_report(
    db: AsyncSession, org_id: int | None, start_date: date, end_date: date
) -> OvertimeReport:
    stmt = (
        select(
            AttendanceRecord.employee_id,
            func.sum(AttendanceRecord.overtime_minutes).label("total_ot"),
            func.count(case((AttendanceRecord.overtime_minutes > 0, 1))).label("ot_days"),
        )
        .where(
            AttendanceRecord.work_date >= start_date,
            AttendanceRecord.work_date <= end_date,
            AttendanceRecord.overtime_minutes > 0,
        )
        .join(Employee, AttendanceRecord.employee_id == Employee.id)
        .group_by(AttendanceRecord.employee_id)
        .order_by(func.sum(AttendanceRecord.overtime_minutes).desc())
    )
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    rows = (await db.execute(stmt)).all()

    emp_ids = [r.employee_id for r in rows]
    emp_map: dict[int, Employee] = {}
    if emp_ids:
        emp_result = await db.execute(select(Employee).where(Employee.id.in_(emp_ids)))
        emp_map = {e.id: e for e in emp_result.scalars().all()}

    entries = []
    for row in rows:
        emp = emp_map.get(row.employee_id)
        entries.append(
            OvertimeEntry(
                employee_id=row.employee_id,
                employee_name=f"{emp.first_name} {emp.last_name}" if emp else "Unknown",
                department=emp.department if emp else None,
                total_overtime_minutes=int(row.total_ot),
                overtime_days=int(row.ot_days),
            )
        )

    return OvertimeReport(period_start=start_date, period_end=end_date, employees=entries)


def unknown_persons_query(
    org_id: int | None, date_from: date | None, date_to: date | None
) -> Select:
    stmt = select(RecognitionEvent).where(RecognitionEvent.result == RecognitionResult.unknown)
    if org_id is not None:
        stmt = stmt.where(RecognitionEvent.organization_id == org_id)
    if date_from is not None:
        start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        stmt = stmt.where(RecognitionEvent.recognized_at >= start)
    if date_to is not None:
        end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        stmt = stmt.where(RecognitionEvent.recognized_at <= end)
    return stmt.order_by(RecognitionEvent.recognized_at.desc())


async def attendance_export_csv(
    db: AsyncSession, org_id: int | None, start: date, end: date
) -> str:
    att_stmt = (
        select(AttendanceRecord)
        .where(AttendanceRecord.work_date >= start, AttendanceRecord.work_date <= end)
        .join(Employee, AttendanceRecord.employee_id == Employee.id)
        .order_by(AttendanceRecord.work_date, Employee.last_name)
    )
    att_stmt = apply_tenant_filter(att_stmt, org_id, Employee.organization_id)
    records = list((await db.execute(att_stmt)).scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Employee ID", "Employee Name", "Department", "Check In", "Check Out",
        "Worked Minutes", "Overtime Minutes", "Status", "Method In", "Method Out",
    ])
    for r in records:
        emp = r.employee
        writer.writerow([
            r.work_date.isoformat(),
            emp.employee_code if emp else r.employee_id,
            f"{emp.first_name} {emp.last_name}" if emp else "",
            emp.department if emp else "",
            r.check_in_at.isoformat() if r.check_in_at else "",
            r.check_out_at.isoformat() if r.check_out_at else "",
            r.worked_minutes,
            r.overtime_minutes,
            r.status,
            r.check_in_method or "",
            r.check_out_method or "",
        ])
    return output.getvalue()
