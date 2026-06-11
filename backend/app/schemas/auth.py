from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    name: str = Field(max_length=255)
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=255)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Name cannot be empty")
        return stripped

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Invalid email address")
        return normalized


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Name cannot be empty")
        return stripped

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Invalid email address")
        return normalized


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=255)


class PermissionOut(BaseModel):
    id: int
    name: str
    label: str

    class Config:
        from_attributes = True


class RoleOut(BaseModel):
    id: int
    name: str
    label: str
    permissions: list[PermissionOut] = []

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    organization_id: int | None = None
    branch_id: int | None = None
    department_id: int | None = None
    name: str
    email: str
    email_verified_at: datetime | None = None
    is_active: bool
    auth_provider: str = "local"
    roles: list[RoleOut] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class AuthConfigResponse(BaseModel):
    oauth_enabled: bool
    oauth_providers: list[str]
    saml_enabled: bool
    ldap_enabled: bool
    registration_enabled: bool
