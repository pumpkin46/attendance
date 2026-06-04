from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginationParams, paginate, PaginationDep
from app.models.attendance import AttendanceAnomaly, AttendanceRecord
from app.models.employee import Employee
from app.schemas.attendance import (
    AnomalyDetectRequest,
    AnomalyOut,
    AnomalySummary,
    AnomalyUpdateRequest,
)
from app.services.anomaly_detector import analyze_records
from app.realtime.hub import emit

router = APIRouter(prefix="/api/v1", tags=["anomalies"])


def _org_employee_ids(org_id: int | None):
    """Subquery returning employee IDs for the given org."""
    if org_id is None:
        return None
    return select(Employee.id).where(Employee.organization_id == org_id)


@router.get("/anomalies/summary")
async def anomaly_summary(
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("reports.view"),
) -> AnomalySummary:
    base = select(AttendanceAnomaly)
    emp_ids = _org_employee_ids(org_id)
    if emp_ids is not None:
        base = base.where(AttendanceAnomaly.employee_id.in_(emp_ids))

    result = await db.execute(base)
    anomalies = list(result.scalars().all())

    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}
    open_count = 0
    ack_count = 0

    for a in anomalies:
        by_severity[a.severity] = by_severity.get(a.severity, 0) + 1
        by_type[a.anomaly_type] = by_type.get(a.anomaly_type, 0) + 1
        if a.status == "open":
            open_count += 1
        elif a.status == "acknowledged":
            ack_count += 1

    return AnomalySummary(
        total=len(anomalies),
        open=open_count,
        acknowledged=ack_count,
        by_severity=by_severity,
        by_type=by_type,
    )


@router.get("/anomalies")
async def list_anomalies(
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("reports.view"),
    pagination: PaginationDep,
    status: str | None = Query(None),
    severity: str | None = Query(None),
    employee_id: int | None = Query(None),
    anomaly_type: str | None = Query(None),
):
    stmt = select(AttendanceAnomaly).order_by(AttendanceAnomaly.detected_at.desc())

    emp_ids = _org_employee_ids(org_id)
    if emp_ids is not None:
        stmt = stmt.where(AttendanceAnomaly.employee_id.in_(emp_ids))

    if status:
        stmt = stmt.where(AttendanceAnomaly.status == status)
    if severity:
        stmt = stmt.where(AttendanceAnomaly.severity == severity)
    if employee_id:
        stmt = stmt.where(AttendanceAnomaly.employee_id == employee_id)
    if anomaly_type:
        stmt = stmt.where(AttendanceAnomaly.anomaly_type == anomaly_type)

    return await paginate(db, stmt, pagination.page, pagination.per_page, AnomalyOut)


@router.post("/anomalies/detect")
async def detect_anomalies(
    body: AnomalyDetectRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("attendance.manage"),
):
    lookback = body.lookback_days or settings.anomaly_lookback_days
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback)

    stmt = select(AttendanceRecord).where(AttendanceRecord.work_date >= cutoff.date())

    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        stmt = stmt.where(AttendanceRecord.employee_id.in_(emp_ids))

    if body.employee_ids:
        stmt = stmt.where(AttendanceRecord.employee_id.in_(body.employee_ids))

    result = await db.execute(stmt)
    records = list(result.scalars().all())

    record_dicts = []
    for r in records:
        check_in_hour = None
        if r.check_in_at:
            check_in_hour = r.check_in_at.hour + r.check_in_at.minute / 60.0

        shift_start_hour = None
        if r.shift and r.shift.start_time:
            shift_start_hour = r.shift.start_time.hour + r.shift.start_time.minute / 60.0

        record_dicts.append({
            "record_id": r.id,
            "employee_id": r.employee_id,
            "work_date": str(r.work_date),
            "check_in_at": str(r.check_in_at) if r.check_in_at else None,
            "check_out_at": str(r.check_out_at) if r.check_out_at else None,
            "check_in_hour": check_in_hour,
            "shift_start_hour": shift_start_hour,
            "worked_minutes": r.worked_minutes or 0,
            "overtime_minutes": r.overtime_minutes or 0,
            "status": r.status,
            "check_in_method": r.check_in_method,
            "day_of_week": r.work_date.isoweekday() if r.work_date else 1,
            "recognition_events_count": 0,
        })

    config = {
        "overtime_threshold_minutes": settings.anomaly_overtime_minutes,
        "check_in_deviation_minutes": settings.anomaly_checkin_deviation_minutes,
    }

    analysis = analyze_records(record_dicts, config)
    detected = analysis.get("anomalies", [])

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    saved = 0

    for item in detected:
        anomaly = AttendanceAnomaly(
            attendance_record_id=item.get("record_id"),
            employee_id=item["employee_id"],
            anomaly_type=item["anomaly_type"],
            severity=item.get("severity", "medium"),
            score=item.get("score", 0),
            title=item.get("title", ""),
            description=item.get("description", ""),
            evidence=item.get("evidence"),
            status="open",
            detection_run_id=run_id,
            detected_at=now,
        )
        db.add(anomaly)
        saved += 1

    await db.flush()

    if saved:
        await emit(org_id, "anomalies.changed", {"detection_run_id": run_id, "count": saved})

    return {
        "success": True,
        "detection_run_id": run_id,
        "records_analyzed": analysis.get("records_analyzed", 0),
        "anomalies_detected": saved,
        "processing_ms": analysis.get("processing_ms", 0),
    }


@router.patch("/anomalies/{anomaly_id}")
async def update_anomaly(
    anomaly_id: int,
    body: AnomalyUpdateRequest,
    db: DbSession,
    user: require_permission("attendance.manage"),
):
    stmt = select(AttendanceAnomaly).where(AttendanceAnomaly.id == anomaly_id)
    result = await db.execute(stmt)
    anomaly = result.scalar_one_or_none()
    if not anomaly:
        raise HTTPException(404, "Anomaly not found")

    now = datetime.now(timezone.utc)
    anomaly.status = body.status

    if body.status == "acknowledged":
        anomaly.acknowledged_at = now
        anomaly.acknowledged_by = user.id

    if body.status in ("resolved", "false_positive"):
        anomaly.resolved_at = now
        if not anomaly.acknowledged_at:
            anomaly.acknowledged_at = now
            anomaly.acknowledged_by = user.id

    await db.flush()
    await db.refresh(anomaly)

    emp_org = await db.execute(
        select(Employee.organization_id).where(Employee.id == anomaly.employee_id)
    )
    await emit(emp_org.scalar_one_or_none(), "anomalies.changed", {"anomaly_id": anomaly.id})

    return AnomalyOut.model_validate(anomaly, from_attributes=True)
