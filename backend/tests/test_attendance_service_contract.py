"""Contract tests for attendance_service call signatures.

These guard against the call sites in the API routers drifting from the
service function signatures (a past bug: recognition_api called
process_recognition with kwargs the function did not accept, raising
TypeError at runtime on every matched recognition).
"""

from __future__ import annotations

import inspect

from app.services.attendance_service import process_recognition, process_rfid_tap


def test_process_recognition_accepts_engine_api_call():
    # Mirrors app/api/engine_api.py
    inspect.signature(process_recognition).bind(
        db="db",
        employee_id=1,
        camera_id=2,
        confidence=0.9,
        liveness_passed=True,
        method="face",
    )


def test_process_recognition_accepts_recognition_api_call():
    # Mirrors app/api/recognition_api.py
    inspect.signature(process_recognition).bind(
        db="db",
        employee_id=1,
        confidence=0.9,
        liveness_passed=True,
        processing_ms=42,
        organization_id=5,
    )


def test_process_rfid_tap_accepts_rfid_call():
    # Mirrors app/api/rfid.py -> process_rfid_tap(db, employee_id, direction)
    inspect.signature(process_rfid_tap).bind("db", 1, "in")
