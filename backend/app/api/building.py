from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.schemas.building import (
    DEFAULT_SUBSCRIBED_EVENTS,
    DRIVER_LABELS,
    EVENT_TYPE_LABELS,
    BuildingConfigResponse,
    BuildingConnectorCreate,
    BuildingConnectorOut,
    BuildingConnectorUpdate,
    BuildingEventOut,
    ConnectorTestResponse,
    OccupancyPublishRequest,
    OccupancyPublishResponse,
)
from app.services import building_service

router = APIRouter(prefix="/api/v1/building", tags=["building"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/config", response_model=BuildingConfigResponse)
async def get_building_config(user: CurrentUser):
    return BuildingConfigResponse(
        enabled=settings.building_integration_enabled,
        webhook_timeout=settings.building_webhook_timeout,
        business_hours_start=settings.building_business_hours_start,
        business_hours_end=settings.building_business_hours_end,
        business_timezone=settings.building_business_timezone,
        drivers=DRIVER_LABELS,
        event_types=EVENT_TYPE_LABELS,
        default_subscribed_events=DEFAULT_SUBSCRIBED_EVENTS,
    )


@router.get("/connectors", response_model=PaginatedResponse[BuildingConnectorOut])
async def list_connectors(
    db: DbSession,
    org_id: TenantOrgId,
    pagination: PaginationDep,
    _: require_permission("building.manage"),
):
    stmt = building_service.connectors_query(org_id)
    counts = await building_service.events_today_counts(db)
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page.data = [building_service.connector_to_out(c, counts.get(c.id, 0)) for c in page.data]
    return page


@router.post("/connectors", response_model=BuildingConnectorOut, status_code=status.HTTP_201_CREATED)
async def create_connector(
    body: BuildingConnectorCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("building.manage"),
):
    return await building_service.create_connector(
        db, org_id, body, user_id=user.id, ip_address=_ip(request)
    )


@router.patch("/connectors/{connector_id}", response_model=BuildingConnectorOut)
async def update_connector(
    connector_id: int,
    body: BuildingConnectorUpdate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("building.manage"),
):
    return await building_service.update_connector(
        db, connector_id, org_id, body, user_id=user.id, ip_address=_ip(request)
    )


@router.delete("/connectors/{connector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connector(
    connector_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("building.manage"),
):
    await building_service.delete_connector(
        db, connector_id, org_id, user_id=user.id, ip_address=_ip(request)
    )


@router.post("/connectors/{connector_id}/test", response_model=ConnectorTestResponse)
async def test_connector(
    connector_id: int,
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("building.manage"),
):
    return await building_service.test_connector(db, connector_id, org_id)


@router.get("/events", response_model=PaginatedResponse[BuildingEventOut])
async def list_building_events(
    db: DbSession,
    org_id: TenantOrgId,
    pagination: PaginationDep,
    _: require_permission("building.manage"),
):
    stmt = building_service.events_query(org_id)
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page.data = [building_service.event_to_out(e) for e in page.data]
    return page


@router.post("/occupancy/publish", response_model=OccupancyPublishResponse)
async def publish_occupancy(
    body: OccupancyPublishRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("building.manage"),
):
    return await building_service.publish_occupancy(db, org_id, body)
