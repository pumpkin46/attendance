from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LiveEvent(Base):
    __tablename__ = "live_events"
    __table_args__ = (
        Index("ix_live_events_occurred_at_event_type", "occurred_at", "event_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    visitor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="SET NULL"), nullable=True
    )
    access_point_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("access_points.id", ondelete="SET NULL"), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    organization: Mapped["Organization | None"] = relationship(lazy="selectin")
    camera: Mapped["Camera | None"] = relationship(lazy="selectin")
    employee: Mapped["Employee | None"] = relationship(lazy="selectin")
    visitor: Mapped["Visitor | None"] = relationship(lazy="selectin")
    access_point: Mapped["AccessPoint | None"] = relationship(lazy="selectin")
