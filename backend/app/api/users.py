"""User & permission administration.

Account management (list/create/update users, assign roles) is guarded by
``users.manage``; role and permission management by ``roles.manage``. Read
endpoints shared by both areas accept either permission. The ``super_admin``
role is immutable here — it bypasses permission checks by design, so editing
its grants would only mislead.
"""
from __future__ import annotations

import math

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import (
    DbSession,
    TenantOrgId,
    require_any_permission,
    require_permission,
    require_super_admin,
)
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from app.core.security import hash_password
from app.models.user import Permission, Role, User, role_user
from app.schemas.users import (
    AdminCreateUserRequest,
    AdminUpdateUserRequest,
    PaginatedUsers,
    PermissionOut,
    RoleCreateRequest,
    RoleUpdateRequest,
    RoleWithUsage,
    UserOut,
)
from app.services.audit_service import log_action

router = APIRouter(prefix="/api/v1", tags=["users"])


def _client_meta(request: Request) -> dict[str, str | None]:
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("User-Agent"),
    }


async def _load_roles(db, role_ids: list[int]) -> list[Role]:
    if not role_ids:
        return []
    result = await db.execute(
        select(Role).options(selectinload(Role.permissions)).where(Role.id.in_(set(role_ids)))
    )
    roles = list(result.scalars())
    missing = set(role_ids) - {r.id for r in roles}
    if missing:
        raise ValidationError(f"Unknown role id(s): {sorted(missing)}")
    return roles


def _guard_super_admin_assignment(actor: User, roles: list[Role]) -> None:
    if any(r.name == settings.super_admin_role for r in roles) and not actor.has_role(
        settings.super_admin_role
    ):
        raise PermissionDeniedError("Only a super admin can grant the super admin role")


# ── Users ────────────────────────────────────────────────────────────────────


@router.get("/users", response_model=PaginatedUsers)
async def list_users(
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("users.manage"),
    search: str | None = Query(None, max_length=255),
    role_id: int | None = Query(None),
    is_active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
):
    stmt = select(User).options(selectinload(User.roles).selectinload(Role.permissions))

    is_super = user.has_role(settings.super_admin_role)
    if is_super:
        if org_id is not None:
            stmt = stmt.where(User.organization_id == org_id)
    else:
        # Tenant scoping: org admins manage only accounts inside their org.
        stmt = stmt.where(User.organization_id == user.organization_id)

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like)))
    if role_id is not None:
        stmt = stmt.where(User.roles.any(Role.id == role_id))
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)

    total = (
        await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))
    ).scalar_one()
    rows = await db.execute(
        stmt.order_by(User.name.asc()).offset((page - 1) * per_page).limit(per_page)
    )
    users = rows.scalars().unique().all()

    return PaginatedUsers(
        data=[UserOut.model_validate(u, from_attributes=True) for u in users],
        current_page=page,
        last_page=max(1, math.ceil(total / per_page)),
        total=total,
    )


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminCreateUserRequest,
    request: Request,
    db: DbSession,
    user: require_permission("users.manage"),
):
    existing = await db.execute(select(User.id).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("An account with that email already exists")

    roles = await _load_roles(db, body.role_ids)
    _guard_super_admin_assignment(user, roles)

    is_super = user.has_role(settings.super_admin_role)
    organization_id = body.organization_id if is_super else user.organization_id

    target = User(
        organization_id=organization_id,
        name=body.name,
        email=body.email,
        password=hash_password(body.password),
        auth_provider="local",
        is_active=body.is_active,
    )
    target.roles = roles
    db.add(target)
    await db.flush()
    await db.refresh(target)

    await log_action(
        db,
        user_id=user.id,
        action="user_create",
        entity_type="user",
        entity_id=target.id,
        new_values={"email": target.email, "roles": [r.name for r in roles]},
        **_client_meta(request),
    )
    return UserOut.model_validate(target, from_attributes=True)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: AdminUpdateUserRequest,
    request: Request,
    db: DbSession,
    user: require_permission("users.manage"),
):
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user_id)
    )
    target = (await db.execute(stmt)).scalar_one_or_none()
    if target is None:
        raise NotFoundError("User not found")

    is_super = user.has_role(settings.super_admin_role)
    if not is_super:
        if target.organization_id != user.organization_id:
            raise NotFoundError("User not found")
        if target.has_role(settings.super_admin_role):
            raise PermissionDeniedError("Only a super admin can modify a super admin account")

    changes: dict[str, object] = {}

    if body.name is not None and body.name != target.name:
        changes["name"] = {"from": target.name, "to": body.name}
        target.name = body.name

    if body.email is not None and body.email != target.email:
        dup = await db.execute(
            select(User.id).where(User.email == body.email, User.id != target.id)
        )
        if dup.scalar_one_or_none() is not None:
            raise ConflictError("That email is already in use")
        changes["email"] = {"from": target.email, "to": body.email}
        target.email = body.email
        target.email_verified_at = None

    if body.password is not None:
        target.password = hash_password(body.password)
        changes["password"] = "reset"

    if body.is_active is not None and body.is_active != target.is_active:
        if target.id == user.id:
            raise ValidationError("You cannot deactivate your own account")
        changes["is_active"] = {"from": target.is_active, "to": body.is_active}
        target.is_active = body.is_active

    if body.role_ids is not None:
        roles = await _load_roles(db, body.role_ids)
        _guard_super_admin_assignment(user, roles)
        had_super = target.has_role(settings.super_admin_role)
        keeps_super = any(r.name == settings.super_admin_role for r in roles)
        if had_super and not keeps_super and not is_super:
            raise PermissionDeniedError("Only a super admin can revoke the super admin role")
        if target.id == user.id and had_super and not keeps_super:
            raise ValidationError("You cannot remove your own super admin role")
        old_names = sorted(r.name for r in target.roles)
        new_names = sorted(r.name for r in roles)
        if old_names != new_names:
            changes["roles"] = {"from": old_names, "to": new_names}
        target.roles = roles

    if changes:
        await log_action(
            db,
            user_id=user.id,
            action="user_update",
            entity_type="user",
            entity_id=target.id,
            new_values=changes,
            **_client_meta(request),
        )
        # log_action's flush ran the UPDATE, expiring server-generated columns
        # (updated_at via onupdate); refresh here so Pydantic's attribute reads
        # don't trigger lazy IO outside the greenlet context.
        await db.refresh(target)

    return UserOut.model_validate(target, from_attributes=True)


# ── Roles & permissions ──────────────────────────────────────────────────────


@router.get("/roles", response_model=list[RoleWithUsage])
async def list_roles(
    db: DbSession,
    user: require_any_permission("users.manage", "roles.manage"),
):
    counts = dict(
        (
            await db.execute(
                select(role_user.c.role_id, func.count(role_user.c.user_id)).group_by(
                    role_user.c.role_id
                )
            )
        ).all()
    )
    result = await db.execute(
        select(Role).options(selectinload(Role.permissions)).order_by(Role.id.asc())
    )
    roles = result.scalars().all()
    out = []
    for role in roles:
        item = RoleWithUsage.model_validate(role, from_attributes=True)
        item.user_count = counts.get(role.id, 0)
        out.append(item)
    return out


@router.get("/permissions", response_model=list[PermissionOut])
async def list_permissions(
    db: DbSession,
    user: require_any_permission("users.manage", "roles.manage"),
):
    result = await db.execute(select(Permission).order_by(Permission.name.asc()))
    return [PermissionOut.model_validate(p, from_attributes=True) for p in result.scalars()]


async def _load_permissions(db, permission_ids: list[int]) -> list[Permission]:
    if not permission_ids:
        return []
    result = await db.execute(select(Permission).where(Permission.id.in_(set(permission_ids))))
    perms = list(result.scalars())
    missing = set(permission_ids) - {p.id for p in perms}
    if missing:
        raise ValidationError(f"Unknown permission id(s): {sorted(missing)}")
    return perms


@router.post("/roles", response_model=RoleWithUsage, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreateRequest,
    request: Request,
    db: DbSession,
    # Roles are global (no organization_id); restrict mutation to super admins
    # so a tenant admin cannot mint cross-tenant high-privilege roles.
    user: require_super_admin(),
):
    existing = await db.execute(select(Role.id).where(Role.name == body.name))
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("A role with that name already exists")

    role = Role(name=body.name, label=body.label)
    role.permissions = await _load_permissions(db, body.permission_ids)
    db.add(role)
    await db.flush()
    await db.refresh(role)

    await log_action(
        db,
        user_id=user.id,
        action="role_create",
        entity_type="role",
        entity_id=role.id,
        new_values={"name": role.name, "permissions": [p.name for p in role.permissions]},
        **_client_meta(request),
    )
    return RoleWithUsage.model_validate(role, from_attributes=True)


@router.patch("/roles/{role_id}", response_model=RoleWithUsage)
async def update_role(
    role_id: int,
    body: RoleUpdateRequest,
    request: Request,
    db: DbSession,
    user: require_super_admin(),
):
    result = await db.execute(
        select(Role).options(selectinload(Role.permissions)).where(Role.id == role_id)
    )
    role = result.scalar_one_or_none()
    if role is None:
        raise NotFoundError("Role not found")
    if role.name == settings.super_admin_role:
        raise ValidationError("The super admin role bypasses permissions and cannot be edited")

    changes: dict[str, object] = {}
    if body.label is not None and body.label != role.label:
        changes["label"] = {"from": role.label, "to": body.label}
        role.label = body.label
    if body.permission_ids is not None:
        perms = await _load_permissions(db, body.permission_ids)
        old_names = sorted(p.name for p in role.permissions)
        new_names = sorted(p.name for p in perms)
        if old_names != new_names:
            changes["permissions"] = {"from": old_names, "to": new_names}
        role.permissions = perms

    if changes:
        await log_action(
            db,
            user_id=user.id,
            action="role_update",
            entity_type="role",
            entity_id=role.id,
            new_values=changes,
            **_client_meta(request),
        )

    count = (
        await db.execute(
            select(func.count(role_user.c.user_id)).where(role_user.c.role_id == role.id)
        )
    ).scalar_one()
    out = RoleWithUsage.model_validate(role, from_attributes=True)
    out.user_count = count
    return out


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    request: Request,
    db: DbSession,
    user: require_super_admin(),
):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if role is None:
        raise NotFoundError("Role not found")
    if role.name == settings.super_admin_role:
        raise ValidationError("The super admin role cannot be deleted")

    in_use = (
        await db.execute(
            select(func.count(role_user.c.user_id)).where(role_user.c.role_id == role.id)
        )
    ).scalar_one()
    if in_use:
        raise ConflictError(
            f"Role is assigned to {in_use} user(s). Reassign them before deleting it."
        )

    await log_action(
        db,
        user_id=user.id,
        action="role_delete",
        entity_type="role",
        entity_id=role.id,
        new_values={"name": role.name},
        **_client_meta(request),
    )
    await db.delete(role)
