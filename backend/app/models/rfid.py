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
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class RfidDirection(enum.Enum):
    in_ = "in"
    out = "out"
    both = "both"


class RfidEventResult(enum.Enum):
    matched = "matched"
    unknown = "unknown"
    inactive = "inactive"
    duplicate_ignored = "duplicate_ignored"


class RfidReader(Base, TimestampMixin):
    __tablename__ = "rfid_readers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255))
    device_id: Mapped[str] = mapped_column(String(255), unique=True)
    direction: Mapped[RfidDirection] = mapped_column(
        Enum(RfidDirection, values_callable=lambda e: [x.value for x in e]),
        server_default="both",
    )
    api_token: Mapped[str] = mapped_column(String(64), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    location: Mapped["Location"] = relationship(lazy="selectin")
    events: Mapped[list[RfidEvent]] = relationship(back_populates="rfid_reader", lazy="noload")


class RfidCard(Base, TimestampMixin):
    __tablename__ = "rfid_cards"
    __table_args__ = (
        Index("ix_rfid_cards_uid_is_active", "uid", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    uid: Mapped[str] = mapped_column(String(255), unique=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    employee: Mapped["Employee"] = relationship(back_populates="rfid_cards", lazy="selectin")


class RfidEvent(Base, TimestampMixin):
    __tablename__ = "rfid_events"
    __table_args__ = (
        Index("ix_rfid_events_tapped_at_result", "tapped_at", "result"),
        Index("ix_rfid_events_employee_id_tapped_at", "employee_id", "tapped_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rfid_reader_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rfid_readers.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    uid: Mapped[str] = mapped_column(String(255))
    result: Mapped[RfidEventResult] = mapped_column(
        Enum(RfidEventResult, values_callable=lambda e: [x.value for x in e]),
        server_default="unknown",
    )
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    tapped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    rfid_reader: Mapped["RfidReader | None"] = relationship(back_populates="events", lazy="selectin")
    employee: Mapped["Employee | None"] = relationship(lazy="selectin")
