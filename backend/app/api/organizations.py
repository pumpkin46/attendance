from __future__ import annotations

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.organization import Branch, Department, Organization
from app.models.location import Location
from app.schemas.organization import (
    BranchBrief,
    BranchCreate,
    BranchOut,
    DepartmentCreate,
    DepartmentOut,
    DepartmentWithBranch,
    LocationBrief,
    OrganizationCreate,
    OrganizationOut,
    OrganizationWithCounts,
    SecurityConfigResponse,
)

router = APIRouter(prefix="/api/v1", tags=["organizations"])


async def _count_by_org(
    db: DbSession, model, org_ids: list[int]
) -> dict[int, int]:
    if not org_ids:
        return {}
    stmt = (
        select(model.organization_id, func.count())
        .where(model.organization_id.in_(org_ids))
        .group_by(model.organization_id)
    )
    result = await db.execute(stmt)
    return {org_id: count for org_id, count in result.all()}


def _format_department(dept: Department) -> DepartmentWithBranch:
    base = DepartmentOut.model_validate(dept, from_attributes=True)
    branch = (
        BranchBrief(id=dept.branch.id, name=dept.branch.name)
        if dept.branch is not None
        else None
    )
    return DepartmentWithBranch(**base.model_dump(), branch=branch)


# ── Organizations ───────────────────────────────────────────────────────────

@router.get("/organizations", response_model=list[OrganizationWithCounts])
async def list_organizations(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = select(Organization).order_by(Organization.name)
    if not user.has_role(settings.super_admin_role):
        stmt = stmt.where(Organization.id == user.organization_id)
    else:
        stmt = apply_tenant_filter(stmt, org_id, Organization.id)
    result = await db.execute(stmt)
    orgs = list(result.scalars().all())
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


@router.post("/organizations", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate,
    db: DbSession,
    user: require_permission("organizations.manage"),
):
    if not user.has_role(settings.super_admin_role):
        raise PermissionDeniedError("Only super admins can create organizations")

    org = Organization(
        name=body.name,
        code=body.code,
        timezone=body.timezone,
        settings=body.settings,
    )
    db.add(org)
    await db.flush()
    await db.refresh(org)
    return OrganizationOut.model_validate(org, from_attributes=True)


@router.get("/organizations/{org_id}", response_model=OrganizationOut)
async def get_organization(org_id: int, db: DbSession, user: CurrentUser):
    if not user.has_role(settings.super_admin_role) and user.organization_id != org_id:
        raise PermissionDeniedError("Access denied")

    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization not found")
    return OrganizationOut.model_validate(org, from_attributes=True)


# ── Branches ────────────────────────────────────────────────────────────────

@router.get("/branches", response_model=list[BranchOut])
async def list_branches(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    organization_id: int | None = Query(None),
):
    stmt = select(Branch).order_by(Branch.name)
    if organization_id is not None:
        stmt = stmt.where(Branch.organization_id == organization_id)
    stmt = apply_tenant_filter(stmt, org_id, Branch.organization_id)
    result = await db.execute(stmt)
    return [
        BranchOut.model_validate(b, from_attributes=True)
        for b in result.scalars().all()
    ]


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
async def create_branch(
    body: BranchCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("branches.manage"),
):
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
    return BranchOut.model_validate(branch, from_attributes=True)


# ── Departments ─────────────────────────────────────────────────────────────

@router.get("/departments", response_model=list[DepartmentWithBranch])
async def list_departments(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    organization_id: int | None = Query(None),
    branch_id: int | None = Query(None),
):
    stmt = select(Department).order_by(Department.name)
    if organization_id is not None:
        stmt = stmt.where(Department.organization_id == organization_id)
    if branch_id is not None:
        stmt = stmt.where(Department.branch_id == branch_id)
    stmt = apply_tenant_filter(stmt, org_id, Department.organization_id)
    result = await db.execute(stmt)
    return [_format_department(d) for d in result.scalars().all()]


@router.post("/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
async def create_department(
    body: DepartmentCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("departments.manage"),
):
    if org_id is None:
        raise ValidationError("Organization context required")

    dept = Department(
        organization_id=org_id,
        branch_id=body.branch_id,
        name=body.name,
        code=body.code,
    )
    db.add(dept)
    await db.flush()
    await db.refresh(dept)
    return DepartmentOut.model_validate(dept, from_attributes=True)


# ── Locations ───────────────────────────────────────────────────────────────

@router.get("/locations", response_model=list[LocationBrief])
async def list_locations(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    stmt = select(Location).order_by(Location.name)
    stmt = apply_tenant_filter(stmt, org_id, Location.organization_id)
    result = await db.execute(stmt)
    return [
        LocationBrief(id=loc.id, name=loc.name, address=loc.address)
        for loc in result.scalars().all()
    ]


# ── Security config ─────────────────────────────────────────────────────────

@router.get("/security/config", response_model=SecurityConfigResponse)
async def security_config(
    user: require_permission("security.view"),
):
    return {
        "authentication": {
            "jwt": {
                "enabled": True,
                "token_type": "Bearer",
            },
            "oauth2": {
                "enabled": settings.oauth_enabled,
                "providers": ["google", "microsoft"] if settings.oauth_enabled else [],
            },
            "saml": {
                "enabled": settings.saml_enabled,
            },
            "ldap": {
                "enabled": settings.ldap_enabled,
            },
        },
        "authorization": {
            "model": "rbac",
            "roles": {
                "super_admin": "Super Admin",
                "org_admin": "Organization Admin",
                "hr_manager": "HR Manager",
                "supervisor": "Supervisor",
                "employee": "Employee",
                "security_officer": "Security Officer",
            },
        },
        "encryption": {
            "in_transit": {
                "protocol": "1.3",
                "force_https": settings.app_env != "local",
            },
            "at_rest": {
                "cipher": "AES-256-CBC",
            },
            "secrets": {
                "driver": "env",
                "vault_configured": False,
                "kms_configured": False,
            },
        },
        "tenancy": {
            "isolation_enabled": settings.tenant_isolation_enabled,
            "supports": {
                "unlimited_organizations": True,
                "unlimited_branches": True,
                "unlimited_departments": True,
            },
        },
    }
