"""
Stage 9: Attendance Event Creation — Generate attendance records from verified identities.

Attendance Types:
- Check-In
- Check-Out
- Break Start
- Break End
- Overtime Start
- Overtime End

Duplicate Prevention: configurable window (default 5 minutes).

Event Output includes: employee_id, name, camera_id, event_type, confidence,
liveness_score, timestamp.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from app.engine.config import engine_config

logger = logging.getLogger(__name__)

# Upper bound on pending (not yet persisted) events. The consumer drains every
# couple of seconds, so hitting this means it is dead/stopped — dropping the
# oldest is preferable to growing without bound for the process lifetime.
MAX_PENDING_EVENTS = 1000


class AttendanceEventType(Enum):
    CHECK_IN = "CHECK_IN"
    CHECK_OUT = "CHECK_OUT"
    BREAK_START = "BREAK_START"
    BREAK_END = "BREAK_END"
    OVERTIME_START = "OVERTIME_START"
    OVERTIME_END = "OVERTIME_END"


@dataclass
class AttendanceEvent:
    employee_id: str
    employee_name: str | None
    camera_id: int | None
    event_type: AttendanceEventType
    confidence: float
    liveness_score: float
    timestamp: datetime
    location_id: int | None = None
    zone: str | None = None
    verification_level: str | None = None
    processing_ms: int = 0
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "employee_id": self.employee_id,
            "employee_name": self.employee_name,
            "camera_id": self.camera_id,
            "event_type": self.event_type.value,
            "confidence": round(self.confidence, 4),
            "liveness_score": round(self.liveness_score, 4),
            "timestamp": self.timestamp.isoformat(),
            "location_id": self.location_id,
            "zone": self.zone,
            "verification_level": self.verification_level,
            "processing_ms": self.processing_ms,
        }


class DuplicateTracker:
    """Prevent duplicate attendance events within a configurable time window."""

    def __init__(self) -> None:
        self._events: dict[str, datetime] = {}

    def is_duplicate(self, employee_id: str, event_type: AttendanceEventType) -> bool:
        key = f"{employee_id}:{event_type.value}"
        now = datetime.now(timezone.utc)
        last = self._events.get(key)

        window = engine_config.attendance.duplicate_window_seconds
        if last and (now - last).total_seconds() < window:
            return True

        self._events[key] = now
        return False

    def clear_expired(self) -> int:
        now = datetime.now(timezone.utc)
        window = engine_config.attendance.duplicate_window_seconds
        expired = [
            k for k, v in self._events.items()
            if (now - v).total_seconds() > window * 2
        ]
        for k in expired:
            del self._events[k]
        return len(expired)


class AttendanceGenerator:
    """Generate attendance events from verified recognition results."""

    def __init__(self) -> None:
        self._duplicate_tracker = DuplicateTracker()
        # Producers run on threadpool threads while the consumer drains from
        # the event loop; deque append/popleft are atomic under the GIL.
        self._event_queue: deque[AttendanceEvent] = deque(maxlen=MAX_PENDING_EVENTS)
        self._total_events = 0
        self._duplicates_prevented = 0

    @property
    def stats(self) -> dict:
        return {
            "total_events_generated": self._total_events,
            "duplicates_prevented": self._duplicates_prevented,
            "pending_events": len(self._event_queue),
        }

    def generate_event(
        self,
        employee_id: str,
        *,
        employee_name: str | None = None,
        camera_id: int | None = None,
        event_type: AttendanceEventType = AttendanceEventType.CHECK_IN,
        confidence: float = 0.0,
        liveness_score: float = 0.0,
        location_id: int | None = None,
        zone: str | None = None,
        direction: str | None = None,
        verification_level: str | None = None,
        processing_ms: int = 0,
        meta: dict | None = None,
        enqueue: bool = True,
    ) -> AttendanceEvent | None:
        """Generate an attendance event with duplicate prevention.

        enqueue=False builds and returns the event without queueing it for
        the background consumer: API-initiated recognitions persist inline
        and must never be double-written by the consumer.
        """
        resolved_type = self._resolve_event_type(event_type, direction)

        if self._duplicate_tracker.is_duplicate(employee_id, resolved_type):
            self._duplicates_prevented += 1
            logger.debug(
                "Duplicate prevented for %s (%s)", employee_id, resolved_type.value
            )
            return None

        event = AttendanceEvent(
            employee_id=employee_id,
            employee_name=employee_name,
            camera_id=camera_id,
            event_type=resolved_type,
            confidence=confidence,
            liveness_score=liveness_score,
            timestamp=datetime.now(timezone.utc),
            location_id=location_id,
            zone=zone,
            verification_level=verification_level,
            processing_ms=processing_ms,
            meta=meta or {},
        )

        if enqueue:
            self._event_queue.append(event)
        self._total_events += 1
        logger.info(
            "Attendance event: %s %s @ camera %s (conf=%.2f)",
            employee_id, resolved_type.value, camera_id, confidence,
        )
        return event

    def drain_events(self) -> list[AttendanceEvent]:
        """Drain the event queue for batch processing.

        Pops one event at a time so nothing appended concurrently (producers
        run on threadpool threads) is lost between a copy and a clear.
        """
        events: list[AttendanceEvent] = []
        while True:
            try:
                events.append(self._event_queue.popleft())
            except IndexError:
                return events

    def _resolve_event_type(
        self, event_type: AttendanceEventType, direction: str | None
    ) -> AttendanceEventType:
        """Resolve event type based on camera direction if not explicitly set."""
        if direction == "in":
            return AttendanceEventType.CHECK_IN
        elif direction == "out":
            return AttendanceEventType.CHECK_OUT
        return event_type

    def cleanup(self) -> None:
        self._duplicate_tracker.clear_expired()


_generator: AttendanceGenerator | None = None


def get_attendance_generator() -> AttendanceGenerator:
    global _generator
    if _generator is None:
        _generator = AttendanceGenerator()
    return _generator
