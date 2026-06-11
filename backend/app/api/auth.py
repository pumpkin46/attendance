from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.core.errors import AuthError, ConflictError, PermissionDeniedError, ValidationError
from app.core.rate_limit import login_rate_limit, register_rate_limit
from app.core.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.models.user import Role, User
from app.schemas.auth import (
    AuthConfigResponse,
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    UpdateProfileRequest,
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


@router.post(
    "/register",
    response_model=LoginResponse,
    status_code=201,
    dependencies=[register_rate_limit()],
)
async def register(body: RegisterRequest, request: Request, db: DbSession):
    if not settings.registration_enabled:
        raise PermissionDeniedError(
            "Self-registration is disabled. Ask an administrator to create your account."
        )

    existing = await db.execute(select(User.id).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("An account with that email already exists")

    role_stmt = (
        select(Role)
        .options(selectinload(Role.permissions))
        .where(Role.name == settings.registration_default_role)
    )
    default_role = (await db.execute(role_stmt)).scalar_one_or_none()

    user = User(
        name=body.name,
        email=body.email,
        password=hash_password(body.password),
        auth_provider="local",
        is_active=True,
    )
    # New accounts start with the default role (no elevated permissions);
    # admins grant access later through user management.
    user.roles = [default_role] if default_role else []
    db.add(user)
    await db.flush()
    await db.refresh(user)

    token = create_access_token({"sub": str(user.id)})

    await log_action(
        db,
        user_id=user.id,
        action="register",
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


@router.patch("/me", response_model=UserOut)
async def update_me(body: UpdateProfileRequest, user: CurrentUser, request: Request, db: DbSession):
    changes: dict[str, object] = {}

    if body.name is not None and body.name != user.name:
        changes["name"] = {"from": user.name, "to": body.name}
        user.name = body.name

    if body.email is not None and body.email != user.email:
        existing = await db.execute(
            select(User.id).where(User.email == body.email, User.id != user.id)
        )
        if existing.scalar_one_or_none() is not None:
            raise ConflictError("That email is already in use")
        changes["email"] = {"from": user.email, "to": body.email}
        user.email = body.email
        # Email is the login identity; a change invalidates prior verification.
        user.email_verified_at = None

    if changes:
        await log_action(
            db,
            user_id=user.id,
            action="profile_update",
            entity_type="user",
            entity_id=user.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("User-Agent"),
            new_values=changes,
        )
        # log_action's flush ran the UPDATE, expiring server-generated columns
        # (updated_at via onupdate); refresh here so Pydantic's attribute reads
        # don't trigger lazy IO outside the greenlet context.
        await db.refresh(user)

    return UserOut.model_validate(user, from_attributes=True)


@router.post("/me/password", response_model=LogoutResponse)
async def change_password(
    body: ChangePasswordRequest, user: CurrentUser, request: Request, db: DbSession
):
    if not verify_password(body.current_password, user.password):
        raise ValidationError("Your current password is incorrect")

    if verify_password(body.new_password, user.password):
        raise ValidationError("New password must be different from the current one")

    user.password = hash_password(body.new_password)

    await log_action(
        db,
        user_id=user.id,
        action="password_change",
        entity_type="user",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )

    return LogoutResponse(message="Password updated successfully")


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
        registration_enabled=settings.registration_enabled,
    )
