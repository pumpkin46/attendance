from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token, hash_device_token
from app.models.user import User, Role


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = auth[7:]
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user_id_int, User.is_active == True)  # noqa: E712
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Token revocation: a password change bumps password_changed_at, so any
    # token minted before that (pwd_at claim older, or absent on legacy tokens)
    # is no longer valid.
    if user.password_changed_at is not None:
        token_pwd_at = payload.get("pwd_at", 0)
        if token_pwd_at < int(user.password_changed_at.timestamp()):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token invalidated by password change",
            )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]


def require_permission(permission_name: str):
    async def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.has_role(settings.super_admin_role):
            return user
        if not user.has_permission(permission_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission_name}",
            )
        return user

    return Annotated[User, Depends(checker)]


def require_super_admin():
    """Allow only super admins. Use for global, cross-tenant resources.

    Roles/permissions have no organization_id, so any org admin holding
    roles.manage could otherwise edit roles shared by every tenant or mint a
    high-privilege role. Gating role mutation on super-admin keeps a tenant
    admin from escalating across the whole platform.
    """

    async def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if not user.has_role(settings.super_admin_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This action requires the super admin role",
            )
        return user

    return Annotated[User, Depends(checker)]


def require_any_permission(*permission_names: str):
    """Like require_permission, but passes when the user holds ANY of the names.

    Used for read endpoints shared by multiple admin areas (e.g. the role list
    is needed by both the user manager and the role editor).
    """

    async def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.has_role(settings.super_admin_role):
            return user
        if not any(user.has_permission(name) for name in permission_names):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {' or '.join(permission_names)}",
            )
        return user

    return Annotated[User, Depends(checker)]


async def get_single_org_id(db: AsyncSession) -> int | None:
    """Id of the only active organization, or None when there are 0 or 2+.

    Single-organization deployments keep the organizations table purely as a
    label; super admins should act on that org without selecting a tenant.
    With multiple orgs the explicit header stays required, so requests can
    never silently mix tenants.
    """
    from app.models.organization import Organization

    # Count only company ROOTS (parent_id IS NULL). Post org-tree-merge the
    # table also holds department/team nodes; without this guard a single-tenant
    # deployment with several nodes would see 2+ rows, return None, and turn
    # apply_tenant_filter into a no-op — a cross-everything leak.
    stmt = (
        select(Organization.id)
        .where(
            Organization.is_active == True,  # noqa: E712
            Organization.parent_id.is_(None),
        )
        .order_by(Organization.id)
        .limit(2)
    )
    ids = list((await db.execute(stmt)).scalars().all())
    return ids[0] if len(ids) == 1 else None


async def get_tenant_org_id(
    request: Request,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> int | None:
    if user.has_role(settings.super_admin_role):
        header_val = request.headers.get(settings.tenant_header)
        if header_val:
            # The selection is persisted client-side and can outlive the org (it
            # was deleted, or the value is a node id / id from another
            # deployment). The header may name ANY node (a company root or a
            # sub-unit); the tenant boundary is always that node's company ROOT,
            # derived from the node itself — never the raw header value — so a
            # selected department still feeds apply_tenant_filter the company root.
            org_id: int | None
            try:
                org_id = int(header_val)
            except ValueError:
                org_id = None
            if org_id is not None:
                from app.middleware.tenant import root_id_of

                root_id = await root_id_of(db, org_id)
                if root_id is not None:
                    return root_id
            # A stale or unparseable selection must not brick every request:
            # fall back to the single-org / global scope a super admin gets with
            # no header at all. The client can re-select a valid tenant.
        return await get_single_org_id(db)
    if user.organization_id is None:
        # None means validated global scope (super admin only). A tenant user
        # without an org (self-registered, or their org was deleted) must not
        # inherit it: apply_tenant_filter is a no-op on None, so returning it
        # would expose every tenant's data.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not assigned to an organization",
        )
    return user.organization_id


TenantOrgId = Annotated[int | None, Depends(get_tenant_org_id)]


async def get_rfid_reader(
    request: Request,
    db: DbSession,
):
    from app.models.rfid import RfidReader

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing device token")
    token_hash = hash_device_token(auth[7:])
    stmt = select(RfidReader).where(RfidReader.api_token == token_hash, RfidReader.is_active == True)  # noqa: E712
    result = await db.execute(stmt)
    reader = result.scalar_one_or_none()
    if reader is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid RFID reader token")
    return reader
