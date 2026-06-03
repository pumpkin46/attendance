from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel, Field


# ── Attendance Records ────────────────────────────────────────────────────────


class AttendanceRecordOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    employee_id: int
    location_id: int | None = None
    camera_id: int | None = None
    shift_id: int | None = None
    work_date: date
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    check_in_method: str | None = None
    check_out_method: str | None = None
    worked_minutes: int = 0
    overtime_minutes: int = 0
    status: str = "absent"
    attendance_type: str | None = None
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TodaySummary(BaseModel):
    total_employees: int
    present: int
    late: int
    absent: int
    on_leave: int


class AttendanceManualRequest(BaseModel):
    employee_id: int
    work_date: str
    check_in_at: str | None = None
    check_out_at: str | None = None
    notes: str | None = None


class ShiftTypeMeta(BaseModel):
    label: str
    example: str | None = None
    description: str | None = None
    slots: list[str] | None = None


SHIFT_TYPES: dict[str, ShiftTypeMeta] = {
    "fixed": ShiftTypeMeta(label="Fixed Shift", example="09:00–18:00"),
    "rotational": ShiftTypeMeta(
        label="Rotational Shift",
        slots=["morning", "evening", "night"],
    ),
    "flexible": ShiftTypeMeta(
        label="Flexible Shift",
        description="Employee defines start time",
    ),
    "split": ShiftTypeMeta(label="Split Shift", example="08:00–12:00, 14:00–18:00"),
}


class AttendanceConfigResponse(BaseModel):
    attendance_grace_minutes: int
    attendance_min_work_minutes: int
    attendance_max_work_minutes: int
    attendance_break_minutes: int
    attendance_half_day_minutes: int
    attendance_min_confidence: float
    attendance_overtime_threshold_minutes: int
    face_duplicate_window_seconds: int
    rfid_duplicate_window_seconds: int
    anomaly_detection_enabled: bool
    anomaly_lookback_days: int
    shift_types: dict[str, ShiftTypeMeta] = Field(default_factory=lambda: dict(SHIFT_TYPES))


# ── Attendance Policies ──────────────────────────────────────────────────────


class AttendancePolicyOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    name: str
    grace_minutes: int = 15
    min_work_minutes: int = 240
    max_work_minutes: int = 600
    break_minutes: int = 60
    overtime_after_minutes: int = 480
    overtime_multiplier: float = 1.5
    night_shift_start: time | None = None
    night_shift_end: time | None = None
    night_shift_multiplier: float = 1.25
    weekend_days: Any | None = None
    weekend_multiplier: float = 1.5
    holiday_paid: bool = True
    auto_checkout_exit_zone: bool = True
    require_liveness_checkin: bool = True
    min_confidence: float = 0.95
    half_day_minutes: int = 240
    is_default: bool = False
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AttendancePolicyCreate(BaseModel):
    name: str
    grace_minutes: int = 15
    min_work_minutes: int = 240
    max_work_minutes: int = 600
    break_minutes: int = 60
    overtime_after_minutes: int = 480
    overtime_multiplier: float = 1.5
    night_shift_start: str | None = None
    night_shift_end: str | None = None
    night_shift_multiplier: float = 1.25
    weekend_days: list[int] | None = None
    weekend_multiplier: float = 1.5
    holiday_paid: bool = True
    auto_checkout_exit_zone: bool = True
    require_liveness_checkin: bool = True
    min_confidence: float = 0.95
    half_day_minutes: int = 240
    is_default: bool = False


# ── Shifts ────────────────────────────────────────────────────────────────────


class ShiftOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    attendance_policy_id: int | None = None
    name: str
    type: str = "fixed"
    rotation_slot: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    segments: Any | None = None
    grace_minutes: int = 15
    break_minutes: int = 0
    min_work_minutes: int | None = None
    max_work_minutes: int | None = None
    days_of_week: Any | None = None
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ShiftCreate(BaseModel):
    name: str
    type: str = "fixed"
    rotation_slot: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    segments: list[dict[str, str]] | None = None
    attendance_policy_id: int | None = None
    grace_minutes: int = 15
    break_minutes: int = 0
    min_work_minutes: int | None = None
    max_work_minutes: int | None = None
    days_of_week: list[int] | None = None


class ShiftAssignRequest(BaseModel):
    employee_id: int
    effective_from: str
    effective_to: str | None = None


# ── Holidays ──────────────────────────────────────────────────────────────────


class HolidayOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    location_id: int | None = None
    name: str
    date: date
    is_recurring: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class HolidayCreate(BaseModel):
    name: str
    date: str
    location_id: int | None = None
    is_recurring: bool = False


# ── Leave Requests ────────────────────────────────────────────────────────────


class LeaveRequestOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    employee_id: int
    type: str
    start_date: date
    end_date: date
    reason: str | None = None
    status: str = "pending"
    approved_by: int | None = None
    approved_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class LeaveRequestCreate(BaseModel):
    employee_id: int | None = None
    type: str
    start_date: str
    end_date: str
    reason: str | None = None


class LeaveRequestUpdate(BaseModel):
    status: str = Field(..., pattern=r"^(approved|rejected)$")


# ── Anomalies ─────────────────────────────────────────────────────────────────


class AnomalyOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    attendance_record_id: int | None = None
    employee_id: int
    anomaly_type: str
    severity: str = "medium"
    score: float = 0
    title: str
    description: str
    evidence: Any | None = None
    status: str = "open"
    detection_run_id: str | None = None
    detected_at: datetime | None = None
    acknowledged_at: datetime | None = None
    acknowledged_by: int | None = None
    resolved_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AnomalySummary(BaseModel):
    total: int
    open: int
    acknowledged: int
    by_severity: dict[str, int]
    by_type: dict[str, int]


class AnomalyDetectRequest(BaseModel):
    employee_ids: list[int] | None = None
    lookback_days: int | None = None


class AnomalyUpdateRequest(BaseModel):
    status: str = Field(
        ..., pattern=r"^(acknowledged|resolved|false_positive)$"
    )
