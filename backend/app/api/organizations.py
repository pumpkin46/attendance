from __future__ import annotations

from fastapi import APIRouter, status

from app.core.config import settings
from app.core.dependencies import (
    CurrentUser,
    DbSession,
    TenantOrgId,
    require_any_permission,
    require_permission,
)
from app.schemas.organization import (
    LocationCreate,
    LocationOut,
    LocationUpdate,
    OrganizationCreate,
    OrganizationOut,
    OrganizationUpdate,
    OrganizationWithCounts,
    OrgNodeCreate,
    OrgNodeDetail,
    OrgNodeMove,
    OrgNodeOut,
    OrgNodeUpdate,
    SecurityConfigResponse,
)
from app.services import organization_service as service

router = APIRouter(prefix="/api/v1", tags=["organizations"])


# ── Organizations (company roots) ─────────────────────────────────────────────


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


@router.patch("/organizations/{org_id}", response_model=OrganizationOut)
async def update_organization(
    org_id: int,
    body: OrganizationUpdate,
    db: DbSession,
    user: require_permission("organizations.manage"),
):
    org = await service.update_organization(
        db,
        org_id,
        body,
        is_super_admin=user.has_role(settings.super_admin_role),
        user_org_id=user.organization_id,
    )
    return OrganizationOut.model_validate(org, from_attributes=True)


@router.delete("/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    org_id: int,
    db: DbSession,
    user: require_permission("organizations.manage"),
):
    await service.delete_organization(
        db, org_id, is_super_admin=user.has_role(settings.super_admin_role)
    )


# ── Org-tree nodes ────────────────────────────────────────────────────────────


@router.get("/org-nodes/tree", response_model=list[OrgNodeOut])
async def get_org_tree(
    db: DbSession,
    org_id: TenantOrgId,
    user: require_any_permission("org_nodes.manage", "org_nodes.view"),
):
    return await service.get_tree(db, org_id)


@router.get("/org-nodes/{node_id}", response_model=OrgNodeDetail)
async def get_org_node(
    node_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_any_permission("org_nodes.manage", "org_nodes.view"),
):
    return await service.get_node(db, org_id, node_id)


@router.post("/org-nodes", response_model=OrgNodeOut, status_code=status.HTTP_201_CREATED)
async def create_org_node(
    body: OrgNodeCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    return await service.create_node(db, org_id, body)


@router.patch("/org-nodes/{node_id}", response_model=OrgNodeOut)
async def update_org_node(
    node_id: int,
    body: OrgNodeUpdate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    return await service.update_node(db, org_id, node_id, body)


@router.post("/org-nodes/{node_id}/move", response_model=OrgNodeOut)
async def move_org_node(
    node_id: int,
    body: OrgNodeMove,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    return await service.move_node(db, org_id, node_id, body)


@router.delete("/org-nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_node(
    node_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    await service.delete_node(db, org_id, node_id)


# ── Locations ───────────────────────────────────────────────────────────────


@router.get("/locations", response_model=list[LocationOut])
async def list_locations(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    return await service.list_locations(db, org_id)


@router.post("/locations", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
async def create_location(
    body: LocationCreate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    return await service.create_location(db, org_id, body)


@router.patch("/locations/{location_id}", response_model=LocationOut)
async def update_location(
    location_id: int,
    body: LocationUpdate,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    return await service.update_location(db, org_id, location_id, body)


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location(
    location_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("org_nodes.manage"),
):
    await service.delete_location(db, org_id, location_id)


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
                "unlimited_org_nodes": True,
                "arbitrary_depth_tree": True,
            },
        },
    }
