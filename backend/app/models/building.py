from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ConnectorDriver(enum.Enum):
    webhook = "webhook"
    mqtt = "mqtt"
    bacnet_gateway = "bacnet_gateway"


class BuildingEventStatus(enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"
    skipped = "skipped"


class BuildingConnector(Base, TimestampMixin):
    __tablename__ = "building_connectors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    driver: Mapped[ConnectorDriver] = mapped_column(
        Enum(ConnectorDriver, values_callable=lambda e: [x.value for x in e]),
        server_default="webhook",
    )
    endpoint_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    api_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subscribed_events: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    location: Mapped["Location | None"] = relationship(lazy="selectin")
    events: Mapped[list[BuildingEvent]] = relationship(
        back_populates="building_connector", lazy="noload"
    )


class BuildingEvent(Base, TimestampMixin):
    __tablename__ = "building_events"
    __table_args__ = (
        Index("ix_building_events_building_connector_id_created_at", "building_connector_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    building_connector_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("building_connectors.id", ondelete="CASCADE")
    )
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[BuildingEventStatus] = mapped_column(
        Enum(BuildingEventStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="pending",
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    building_connector: Mapped[BuildingConnector] = relationship(
        back_populates="events", lazy="selectin"
    )
