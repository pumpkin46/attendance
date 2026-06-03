from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class VisitorCreate(BaseModel):
    name: str
    company: str | None = None
    phone: str | None = None
    purpose: str | None = None
    host_employee_id: int | None = None
    visit_start_at: datetime | None = None
    visit_end_at: datetime | None = None


class VisitorOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    name: str
    company: str | None = None
    phone: str | None = None
    purpose: str | None = None
    host_employee_id: int | None = None
    check_in_code: str | None = None
    badge_number: str | None = None
    face_registered: bool = False
    status: str
    visit_start_at: datetime
    visit_end_at: datetime
    checked_in_at: datetime | None = None
    face_expires_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VisitorKioskCreate(BaseModel):
    name: str
    location_id: int | None = None
    allow_walk_in: bool = True
    require_host: bool = False
    require_liveness: bool = True


class VisitorKioskOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    location_id: int | None = None
    name: str
    device_id: str
    is_active: bool
    allow_walk_in: bool
    require_host: bool
    require_liveness: bool
    online: bool = False
    last_heartbeat_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class KioskConfigResponse(BaseModel):
    default_visit_hours: int
    face_expiry_buffer_minutes: int
    badge_prefix: str
    require_face_enrollment: bool


class HostOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    department: str | None = None
    email: str | None = None


class VisitorLookupRequest(BaseModel):
    check_in_code: str


class VisitorRegisterRequest(BaseModel):
    name: str
    company: str | None = None
    phone: str | None = None
    purpose: str | None = None
    host_employee_id: int | None = None
