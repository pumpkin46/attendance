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
    Numeric,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class CameraDirection(enum.Enum):
    in_ = "in"
    out = "out"
    both = "both"


class DeploymentMode(enum.Enum):
    cloud = "cloud"
    edge = "edge"


class CameraStatus(enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


class Camera(Base, TimestampMixin):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="CASCADE")
    )
    zone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    floor: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    camera_type: Mapped[str] = mapped_column(String(32), server_default="rtsp")
    device_id: Mapped[str] = mapped_column(String(255), unique=True)
    stream_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_fps: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    resolution_width: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    resolution_height: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    direction: Mapped[CameraDirection] = mapped_column(
        Enum(CameraDirection, values_callable=lambda e: [x.value for x in e]),
        server_default="both",
    )
    deployment_mode: Mapped[DeploymentMode] = mapped_column(
        Enum(DeploymentMode, values_callable=lambda e: [x.value for x in e]),
        server_default="cloud",
    )
    status: Mapped[CameraStatus] = mapped_column(
        Enum(CameraStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="active",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    frame_rate_fps: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    last_frame_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bandwidth_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_usage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    gpu_usage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    dropped_frames: Mapped[int] = mapped_column(Integer, server_default="0")
    health_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    location: Mapped["Location"] = relationship(back_populates="cameras", lazy="selectin")
    health_logs: Mapped[list[CameraHealthLog]] = relationship(
        back_populates="camera", lazy="noload"
    )


class CameraHealthLog(Base):
    __tablename__ = "camera_health_logs"
    __table_args__ = (
        Index("ix_camera_health_logs_camera_id_recorded_at", "camera_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="CASCADE")
    )
    online: Mapped[bool] = mapped_column(Boolean, server_default="1")
    frame_rate_fps: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bandwidth_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_usage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    gpu_usage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    dropped_frames: Mapped[int] = mapped_column(Integer, server_default="0")
    recognition_events: Mapped[int] = mapped_column(Integer, server_default="0")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    camera: Mapped[Camera] = relationship(back_populates="health_logs", lazy="selectin")
