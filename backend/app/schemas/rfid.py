from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class LocationBrief(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str


class RfidReaderCreate(BaseModel):
    name: str
    location_id: int
    device_id: str | None = None
    direction: str = "both"


class RfidReaderUpdate(BaseModel):
    name: str | None = None
    location_id: int | None = None
    device_id: str | None = None
    direction: str | None = None
    is_active: bool | None = None


class RfidReaderOut(BaseModel):
    id: int
    name: str
    device_id: str
    direction: str
    is_active: bool
    online: bool = False
    last_heartbeat_at: datetime | None = None
    taps_today: int = 0
    location: LocationBrief | None = None


class RfidReaderCreatedOut(RfidReaderOut):
    """Reader detail plus the one-time plaintext device token."""

    api_token_plain: str


class RfidTokenRegeneratedOut(BaseModel):
    id: int
    api_token_plain: str
    message: str


class RfidCardCreate(BaseModel):
    uid: str
    label: str | None = None


class RfidCardOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    employee_id: int
    uid: str
    label: str | None = None
    is_active: bool
    assigned_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EmployeeBrief(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    first_name: str
    last_name: str
    employee_code: str | None = None


class ReaderBrief(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str


class RfidEventOut(BaseModel):
    id: int
    uid: str
    result: str
    tapped_at: datetime
    metadata: dict | None = None
    employee: EmployeeBrief | None = None
    reader: ReaderBrief | None = None


class TapRequest(BaseModel):
    uid: str
    timestamp: datetime | None = None


class SimulateRequest(BaseModel):
    rfid_reader_id: int
    uid: str
    timestamp: datetime | None = None


class SimulateTapResponse(BaseModel):
    matched: bool
    reason: str | None = None
    uid: str | None = None
    attendance_action: str | None = None
    employee: EmployeeBrief | None = None


class DeviceTapResponse(BaseModel):
    matched: bool
    reason: str | None = None
    uid: str | None = None
    attendance_action: str | None = None
    employee: EmployeeBrief | None = None
