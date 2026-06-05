"""AI security monitoring: alert dashboard + acknowledge/resolve transitions."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.middleware.tenant import apply_tenant_filter
from app.models.security import SecurityAlert
from app.schemas.security_monitoring import SecurityAlertOut, SecurityDashboard


async def _count_by(db: AsyncSession, column, org_id: int | None) -> dict:
    stmt = select(column, func.count(SecurityAlert.id).label("cnt")).group_by(column)
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    return {row[0]: row.cnt for row in (await db.execute(stmt)).all()}


async def build_dashboard(db: AsyncSession, org_id: int | None) -> SecurityDashboard:
    total_q = apply_tenant_filter(
        select(func.count(SecurityAlert.id)), org_id, SecurityAlert.organization_id
    )
    total = (await db.execute(total_q)).scalar() or 0

    status_map = await _count_by(db, SecurityAlert.status, org_id)
    by_severity = await _count_by(db, SecurityAlert.severity, org_id)
    by_type = await _count_by(db, SecurityAlert.alert_type, org_id)

    recent_stmt = apply_tenant_filter(
        select(SecurityAlert), org_id, SecurityAlert.organization_id
    ).order_by(SecurityAlert.id.desc()).limit(10)
    recent_alerts = [
        SecurityAlertOut.model_validate(a, from_attributes=True)
        for a in (await db.execute(recent_stmt)).scalars().all()
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


def alerts_query(org_id: int | None) -> Select:
    stmt = select(SecurityAlert).order_by(SecurityAlert.id.desc())
    return apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)


async def get_alert(db: AsyncSession, alert_id: int, org_id: int | None) -> SecurityAlert:
    stmt = select(SecurityAlert).where(SecurityAlert.id == alert_id)
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    alert = (await db.execute(stmt)).scalar_one_or_none()
    if not alert:
        raise NotFoundError("Alert not found")
    return alert


async def acknowledge_alert(
    db: AsyncSession, alert_id: int, org_id: int | None, user_id: int
) -> SecurityAlert:
    alert = await get_alert(db, alert_id, org_id)
    if alert.status != "open":
        raise ConflictError("Alert is not in open state")
    alert.status = "acknowledged"
    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledged_by = user_id
    await db.flush()
    await db.refresh(alert)
    return alert


async def resolve_alert(
    db: AsyncSession, alert_id: int, org_id: int | None, user_id: int
) -> SecurityAlert:
    alert = await get_alert(db, alert_id, org_id)
    if alert.status == "resolved":
        raise ConflictError("Alert already resolved")
    alert.status = "resolved"
    alert.resolved_at = datetime.now(timezone.utc)
    alert.resolved_by = user_id
    await db.flush()
    await db.refresh(alert)
    return alert
