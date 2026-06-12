"""Attendance + unknown-persons reporting aggregation.

All querying and aggregation lives here; the reports router only resolves
query params and wraps results. File rendering (CSV/Excel/PDF) lives in
``report_export``, which consumes the report models built here.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone

from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload, selectinload

from app.middleware.tenant import apply_tenant_filter
from app.models.attendance import AttendanceRecord
from app.models.camera import Camera
from app.models.employee import Employee
from app.models.recognition import RecognitionEvent, RecognitionResult
from app.schemas.report import AttendanceRangeEntry, AttendanceRangeReport


def _employee_name(employee: Employee | None) -> str:
    if employee is None:
        return "Unknown"
    return f"{employee.first_name} {employee.last_name}"


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
        "liveness_passed": event.liveness_passed,
        "processing_ms": event.processing_ms,
        "snapshot_path": event.snapshot_path,
        "snapshot_url": (
            f"/api/v1/recognition/events/{event.id}/snapshot" if event.snapshot_path else None
        ),
        "notified_at": event.notified_at,
        "recognized_at": event.recognized_at,
        "metadata": event.meta,
        "camera": camera,
    }


async def attendance_range_report(
    db: AsyncSession, org_id: int | None, start: date, end: date
) -> AttendanceRangeReport:
    """Raw attendance records over a range — mirrors the Attendance page list."""
    stmt = (
        select(AttendanceRecord)
        .where(AttendanceRecord.work_date >= start, AttendanceRecord.work_date <= end)
        .join(Employee, AttendanceRecord.employee_id == Employee.id)
        # The export reads only the employee (name/code/department) — suppress
        # the model's selectin loads for location/shift and the employee's own
        # cascading relationships, which would hydrate objects nobody reads.
        .options(
            selectinload(AttendanceRecord.employee).lazyload("*"),
            lazyload(AttendanceRecord.location),
            lazyload(AttendanceRecord.shift),
        )
        .order_by(AttendanceRecord.work_date.desc(), Employee.last_name, Employee.first_name)
    )
    stmt = apply_tenant_filter(stmt, org_id, Employee.organization_id)
    records = list((await db.execute(stmt)).scalars().unique().all())

    entries = [
        AttendanceRangeEntry(
            work_date=r.work_date,
            employee_code=r.employee.employee_code if r.employee else "",
            employee_name=_employee_name(r.employee),
            department=r.employee.department if r.employee else None,
            status=r.status,
            attendance_type=r.attendance_type,
            check_in_at=r.check_in_at,
            check_out_at=r.check_out_at,
            check_in_method=r.check_in_method,
            check_out_method=r.check_out_method,
            worked_minutes=r.worked_minutes or 0,
            overtime_minutes=r.overtime_minutes or 0,
        )
        for r in records
    ]
    return AttendanceRangeReport(
        period_start=start,
        period_end=end,
        total_records=len(records),
        present=sum(1 for r in records if r.status == "present"),
        late_or_early=sum(1 for r in records if r.status in ("late", "early_leave")),
        worked_minutes=sum(r.worked_minutes or 0 for r in records),
        overtime_minutes=sum(r.overtime_minutes or 0 for r in records),
        entries=entries,
    )


def _unknown_conditions(
    org_id: int | None,
    date_from: date | None,
    date_to: date | None,
    camera_id: int | None = None,
    alerts_only: bool = False,
) -> list:
    conds = [RecognitionEvent.result == RecognitionResult.unknown]
    if org_id is not None:
        conds.append(RecognitionEvent.organization_id == org_id)
    if date_from is not None:
        conds.append(
            RecognitionEvent.recognized_at
            >= datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        )
    if date_to is not None:
        conds.append(
            RecognitionEvent.recognized_at
            <= datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        )
    if camera_id is not None:
        conds.append(RecognitionEvent.camera_id == camera_id)
    if alerts_only:
        conds.append(RecognitionEvent.notified_at.isnot(None))
    return conds


def unknown_persons_query(
    org_id: int | None,
    date_from: date | None,
    date_to: date | None,
    camera_id: int | None = None,
    alerts_only: bool = False,
) -> Select:
    return (
        select(RecognitionEvent)
        .where(*_unknown_conditions(org_id, date_from, date_to, camera_id, alerts_only))
        .order_by(RecognitionEvent.recognized_at.desc())
    )


async def unknown_persons_summary(
    db: AsyncSession, org_id: int | None, date_from: date | None, date_to: date | None
) -> dict:
    """Range-wide aggregates for the Unknown Faces page.

    Stat cards and the camera filter need totals over the whole range — the
    list endpoint is paginated, so per-page counts would be wrong.
    """
    conds = _unknown_conditions(org_id, date_from, date_to)
    totals_stmt = select(
        func.count(),
        func.count(RecognitionEvent.notified_at),
        func.count(case((RecognitionEvent.liveness_passed == False, 1))),  # noqa: E712
    ).where(*conds)
    total, alerts, spoof = (await db.execute(totals_stmt)).one()

    cam_stmt = (
        select(Camera.id, Camera.name)
        .join(RecognitionEvent, RecognitionEvent.camera_id == Camera.id)
        .where(*conds)
        .distinct()
        .order_by(Camera.name)
    )
    cameras = [{"id": cid, "name": name} for cid, name in (await db.execute(cam_stmt)).all()]

    return {"total": total, "alerts": alerts, "spoof": spoof, "cameras": cameras}
