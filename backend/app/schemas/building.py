from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


DRIVER_LABELS: dict[str, str] = {
    "webhook": "Webhook",
    "mqtt": "MQTT",
    "bacnet_gateway": "BACnet Gateway",
}

EVENT_TYPE_LABELS: dict[str, str] = {
    "access_granted": "Access granted",
    "access_denied": "Access denied",
    "occupancy_update": "Occupancy update",
    "visitor_check_in": "Visitor check-in",
    "visitor_check_out": "Visitor check-out",
    "test": "Test ping",
}

DEFAULT_SUBSCRIBED_EVENTS: list[str] = [
    "access_granted",
    "occupancy_update",
    "visitor_check_in",
]


class BuildingConnectorCreate(BaseModel):
    name: str
    driver: str = "webhook"
    endpoint_url: str | None = None
    api_secret: str | None = None
    location_id: int | None = None
    subscribed_events: list[str] | None = None
    settings: dict | None = None


class BuildingConnectorUpdate(BaseModel):
    name: str | None = None
    driver: str | None = None
    endpoint_url: str | None = None
    api_secret: str | None = None
    location_id: int | None = None
    subscribed_events: list[str] | None = None
    settings: dict | None = None
    is_active: bool | None = None


class BuildingConnectorOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    organization_id: int
    location_id: int | None = None
    name: str
    driver: str
    endpoint_url: str | None = None
    subscribed_events: list[str] | None = None
    is_active: bool
    last_sync_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    events_today: int = 0


class BuildingConnectorBrief(BaseModel):
    id: int
    name: str


class BuildingEventOut(BaseModel):
    id: int
    event_type: str
    status: str
    error_message: str | None = None
    created_at: datetime | None = None
    connector: BuildingConnectorBrief | None = None


class BuildingConfigResponse(BaseModel):
    enabled: bool
    webhook_timeout: int
    business_hours_start: str
    business_hours_end: str
    business_timezone: str
    drivers: dict[str, str] = Field(default_factory=lambda: dict(DRIVER_LABELS))
    event_types: dict[str, str] = Field(default_factory=lambda: dict(EVENT_TYPE_LABELS))
    default_subscribed_events: list[str] = Field(default_factory=lambda: list(DEFAULT_SUBSCRIBED_EVENTS))


class OccupancyPublishRequest(BaseModel):
    location_id: int
    count: int


class ConnectorTestResponse(BaseModel):
    """Result of a connector webhook test ping.

    On success the HTTP status/body are returned; on transport failure only
    ``success`` and ``error`` are populated.
    """

    success: bool
    status_code: int | None = None
    response_body: str | None = None
    error: str | None = None


class OccupancyPublishResponse(BaseModel):
    success: bool
    dispatched_to: int
    total_connectors: int
