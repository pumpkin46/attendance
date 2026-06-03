from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CameraCreate(BaseModel):
    location_id: int
    name: str
    camera_type: str = "RTSP"
    zone: str | None = None
    floor: str | None = None
    device_id: str | None = None
    stream_url: str | None = None
    direction: str | None = None
    deployment_mode: str | None = None
    target_fps: int = 15
    resolution_width: int | None = None
    resolution_height: int | None = None


class CameraUpdate(BaseModel):
    location_id: int | None = None
    name: str | None = None
    camera_type: str | None = None
    zone: str | None = None
    floor: str | None = None
    device_id: str | None = None
    stream_url: str | None = None
    direction: str | None = None
    deployment_mode: str | None = None
    target_fps: int | None = None
    resolution_width: int | None = None
    resolution_height: int | None = None
    status: str | None = None
    is_active: bool | None = None


class CameraOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    location_id: int
    name: str
    camera_type: str
    zone: str | None = None
    floor: str | None = None
    device_id: str | None = None
    stream_url: str | None = None
    target_fps: int
    resolution_width: int | None = None
    resolution_height: int | None = None
    direction: str | None = None
    deployment_mode: str | None = None
    status: str
    is_active: bool
    last_heartbeat_at: datetime | None = None
    frame_rate_fps: float | None = None
    last_frame_at: datetime | None = None
    latency_ms: int | None = None
    bandwidth_kbps: float | None = None
    cpu_usage_percent: float | None = None
    gpu_usage_percent: float | None = None
    dropped_frames: int | None = None
    health_updated_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


CAMERA_TYPES: dict[str, str] = {
    "rtsp": "RTSP IP Camera",
    "ip": "IP Camera (HTTP)",
    "usb": "USB Camera",
    "nvr": "NVR Channel",
    "cctv": "CCTV Stream",
    "mobile": "Mobile Camera",
}

CAMERA_ZONES: dict[str, str] = {
    "entry": "Entry",
    "exit": "Exit",
    "lobby": "Lobby",
    "parking": "Parking",
    "office": "Office",
    "warehouse": "Warehouse",
    "other": "Other",
}

CAMERA_STATUSES: list[str] = ["active", "inactive", "maintenance"]


class CameraConfigResponse(BaseModel):
    poll_interval_seconds: int
    online_threshold_seconds: int
    health_log_retention_days: int
    health_log_interval_seconds: int
    max_cameras: int
    camera_types: dict[str, str] = Field(default_factory=lambda: dict(CAMERA_TYPES))
    zones: dict[str, str] = Field(default_factory=lambda: dict(CAMERA_ZONES))
    statuses: list[str] = Field(default_factory=lambda: list(CAMERA_STATUSES))


class CameraMonitoringSummary(BaseModel):
    total_cameras: int
    online: int
    offline: int
    cameras: list[dict]


class CameraHealthLogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    camera_id: int
    online: bool
    frame_rate_fps: float | None = None
    latency_ms: int | None = None
    bandwidth_kbps: float | None = None
    cpu_usage_percent: float | None = None
    gpu_usage_percent: float | None = None
    dropped_frames: int | None = None
    recognition_events: int | None = None
    recorded_at: datetime | None = None


class CaptureResult(BaseModel):
    success: bool
    image: str | None = None
    error: str | None = None
