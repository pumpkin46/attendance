"""Organization / branch / department / location business logic."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.location import Location
from app.models.organization import Branch, Department, Organization
from app.schemas.organization import (
    BranchBrief,
    BranchCreate,
    DepartmentCreate,
    DepartmentOut,
    DepartmentWithBranch,
    OrganizationCreate,
    OrganizationOut,
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
    if org_id is None:
        raise ValidationError("Organization context required")
    branch = Branch(
        organization_id=org_id,
        name=body.name,
        code=body.code,
        address=body.address,
        timezone=body.timezone,
    )
    db.add(branch)
    await db.flush()
    await db.refresh(branch)
    return branch


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
    if org_id is None:
        raise ValidationError("Organization context required")
    dept = Department(
        organization_id=org_id, branch_id=body.branch_id, name=body.name, code=body.code
    )
    db.add(dept)
    await db.flush()
    await db.refresh(dept)
    return dept


# ── Locations ─────────────────────────────────────────────────────────────────


async def list_locations(db: AsyncSession, org_id: int | None) -> list[Location]:
    stmt = select(Location).order_by(Location.name)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    return list((await db.execute(stmt)).scalars().all())
