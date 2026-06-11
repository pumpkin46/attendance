"""Recognition side-effects (identification logging) and event analytics.

The face matching itself lives in ``face_service``/``recognition_pipeline``; this
module owns the persistence + realtime that follow an identification and the
recognition-event metrics/queries.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import NotFoundError
from app.models.employee import Employee
from app.models.recognition import RecognitionEvent
from app.models.visitor import Visitor
from app.schemas.recognition_api import RecognitionMetrics, UnknownSummary
from app.services import attendance_service
from app.services.live_event_service import create_live_event

logger = logging.getLogger(__name__)

_snapshot_cleanup_task: asyncio.Task | None = None

# Per-tenant timestamp of the last persisted "unknown" event, for throttling. Best
# effort (per-process); a continuously-scanning kiosk would otherwise log one
# unknown per frame. See settings.unknown_event_throttle_seconds.
_last_unknown_at: dict[int | None, float] = {}


def _unknown_throttled(org_id: int | None) -> bool:
    """True if an unknown event for this tenant was recorded within the window."""
    window = settings.unknown_event_throttle_seconds
    if window <= 0:
        return False
    now_ts = time.time()
    last = _last_unknown_at.get(org_id)
    if last is not None and (now_ts - last) < window:
        return True
    _last_unknown_at[org_id] = now_ts
    return False


def purge_old_snapshots() -> int:
    """Delete recognition snapshot files older than the retention window.

    File-based sweep (by modification time) over ``engine_snapshot_dir``, so a
    continuously-running kiosk doesn't accumulate snapshots forever. Stale DB
    references degrade gracefully — the snapshot endpoint 404s and the UI shows
    "No snapshot". Returns the number of files removed.
    """
    directory = Path(settings.engine_snapshot_dir)
    if not directory.exists():
        return 0
    cutoff = time.time() - settings.unknown_snapshot_retention_days * 86400
    removed = 0
    for file in directory.glob("*.jpg"):
        try:
            if file.stat().st_mtime < cutoff:
                file.unlink()
                removed += 1
        except OSError:
            continue
    return removed


async def _run_snapshot_cleanup_loop(interval_seconds: int = 3600) -> None:
    """In-process fallback sweep (used when Celery Beat isn't running)."""
    while True:
        try:
            removed = await asyncio.to_thread(purge_old_snapshots)
            if removed:
                logger.info("[snapshot-cleanup] removed %d old snapshot(s)", removed)
        except Exception as exc:  # never let the loop die
            logger.warning("[snapshot-cleanup] error: %s", exc)
        await asyncio.sleep(interval_seconds)


def start_snapshot_cleanup_task() -> asyncio.Task:
    global _snapshot_cleanup_task
    if _snapshot_cleanup_task is None or _snapshot_cleanup_task.done():
        _snapshot_cleanup_task = asyncio.create_task(_run_snapshot_cleanup_loop())
    return _snapshot_cleanup_task


def _save_event_snapshot(image_b64: str | None, event_id: int) -> str | None:
    """Persist the captured frame for a recognition event; returns the file path.

    The /recognition/identify path (kiosk, monitor, test page) didn't store a
    snapshot, so the Unknown Faces table showed an empty thumbnail. We write the
    submitted frame as-is (it's already a JPEG) under the configured snapshot dir.
    """
    if not settings.unknown_snapshot_enabled or not image_b64:
        return None
    try:
        data = image_b64.split(",", 1)[1] if "," in image_b64 else image_b64
        raw = base64.b64decode(data)
        directory = Path(settings.engine_snapshot_dir)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"event_{event_id}.jpg"
        path.write_bytes(raw)
        return str(path)
    except Exception:
        return None


async def record_identification(
    db: AsyncSession,
    result: dict,
    org_id: int | None,
    image_b64: str | None = None,
    camera_id: int | None = None,
) -> dict:
    """Persist attendance/recognition events + realtime for an identify result.

    ``image_b64`` is the submitted frame; when present it is saved as the event
    snapshot so the recognition/unknown-faces views can show a thumbnail.

    Returns a small outcome dict (`matched`, `employee`, `attendance`, `reason`)
    so the API can tell the kiosk/test UI whether an identity was recognized and
    what attendance action (check-in/out/duplicate) it produced.
    """
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
            return {"matched": True, "employee": None, "attendance": None}

        employee_id = int(emp_id_str)
        confidence = result.get("confidence", 0.0)
        liveness_passed = bool(result.get("liveness_passed", False))
        processing_ms = result.get("processing_ms", 0)

        record = await attendance_service.process_recognition(
            db=db,
            employee_id=employee_id,
            camera_id=camera_id,
            confidence=confidence,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
            organization_id=org_id,
        )
        action = getattr(record, "last_action", None)

        # Log the successful match so it appears in metrics, the events list,
        # and exports (previously only "unknown" events were recorded).
        employee = await db.get(Employee, employee_id)
        event_org_id = employee.organization_id if employee else org_id
        event = RecognitionEvent(
            employee_id=employee_id,
            organization_id=event_org_id,
            camera_id=camera_id,
            result="matched",
            confidence=confidence,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
            recognized_at=datetime.now(timezone.utc),
        )
        db.add(event)
        await db.flush()
        snapshot = _save_event_snapshot(image_b64, event.id)
        if snapshot:
            event.snapshot_path = snapshot
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

        employee_brief = (
            {
                "id": employee.id,
                "employee_code": getattr(employee, "employee_code", None),
                "first_name": getattr(employee, "first_name", None),
                "last_name": getattr(employee, "last_name", None),
            }
            if employee is not None
            else None
        )
        attendance = (
            {"action": action, "employee_id": employee_id} if action else None
        )
        return {"matched": True, "employee": employee_brief, "attendance": attendance}

    # Unknown face. Throttle persistence so a continuously-scanning kiosk doesn't
    # write a row + snapshot every frame; the caller still gets matched=False so
    # the UI shows "unknown" live regardless.
    if _unknown_throttled(org_id):
        return {"matched": False, "employee": None, "attendance": None, "reason": result.get("reason")}

    event = RecognitionEvent(
        employee_id=None,
        organization_id=org_id,
        camera_id=camera_id,
        result="unknown",
        confidence=result.get("confidence"),
        liveness_passed=result.get("liveness_passed"),
        processing_ms=result.get("processing_ms"),
        recognized_at=datetime.now(timezone.utc),
    )
    db.add(event)
    await db.flush()
    snapshot = _save_event_snapshot(image_b64, event.id)
    if snapshot:
        event.snapshot_path = snapshot
        await db.flush()
    await create_live_event(
        db=db,
        organization_id=org_id,
        event_type="recognition.unknown",
        message="Unknown face detected",
        payload={"confidence": result.get("confidence")},
    )
    return {"matched": False, "employee": None, "attendance": None, "reason": result.get("reason")}


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


async def record_event_feedback(
    db: AsyncSession,
    event_id: int,
    outcome: str,
    org_id: int | None,
    note: str | None = None,
    user_id: int | None = None,
) -> dict:
    """Label a recognition event as correct/incorrect (ground truth).

    Maps the reviewer's verdict onto a match outcome (true/false accept or
    reject), persists it on the event, and feeds the engine metrics collector
    so measured accuracy / FPR / FNR reflect real-world feedback.
    """
    event = (
        await db.execute(select(RecognitionEvent).where(RecognitionEvent.id == event_id))
    ).scalar_one_or_none()
    if not event or (org_id is not None and event.organization_id != org_id):
        raise NotFoundError("Event not found")

    result_value = (
        event.result.value if hasattr(event.result, "value") else str(event.result)
    )
    correct = outcome == "correct"
    if result_value == "matched":
        label = "true_accept" if correct else "false_accept"
    else:
        # unknown / liveness_failed / low_confidence are all rejections
        label = "true_reject" if correct else "false_reject"

    meta = dict(event.meta or {})
    meta["feedback"] = {
        "outcome": outcome,
        "label": label,
        "note": note,
        "user_id": user_id,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    event.meta = meta
    await db.flush()

    from app.engine.metrics import get_metrics

    get_metrics().record_match_outcome(label)
    return {
        "event_id": event.id,
        "result": result_value,
        "outcome": outcome,
        "label": label,
    }


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
