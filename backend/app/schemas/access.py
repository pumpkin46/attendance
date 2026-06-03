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


class AccessConfigResponse(BaseModel):
    actions: dict[str, str]
    device_types: dict[str, str]
    grant_conditions: dict[str, bool]


class ExecuteRequest(BaseModel):
    action: str | None = None
