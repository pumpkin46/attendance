from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class CameraLocationBrief(BaseModel):
    id: int
    name: str


class CameraHealth(BaseModel):
    online: bool
    fps: float | None = None
    latency_ms: int | None = None
    bandwidth_kbps: float | None = None
    cpu_usage_percent: float | None = None
    gpu_usage_percent: float | None = None
    dropped_frames: int = 0
    recognition_events_today: int = 0
    updated_at: str | None = None


class MonitoringCameraOut(BaseModel):
    """Rich camera shape produced by ``monitoring._format_camera``."""

    id: int
    name: str
    camera_type: str | None = None
    location: CameraLocationBrief | None = None
    zone: str | None = None
    floor: str | None = None
    stream_url: str | None = None
    target_fps: int | None = None
    resolution: str | None = None
    resolution_width: int | None = None
    resolution_height: int | None = None
    status: str | None = None
    is_active: bool | None = None
    direction: str | None = None
    deployment_mode: str | None = None
    device_id: str | None = None
    last_heartbeat_at: str | None = None
    last_frame_at: str | None = None
    health: CameraHealth
    recognition_count_today: int = 0
    online: bool = False
    frame_rate_fps: float | None = None


class CameraHealthSummary(BaseModel):
    online: int
    offline: int
    avg_fps: float | None = None
    avg_latency_ms: int | None = None
    total_dropped_frames: int = 0


class MonitoringDashboardOut(BaseModel):
    active_cameras: int
    total_cameras: int
    employees_present: int
    employees_absent: int
    employees_late: int
    # Default-bearing so payloads built before these fields existed (and the
    # mocked dashboards in the WS feed tests) still validate.
    employees_on_leave: int = 0
    total_employees: int = 0
    unknown_persons_today: int
    active_visitors: int
    camera_health: CameraHealthSummary
    cameras: list[MonitoringCameraOut]


class AttendanceTrendDay(BaseModel):
    """One calendar day of check-in volume, split on-time vs late."""

    date: str
    on_time: int
    late: int
    total: int


class AttendanceTrendOut(BaseModel):
    days: list[AttendanceTrendDay]


class LiveFeedEventOut(BaseModel):
    # Payload is arbitrary JSON; allow extra so nothing is dropped.
    model_config = ConfigDict(extra="allow")

    id: int
    event_type: str | None = None
    message: str | None = None
    payload: dict | None = None
    camera_id: int | None = None
    employee_id: int | None = None
    visitor_id: int | None = None
    occurred_at: str | None = None


class LiveFeedOut(BaseModel):
    events: list[LiveFeedEventOut]
