from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
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
    """Canonical recognition-outcome values.

    The single source of truth for recognition results — engine.py aliases this
    (as RecognitionEventResult). Stored as varchar on both recognition_events and
    engine_recognition_logs (not a native PG enum), so a new outcome needs no
    ALTER TYPE migration; this enum is the validation/reference list.
    """

    matched = "matched"
    unknown = "unknown"
    liveness_failed = "liveness_failed"
    low_confidence = "low_confidence"
    quality_rejected = "quality_rejected"


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
    # Varchar (not a native PG enum) to match engine_recognition_logs.result and
    # so a richer outcome can be written without an ALTER TYPE. Values come from
    # RecognitionResult (store the .value).
    result: Mapped[str] = mapped_column(String(32))
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
