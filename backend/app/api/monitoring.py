from __future__ import annotations

from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId
from app.schemas.monitoring import LiveFeedOut, MonitoringDashboardOut
from app.services import monitoring_service

router = APIRouter(prefix="/api/v1", tags=["monitoring"])


@router.get("/monitoring/dashboard", response_model=MonitoringDashboardOut)
async def monitoring_dashboard(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    return await monitoring_service.build_dashboard(db, org_id)


@router.get("/monitoring/live-feed", response_model=LiveFeedOut)
async def monitoring_live_feed(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    return await monitoring_service.build_live_feed(db, org_id)
