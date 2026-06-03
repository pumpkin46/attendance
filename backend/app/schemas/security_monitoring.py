from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SecurityAlertOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    alert_type: str
    severity: str
    title: str
    description: str | None = None
    camera_id: int | None = None
    access_point_id: int | None = None
    snapshot_path: str | None = None
    metadata_json: dict | None = None
    status: str
    acknowledged_at: datetime | None = None
    acknowledged_by: int | None = None
    resolved_at: datetime | None = None
    resolved_by: int | None = None
    created_at: datetime | None = None


class SecurityDashboard(BaseModel):
    total_alerts: int
    open_alerts: int
    acknowledged_alerts: int
    resolved_alerts: int
    by_severity: dict[str, int]
    by_type: dict[str, int]
    recent_alerts: list[SecurityAlertOut]


class SecurityConfigResponse(BaseModel):
    enabled: bool
    after_hours_start: str
    after_hours_end: str
    tailgating_window: int
    alert_cooldown: int
