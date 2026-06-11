"""Attendance anomaly detection: gather features, score, and persist.

Shared by the ``POST /anomalies/detect`` endpoint (per-tenant, on demand) and the
periodic Celery task (all tenants). The caller owns the transaction commit and
any realtime emit.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import NotFoundError
from app.models.attendance import AnomalyStatus, AttendanceAnomaly, AttendanceRecord
from app.models.employee import Employee
from app.schemas.attendance import AnomalySummary, AnomalyUpdateRequest
from app.services.anomaly_detector import analyze_records


def _org_employee_ids(org_id: int | None):
    """Subquery of employee IDs for an org (None → no tenant filter)."""
    if org_id is None:
        return None
    return select(Employee.id).where(Employee.organization_id == org_id)


async def run_anomaly_detection(
    db: AsyncSession,
    *,
    org_id: int | None = None,
    employee_ids: list[int] | None = None,
    lookback_days: int | None = None,
) -> dict:
    """Detect and persist anomalies; returns a summary. Does not commit/emit."""
    lookback = lookback_days or settings.anomaly_lookback_days
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback)

    stmt = select(AttendanceRecord).where(AttendanceRecord.work_date >= cutoff.date())
    if org_id:
        emp_ids = select(Employee.id).where(Employee.organization_id == org_id)
        stmt = stmt.where(AttendanceRecord.employee_id.in_(emp_ids))
    if employee_ids:
        stmt = stmt.where(AttendanceRecord.employee_id.in_(employee_ids))

    records = list((await db.execute(stmt)).scalars().all())

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

    analysis = await run_in_threadpool(analyze_records, record_dicts, config)
    detected = analysis.get("anomalies", [])

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    saved = 0
    for item in detected:
        db.add(
            AttendanceAnomaly(
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
        )
        saved += 1

    await db.flush()

    return {
        "detection_run_id": run_id,
        "records_analyzed": analysis.get("records_analyzed", 0),
        "anomalies_detected": saved,
        "processing_ms": analysis.get("processing_ms", 0),
    }


async def summary(db: AsyncSession, org_id: int | None) -> AnomalySummary:
    """Open-anomaly counts grouped in SQL (the triage view ignores closed ones)."""
    emp_ids = _org_employee_ids(org_id)

    def _scoped(stmt: Select) -> Select:
        if emp_ids is not None:
            return stmt.where(AttendanceAnomaly.employee_id.in_(emp_ids))
        return stmt

    open_only = AttendanceAnomaly.status == AnomalyStatus.open

    severity_rows = await db.execute(
        _scoped(
            select(AttendanceAnomaly.severity, func.count())
            .where(open_only)
            .group_by(AttendanceAnomaly.severity)
        )
    )
    by_severity = {getattr(sev, "value", sev): count for sev, count in severity_rows}

    type_rows = await db.execute(
        _scoped(
            select(AttendanceAnomaly.anomaly_type, func.count())
            .where(open_only)
            .group_by(AttendanceAnomaly.anomaly_type)
        )
    )
    by_type = dict(type_rows.all())

    return AnomalySummary(
        open_total=sum(by_severity.values()),
        critical=by_severity.get("critical", 0),
        high=by_severity.get("high", 0),
        medium=by_severity.get("medium", 0),
        low=by_severity.get("low", 0),
        by_type=by_type,
    )


def anomalies_query(
    org_id: int | None,
    *,
    status: str | None,
    severity: str | None,
    employee_id: int | None,
    anomaly_type: str | None,
) -> Select:
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
    return stmt


async def update_anomaly(
    db: AsyncSession,
    anomaly_id: int,
    body: AnomalyUpdateRequest,
    user_id: int,
    org_id: int | None,
) -> tuple[AttendanceAnomaly, int | None]:
    """Apply a status transition; returns (anomaly, owning org_id) for emit."""
    anomaly = (
        await db.execute(select(AttendanceAnomaly).where(AttendanceAnomaly.id == anomaly_id))
    ).scalar_one_or_none()
    if not anomaly:
        raise NotFoundError("Anomaly not found")

    owner_org = (
        await db.execute(
            select(Employee.organization_id).where(Employee.id == anomaly.employee_id)
        )
    ).scalar_one_or_none()
    if org_id is not None and owner_org != org_id:
        # Cross-tenant probe: answer as if the anomaly does not exist.
        raise NotFoundError("Anomaly not found")

    now = datetime.now(timezone.utc)
    anomaly.status = body.status
    if body.status == "acknowledged":
        anomaly.acknowledged_at = now
        anomaly.acknowledged_by = user_id
    if body.status in ("resolved", "false_positive"):
        anomaly.resolved_at = now
        if not anomaly.acknowledged_at:
            anomaly.acknowledged_at = now
            anomaly.acknowledged_by = user_id

    await db.flush()
    await db.refresh(anomaly)
    return anomaly, owner_org
