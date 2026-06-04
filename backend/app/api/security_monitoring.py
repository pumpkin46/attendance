from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import ConflictError, NotFoundError
from app.core.pagination import PaginatedResponse, paginate, PaginationDep
from app.middleware.tenant import apply_tenant_filter
from app.models.security import SecurityAlert
from app.realtime.hub import emit
from app.schemas.security_monitoring import (
    SecurityAlertOut,
    SecurityConfigResponse,
    SecurityDashboard,
)

router = APIRouter(prefix="/api/v1/security-monitoring", tags=["security-monitoring"])


@router.get("/config", response_model=SecurityConfigResponse)
async def get_security_config(
    _: require_permission("security.monitor"),
):
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
    base = select(SecurityAlert)
    base = apply_tenant_filter(base, org_id, SecurityAlert.organization_id)

    total_q = select(func.count(SecurityAlert.id))
    total_q = apply_tenant_filter(total_q, org_id, SecurityAlert.organization_id)
    total = (await db.execute(total_q)).scalar() or 0

    status_q = (
        select(
            SecurityAlert.status,
            func.count(SecurityAlert.id).label("cnt"),
        )
        .group_by(SecurityAlert.status)
    )
    status_q = apply_tenant_filter(status_q, org_id, SecurityAlert.organization_id)
    status_rows = (await db.execute(status_q)).all()
    status_map = {row.status: row.cnt for row in status_rows}

    severity_q = (
        select(
            SecurityAlert.severity,
            func.count(SecurityAlert.id).label("cnt"),
        )
        .group_by(SecurityAlert.severity)
    )
    severity_q = apply_tenant_filter(severity_q, org_id, SecurityAlert.organization_id)
    severity_rows = (await db.execute(severity_q)).all()
    by_severity = {row.severity: row.cnt for row in severity_rows}

    type_q = (
        select(
            SecurityAlert.alert_type,
            func.count(SecurityAlert.id).label("cnt"),
        )
        .group_by(SecurityAlert.alert_type)
    )
    type_q = apply_tenant_filter(type_q, org_id, SecurityAlert.organization_id)
    type_rows = (await db.execute(type_q)).all()
    by_type = {row.alert_type: row.cnt for row in type_rows}

    recent_stmt = base.order_by(SecurityAlert.id.desc()).limit(10)
    recent_result = await db.execute(recent_stmt)
    recent_alerts = [
        SecurityAlertOut.model_validate(a, from_attributes=True)
        for a in recent_result.scalars().all()
    ]

    return SecurityDashboard(
        total_alerts=total,
        open_alerts=status_map.get("open", 0),
        acknowledged_alerts=status_map.get("acknowledged", 0),
        resolved_alerts=status_map.get("resolved", 0),
        by_severity=by_severity,
        by_type=by_type,
        recent_alerts=recent_alerts,
    )


@router.get("/alerts", response_model=PaginatedResponse[SecurityAlertOut])
async def list_alerts(
    db: DbSession,
    org_id: TenantOrgId,
    pagination: PaginationDep,
    _: require_permission("security.monitor"),
):
    stmt = select(SecurityAlert).order_by(SecurityAlert.id.desc())
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    return await paginate(db, stmt, pagination.page, pagination.per_page, SecurityAlertOut)


@router.get("/alerts/{alert_id}", response_model=SecurityAlertOut)
async def get_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("security.monitor"),
):
    alert = await _get_alert_or_404(db, alert_id, org_id)
    return SecurityAlertOut.model_validate(alert, from_attributes=True)


@router.post("/alerts/{alert_id}/acknowledge", response_model=SecurityAlertOut)
async def acknowledge_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("security.monitor"),
):
    alert = await _get_alert_or_404(db, alert_id, org_id)
    if alert.status != "open":
        raise ConflictError("Alert is not in open state")
    alert.status = "acknowledged"
    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledged_by = user.id
    await db.flush()
    await db.refresh(alert)
    await emit(alert.organization_id, "security.changed", {"alert_id": alert.id})
    return SecurityAlertOut.model_validate(alert, from_attributes=True)


@router.post("/alerts/{alert_id}/resolve", response_model=SecurityAlertOut)
async def resolve_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("security.monitor"),
):
    alert = await _get_alert_or_404(db, alert_id, org_id)
    if alert.status == "resolved":
        raise ConflictError("Alert already resolved")
    alert.status = "resolved"
    alert.resolved_at = datetime.now(timezone.utc)
    alert.resolved_by = user.id
    await db.flush()
    await db.refresh(alert)
    await emit(alert.organization_id, "security.changed", {"alert_id": alert.id})
    return SecurityAlertOut.model_validate(alert, from_attributes=True)


async def _get_alert_or_404(
    db: DbSession, alert_id: int, org_id: int | None
) -> SecurityAlert:
    stmt = select(SecurityAlert).where(SecurityAlert.id == alert_id)
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    result = await db.execute(stmt)
    alert = result.scalar_one_or_none()
    if not alert:
        raise NotFoundError("Alert not found")
    return alert
