from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Organization ────────────────────────────────────────────────────────────

class OrganizationOut(BaseModel):
    id: int
    name: str
    code: str
    timezone: str
    settings: dict[str, Any] | None = None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class OrganizationCreate(BaseModel):
    name: str
    code: str
    timezone: str = "UTC"
    settings: dict[str, Any] | None = None


# ── Branch ──────────────────────────────────────────────────────────────────

class BranchOut(BaseModel):
    id: int
    organization_id: int
    name: str
    code: str
    address: str | None = None
    timezone: str
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class BranchCreate(BaseModel):
    name: str
    code: str
    address: str | None = None
    timezone: str = "UTC"


# ── Department ──────────────────────────────────────────────────────────────

class DepartmentOut(BaseModel):
    id: int
    organization_id: int
    branch_id: int | None = None
    name: str
    code: str
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class DepartmentCreate(BaseModel):
    name: str
    code: str
    branch_id: int | None = None


# ── Location ────────────────────────────────────────────────────────────────

class LocationOut(BaseModel):
    id: int
    organization_id: int
    branch_id: int | None = None
    name: str
    address: str | None = None
    timezone: str
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
