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
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class DeviceType(enum.Enum):
    door = "door"
    turnstile = "turnstile"
    gate = "gate"


class DefaultAction(enum.Enum):
    unlock_door = "unlock_door"
    lock_door = "lock_door"
    open_turnstile = "open_turnstile"
    open_gate = "open_gate"


class AccessPoint(Base, TimestampMixin):
    __tablename__ = "access_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    device_type: Mapped[DeviceType] = mapped_column(
        Enum(DeviceType, values_callable=lambda e: [x.value for x in e]),
        server_default="door",
    )
    default_action: Mapped[DefaultAction] = mapped_column(
        Enum(DefaultAction, values_callable=lambda e: [x.value for x in e]),
        server_default="unlock_door",
    )
    controller_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    require_liveness: Mapped[bool] = mapped_column(Boolean, server_default="1")
    min_confidence: Mapped[float] = mapped_column(Numeric(5, 4), server_default="0.95")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    location: Mapped["Location | None"] = relationship(lazy="selectin")
    camera: Mapped["Camera | None"] = relationship(lazy="selectin")
    events: Mapped[list[AccessEvent]] = relationship(back_populates="access_point", lazy="noload")


class AccessEvent(Base):
    __tablename__ = "access_events"
    __table_args__ = (
        Index("ix_access_events_access_point_id_occurred_at", "access_point_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    access_point_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("access_points.id", ondelete="CASCADE")
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    visitor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(32))
    granted: Mapped[bool] = mapped_column(Boolean, server_default="0")
    deny_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    liveness_passed: Mapped[bool] = mapped_column(Boolean, server_default="0")
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    access_point: Mapped[AccessPoint] = relationship(back_populates="events", lazy="selectin")
    employee: Mapped["Employee | None"] = relationship(lazy="selectin")
    visitor: Mapped["Visitor | None"] = relationship(lazy="selectin")
