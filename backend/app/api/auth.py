from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.core.errors import AuthError, PermissionDeniedError
from app.core.rate_limit import login_rate_limit
from app.core.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.models.user import Role, User
from app.schemas.auth import (
    AuthConfigResponse,
    LoginRequest,
    LoginResponse,
    UserOut,
)
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LogoutResponse(BaseModel):
    message: str


@router.post("/login", response_model=LoginResponse, dependencies=[login_rate_limit()])
async def login(body: LoginRequest, request: Request, db: DbSession):
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.email == body.email)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password):
        raise AuthError("Invalid email or password")

    if not user.is_active:
        raise PermissionDeniedError("Account is deactivated")

    if needs_rehash(user.password):
        user.password = hash_password(body.password)

    token = create_access_token({"sub": str(user.id)})

    await log_action(
        db,
        user_id=user.id,
        action="login",
        entity_type="user",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )

    return LoginResponse(
        token=token,
        user=UserOut.model_validate(user, from_attributes=True),
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(user: CurrentUser, request: Request, db: DbSession):
    await log_action(
        db,
        user_id=user.id,
        action="logout",
        entity_type="user",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )
    return LogoutResponse(message="Logged out successfully")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return UserOut.model_validate(user, from_attributes=True)


@router.get("/config", response_model=AuthConfigResponse)
async def auth_config():
    providers: list[str] = []
    if settings.oauth_enabled:
        providers = ["google", "microsoft"]
    return AuthConfigResponse(
        oauth_enabled=settings.oauth_enabled,
        oauth_providers=providers,
        saml_enabled=settings.saml_enabled,
        ldap_enabled=settings.ldap_enabled,
    )
