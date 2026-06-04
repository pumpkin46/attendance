from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class DailyEmployeeEntry(BaseModel):
    employee_code: str
    employee_name: str
    status: str
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    worked_minutes: int = 0
    overtime_minutes: int = 0


class DailyReport(BaseModel):
    date: date
    present: int
    absent: int
    late: int
    on_leave: int
    total_records: int = 0
    employees: list[DailyEmployeeEntry]


class MonthlySummary(BaseModel):
    total_working_days: int
    attendance_percent: float
    overtime_minutes: int
    absence_count: int


class MonthlyEmployeeEntry(BaseModel):
    employee_id: int
    employee_code: str
    employee_name: str
    department: str | None = None
    total_working_days: int
    present_days: int = 0
    attendance_percent: float
    overtime_minutes: int = 0
    overtime_hours: float
    absence_count: int
    late_count: int
    on_leave_count: int


class MonthlyReport(BaseModel):
    year: int
    month: int
    total_working_days: int
    employee_count: int = 0
    summary: MonthlySummary
    employees: list[MonthlyEmployeeEntry]


class AttendanceSummaryReport(BaseModel):
    period_start: date
    period_end: date
    total_employees: int
    avg_attendance_rate: float
    total_present: int
    total_absent: int
    total_late: int
    total_on_leave: int
    total_half_days: int


class OvertimeReport(BaseModel):
    period_start: date
    period_end: date
    employees: list["OvertimeEntry"]


class OvertimeEntry(BaseModel):
    employee_id: int
    employee_name: str
    department: str | None = None
    total_overtime_minutes: int
    overtime_days: int


class UnknownPersonCamera(BaseModel):
    id: int
    name: str | None = None


class UnknownPersonEvent(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    camera_id: int | None = None
    result: str | None = None
    confidence: float | None = None
    snapshot_path: str | None = None
    snapshot_url: str | None = None
    notified_at: datetime | None = None
    recognized_at: datetime | None = None
    metadata: dict | None = None
    camera: UnknownPersonCamera | None = None


class UnknownPersonReport(BaseModel):
    total: int
    events: list[UnknownPersonEvent]
