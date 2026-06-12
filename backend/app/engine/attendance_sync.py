"""Persist engine attendance events into the attendance ledger.

The camera pipeline (recognition_engine -> attendance_generator) produces
AttendanceEvents in memory only; nothing under app/engine holds a DB session,
so without this consumer events from running streams are counted in metrics
but never written to attendance_records. The consumer drains the generator
queue on a short interval and routes each event through
attendance_service.process_recognition, which owns the check-in/out state
machine and duplicate suppression.

Single-writer rule: this task is the only component that persists queued
events. The one synchronous path (POST /engine/recognize) claims its event
from the queue via AttendanceGenerator.consume() before writing inline, so an
event is persisted exactly once.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.engine.attendance_generator import AttendanceEvent, get_attendance_generator
from app.engine.config import engine_config

logger = logging.getLogger(__name__)

DRAIN_INTERVAL_SECONDS = 2.0


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
        """Drain pending events; returns how many were persisted."""
        events = get_attendance_generator().drain_events()
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

        async with async_session_factory() as session:
            for event in events:
                employee_pk = employee_pk_from_identity(event.employee_id)
                if employee_pk is None:
                    continue
                age = (now - event.timestamp).total_seconds()
                if age > max_age:
                    # Replaying a stale check-in long after the fact could flip
                    # an open record straight into a bogus check-out.
                    logger.warning(
                        "Discarding stale attendance event for employee %s (%.0fs old)",
                        event.employee_id,
                        age,
                    )
                    continue
                try:
                    await process_recognition(
                        session,
                        employee_pk,
                        camera_id=event.camera_id,
                        confidence=event.confidence,
                        liveness_passed=event.liveness_score > 0,
                        method="face",
                    )
                    await session.commit()
                    persisted += 1
                except Exception:
                    # Commit per event so one failure cannot poison the batch.
                    logger.exception(
                        "Failed to persist attendance event for employee %s",
                        event.employee_id,
                    )
                    await session.rollback()

        if persisted:
            logger.debug("Persisted %d camera attendance event(s)", persisted)
        return persisted


_consumer: AttendanceEventConsumer | None = None


def get_attendance_consumer() -> AttendanceEventConsumer:
    global _consumer
    if _consumer is None:
        _consumer = AttendanceEventConsumer()
    return _consumer
