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
from app.services import attendance_service, security_monitoring_service
from app.services.live_event_service import create_live_event

logger = logging.getLogger(__name__)

_snapshot_cleanup_task: asyncio.Task | None = None

# Per-tenant timestamp of the last persisted "unknown" event, for throttling. Best
# effort (per-process); a continuously-scanning kiosk would otherwise log one
# unknown per frame. See settings.unknown_event_throttle_seconds.
_last_unknown_at: dict[int | None, float] = {}

# Pipeline reasons meaning no usable face was in the frame at all (e.g. the
# person stepped out of view between the kiosk's detect and identify ticks).
# These produce nothing worth reviewing or announcing.
_NO_FACE_REASONS = frozenset({"no_face", "invalid_image"})

# Reasons that still mean "a real face was searched and nobody matched" — the
# pipeline leaves reason unset for a plain below-threshold miss; callers may
# also tag it explicitly. "stale_identity" = the face matched FAISS vectors of
# a deleted/deactivated employee, which for alerting purposes is an unknown
# person on premises.
_GENUINE_UNKNOWN_REASONS = frozenset(
    {None, "low_confidence", "low_confidence_review", "stale_identity"}
)


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


async def _resolve_identity(
    db: AsyncSession, identity: str
) -> Employee | Visitor | None:
    """Map a FAISS identity string to its ORM row, without any gating.

    Employees are enrolled under their numeric primary key, visitors under
    "visitor-<id>"; anything else resolves to None.
    """
    if identity.startswith("visitor-"):
        try:
            return await db.get(Visitor, int(identity.removeprefix("visitor-")))
        except ValueError:
            return None
    try:
        return await db.get(Employee, int(identity))
    except (TypeError, ValueError):
        return None


async def authorize_match(
    db: AsyncSession, identity: str | None, org_id: int | None
) -> Employee | Visitor | None:
    """Gate a global-index FAISS match to the caller's tenant.

    Returns the matched Employee/Visitor row only when it still exists, is
    active (employees), and belongs to ``org_id``. The index is global, so
    every consumer of a raw match must pass it through here before exposing
    the identity or writing attendance. ``org_id`` None only reaches here for
    validated super-admin scope (get_tenant_org_id rejects tenant users
    without an organization), so None means any org is allowed.
    """
    if not identity:
        return None
    identity = str(identity)
    row = await _resolve_identity(db, identity)
    if row is None:
        return None
    if not identity.startswith("visitor-") and not row.is_active:
        return None
    if org_id is not None and row.organization_id != org_id:
        return None
    return row


async def _strip_rejected_identity(
    db: AsyncSession, result: dict, identity: str, org_id: int | None
) -> None:
    """Erase a vetoed FAISS identity so the caller sees a plain non-match.

    Mutates ``result`` in place: the API layer spreads this same dict into its
    response, so the identity must be stripped here, not just in the outcome
    dict. The caller gets nothing distinguishable from a miss; the server log
    carries the real cause. The re-resolve only picks stale-vector vs
    cross-tenant for the log/reason (identity-map hit when the row exists).
    """
    row = await _resolve_identity(db, identity)
    if row is None or (not identity.startswith("visitor-") and not row.is_active):
        logger.warning(
            "Face matched identity %s but no active row exists; "
            "treating as unknown (stale FAISS vectors?)",
            identity,
        )
        result["reason"] = "stale_identity"
    else:
        logger.warning(
            "Cross-tenant face match suppressed: identity %s belongs to "
            "org %s, caller org %s",
            identity,
            row.organization_id,
            org_id,
        )
        result["reason"] = "low_confidence"
    result["employee_id"] = None


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
        identity = str(result["employee_id"])
        row = await authorize_match(db, identity, org_id)
        if row is None:
            # Stale vectors or another tenant's row: strip the identity and
            # fall through to the unknown path under the caller's org.
            await _strip_rejected_identity(db, result, identity, org_id)
        elif identity.startswith("visitor-"):
            await create_live_event(
                db=db,
                organization_id=row.organization_id,
                event_type="recognition.visitor",
                message=f"Visitor {row.name} recognized",
                visitor_id=row.id,
                payload={"confidence": result.get("confidence")},
            )
            return {"matched": True, "employee": None, "attendance": None}
        else:
            return await _record_employee_match(
                db,
                result,
                employee=row,
                org_id=org_id,
                image_b64=image_b64,
                camera_id=camera_id,
            )

    # No match. The pipeline only sets a reason when a gate (decode, quality,
    # liveness) stopped the frame before matching; a genuine searched-but-
    # unmatched face (see _GENUINE_UNKNOWN_REASONS) is the only case broadcast
    # as "recognition.unknown" (the org-wide toast). Gate rejections are still
    # persisted for review but broadcast as "recognition.rejected".
    return await _record_no_match(
        db, result, org_id=org_id, image_b64=image_b64, camera_id=camera_id
    )


async def _record_employee_match(
    db: AsyncSession,
    result: dict,
    *,
    employee: Employee,
    org_id: int | None,
    image_b64: str | None,
    camera_id: int | None,
) -> dict:
    """Persist attendance + event + realtime for a verified employee match."""
    employee_id = employee.id
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
    event_org_id = employee.organization_id
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
    # Offload the base64 decode + disk write so a full-res frame (or a slow /
    # network snapshot mount) cannot stall the event loop on the identify path.
    snapshot = await asyncio.to_thread(_save_event_snapshot, image_b64, event.id)
    if snapshot:
        event.snapshot_path = snapshot
        await db.flush()

    # AI security checks (after-hours, tailgating). Best effort — an alert
    # failure must never break the attendance write it follows.
    try:
        await security_monitoring_service.evaluate_matched(
            db,
            employee=employee,
            event=event,
            org_id=event_org_id,
            camera_id=camera_id,
            snapshot_path=snapshot,
        )
    except Exception as exc:
        logger.warning("[security-monitoring] matched-event checks failed: %s", exc)

    await create_live_event(
        db=db,
        organization_id=employee.organization_id,
        event_type="recognition.matched",
        message=f"{employee.first_name} {employee.last_name} recognized",
        employee_id=employee.id,
        camera_id=camera_id,
        # recognition_event_id lets the dashboard's event detail view
        # load the stored snapshot for this match.
        payload={
            "recognition_event_id": event.id,
            "confidence": confidence,
            "liveness_passed": liveness_passed,
            "attendance_action": action,
            "snapshot": bool(snapshot),
        },
    )

    employee_brief = {
        "id": employee.id,
        "employee_code": getattr(employee, "employee_code", None),
        "first_name": getattr(employee, "first_name", None),
        "last_name": getattr(employee, "last_name", None),
    }
    attendance = (
        {"action": action, "employee_id": employee_id} if action else None
    )
    return {"matched": True, "employee": employee_brief, "attendance": attendance}


async def _record_no_match(
    db: AsyncSession,
    result: dict,
    *,
    org_id: int | None,
    image_b64: str | None,
    camera_id: int | None,
) -> dict:
    """Persist an unknown/rejected recognition event + realtime broadcast."""
    reason = result.get("reason")
    no_match = {"matched": False, "employee": None, "attendance": None, "reason": reason}

    if reason in _NO_FACE_REASONS:
        return no_match

    # Throttle persistence so a continuously-scanning kiosk doesn't write a
    # row + snapshot every frame; the caller still gets matched=False so the
    # UI shows "unknown" live regardless.
    if _unknown_throttled(org_id):
        return no_match

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
    # Offload the base64 decode + disk write so a full-res frame (or a slow /
    # network snapshot mount) cannot stall the event loop on the identify path.
    snapshot = await asyncio.to_thread(_save_event_snapshot, image_b64, event.id)
    if snapshot:
        event.snapshot_path = snapshot
        await db.flush()
    rejected = reason not in _GENUINE_UNKNOWN_REASONS

    # AI security checks (spoof attempt, unknown person). Best effort: never
    # let alerting break the event write. `liveness_passed is False` is only
    # set when the liveness gate itself rejected the frame.
    try:
        await security_monitoring_service.evaluate_unmatched(
            db,
            org_id=org_id,
            camera_id=camera_id,
            event=event,
            spoof=result.get("liveness_passed") is False,
            genuine_unknown=not rejected,
            reason=reason,
            snapshot_path=snapshot,
        )
    except Exception as exc:
        logger.warning("[security-monitoring] unmatched-event checks failed: %s", exc)

    await create_live_event(
        db=db,
        organization_id=org_id,
        event_type="recognition.rejected" if rejected else "recognition.unknown",
        message=f"Face rejected ({reason})" if rejected else "Unknown face detected",
        camera_id=camera_id,
        payload={
            "recognition_event_id": event.id,
            "confidence": result.get("confidence"),
            "liveness_passed": result.get("liveness_passed"),
            "reason": reason,
            "snapshot": bool(snapshot),
        },
    )
    return no_match


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


async def snapshot_path(db: AsyncSession, event_id: int, org_id: int | None = None) -> str:
    stmt = select(RecognitionEvent).where(RecognitionEvent.id == event_id)
    if org_id is not None:
        # Event ids are sequential integers; without the tenant filter any
        # caller with recognition.view could enumerate other orgs' snapshots.
        stmt = stmt.where(RecognitionEvent.organization_id == org_id)
    event = (await db.execute(stmt)).scalar_one_or_none()
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
