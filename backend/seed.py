"""Database seeder — creates demo admin, roles, and sample data."""
from __future__ import annotations

import asyncio
import os
import secrets
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import async_session_factory, engine
from app.core.security import hash_password

_DEFAULT_SEED_PASSWORD = "password"


def _seed_password(env_var: str, label: str) -> str:
    """Resolve a seed account password.

    Reads ``env_var`` if set. In non-local environments we refuse to fall back
    to the well-known default; instead we generate a strong random password and
    print it once so the operator can capture and rotate it.
    """
    value = os.environ.get(env_var)
    if value:
        return value
    if settings.app_env != "local":
        generated = secrets.token_urlsafe(18)
        print(
            f"[seed] {env_var} not set — generated a random password for {label}:\n"
            f"       {generated}\n"
            f"       Save it now and change it after first login."
        )
        return generated
    print(
        f"[seed] WARNING: using insecure default password for {label} "
        f"(set {env_var} to override). Do NOT use this outside local dev."
    )
    return _DEFAULT_SEED_PASSWORD


async def _add_node(db, *, parent, name, code, node_type, timezone="UTC"):
    """Create a child org-tree node under ``parent``."""
    from app.models.organization import Organization

    node = Organization(
        name=name,
        code=code,
        node_type=node_type,
        parent_id=parent.id,
        timezone=timezone,
    )
    db.add(node)
    await db.flush()
    return node


async def seed():
    from app.models.organization import Organization
    from app.models.location import Location
    from app.models.user import User
    from app.models.employee import Employee
    from app.models.attendance import AttendancePolicy, Shift
    from app.services.bootstrap import ensure_roles_and_permissions

    async with async_session_factory() as db:
        existing = (await db.execute(select(Organization).limit(1))).scalar_one_or_none()
        if existing:
            print("Database already seeded (organizations exist). Skipping.")
            return

        # Company root: parent_id NULL marks it as the tenant.
        org = Organization(
            name="Demo Corporation", code="DEMO", timezone="UTC",
            node_type="company", parent_id=None,
        )
        db.add(org)
        await db.flush()

        # A small tree: Demo Corporation > Technology > Backend Team.
        technology = await _add_node(db, parent=org, name="Technology", code="TECH", node_type="department")
        backend_team = await _add_node(db, parent=technology, name="Backend Team", code="BACKEND", node_type="team")

        location = Location(
            organization_id=org.id,
            name="Head Office", address="100 Main Street", timezone="UTC",
        )
        db.add(location)
        await db.flush()

        # Canonical roles/permissions live in app.services.bootstrap (shared
        # with the public /setup wizard).
        role_map = await ensure_roles_and_permissions(db)

        # Users no longer carry an organization_id column (dropped in
        # m9a0b1c2d3e4). A super admin is global (no org membership); other
        # accounts draw their tenant scope from the user_organization M2M, so
        # the org-admin is linked to the company root instead. Mirrors the
        # /setup wizard's User() construction in app.api.setup.run_setup.
        super_admin = User(
            name="Platform Super Admin",
            email="superadmin@attendance.local",
            password=hash_password(_seed_password("SEED_SUPERADMIN_PASSWORD", "superadmin@attendance.local")),
        )
        super_admin.roles = [role_map["super_admin"]]
        db.add(super_admin)

        admin = User(
            name="Organization Admin",
            email="admin@attendance.local",
            password=hash_password(_seed_password("SEED_ADMIN_PASSWORD", "admin@attendance.local")),
        )
        admin.roles = [role_map["org_admin"]]
        admin.organizations = [org]
        db.add(admin)
        await db.flush()

        policy = AttendancePolicy(
            organization_id=org.id,
            name="Default Policy",
            is_default=True,
            grace_minutes=15,
            min_work_minutes=240,
            max_work_minutes=600,
            break_minutes=60,
            overtime_after_minutes=480,
        )
        db.add(policy)
        await db.flush()

        from datetime import date, time, timedelta

        def t(hhmm: str) -> time:
            hour, minute = map(int, hhmm.split(":"))
            return time(hour, minute)

        shifts = [
            Shift(organization_id=org.id, attendance_policy_id=policy.id, name="Fixed — Office Day",
                  type="fixed", start_time=t("09:00"), end_time=t("18:00"), grace_minutes=15, days_of_week=[1, 2, 3, 4, 5]),
            Shift(organization_id=org.id, attendance_policy_id=policy.id, name="Rotational — Morning",
                  type="rotational", rotation_slot="morning", start_time=t("06:00"), end_time=t("14:00"), grace_minutes=10),
            Shift(organization_id=org.id, attendance_policy_id=policy.id, name="Flexible",
                  type="flexible", start_time=t("08:00"), end_time=t("17:00"), grace_minutes=30),
            Shift(organization_id=org.id, attendance_policy_id=policy.id, name="Split Shift",
                  type="split", start_time=t("08:00"), end_time=t("18:00"), grace_minutes=15,
                  segments=[{"start": "08:00", "end": "12:00"}, {"start": "14:00", "end": "18:00"}]),
        ]
        for s in shifts:
            db.add(s)

        for i in range(1, 6):
            emp = Employee(
                organization_id=org.id,
                location_id=location.id,
                employee_code=f"EMP{i:04d}",
                first_name=f"Employee{i}",
                last_name="Demo",
                email=f"emp{i}@demo.local",
                department="Backend Team",
                hire_date=date.today() - timedelta(days=365),
            )
            db.add(emp)

        await db.commit()
        print("Database seeded successfully.")


if __name__ == "__main__":
    asyncio.run(seed())
