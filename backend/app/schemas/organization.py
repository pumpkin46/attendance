from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ── Organization (company root) ───────────────────────────────────────────────

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
    """Organization (company root) plus computed related-entity counts.

    ``nodes_count`` counts sub-units (departments/teams/branches) under the root,
    excluding the root itself. ``employees_count`` is the whole-tenant total.
    """

    nodes_count: int = 0
    employees_count: int = 0


# ── Org-tree nodes ────────────────────────────────────────────────────────────

class OrgNodeBrief(BaseModel):
    """Minimal node summary for embedding in other payloads."""

    id: int
    name: str
    node_type: str


class OrgNodeOut(BaseModel):
    id: int
    name: str
    code: str
    node_type: str
    parent_id: int | None = None
    # depth / path / root_organization_id are derived (the row no longer stores
    # them); they are computed while assembling a response. depth is relative to
    # the returned top node and path is the chain of ancestor ids.
    root_organization_id: int
    timezone: str
    depth: int = 0
    path: str = ""
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Populated only by the tree endpoint; flat listings leave it None.
    children: list["OrgNodeOut"] | None = None

    class Config:
        from_attributes = True


class OrgNodeDetail(OrgNodeOut):
    """A single node plus its ancestor breadcrumb (root → … → parent)."""

    breadcrumb: list[OrgNodeBrief] = []


class OrgNodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=255)
    # The node this one hangs under. Required — a node always has a parent
    # (root companies are created via the organizations endpoint).
    parent_id: int
    node_type: str = Field(default="department", min_length=1, max_length=32)
    timezone: str = "UTC"


class OrgNodeUpdate(BaseModel):
    """Partial update. Reparenting is done via the dedicated move endpoint."""

    name: str | None = Field(None, min_length=1, max_length=255)
    code: str | None = Field(None, min_length=1, max_length=255)
    node_type: str | None = Field(None, min_length=1, max_length=32)
    timezone: str | None = None
    is_active: bool | None = None


class OrgNodeMove(BaseModel):
    new_parent_id: int


# ── Location ──────────────────────────────────────────────────────────────────

class LocationOut(BaseModel):
    id: int
    organization_id: int
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


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    timezone: str = "UTC"
    # Super admins operating without a tenant header pick the target org here;
    # for tenant-scoped users the header/org context always wins.
    organization_id: int | None = None


class LocationUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""

    name: str | None = Field(None, min_length=1, max_length=255)
    address: str | None = None
    timezone: str | None = None
    is_active: bool | None = None


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
