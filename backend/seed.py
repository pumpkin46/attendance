"""Database seeder — creates demo admin, roles, and sample data."""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, engine
from app.core.security import hash_password


async def seed():
    from app.models.organization import Organization, Branch, Department
    from app.models.location import Location
    from app.models.user import User, Role, Permission, role_permission, role_user
    from app.models.employee import Employee
    from app.models.attendance import AttendancePolicy, Shift

    async with async_session_factory() as db:
        existing = (await db.execute(select(Organization).limit(1))).scalar_one_or_none()
        if existing:
            print("Database already seeded (organizations exist). Skipping.")
            return

        org = Organization(name="Demo Corporation", code="DEMO", timezone="UTC")
        db.add(org)
        await db.flush()

        branch = Branch(organization_id=org.id, name="Head Office Branch", code="HQ", address="100 Main Street", timezone="UTC")
        db.add(branch)
        await db.flush()

        department = Department(organization_id=org.id, branch_id=branch.id, name="Operations", code="OPS")
        db.add(department)
        await db.flush()

        location = Location(organization_id=org.id, branch_id=branch.id, name="Head Office", address="100 Main Street", timezone="UTC")
        db.add(location)
        await db.flush()

        permissions_data = [
            ("employees.manage", "Manage Employees"),
            ("attendance.manage", "Manage Attendance"),
            ("shifts.manage", "Manage Shifts"),
            ("holidays.manage", "Manage Holidays"),
            ("leave.approve", "Approve Leave"),
            ("cameras.manage", "Manage Cameras"),
            ("rfid.manage", "Manage RFID"),
            ("recognition.view", "View Recognition Events"),
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
        ]

        perm_map = {}
        for name, label in permissions_data:
            p = Permission(name=name, label=label)
            db.add(p)
            await db.flush()
            perm_map[name] = p

        all_except_org_manage = [p for name, p in perm_map.items() if name != "organizations.manage"]

        roles_data = {
            "super_admin": ("Super Admin", []),
            "org_admin": ("Organization Admin", all_except_org_manage),
            "hr_manager": ("HR Manager", [perm_map[n] for n in [
                "employees.manage", "attendance.manage", "shifts.manage", "holidays.manage",
                "leave.approve", "reports.view", "reports.export", "branches.manage", "departments.manage",
            ]]),
            "supervisor": ("Supervisor", [perm_map[n] for n in [
                "attendance.manage", "reports.view", "leave.approve",
            ]]),
            "employee": ("Employee", []),
            "security_officer": ("Security Officer", [perm_map[n] for n in [
                "cameras.manage", "rfid.manage", "recognition.view",
                "reports.view", "security.view", "building.manage", "security.monitor",
                "visitors.manage", "visitors.view",
            ]]),
        }

        role_map = {}
        for name, (label, perms) in roles_data.items():
            r = Role(name=name, label=label)
            r.permissions = perms
            db.add(r)
            await db.flush()
            role_map[name] = r

        super_admin = User(
            organization_id=None,
            name="Platform Super Admin",
            email="superadmin@attendance.local",
            password=hash_password("password"),
        )
        super_admin.roles = [role_map["super_admin"]]
        db.add(super_admin)

        admin = User(
            organization_id=org.id,
            branch_id=branch.id,
            department_id=department.id,
            name="Organization Admin",
            email="admin@attendance.local",
            password=hash_password("password"),
        )
        admin.roles = [role_map["org_admin"]]
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
                branch_id=branch.id,
                department_id=department.id,
                employee_code=f"EMP{i:04d}",
                first_name=f"Employee{i}",
                last_name="Demo",
                email=f"emp{i}@demo.local",
                department="Operations",
                hire_date=date.today() - timedelta(days=365),
            )
            db.add(emp)

        await db.commit()
        print("Database seeded successfully.")


if __name__ == "__main__":
    asyncio.run(seed())
