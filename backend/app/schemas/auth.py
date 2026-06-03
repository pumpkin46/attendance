from datetime import datetime

from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


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
