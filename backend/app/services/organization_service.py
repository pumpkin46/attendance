"""Organization / branch / department / location business logic."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.location import Location
from app.models.organization import Branch, Department, Organization
from app.schemas.organization import (
    BranchBrief,
    BranchCreate,
    BranchUpdate,
    DepartmentCreate,
    DepartmentOut,
    DepartmentUpdate,
    DepartmentWithBranch,
    LocationCreate,
    LocationOut,
    LocationUpdate,
    LocationWithBranch,
    OrganizationCreate,
    OrganizationOut,
    OrganizationUpdate,
    OrganizationWithCounts,
)


async def _count_by_org(db: AsyncSession, model, org_ids: list[int]) -> dict[int, int]:
    if not org_ids:
        return {}
    stmt = (
        select(model.organization_id, func.count())
        .where(model.organization_id.in_(org_ids))
        .group_by(model.organization_id)
    )
    return {org_id: count for org_id, count in (await db.execute(stmt)).all()}


async def _employee_count(db: AsyncSession, column, value: int) -> int:
    stmt = select(func.count()).select_from(Employee).where(column == value)
    return (await db.execute(stmt)).scalar_one()


async def _ensure_unique_org_code(db: AsyncSession, code: str, *, exclude_id: int | None = None) -> None:
    stmt = select(Organization.id).where(Organization.code == code)
    if exclude_id is not None:
        stmt = stmt.where(Organization.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        raise ConflictError(f"Organization code '{code}' is already in use")


async def _ensure_unique_code_in_org(
    db: AsyncSession, model, organization_id: int, code: str, *, exclude_id: int | None = None
) -> None:
    stmt = select(model.id).where(model.organization_id == organization_id, model.code == code)
    if exclude_id is not None:
        stmt = stmt.where(model.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        label = "Branch" if model is Branch else "Department"
        raise ConflictError(f"{label} code '{code}' is already in use in this organization")


async def _resolve_target_org_id(
    db: AsyncSession, tenant_org_id: int | None, body_org_id: int | None
) -> int:
    """Pick the org a new branch/department belongs to.

    The tenant context (header or the user's own org) always wins; only a super
    admin without a tenant header may choose the org through the request body.
    """
    org_id = tenant_org_id if tenant_org_id is not None else body_org_id
    if org_id is None:
        raise ValidationError("Organization context required")
    exists = (
        await db.execute(select(Organization.id).where(Organization.id == org_id))
    ).first()
    if exists is None:
        raise NotFoundError("Organization not found")
    return org_id


async def _validate_branch_in_org(db: AsyncSession, branch_id: int, organization_id: int) -> None:
    stmt = select(Branch.id).where(Branch.id == branch_id, Branch.organization_id == organization_id)
    if (await db.execute(stmt)).first() is None:
        raise ValidationError("Branch does not belong to this organization")


def _format_department(dept: Department) -> DepartmentWithBranch:
    base = DepartmentOut.model_validate(dept, from_attributes=True)
    branch = (
        BranchBrief(id=dept.branch.id, name=dept.branch.name)
        if dept.branch is not None
        else None
    )
    return DepartmentWithBranch(**base.model_dump(), branch=branch)


# ── Organizations ─────────────────────────────────────────────────────────────


async def list_organizations(
    db: AsyncSession,
    *,
    is_super_admin: bool,
    user_org_id: int | None,
    tenant_org_id: int | None,
) -> list[OrganizationWithCounts]:
    stmt = select(Organization).order_by(Organization.name)
    if not is_super_admin:
        stmt = stmt.where(Organization.id == user_org_id)
    else:
        stmt = apply_tenant_filter(stmt, tenant_org_id, Organization.id)
    orgs = list((await db.execute(stmt)).scalars().all())
    org_ids = [o.id for o in orgs]

    branch_counts = await _count_by_org(db, Branch, org_ids)
    dept_counts = await _count_by_org(db, Department, org_ids)
    emp_counts = await _count_by_org(db, Employee, org_ids)

    return [
        OrganizationWithCounts(
            **OrganizationOut.model_validate(org, from_attributes=True).model_dump(),
            branches_count=branch_counts.get(org.id, 0),
            departments_count=dept_counts.get(org.id, 0),
            employees_count=emp_counts.get(org.id, 0),
        )
        for org in orgs
    ]


async def create_organization(
    db: AsyncSession, body: OrganizationCreate, *, is_super_admin: bool
) -> Organization:
    if not is_super_admin:
        raise PermissionDeniedError("Only super admins can create organizations")
    await _ensure_unique_org_code(db, body.code)
    org = Organization(
        name=body.name, code=body.code, timezone=body.timezone, settings=body.settings
    )
    db.add(org)
    await db.flush()
    await db.refresh(org)
    return org


async def get_organization(
    db: AsyncSession, target_org_id: int, *, is_super_admin: bool, user_org_id: int | None
) -> Organization:
    if not is_super_admin and user_org_id != target_org_id:
        raise PermissionDeniedError("Access denied")
    org = (
        await db.execute(select(Organization).where(Organization.id == target_org_id))
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization not found")
    return org


async def update_organization(
    db: AsyncSession,
    target_org_id: int,
    body: OrganizationUpdate,
    *,
    is_super_admin: bool,
    user_org_id: int | None,
) -> Organization:
    org = await get_organization(
        db, target_org_id, is_super_admin=is_super_admin, user_org_id=user_org_id
    )
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] != org.code:
        await _ensure_unique_org_code(db, changes["code"], exclude_id=org.id)
    for field, value in changes.items():
        setattr(org, field, value)
    await db.flush()
    await db.refresh(org)
    return org


async def delete_organization(
    db: AsyncSession, target_org_id: int, *, is_super_admin: bool
) -> None:
    if not is_super_admin:
        raise PermissionDeniedError("Only super admins can delete organizations")
    org = (
        await db.execute(select(Organization).where(Organization.id == target_org_id))
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization not found")
    employees = await _employee_count(db, Employee.organization_id, org.id)
    if employees:
        raise ConflictError(
            f"Organization still has {employees} employee(s); reassign or remove them first"
        )
    # Branches and departments cascade at the database level.
    await db.delete(org)
    await db.flush()


# ── Branches ──────────────────────────────────────────────────────────────────


async def list_branches(
    db: AsyncSession, org_id: int | None, organization_id: int | None
) -> list[Branch]:
    stmt = select(Branch).order_by(Branch.name)
    if organization_id is not None:
        stmt = stmt.where(Branch.organization_id == organization_id)
    stmt = apply_tenant_filter(stmt, org_id, Branch.organization_id)
    return list((await db.execute(stmt)).scalars().all())


async def create_branch(db: AsyncSession, org_id: int | None, body: BranchCreate) -> Branch:
    target_org_id = await _resolve_target_org_id(db, org_id, body.organization_id)
    await _ensure_unique_code_in_org(db, Branch, target_org_id, body.code)
    branch = Branch(
        organization_id=target_org_id,
        name=body.name,
        code=body.code,
        address=body.address,
        timezone=body.timezone,
    )
    db.add(branch)
    await db.flush()
    await db.refresh(branch)
    return branch


async def _get_branch(db: AsyncSession, org_id: int | None, branch_id: int) -> Branch:
    stmt = select(Branch).where(Branch.id == branch_id)
    stmt = apply_tenant_filter(stmt, org_id, Branch.organization_id)
    branch = (await db.execute(stmt)).scalar_one_or_none()
    if branch is None:
        raise NotFoundError("Branch not found")
    return branch


async def update_branch(
    db: AsyncSession, org_id: int | None, branch_id: int, body: BranchUpdate
) -> Branch:
    branch = await _get_branch(db, org_id, branch_id)
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] != branch.code:
        await _ensure_unique_code_in_org(
            db, Branch, branch.organization_id, changes["code"], exclude_id=branch.id
        )
    for field, value in changes.items():
        setattr(branch, field, value)
    await db.flush()
    await db.refresh(branch)
    return branch


async def delete_branch(db: AsyncSession, org_id: int | None, branch_id: int) -> None:
    branch = await _get_branch(db, org_id, branch_id)
    employees = await _employee_count(db, Employee.branch_id, branch.id)
    if employees:
        raise ConflictError(
            f"Branch still has {employees} employee(s); reassign or remove them first"
        )
    # Departments that pointed here are detached (branch_id SET NULL) by the database.
    await db.delete(branch)
    await db.flush()


# ── Departments ───────────────────────────────────────────────────────────────


async def list_departments(
    db: AsyncSession,
    org_id: int | None,
    organization_id: int | None,
    branch_id: int | None,
) -> list[DepartmentWithBranch]:
    stmt = select(Department).order_by(Department.name)
    if organization_id is not None:
        stmt = stmt.where(Department.organization_id == organization_id)
    if branch_id is not None:
        stmt = stmt.where(Department.branch_id == branch_id)
    stmt = apply_tenant_filter(stmt, org_id, Department.organization_id)
    return [_format_department(d) for d in (await db.execute(stmt)).scalars().all()]


async def create_department(
    db: AsyncSession, org_id: int | None, body: DepartmentCreate
) -> Department:
    target_org_id = await _resolve_target_org_id(db, org_id, body.organization_id)
    await _ensure_unique_code_in_org(db, Department, target_org_id, body.code)
    if body.branch_id is not None:
        await _validate_branch_in_org(db, body.branch_id, target_org_id)
    dept = Department(
        organization_id=target_org_id, branch_id=body.branch_id, name=body.name, code=body.code
    )
    db.add(dept)
    await db.flush()
    await db.refresh(dept)
    return dept


async def _get_department(db: AsyncSession, org_id: int | None, department_id: int) -> Department:
    stmt = select(Department).where(Department.id == department_id)
    stmt = apply_tenant_filter(stmt, org_id, Department.organization_id)
    dept = (await db.execute(stmt)).scalar_one_or_none()
    if dept is None:
        raise NotFoundError("Department not found")
    return dept


async def update_department(
    db: AsyncSession, org_id: int | None, department_id: int, body: DepartmentUpdate
) -> Department:
    dept = await _get_department(db, org_id, department_id)
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] != dept.code:
        await _ensure_unique_code_in_org(
            db, Department, dept.organization_id, changes["code"], exclude_id=dept.id
        )
    if changes.get("branch_id") is not None:
        await _validate_branch_in_org(db, changes["branch_id"], dept.organization_id)
    for field, value in changes.items():
        setattr(dept, field, value)
    await db.flush()
    await db.refresh(dept)
    return dept


async def delete_department(db: AsyncSession, org_id: int | None, department_id: int) -> None:
    dept = await _get_department(db, org_id, department_id)
    employees = await _employee_count(db, Employee.department_id, dept.id)
    if employees:
        raise ConflictError(
            f"Department still has {employees} employee(s); reassign or remove them first"
        )
    await db.delete(dept)
    await db.flush()


# ── Locations ─────────────────────────────────────────────────────────────────


def _format_location(loc: Location) -> LocationWithBranch:
    base = LocationOut.model_validate(loc, from_attributes=True)
    branch = (
        BranchBrief(id=loc.branch.id, name=loc.branch.name) if loc.branch is not None else None
    )
    return LocationWithBranch(**base.model_dump(), branch=branch)


async def list_locations(db: AsyncSession, org_id: int | None) -> list[LocationWithBranch]:
    stmt = select(Location).order_by(Location.name)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    return [_format_location(loc) for loc in (await db.execute(stmt)).scalars().all()]


async def _get_location(db: AsyncSession, org_id: int | None, location_id: int) -> Location:
    stmt = select(Location).where(Location.id == location_id)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    location = (await db.execute(stmt)).scalar_one_or_none()
    if location is None:
        raise NotFoundError("Location not found")
    return location


async def create_location(
    db: AsyncSession, org_id: int | None, body: LocationCreate
) -> LocationWithBranch:
    target_org_id = await _resolve_target_org_id(db, org_id, body.organization_id)
    if body.branch_id is not None:
        await _validate_branch_in_org(db, body.branch_id, target_org_id)
    location = Location(
        organization_id=target_org_id,
        branch_id=body.branch_id,
        name=body.name,
        address=body.address,
        timezone=body.timezone,
    )
    db.add(location)
    await db.flush()
    await db.refresh(location)
    return _format_location(location)


async def update_location(
    db: AsyncSession, org_id: int | None, location_id: int, body: LocationUpdate
) -> LocationWithBranch:
    location = await _get_location(db, org_id, location_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("branch_id") is not None:
        await _validate_branch_in_org(db, changes["branch_id"], location.organization_id)
    for field, value in changes.items():
        setattr(location, field, value)
    await db.flush()
    await db.refresh(location)
    return _format_location(location)


async def _location_dependents(db: AsyncSession, location_id: int) -> dict[str, int]:
    """Counts of records that would cascade-delete with the location."""
    from app.models.camera import Camera
    from app.models.edge import EdgeDevice
    from app.models.rfid import RfidReader

    counts: dict[str, int] = {}
    for label, model in (("camera", Camera), ("RFID reader", RfidReader), ("edge device", EdgeDevice)):
        stmt = select(func.count()).select_from(model).where(model.location_id == location_id)
        count = (await db.execute(stmt)).scalar_one()
        if count:
            counts[label] = count
    return counts


async def delete_location(db: AsyncSession, org_id: int | None, location_id: int) -> None:
    location = await _get_location(db, org_id, location_id)

    # Cameras, RFID readers, and edge devices cascade-delete with their
    # location — refuse instead of silently destroying device configuration.
    dependents = await _location_dependents(db, location.id)
    if dependents:
        detail = ", ".join(f"{count} {label}(s)" for label, count in dependents.items())
        raise ConflictError(f"Location still has {detail}; move or remove them first")

    employees = await _employee_count(db, Employee.location_id, location.id)
    if employees:
        raise ConflictError(
            f"Location still has {employees} employee(s); reassign or remove them first"
        )

    # Attendance history and holidays that pointed here are detached
    # (location_id SET NULL) by the database.
    await db.delete(location)
    await db.flush()
