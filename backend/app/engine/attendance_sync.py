"""Persist engine attendance events into the attendance ledger.

The camera pipeline (recognition_engine -> attendance_generator) produces
AttendanceEvents in memory only; nothing under app/engine holds a DB session,
so without this consumer events from running streams are counted in metrics
but never written to attendance_records. The consumer drains the generator
queue on a short interval and routes each event through
attendance_service.process_recognition with an explicit intent derived from
the event type (CHECK_IN / CHECK_OUT), so a re-sighted person is never
toggled into a bogus check-out; the service owns the state machine and
duplicate suppression.

Single-writer rule: this task is the sole consumer of the generator queue.
The synchronous API paths (POST /engine/recognize and /engine/recognize-stream)
bypass the queue entirely (generate_event enqueue=False) and persist inline,
so every event has exactly one writer.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.engine.attendance_generator import (
    AttendanceEvent,
    AttendanceEventType,
    get_attendance_generator,
)
from app.engine.config import engine_config
from app.engine.stream_manager import get_stream_manager

logger = logging.getLogger(__name__)

DRAIN_INTERVAL_SECONDS = 2.0

# Event types the attendance ledger can represent. BREAK_* / OVERTIME_* have
# no attendance_records columns and must not be forced through the
# check-in/out state machine.
_EVENT_INTENTS: dict[AttendanceEventType, str] = {
    AttendanceEventType.CHECK_IN: "check_in",
    AttendanceEventType.CHECK_OUT: "check_out",
}


def employee_pk_from_identity(identity: str | None) -> int | None:
    """Map a FAISS identity string to an employees.id, or None to skip.

    Employees are enrolled under their numeric primary key; visitors under
    "visitor-<id>" (visitor presence is tracked by the visitor module, not
    the attendance ledger).
    """
    if not identity:
        return None
    try:
        return int(identity)
    except (TypeError, ValueError):
        return None


class AttendanceEventConsumer:
    """Background task that drains attendance events into the database."""

    def __init__(self, interval_seconds: float = DRAIN_INTERVAL_SECONDS) -> None:
        self._interval = interval_seconds
        self._task: asyncio.Task | None = None
        self._running = False
        # Events that failed transiently (or were in flight when a drain was
        # cancelled) and should be replayed on the next drain. Never pushed
        # back into the generator deque: appendleft on a full maxlen deque
        # would evict the newest event.
        self._retry: list[AttendanceEvent] = []

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Final flush so events generated just before shutdown are not lost.
        # This also covers the batch remainder a cancelled mid-drain stashed
        # into self._retry, so events already popped from the generator by an
        # interrupted drain are persisted rather than dropped.
        try:
            await self.drain_once()
        except Exception:
            logger.exception("Final attendance event flush failed")

    async def _run(self) -> None:
        while self._running:
            await asyncio.sleep(self._interval)
            try:
                await self.drain_once()
            except Exception:
                # Keep the loop alive: one bad batch (e.g. DB outage) must not
                # permanently stop camera attendance.
                logger.exception("Attendance event drain failed")

    async def drain_once(self) -> int:
        """Drain pending events; returns how many produced a real write."""
        # Replay events stashed by a previous drain first; the stale-age guard
        # in _persist_event bounds how long any one event can keep coming back.
        events = self._retry
        self._retry = []
        events.extend(get_attendance_generator().drain_events())
        if not events:
            return 0

        # Imported here, not at module top: app.engine.* must stay importable
        # without DB configuration (engine unit tests construct these modules
        # directly).
        from app.core.database import async_session_factory
        from app.services.attendance_service import process_recognition

        max_age = engine_config.attendance.duplicate_window_seconds
        now = datetime.now(timezone.utc)
        persisted = 0
        noop = 0
        skipped = 0
        processed = 0

        try:
            async with async_session_factory() as session:
                for event in events:
                    outcome = await self._persist_event(
                        session, event, process_recognition, now=now, max_age=max_age
                    )
                    if outcome == "persisted":
                        persisted += 1
                    elif outcome == "noop":
                        noop += 1
                    else:
                        skipped += 1
                    processed += 1
        except BaseException:
            # Cancelled (or failed outside the per-event handler, e.g. opening
            # the session) mid-drain: these events are already popped from the
            # generator, so stash the unprocessed remainder for the next drain
            # / the final flush in stop() instead of losing it.
            self._retry.extend(events[processed:])
            raise

        if persisted or noop or skipped:
            logger.debug(
                "Camera attendance drain: %d persisted, %d no-op, %d skipped",
                persisted,
                noop,
                skipped,
            )
        return persisted

    async def _persist_event(
        self,
        session,
        event: AttendanceEvent,
        process_recognition,
        *,
        now: datetime,
        max_age: float,
    ) -> str:
        """Route one event; "persisted" only when a ledger row was written.

        "noop" means the state machine accepted the event but wrote nothing
        (already checked in/out, duplicate window); "skipped" covers events
        the ledger cannot represent plus failures stashed for retry.
        """
        employee_pk = employee_pk_from_identity(event.employee_id)
        if employee_pk is None:
            return "skipped"
        age = (now - event.timestamp).total_seconds()
        if age > max_age:
            # Replaying a stale check-in long after the fact could flip
            # an open record straight into a bogus check-out.
            logger.warning(
                "Discarding stale attendance event for employee %s (%.0fs old)",
                event.employee_id,
                age,
            )
            return "skipped"
        intent = _EVENT_INTENTS.get(event.event_type)
        if intent is None:
            logger.debug(
                "Skipping %s event for employee %s: no ledger columns for it",
                event.event_type.value,
                event.employee_id,
            )
            return "skipped"

        # The stream registry carries the camera's organization (stream_sync
        # hydrates it from the Location join at registration), so the service
        # can veto a cross-tenant match from the global FAISS index. An
        # unregistered camera falls back to None (the matched employee's org).
        organization_id = None
        if event.camera_id is not None:
            stream = get_stream_manager().get_stream(event.camera_id)
            if stream is not None:
                organization_id = stream.organization_id

        try:
            record = await process_recognition(
                session,
                employee_pk,
                camera_id=event.camera_id,
                confidence=event.confidence,
                liveness_passed=event.liveness_score > 0,
                organization_id=organization_id,
                method="face",
                intent=intent,
            )
            await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Commit per event so one failure cannot poison the batch; keep
            # the event for the next drain (the stale-age guard bounds this).
            logger.exception(
                "Failed to persist attendance event for employee %s",
                event.employee_id,
            )
            await session.rollback()
            # The service arms the duplicate fast-path after a successful
            # flush; a failure between arm and commit would make the retried
            # event read as duplicate_ignored for the whole window. Unarm
            # before stashing for retry (best-effort, never raises).
            from app.services.attendance_service import clear_duplicate_marker

            await clear_duplicate_marker(employee_pk, method="face")
            self._retry.append(event)
            return "skipped"
        if record is None:
            return "skipped"
        if record.last_action in ("check_in", "check_out"):
            return "persisted"
        return "noop"


_consumer: AttendanceEventConsumer | None = None


def get_attendance_consumer() -> AttendanceEventConsumer:
    global _consumer
    if _consumer is None:
        _consumer = AttendanceEventConsumer()
    return _consumer
