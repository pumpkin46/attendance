from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class AttendanceRangeEntry(BaseModel):
    work_date: date
    employee_code: str
    employee_name: str
    department: str | None = None
    status: str
    attendance_type: str | None = None
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    check_in_method: str | None = None
    check_out_method: str | None = None
    worked_minutes: int = 0
    overtime_minutes: int = 0


class AttendanceRangeReport(BaseModel):
    """Raw attendance records over a date range (the Attendance page view)."""

    period_start: date
    period_end: date
    total_records: int
    present: int
    late_or_early: int
    worked_minutes: int
    overtime_minutes: int
    entries: list[AttendanceRangeEntry]


class UnknownPersonCamera(BaseModel):
    id: int
    name: str | None = None


class UnknownPersonEvent(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    camera_id: int | None = None
    result: str | None = None
    confidence: float | None = None
    liveness_passed: bool | None = None
    processing_ms: int | None = None
    snapshot_path: str | None = None
    snapshot_url: str | None = None
    notified_at: datetime | None = None
    recognized_at: datetime | None = None
    metadata: dict | None = None
    camera: UnknownPersonCamera | None = None


class UnknownPersonsSummary(BaseModel):
    """Range-wide aggregates backing the Unknown Faces stat cards + camera filter."""

    total: int
    alerts: int
    spoof: int
    cameras: list[UnknownPersonCamera]
