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
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class VisitorStatus(enum.Enum):
    scheduled = "scheduled"
    checked_in = "checked_in"
    expired = "expired"
    cancelled = "cancelled"


class Visitor(Base, TimestampMixin):
    __tablename__ = "visitors"
    __table_args__ = (
        Index("ix_visitors_status_face_expires_at", "status", "face_expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    host_employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    purpose: Mapped[str | None] = mapped_column(String(255), nullable=True)
    check_in_code: Mapped[str | None] = mapped_column(String(12), unique=True, nullable=True)
    badge_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    visit_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    visit_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[VisitorStatus] = mapped_column(
        Enum(VisitorStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="scheduled",
    )
    checked_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    face_registered: Mapped[bool] = mapped_column(Boolean, server_default="0")
    ai_identity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    face_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    host_employee: Mapped["Employee | None"] = relationship(lazy="selectin")


class VisitorKiosk(Base, TimestampMixin):
    __tablename__ = "visitor_kiosks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    access_point_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("access_points.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    device_id: Mapped[str] = mapped_column(String(255), unique=True)
    api_token: Mapped[str] = mapped_column(String(255))
    allow_walk_in: Mapped[bool] = mapped_column(Boolean, server_default="1")
    require_host: Mapped[bool] = mapped_column(Boolean, server_default="0")
    require_liveness: Mapped[bool] = mapped_column(Boolean, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    location: Mapped["Location | None"] = relationship(lazy="selectin")
    access_point: Mapped["AccessPoint | None"] = relationship(lazy="selectin")
