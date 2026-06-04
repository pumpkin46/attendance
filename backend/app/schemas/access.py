from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AccessPointCreate(BaseModel):
    name: str
    location_id: int | None = None
    camera_id: int | None = None
    device_type: str = "door"
    default_action: str = "unlock_door"
    controller_url: str | None = None
    require_liveness: bool | None = None
    min_confidence: float | None = None


class AccessPointOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    location_id: int | None = None
    camera_id: int | None = None
    name: str
    device_type: str
    default_action: str
    controller_url: str | None = None
    require_liveness: bool
    min_confidence: float
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CameraBrief(BaseModel):
    id: int
    name: str


class AccessPointWithCamera(AccessPointOut):
    """Access point with an embedded camera summary."""

    camera: CameraBrief | None = None


class AccessExecuteResponse(BaseModel):
    success: bool
    action: str
    access_point_id: int


class AccessConfigResponse(BaseModel):
    actions: dict[str, str]
    device_types: dict[str, str]
    grant_conditions: dict[str, bool]


class ExecuteRequest(BaseModel):
    action: str | None = None


class FaceGrantRequest(BaseModel):
    image: str
    require_liveness: bool | None = None
    pin_code: str | None = None
    badge_number: str | None = None
    check_in_code: str | None = None


class FaceGrantResponse(BaseModel):
    granted: bool
    action: str | None = None
    identity_type: str | None = None
    identity_id: str | None = None
    visitor_id: int | None = None
    employee_id: int | None = None
    confidence: float = 0.0
    liveness_passed: bool = False
    deny_reason: str | None = None
    processing_ms: int = 0

