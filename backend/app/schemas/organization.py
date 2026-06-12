from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=255)
    timezone: str = "UTC"
    settings: dict[str, Any] | None = None


class OrganizationUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""

    name: str | None = Field(None, min_length=1, max_length=255)
    code: str | None = Field(None, min_length=1, max_length=255)
    timezone: str | None = None
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class OrganizationWithCounts(OrganizationOut):
    """Organization plus computed related-entity counts."""

    branches_count: int = 0
    departments_count: int = 0
    employees_count: int = 0


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
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=255)
    address: str | None = None
    timezone: str = "UTC"
    # Super admins operating without a tenant header pick the target org here;
    # for tenant-scoped users the header/org context always wins.
    organization_id: int | None = None


class BranchUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""

    name: str | None = Field(None, min_length=1, max_length=255)
    code: str | None = Field(None, min_length=1, max_length=255)
    address: str | None = None
    timezone: str | None = None
    is_active: bool | None = None


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
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=255)
    branch_id: int | None = None
    # Super admins operating without a tenant header pick the target org here;
    # for tenant-scoped users the header/org context always wins.
    organization_id: int | None = None


class DepartmentUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""

    name: str | None = Field(None, min_length=1, max_length=255)
    code: str | None = Field(None, min_length=1, max_length=255)
    branch_id: int | None = None
    is_active: bool | None = None


class BranchBrief(BaseModel):
    id: int
    name: str


class DepartmentWithBranch(DepartmentOut):
    """Department plus an embedded branch summary when available."""

    branch: BranchBrief | None = None


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


class LocationBrief(BaseModel):
    """Minimal location summary returned by the locations list endpoint."""

    id: int
    name: str
    address: str | None = None


# ── Security config ───────────────────────────────────────────────────────────

class SecurityConfigResponse(BaseModel):
    """Static security/platform configuration descriptor.

    The nested shape is descriptive rather than strictly modelled, so the
    sub-sections allow extra keys.
    """

    model_config = ConfigDict(extra="allow")

    authentication: dict[str, Any]
    authorization: dict[str, Any]
    encryption: dict[str, Any]
    tenancy: dict[str, Any]
