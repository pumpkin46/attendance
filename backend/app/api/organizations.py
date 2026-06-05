from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.schemas.organization import (
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
from app.services import organization_service as service

router = APIRouter(prefix="/api/v1", tags=["organizations"])


# ── Organizations ───────────────────────────────────────────────────────────


@router.get("/organizations", response_model=list[OrganizationWithCounts])
async def list_organizations(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    return await service.list_organizations(
        db,
        is_super_admin=user.has_role(settings.super_admin_role),
        user_org_id=user.organization_id,
        tenant_org_id=org_id,
    )


@router.post("/organizations", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate,
    db: DbSession,
    user: require_permission("organizations.manage"),
):
    org = await service.create_organization(
        db, body, is_super_admin=user.has_role(settings.super_admin_role)
    )
    return OrganizationOut.model_validate(org, from_attributes=True)


@router.get("/organizations/{org_id}", response_model=OrganizationOut)
async def get_organization(org_id: int, db: DbSession, user: CurrentUser):
    org = await service.get_organization(
        db,
        org_id,
        is_super_admin=user.has_role(settings.super_admin_role),
        user_org_id=user.organization_id,
    )
    return OrganizationOut.model_validate(org, from_attributes=True)


# ── Branches ────────────────────────────────────────────────────────────────


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    organization_id: int | None = Query(None),
):
    branches = await service.list_branches(db, org_id, organization_id)
    return [BranchOut.model_validate(b, from_attributes=True) for b in branches]


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
async def create_branch(
    body: BranchCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("branches.manage"),
):
    branch = await service.create_branch(db, org_id, body)
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
    return await service.list_departments(db, org_id, organization_id, branch_id)


@router.post("/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
async def create_department(
    body: DepartmentCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("departments.manage"),
):
    dept = await service.create_department(db, org_id, body)
    return DepartmentOut.model_validate(dept, from_attributes=True)


# ── Locations ───────────────────────────────────────────────────────────────


@router.get("/locations", response_model=list[LocationBrief])
async def list_locations(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    locations = await service.list_locations(db, org_id)
    return [LocationBrief(id=loc.id, name=loc.name, address=loc.address) for loc in locations]


# ── Security config ─────────────────────────────────────────────────────────


@router.get("/security/config", response_model=SecurityConfigResponse)
async def security_config(user: require_permission("security.view")):
    return {
        "authentication": {
            "jwt": {"enabled": True, "token_type": "Bearer"},
            "oauth2": {
                "enabled": settings.oauth_enabled,
                "providers": ["google", "microsoft"] if settings.oauth_enabled else [],
            },
            "saml": {"enabled": settings.saml_enabled},
            "ldap": {"enabled": settings.ldap_enabled},
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
            "in_transit": {"protocol": "1.3", "force_https": settings.app_env != "local"},
            "at_rest": {"cipher": "AES-256-CBC"},
            "secrets": {"driver": "env", "vault_configured": False, "kms_configured": False},
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
