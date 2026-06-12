from __future__ import annotations

import enum
from datetime import date, datetime

from pydantic import BaseModel, field_validator


class AlertCameraOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str


class AlertEmployeeOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    first_name: str
    last_name: str
    employee_code: str | None = None


class SecurityAlertOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int | None = None
    alert_type: str
    severity: str
    title: str
    description: str | None = None
    camera_id: int | None = None
    employee_id: int | None = None
    access_point_id: int | None = None
    recognition_event_id: int | None = None
    camera: AlertCameraOut | None = None
    employee: AlertEmployeeOut | None = None
    snapshot_path: str | None = None
    metadata_json: dict | None = None
    status: str
    acknowledged_at: datetime | None = None
    acknowledged_by: int | None = None
    resolved_at: datetime | None = None
    resolved_by: int | None = None
    occurred_at: datetime | None = None
    created_at: datetime | None = None

    # The ORM stores severity/status as Enum members; the API speaks plain strings.
    @field_validator("severity", "status", mode="before")
    @classmethod
    def _enum_value(cls, v: object) -> object:
        return v.value if isinstance(v, enum.Enum) else v


class AlertTrendPoint(BaseModel):
    day: date
    count: int


class SecurityDashboard(BaseModel):
    total_alerts: int
    open_alerts: int
    acknowledged_alerts: int
    resolved_alerts: int
    by_severity: dict[str, int]
    by_type: dict[str, int]
    trend: list[AlertTrendPoint]
    recent_alerts: list[SecurityAlertOut]


class SecurityConfigResponse(BaseModel):
    enabled: bool
    after_hours_start: str
    after_hours_end: str
    tailgating_window: int
    alert_cooldown: int
