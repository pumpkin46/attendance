"""First-run bootstrap: the canonical roles/permissions catalog.

Single source of truth shared by the demo seeder (``seed.py``) and the public
``/setup`` wizard, so a fresh install always ends up with the same RBAC model
no matter which path created it.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.user import Permission, Role, User, role_user

PERMISSIONS: list[tuple[str, str]] = [
    ("employees.manage", "Manage Employees"),
    ("attendance.manage", "Manage Attendance"),
    ("shifts.manage", "Manage Shifts"),
    ("holidays.manage", "Manage Holidays"),
    ("leave.approve", "Approve Leave"),
    ("cameras.manage", "Manage Cameras"),
    ("rfid.manage", "Manage RFID"),
    ("recognition.view", "View Recognition Events"),
    ("recognition.manage", "Manage Recognition Engine"),
    ("reports.view", "View Reports"),
    ("reports.export", "Export Reports"),
    ("audit.view", "View Audit Logs"),
    ("organizations.manage", "Manage Organizations"),
    ("branches.manage", "Manage Branches"),
    ("departments.manage", "Manage Departments"),
    ("security.view", "View Security Configuration"),
    ("building.manage", "Manage Smart Building Integrations"),
    ("security.monitor", "AI Security Monitoring"),
    ("visitors.manage", "Manage Visitors"),
    ("visitors.view", "View Visitors"),
    ("users.manage", "Manage Users"),
    ("roles.manage", "Manage Roles & Permissions"),
]

# role name -> (label, permission names). None = every permission except
# organizations.manage (the org-admin grant).
ROLE_DEFS: dict[str, tuple[str, list[str] | None]] = {
    "super_admin": ("Super Admin", []),
    "org_admin": ("Organization Admin", None),
    "hr_manager": (
        "HR Manager",
        [
            "employees.manage", "attendance.manage", "shifts.manage", "holidays.manage",
            "leave.approve", "reports.view", "reports.export", "branches.manage",
            "departments.manage",
        ],
    ),
    "supervisor": ("Supervisor", ["attendance.manage", "reports.view", "leave.approve"]),
    "employee": ("Employee", []),
    "security_officer": (
        "Security Officer",
        [
            "cameras.manage", "rfid.manage", "recognition.view", "recognition.manage",
            "reports.view", "security.view", "building.manage", "security.monitor",
            "visitors.manage", "visitors.view",
        ],
    ),
}


async def ensure_roles_and_permissions(db: AsyncSession) -> dict[str, Role]:
    """Get-or-create the canonical permissions and roles (idempotent).

    Existing rows are never modified — custom grants made through the role
    editor survive re-runs. Returns the full role map keyed by role name.
    """
    perms = {p.name: p for p in (await db.execute(select(Permission))).scalars()}
    for name, label in PERMISSIONS:
        if name not in perms:
            perm = Permission(name=name, label=label)
            db.add(perm)
            perms[name] = perm
    await db.flush()

    all_except_org_manage = [p for n, p in perms.items() if n != "organizations.manage"]
    role_stmt = select(Role).options(selectinload(Role.permissions))
    roles = {r.name: r for r in (await db.execute(role_stmt)).scalars()}
    for name, (label, perm_names) in ROLE_DEFS.items():
        if name in roles:
            continue
        role = Role(name=name, label=label)
        role.permissions = (
            all_except_org_manage if perm_names is None else [perms[n] for n in perm_names]
        )
        db.add(role)
        roles[name] = role
    await db.flush()
    return roles


async def super_admin_exists(db: AsyncSession) -> bool:
    """True once any user holds the super-admin role — the 'is set up' marker."""
    stmt = (
        select(func.count(User.id))
        .join(role_user, role_user.c.user_id == User.id)
        .join(Role, Role.id == role_user.c.role_id)
        .where(Role.name == settings.super_admin_role)
    )
    return (await db.execute(stmt)).scalar_one() > 0
