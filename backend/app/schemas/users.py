"""Schemas for the user & permission administration API."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.auth import PermissionOut, RoleOut, UserOut


def _normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or "." not in normalized.split("@")[-1]:
        raise ValueError("Invalid email address")
    return normalized


def _strip_required(value: str, field: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{field} cannot be empty")
    return stripped


class AdminCreateUserRequest(BaseModel):
    name: str = Field(max_length=255)
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=255)
    role_ids: list[int] = []
    is_active: bool = True
    # Org-tree nodes to grant this user access to — a company root or any
    # sub-unit. Each grant scopes the employee directory to that node's sub-tree.
    organization_ids: list[int] = []

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _strip_required(v, "Name")

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _normalize_email(v)


class AdminUpdateUserRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=255)
    is_active: bool | None = None
    role_ids: list[int] | None = None
    # Replace the user's granted org-tree nodes (None = leave unchanged).
    organization_ids: list[int] | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else _strip_required(v, "Name")

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return None if v is None else _normalize_email(v)


class PaginatedUsers(BaseModel):
    data: list[UserOut]
    current_page: int
    last_page: int
    total: int


class RoleWithUsage(RoleOut):
    user_count: int = 0


class RoleCreateRequest(BaseModel):
    name: str = Field(max_length=255)
    label: str = Field(max_length=255)
    permission_ids: list[int] = []

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        slug = v.strip().lower().replace(" ", "_")
        if not slug:
            raise ValueError("Name cannot be empty")
        if not all(c.isalnum() or c in "_." for c in slug):
            raise ValueError("Role name may only contain letters, numbers, underscores and dots")
        return slug

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        return _strip_required(v, "Label")


class RoleUpdateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=255)
    permission_ids: list[int] | None = None

    @field_validator("label")
    @classmethod
    def _label(cls, v: str | None) -> str | None:
        return None if v is None else _strip_required(v, "Label")


__all__ = [
    "AdminCreateUserRequest",
    "AdminUpdateUserRequest",
    "PaginatedUsers",
    "PermissionOut",
    "RoleCreateRequest",
    "RoleUpdateRequest",
    "RoleWithUsage",
    "UserOut",
]
