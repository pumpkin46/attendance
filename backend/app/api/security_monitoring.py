from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Query, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import DbSession, TenantOrgId, TenantScope, require_permission
from app.core.errors import NotFoundError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.middleware.tenant import as_scope_ids
from app.models.organization import Organization
from app.realtime.hub import emit
from app.schemas.security_monitoring import (
    SecurityAlertOut,
    SecurityConfigResponse,
    SecurityDashboard,
)
from app.services import security_export
from app.services import security_monitoring_service as service
from app.services.report_export import ExportContext, MEDIA_TYPES

router = APIRouter(prefix="/api/v1/security-monitoring", tags=["security-monitoring"])

# Export ceilings, mirroring the audit trail: CSV streams cheaply; Excel styles
# every cell and PDF lays out every row, so they get lower caps.
MAX_EXPORT_ROWS = {"csv": 50_000, "xlsx": 10_000, "pdf": 5_000}

TzOffsetQuery = Query(0, ge=-840, le=840, description="JS Date.getTimezoneOffset() of the viewer")


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
    org_id: TenantScope,
    _: require_permission("security.monitor"),
    tz_offset: int = TzOffsetQuery,
):
    return await service.build_dashboard(db, org_id, tz_offset)


@router.get("/alerts", response_model=PaginatedResponse[SecurityAlertOut])
async def list_alerts(
    db: DbSession,
    org_id: TenantScope,
    pagination: PaginationDep,
    _: require_permission("security.monitor"),
    status: str | None = Query(None),
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    q: str | None = Query(None, max_length=255, description="Search title, message or type"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    tz_offset: int = TzOffsetQuery,
):
    stmt = service.alerts_query(
        org_id,
        status=status,
        severity=severity,
        alert_type=alert_type,
        q=q,
        date_from=date_from,
        date_to=date_to,
        tz_offset=tz_offset,
    )
    return await paginate(db, stmt, pagination.page, pagination.per_page, SecurityAlertOut)


@router.get("/alerts/export")
async def export_alerts(
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("security.monitor"),
    export_format: Literal["csv", "xlsx", "pdf"] = Query("csv", alias="format"),
    status: str | None = Query(None),
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    q: str | None = Query(None, max_length=255),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    tz_offset: int = TzOffsetQuery,
):
    """Download the (filtered) security alerts as CSV, a styled Excel workbook, or a print-ready PDF."""
    stmt = service.alerts_query(
        org_id,
        status=status,
        severity=severity,
        alert_type=alert_type,
        q=q,
        date_from=date_from,
        date_to=date_to,
        tz_offset=tz_offset,
    ).limit(MAX_EXPORT_ROWS[export_format])
    alerts = list((await db.execute(stmt)).scalars().all())

    org_name = None
    scope_ids = as_scope_ids(org_id)
    # The export header carries a single org name. Only label it when the read
    # scope resolves to exactly one company root; a multi-org union has no single
    # name, so leave it blank there.
    if scope_ids is not None and len(scope_ids) == 1:
        org_name = (
            await db.execute(select(Organization.name).where(Organization.id == scope_ids[0]))
        ).scalar_one_or_none()
    ctx = ExportContext(
        org_name=org_name,
        generated_at=datetime.now(timezone.utc),
        tz_offset=tz_offset,
    )

    # Rendering (openpyxl) is CPU-bound — keep it off the event loop.
    content = await run_in_threadpool(
        security_export.export_security_alerts, alerts, export_format, ctx
    )

    local_stamp = (ctx.generated_at - timedelta(minutes=tz_offset)).strftime("%Y%m%d-%H%M")
    basename = f"security-alerts-{local_stamp}"
    return Response(
        content=content,
        media_type=MEDIA_TYPES[export_format],
        headers={"Content-Disposition": f'attachment; filename="{basename}.{export_format}"'},
    )


@router.get("/alerts/{alert_id}", response_model=SecurityAlertOut)
async def get_alert(
    alert_id: int,
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("security.monitor"),
):
    alert = await service.get_alert(db, alert_id, org_id)
    return SecurityAlertOut.model_validate(alert, from_attributes=True)


@router.get("/alerts/{alert_id}/snapshot")
async def get_alert_snapshot(
    alert_id: int,
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("security.monitor"),
):
    alert = await service.get_alert(db, alert_id, org_id)
    if not alert.snapshot_path:
        raise NotFoundError("No snapshot available")
    if not os.path.isfile(alert.snapshot_path):
        raise NotFoundError("Snapshot file not found")
    return FileResponse(alert.snapshot_path, media_type="image/jpeg")


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
