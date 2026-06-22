from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token, hash_device_token
from app.middleware.tenant import descendant_ids, root_ids_of
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


async def _header_org_root(request: Request, db: AsyncSession) -> int | None:
    """Company ROOT named by the X-Organization-Id header, or None.

    The header may name any node (a company root or a sub-unit) and can be stale
    (the org was deleted, or it is from another deployment); the tenant boundary
    is always that node's company root, derived from the node itself — never the
    raw header value. Returns None for an absent / unparseable / unknown value.
    """
    header_val = request.headers.get(settings.tenant_header)
    if not header_val:
        return None
    try:
        oid = int(header_val)
    except ValueError:
        return None
    from app.middleware.tenant import root_id_of

    return await root_id_of(db, oid)


async def get_tenant_org_id(
    request: Request,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> int | None:
    """The single ACTIVE organization (company root) for writes / single-org ops.

    Super admin: the header org (resolved to its company root), else the lone
    active org, else None (validated global scope). Non-super-admin: their grants
    are first rolled UP to company roots (a grant may be a sub-unit), then the
    header company if it is one of those roots, else their sole company; an
    ambiguous tenant (0 or 2+ companies, no header) is refused so a write can
    never land in an unintended org.
    """
    if user.has_role(settings.super_admin_role):
        header_root = await _header_org_root(request, db)
        if header_root is not None:
            return header_root
        return await get_single_org_id(db)

    assigned_nodes = [o.id for o in user.organizations]
    if not assigned_nodes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No organizations assigned to this account",
        )
    assigned_roots = await root_ids_of(db, assigned_nodes)
    header_root = await _header_org_root(request, db)
    if header_root is not None and header_root in assigned_roots:
        return header_root
    if len(assigned_roots) == 1:
        return assigned_roots[0]
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Select an organization (X-Organization-Id) to act in",
    )


async def _resolve_read_scopes(
    request: Request,
    user: User,
    db: AsyncSession,
) -> tuple[list[int] | None, list[int] | None]:
    """Resolve a request's READ access as ``(root_scope, node_scope)``.

    ``root_scope`` gates every table keyed by the company root (cameras, RFID,
    locations, visitors, recognition events, …); ``node_scope`` gates the
    ``Employee`` directory, whose boundary is sub-tree membership, so a grant of
    a single sub-unit stays sub-unit-granular there while still exposing the
    parent company's root-keyed data. ``None`` on both = a validated global super
    admin (no filter). A tenant user is never global and is refused with nothing
    assigned, so neither scope is ever None for them.

    Super admin: the header company if given, else the lone active org, else
    global. Non-super-admin: their granted nodes (and the roots they roll up to);
    a header narrows to one company AND to the grants under it.
    """
    if user.has_role(settings.super_admin_role):
        header_root = await _header_org_root(request, db)
        if header_root is not None:
            return [header_root], [header_root]
        sid = await get_single_org_id(db)
        return ([sid], [sid]) if sid is not None else (None, None)

    assigned_nodes = [o.id for o in user.organizations]
    if not assigned_nodes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No organizations assigned to this account",
        )
    assigned_roots = await root_ids_of(db, assigned_nodes)
    header_root = await _header_org_root(request, db)
    if header_root is not None and header_root in assigned_roots:
        # Header picks one company: narrow the roots to it and the granted nodes
        # to those inside its sub-tree, so the employee view matches the company.
        under = await descendant_ids(db, header_root)
        nodes = [n for n in assigned_nodes if n in under]
        return [header_root], nodes
    return assigned_roots, assigned_nodes


async def get_tenant_scope(
    request: Request,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[int] | None:
    """The set of COMPANY ROOTS the request may READ across (root-keyed tables).

    A user's grants (which may be sub-units) are rolled up to their company
    roots, so a sub-unit grant exposes the parent company's root-keyed data.
    None = no tenant filter, reserved for super admins; a tenant user never
    returns None. For the ``Employee`` directory use ``get_tenant_node_scope``.
    """
    roots, _nodes = await _resolve_read_scopes(request, user, db)
    return roots


async def get_tenant_node_scope(
    request: Request,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[int] | None:
    """The granted ORG-TREE NODES for ``Employee``-keyed sub-tree scoping.

    The directory counterpart of ``get_tenant_scope``: keeps the user's grants at
    node granularity (a sub-unit grant stays a sub-unit) so the employee filter
    bounds them to exactly that unit and its descendants. None = global (super
    admin); a tenant user never returns None.
    """
    _roots, nodes = await _resolve_read_scopes(request, user, db)
    return nodes


TenantOrgId = Annotated[int | None, Depends(get_tenant_org_id)]
TenantScope = Annotated[list[int] | None, Depends(get_tenant_scope)]
TenantNodeScope = Annotated[list[int] | None, Depends(get_tenant_node_scope)]


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
