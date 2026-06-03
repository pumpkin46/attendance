from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    SmallInteger,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class EdgeDeviceStatus(enum.Enum):
    pending = "pending"
    online = "online"
    offline = "offline"
    error = "error"


class EdgeDevice(Base, TimestampMixin):
    __tablename__ = "edge_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    location_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255))
    device_id: Mapped[str] = mapped_column(String(255), unique=True)
    api_token: Mapped[str] = mapped_column(String(64), unique=True)
    stream_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    local_ai_url: Mapped[str] = mapped_column(String(255), server_default="http://127.0.0.1:8001")
    status: Mapped[EdgeDeviceStatus] = mapped_column(
        Enum(EdgeDeviceStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="pending",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    poll_interval_seconds: Mapped[int] = mapped_column(SmallInteger, server_default="5")
    require_liveness: Mapped[bool] = mapped_column(Boolean, server_default="0")
    recognition_threshold: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    sync_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    frame_rate_fps: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    software_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)

    camera: Mapped["Camera | None"] = relationship(lazy="selectin")
    location: Mapped["Location"] = relationship(lazy="selectin")
