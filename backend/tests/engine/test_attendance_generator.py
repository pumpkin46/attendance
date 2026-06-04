"""Tests for attendance event generation."""

from datetime import datetime, timedelta, timezone

from app.engine.attendance_generator import (
    AttendanceEventType,
    AttendanceGenerator,
    DuplicateTracker,
)
from app.engine.config import engine_config


def test_generate_check_in_event():
    generator = AttendanceGenerator()
    event = generator.generate_event(
        "EMP001",
        camera_id=3,
        confidence=0.96,
        liveness_score=0.91,
        employee_name="Jane Doe",
    )

    assert event is not None
    assert event.employee_id == "EMP001"
    assert event.event_type == AttendanceEventType.CHECK_IN
    assert event.camera_id == 3
    assert event.confidence == 0.96


def test_direction_resolves_event_type():
    generator = AttendanceGenerator()

    check_in = generator.generate_event("EMP001", direction="in")
    check_out = generator.generate_event("EMP002", direction="out")

    assert check_in is not None
    assert check_out is not None
    assert check_in.event_type == AttendanceEventType.CHECK_IN
    assert check_out.event_type == AttendanceEventType.CHECK_OUT


def test_duplicate_prevention_within_window():
    generator = AttendanceGenerator()
    engine_config.attendance.duplicate_window_seconds = 300

    first = generator.generate_event("EMP001", event_type=AttendanceEventType.CHECK_IN)
    second = generator.generate_event("EMP001", event_type=AttendanceEventType.CHECK_IN)

    assert first is not None
    assert second is None
    assert generator.stats["total_events_generated"] == 1
    assert generator.stats["duplicates_prevented"] == 1


def test_different_event_types_not_duplicates():
    generator = AttendanceGenerator()

    check_in = generator.generate_event("EMP001", event_type=AttendanceEventType.CHECK_IN)
    check_out = generator.generate_event("EMP001", event_type=AttendanceEventType.CHECK_OUT)

    assert check_in is not None
    assert check_out is not None
    assert generator.stats["total_events_generated"] == 2


def test_drain_events_clears_queue():
    generator = AttendanceGenerator()
    generator.generate_event("EMP001")
    generator.generate_event("EMP002")

    events = generator.drain_events()
    assert len(events) == 2
    assert generator.stats["pending_events"] == 0


def test_duplicate_tracker_clear_expired():
    tracker = DuplicateTracker()
    engine_config.attendance.duplicate_window_seconds = 1

    tracker._events["EMP001:CHECK_IN"] = datetime.now(timezone.utc) - timedelta(seconds=10)
    removed = tracker.clear_expired()

    assert removed == 1
    assert "EMP001:CHECK_IN" not in tracker._events


def test_event_to_dict():
    generator = AttendanceGenerator()
    event = generator.generate_event("EMP001", confidence=0.97, liveness_score=0.88)
    payload = event.to_dict()

    assert payload["employee_id"] == "EMP001"
    assert payload["event_type"] == "CHECK_IN"
    assert payload["confidence"] == 0.97
    assert payload["liveness_score"] == 0.88
    assert "timestamp" in payload
