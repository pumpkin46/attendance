from datetime import date, datetime

from pydantic import BaseModel


class EmployeeOut(BaseModel):
    id: int
    organization_id: int
    location_id: int | None = None
    employee_code: str
    first_name: str
    last_name: str
    email: str | None = None
    department: str | None = None
    job_title: str | None = None
    phone: str | None = None
    hire_date: date | None = None
    termination_date: date | None = None
    face_enrolled: bool = False
    face_enrolled_at: datetime | None = None
    face_enrollment_score: float | None = None
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class EmployeeCreate(BaseModel):
    organization_id: int | None = None
    location_id: int | None = None
    employee_code: str
    first_name: str
    last_name: str
    email: str | None = None
    department: str | None = None
    job_title: str | None = None
    hire_date: date | None = None


class EmployeeUpdate(BaseModel):
    location_id: int | None = None
    employee_code: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    department: str | None = None
    job_title: str | None = None
    phone: str | None = None
    hire_date: date | None = None
    termination_date: date | None = None
    is_active: bool | None = None
