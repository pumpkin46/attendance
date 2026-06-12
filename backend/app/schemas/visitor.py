from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class HostOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    employee_code: str | None = None
    department: str | None = None
    email: str | None = None
    job_title: str | None = None


class VisitorCreate(BaseModel):
    name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    purpose: str | None = None
    host_employee_id: int | None = None
    visit_start_at: datetime | None = None
    visit_end_at: datetime | None = None
    expected_arrival: datetime | None = None
    expected_departure: datetime | None = None
    photo_url: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    nationality: str | None = None
    language: str | None = None
    emergency_contact: str | None = None
    emergency_phone: str | None = None
    id_type: str | None = None
    id_number: str | None = None
    id_expiration_date: date | None = None
    passport_number: str | None = None
    driving_license_number: str | None = None
    national_id_number: str | None = None
    job_title: str | None = None
    department: str | None = None
    business_category: str | None = None
    website: str | None = None
    visitor_category: str | None = "walk_in"
    visit_type: str | None = None
    visit_description: str | None = None
    meeting_subject: str | None = None
    expected_duration_minutes: int | None = None
    visit_priority: str | None = None
    access_zones: str | None = None
    contract_start_date: date | None = None
    contract_end_date: date | None = None
    safety_training_status: str | None = None
    work_permit_number: str | None = None
    vehicle_number: str | None = None
    vehicle_type: str | None = None
    parking_zone: str | None = None
    driver_info: str | None = None
    pre_registered: bool = False


class VisitorUpdate(BaseModel):
    name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    purpose: str | None = None
    host_employee_id: int | None = None
    visit_start_at: datetime | None = None
    visit_end_at: datetime | None = None
    visit_type: str | None = None
    visit_description: str | None = None
    current_zone: str | None = None
    visit_priority: str | None = None


class VisitorOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    visitor_code: str | None = None
    name: str
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    purpose: str | None = None
    host_employee_id: int | None = None
    host: HostOut | None = None
    check_in_code: str | None = None
    badge_number: str | None = None
    pin_code: str | None = None
    face_registered: bool = False
    status: str
    approval_status: str | None = None
    visitor_category: str | None = None
    visit_type: str | None = None
    visit_description: str | None = None
    meeting_subject: str | None = None
    visit_priority: str | None = None
    visit_start_at: datetime
    visit_end_at: datetime
    expected_arrival: datetime | None = None
    expected_departure: datetime | None = None
    checked_in_at: datetime | None = None
    checked_out_at: datetime | None = None
    face_expires_at: datetime | None = None
    current_zone: str | None = None
    photo_url: str | None = None
    gender: str | None = None
    nationality: str | None = None
    id_type: str | None = None
    id_number: str | None = None
    contract_start_date: date | None = None
    contract_end_date: date | None = None
    vehicle_number: str | None = None
    parking_zone: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VisitorDashboard(BaseModel):
    on_site: int
    expected: int
    checked_in_today: int
    checked_out_today: int
    overdue: int
    pending_approval: int


class VisitorDailyReport(BaseModel):
    date: str
    total: int
    checked_in: int
    checked_out: int
    pending: int
    overdue: int


class BlacklistCreate(BaseModel):
    name: str
    id_number: str | None = None
    reason: str = "blocked"
    notes: str | None = None
    visitor_id: int | None = None


class BlacklistOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    visitor_id: int | None = None
    name: str
    id_number: str | None = None
    reason: str
    notes: str | None = None
    is_active: bool
    created_at: datetime | None = None


class ApprovalRequest(BaseModel):
    stage: str = Field(description="manager, security, or final")
    notes: str | None = None


class VisitorPhotoOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    visitor_id: int
    url: str
    is_primary: bool
    caption: str | None = None
    created_at: datetime | None = None


class VisitorDocumentOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    visitor_id: int
    document_type: str
    url: str
    filename: str | None = None
    notes: str | None = None
    created_at: datetime | None = None


class VisitorLogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    visitor_id: int
    event_type: str
    description: str | None = None
    user_id: int | None = None
    created_at: datetime | None = None


class VisitorAccessPermissionOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    visitor_id: int
    zone_name: str
    granted: bool
    expires_at: datetime | None = None


class AccessPermissionSet(BaseModel):
    zones: list[str]


class RejectRequest(BaseModel):
    notes: str | None = None


class PhotoUploadBase64(BaseModel):
    image: str
    caption: str | None = None
    is_primary: bool = False


class VisitorFaceEnrollResult(BaseModel):
    """Result of a visitor face enrollment attempt (ad-hoc face_service payload)."""

    model_config = {"extra": "allow"}

    success: bool
    error: str | None = None
    employee_id: str | None = None
    faiss_id: str | None = None
    quality_score: float | None = None
    processing_ms: int | None = None
