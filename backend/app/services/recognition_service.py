"""Recognition side-effects (identification logging) and event analytics.

The face matching itself lives in ``face_service``/``recognition_pipeline``; this
module owns the persistence + realtime that follow an identification and the
recognition-event metrics/queries.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.employee import Employee
from app.models.recognition import RecognitionEvent
from app.models.visitor import Visitor
from app.schemas.recognition_api import RecognitionMetrics, UnknownSummary
from app.services import attendance_service
from app.services.live_event_service import create_live_event


async def record_identification(db: AsyncSession, result: dict, org_id: int | None) -> None:
    """Persist attendance/recognition events + realtime for an identify result."""
    if result.get("success") and result.get("employee_id"):
        emp_id_str = str(result["employee_id"])
        if emp_id_str.startswith("visitor-"):
            visitor_id = int(emp_id_str.replace("visitor-", ""))
            visitor = await db.get(Visitor, visitor_id)
            if visitor and (org_id is None or visitor.organization_id == org_id):
                await create_live_event(
                    db=db,
                    organization_id=visitor.organization_id,
                    event_type="recognition.visitor",
                    message=f"Visitor {visitor.name} recognized",
                    visitor_id=visitor.id,
                    payload={"confidence": result.get("confidence")},
                )
            return

        employee_id = int(emp_id_str)
        confidence = result.get("confidence", 0.0)
        liveness_passed = bool(result.get("liveness_passed", False))
        processing_ms = result.get("processing_ms", 0)

        await attendance_service.process_recognition(
            db=db,
            employee_id=employee_id,
            confidence=confidence,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
            organization_id=org_id,
        )

        # Log the successful match so it appears in metrics, the events list,
        # and exports (previously only "unknown" events were recorded).
        employee = await db.get(Employee, employee_id)
        event_org_id = employee.organization_id if employee else org_id
        db.add(
            RecognitionEvent(
                employee_id=employee_id,
                organization_id=event_org_id,
                result="matched",
                confidence=confidence,
                liveness_passed=liveness_passed,
                processing_ms=processing_ms,
                recognized_at=datetime.now(timezone.utc),
            )
        )
        await db.flush()

        if employee is not None:
            await create_live_event(
                db=db,
                organization_id=employee.organization_id,
                event_type="recognition.matched",
                message=f"{employee.first_name} {employee.last_name} recognized",
                employee_id=employee.id,
                payload={"confidence": confidence, "liveness_passed": liveness_passed},
            )
        return

    db.add(
        RecognitionEvent(
            employee_id=None,
            organization_id=org_id,
            result="unknown",
            confidence=result.get("confidence"),
            liveness_passed=result.get("liveness_passed"),
            processing_ms=result.get("processing_ms"),
            recognized_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()
    await create_live_event(
        db=db,
        organization_id=org_id,
        event_type="recognition.unknown",
        message="Unknown face detected",
        payload={"confidence": result.get("confidence")},
    )


async def _count(db: AsyncSession, stmt: Select) -> int:
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0


async def metrics(db: AsyncSession, org_id: int | None) -> RecognitionMetrics:
    base_stmt = select(RecognitionEvent)
    if org_id is not None:
        base_stmt = base_stmt.where(RecognitionEvent.organization_id == org_id)

    total_events = await _count(db, base_stmt)
    matched = await _count(db, base_stmt.where(RecognitionEvent.result == "matched"))
    unknown = await _count(db, base_stmt.where(RecognitionEvent.result == "unknown"))

    avg_confidence = (
        await db.execute(
            select(func.avg(RecognitionEvent.confidence)).select_from(base_stmt.subquery())
        )
    ).scalar()
    avg_processing_ms = (
        await db.execute(
            select(func.avg(RecognitionEvent.processing_ms)).select_from(base_stmt.subquery())
        )
    ).scalar()

    return RecognitionMetrics(
        total_events=total_events,
        matched=matched,
        unknown=unknown,
        avg_confidence=round(avg_confidence, 4) if avg_confidence else None,
        avg_processing_ms=round(avg_processing_ms, 1) if avg_processing_ms else None,
    )


def events_query(org_id: int | None) -> Select:
    stmt = select(RecognitionEvent)
    if org_id is not None:
        stmt = stmt.where(RecognitionEvent.organization_id == org_id)
    return stmt.order_by(RecognitionEvent.recognized_at.desc())


async def snapshot_path(db: AsyncSession, event_id: int) -> str:
    event = (
        await db.execute(select(RecognitionEvent).where(RecognitionEvent.id == event_id))
    ).scalar_one_or_none()
    if not event:
        raise NotFoundError("Event not found")
    if not event.snapshot_path:
        raise NotFoundError("No snapshot available")
    if not os.path.isfile(event.snapshot_path):
        raise NotFoundError("Snapshot file not found")
    return event.snapshot_path


async def unknown_summary(db: AsyncSession, org_id: int | None) -> UnknownSummary:
    base_stmt = select(RecognitionEvent).where(RecognitionEvent.result == "unknown")
    if org_id is not None:
        base_stmt = base_stmt.where(RecognitionEvent.organization_id == org_id)

    now = datetime.now(timezone.utc)
    return UnknownSummary(
        total_unknown=await _count(db, base_stmt),
        last_24h=await _count(
            db, base_stmt.where(RecognitionEvent.recognized_at >= now - timedelta(hours=24))
        ),
        last_7d=await _count(
            db, base_stmt.where(RecognitionEvent.recognized_at >= now - timedelta(days=7))
        ),
    )
