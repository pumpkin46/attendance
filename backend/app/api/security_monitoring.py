from __future__ import annotations

from fastapi import APIRouter

from app.core.config import settings
from app.core.dependencies import DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.realtime.hub import emit
from app.schemas.security_monitoring import (
    SecurityAlertOut,
    SecurityConfigResponse,
    SecurityDashboard,
)
from app.services import security_monitoring_service as service

router = APIRouter(prefix="/api/v1/security-monitoring", tags=["security-monitoring"])


@router.get("/config", response_model=SecurityConfigResponse)
async def get_security_config(_: require_permission("security.monitor")):
    return SecurityConfigResponse(
        enabled=settings.security_monitoring_enabled,
        after_hours_start=settings.security_after_hours_start,
        after_hours_end=settings.security_after_hours_end,
        tailgating_window=settings.security_tailgating_window,
        alert_cooldown=settings.security_alert_cooldown,
    )


@router.get("/dashboard", response_model=SecurityDashboard)
async def get_dashboard(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("security.monitor"),
):
    return await service.build_dashboard(db, org_id)


@router.get("/alerts", response_model=PaginatedResponse[SecurityAlertOut])
async def list_alerts(
    db: DbSession,
    org_id: TenantOrgId,
    pagination: PaginationDep,
    _: require_permission("security.monitor"),
):
    stmt = service.alerts_query(org_id)
    return await paginate(db, stmt, pagination.page, pagination.per_page, SecurityAlertOut)


@router.get("/alerts/{alert_id}", response_model=SecurityAlertOut)
async def get_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("security.monitor"),
):
    alert = await service.get_alert(db, alert_id, org_id)
    return SecurityAlertOut.model_validate(alert, from_attributes=True)


@router.post("/alerts/{alert_id}/acknowledge", response_model=SecurityAlertOut)
async def acknowledge_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("security.monitor"),
):
    alert = await service.acknowledge_alert(db, alert_id, org_id, user.id)
    await emit(alert.organization_id, "security.changed", {"alert_id": alert.id})
    return SecurityAlertOut.model_validate(alert, from_attributes=True)


@router.post("/alerts/{alert_id}/resolve", response_model=SecurityAlertOut)
async def resolve_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("security.monitor"),
):
    alert = await service.resolve_alert(db, alert_id, org_id, user.id)
    await emit(alert.organization_id, "security.changed", {"alert_id": alert.id})
    return SecurityAlertOut.model_validate(alert, from_attributes=True)
