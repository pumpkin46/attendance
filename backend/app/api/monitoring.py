from __future__ import annotations

from fastapi import APIRouter

from app.core.cache import cached_json
from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId
from app.schemas.monitoring import LiveFeedOut, MonitoringDashboardOut
from app.services import monitoring_service

router = APIRouter(prefix="/api/v1", tags=["monitoring"])


@router.get("/monitoring/dashboard", response_model=MonitoringDashboardOut)
async def monitoring_dashboard(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    # Live aggregate: a short TTL absorbs bursts (and the occasional slow build)
    # without explicit invalidation — staleness is bounded by the TTL.
    return await cached_json(
        f"cache:dashboard:{org_id}",
        settings.cache_dashboard_ttl_seconds,
        lambda: monitoring_service.build_dashboard(db, org_id),
    )


@router.get("/monitoring/live-feed", response_model=LiveFeedOut)
async def monitoring_live_feed(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    return await monitoring_service.build_live_feed(db, org_id)
