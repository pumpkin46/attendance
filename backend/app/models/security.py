from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AlertSeverity(enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AlertStatus(enum.Enum):
    open = "open"
    acknowledged = "acknowledged"
    resolved = "resolved"


class SecurityAlert(Base, TimestampMixin):
    __tablename__ = "security_alerts"
    __table_args__ = (
        Index("ix_security_alerts_org_status_occurred", "organization_id", "status", "occurred_at"),
        Index("ix_security_alerts_alert_type_severity", "alert_type", "severity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    alert_type: Mapped[str] = mapped_column(String(64))
    severity: Mapped[AlertSeverity] = mapped_column(
        Enum(AlertSeverity, values_callable=lambda e: [x.value for x in e]),
        server_default="medium",
    )
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[AlertStatus] = mapped_column(
        Enum(AlertStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="open",
    )
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    visitor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="SET NULL"), nullable=True
    )
    recognition_event_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("recognition_events.id", ondelete="SET NULL"), nullable=True
    )
    access_point_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("access_points.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    camera: Mapped["Camera | None"] = relationship(lazy="selectin")
    employee: Mapped["Employee | None"] = relationship(lazy="selectin")
    visitor: Mapped["Visitor | None"] = relationship(lazy="selectin")
    recognition_event: Mapped["RecognitionEvent | None"] = relationship(lazy="selectin")
    access_point: Mapped["AccessPoint | None"] = relationship(lazy="selectin")
