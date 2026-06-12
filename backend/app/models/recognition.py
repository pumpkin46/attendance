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

from app.models.base import Base


class RecognitionResult(enum.Enum):
    matched = "matched"
    unknown = "unknown"
    liveness_failed = "liveness_failed"
    low_confidence = "low_confidence"


class RecognitionEvent(Base):
    __tablename__ = "recognition_events"
    __table_args__ = (
        Index("ix_recognition_events_recognized_at_result", "recognized_at", "result"),
        Index("ix_recognition_events_org_recognized_at", "organization_id", "recognized_at"),
        Index("ix_recognition_events_employee_id", "employee_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    result: Mapped[RecognitionResult] = mapped_column(
        Enum(RecognitionResult, values_callable=lambda e: [x.value for x in e])
    )
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    liveness_passed: Mapped[bool] = mapped_column(Boolean, server_default="0")
    processing_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    recognized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    camera: Mapped["Camera | None"] = relationship(lazy="selectin")
    employee: Mapped["Employee | None"] = relationship(lazy="selectin")
