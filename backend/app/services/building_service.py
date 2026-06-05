"""Smart-building connectors: CRUD, webhook test, and occupancy dispatch."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import NotFoundError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.building import (
    BuildingConnector,
    BuildingEvent,
    BuildingEventStatus,
    ConnectorDriver,
)
from app.schemas.building import (
    BuildingConnectorBrief,
    BuildingConnectorCreate,
    BuildingConnectorOut,
    BuildingConnectorUpdate,
    BuildingEventOut,
    OccupancyPublishRequest,
    OccupancyPublishResponse,
)
from app.services.audit_service import log_action


def connector_to_out(connector: BuildingConnector, events_today: int = 0) -> BuildingConnectorOut:
    driver = connector.driver.value if hasattr(connector.driver, "value") else str(connector.driver)
    subscribed = connector.subscribed_events
    if isinstance(subscribed, dict):
        subscribed = list(subscribed.keys()) if subscribed else None
    elif subscribed is not None and not isinstance(subscribed, list):
        subscribed = list(subscribed)

    return BuildingConnectorOut(
        id=connector.id,
        organization_id=connector.organization_id,
        location_id=connector.location_id,
        name=connector.name,
        driver=driver,
        endpoint_url=connector.endpoint_url,
        subscribed_events=subscribed,
        is_active=connector.is_active,
        last_sync_at=connector.last_sync_at,
        created_at=connector.created_at,
        updated_at=connector.updated_at,
        events_today=events_today,
    )


def event_to_out(event: BuildingEvent) -> BuildingEventOut:
    status_val = event.status.value if hasattr(event.status, "value") else str(event.status)
    connector = None
    if event.building_connector:
        connector = BuildingConnectorBrief(
            id=event.building_connector.id, name=event.building_connector.name
        )
    return BuildingEventOut(
        id=event.id,
        event_type=event.event_type,
        status=status_val,
        error_message=event.error_message,
        created_at=event.created_at,
        connector=connector,
    )


async def get_connector_or_404(
    db: AsyncSession, connector_id: int, org_id: int | None
) -> BuildingConnector:
    stmt = select(BuildingConnector).where(BuildingConnector.id == connector_id)
    stmt = apply_tenant_filter(stmt, org_id, BuildingConnector.organization_id)
    connector = (await db.execute(stmt)).scalar_one_or_none()
    if not connector:
        raise NotFoundError("Connector not found")
    return connector


def connectors_query(org_id: int | None) -> Select:
    stmt = select(BuildingConnector).order_by(BuildingConnector.id.desc())
    return apply_tenant_filter(stmt, org_id, BuildingConnector.organization_id)


async def events_today_counts(db: AsyncSession) -> dict[int, int]:
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(BuildingEvent.building_connector_id, func.count(BuildingEvent.id))
        .where(BuildingEvent.created_at >= today_start)
        .group_by(BuildingEvent.building_connector_id)
    )
    return dict((await db.execute(stmt)).all())


def events_query(org_id: int | None) -> Select:
    stmt = select(BuildingEvent).join(BuildingConnector).order_by(BuildingEvent.id.desc())
    return apply_tenant_filter(stmt, org_id, BuildingConnector.organization_id)


async def create_connector(
    db: AsyncSession,
    org_id: int | None,
    body: BuildingConnectorCreate,
    *,
    user_id: int,
    ip_address: str | None,
) -> BuildingConnectorOut:
    if org_id is None:
        raise ValidationError("Organization context required")
    try:
        driver = ConnectorDriver(body.driver)
    except ValueError:
        raise ValidationError(f"Invalid driver: {body.driver}")

    connector = BuildingConnector(
        organization_id=org_id,
        name=body.name,
        driver=driver,
        endpoint_url=body.endpoint_url,
        api_secret=body.api_secret,
        location_id=body.location_id,
        subscribed_events=body.subscribed_events,
        settings=body.settings,
    )
    db.add(connector)
    await db.flush()
    await db.refresh(connector)

    await log_action(
        db,
        user_id=user_id,
        action="building_connector.created",
        entity_type="building_connector",
        entity_id=connector.id,
        ip_address=ip_address,
        new_values=body.model_dump(exclude={"api_secret"}),
    )
    return connector_to_out(connector)


async def update_connector(
    db: AsyncSession,
    connector_id: int,
    org_id: int | None,
    body: BuildingConnectorUpdate,
    *,
    user_id: int,
    ip_address: str | None,
) -> BuildingConnectorOut:
    connector = await get_connector_or_404(db, connector_id, org_id)
    update_data = body.model_dump(exclude_unset=True)
    if "driver" in update_data:
        try:
            update_data["driver"] = ConnectorDriver(update_data["driver"])
        except ValueError:
            raise ValidationError(f"Invalid driver: {update_data['driver']}")
    for field, value in update_data.items():
        setattr(connector, field, value)
    await db.flush()
    await db.refresh(connector)

    await log_action(
        db,
        user_id=user_id,
        action="building_connector.updated",
        entity_type="building_connector",
        entity_id=connector.id,
        ip_address=ip_address,
        new_values={k: v for k, v in update_data.items() if k != "api_secret"},
    )
    return connector_to_out(connector)


async def delete_connector(
    db: AsyncSession,
    connector_id: int,
    org_id: int | None,
    *,
    user_id: int,
    ip_address: str | None,
) -> None:
    connector = await get_connector_or_404(db, connector_id, org_id)
    await log_action(
        db,
        user_id=user_id,
        action="building_connector.deleted",
        entity_type="building_connector",
        entity_id=connector.id,
        ip_address=ip_address,
    )
    await db.delete(connector)


async def test_connector(db: AsyncSession, connector_id: int, org_id: int | None) -> dict:
    connector = await get_connector_or_404(db, connector_id, org_id)
    if not connector.endpoint_url:
        raise ValidationError("Connector has no endpoint URL")

    payload = {
        "event": "test",
        "connector_id": connector.id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    headers = {}
    if connector.api_secret:
        headers["Authorization"] = f"Bearer {connector.api_secret}"

    try:
        async with httpx.AsyncClient(timeout=settings.building_webhook_timeout) as client:
            resp = await client.post(connector.endpoint_url, json=payload, headers=headers)
        return {
            "success": resp.is_success,
            "status_code": resp.status_code,
            "response_body": resp.text[:500],
        }
    except httpx.RequestError as exc:
        return {"success": False, "error": str(exc)}


async def publish_occupancy(
    db: AsyncSession, org_id: int | None, body: OccupancyPublishRequest
) -> OccupancyPublishResponse:
    if org_id is None:
        raise ValidationError("Organization context required")

    stmt = select(BuildingConnector).where(
        BuildingConnector.organization_id == org_id,
        BuildingConnector.is_active == True,  # noqa: E712
    )
    connectors = (await db.execute(stmt)).scalars().all()

    dispatched = 0
    for conn in connectors:
        if not conn.endpoint_url:
            continue
        payload = {
            "event": "occupancy_update",
            "location_id": body.location_id,
            "count": body.count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        headers = {}
        if conn.api_secret:
            headers["Authorization"] = f"Bearer {conn.api_secret}"
        event_status = "sent"
        error_message = None
        try:
            async with httpx.AsyncClient(timeout=settings.building_webhook_timeout) as client:
                resp = await client.post(conn.endpoint_url, json=payload, headers=headers)
            if not resp.is_success:
                event_status = "failed"
                error_message = f"HTTP {resp.status_code}"
            else:
                dispatched += 1
        except httpx.RequestError as exc:
            event_status = "failed"
            error_message = str(exc)

        db.add(
            BuildingEvent(
                building_connector_id=conn.id,
                event_type="occupancy_update",
                payload=payload,
                status=BuildingEventStatus(event_status),
                error_message=error_message,
                dispatched_at=datetime.now(timezone.utc) if event_status == "sent" else None,
            )
        )

    await db.flush()
    return OccupancyPublishResponse(
        success=True, dispatched_to=dispatched, total_connectors=len(connectors)
    )
