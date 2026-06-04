"""Database models for the AI Recognition Engine."""

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
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class EngineStreamStatus(enum.Enum):
    active = "active"
    connecting = "connecting"
    degraded = "degraded"
    interrupted = "interrupted"
    offline = "offline"
    error = "error"


class RecognitionEventResult(enum.Enum):
    matched = "matched"
    unknown = "unknown"
    liveness_failed = "liveness_failed"
    quality_rejected = "quality_rejected"
    low_confidence = "low_confidence"


class VerificationLevelEnum(enum.Enum):
    basic = "basic"
    verified = "verified"
    high_security = "high_security"
    maximum_security = "maximum_security"


class AttendanceEventTypeEnum(enum.Enum):
    check_in = "CHECK_IN"
    check_out = "CHECK_OUT"
    break_start = "BREAK_START"
    break_end = "BREAK_END"
    overtime_start = "OVERTIME_START"
    overtime_end = "OVERTIME_END"


class EngineStream(Base, TimestampMixin):
    """Registered camera streams for the recognition engine."""

    __tablename__ = "engine_streams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="CASCADE"), unique=True
    )
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    stream_url: Mapped[str] = mapped_column(String(512))
    protocol: Mapped[str] = mapped_column(String(32), server_default="rtsp")
    camera_type: Mapped[str] = mapped_column(String(64), server_default="ip_camera")
    mode: Mapped[str] = mapped_column(String(32), server_default="live_stream")
    status: Mapped[EngineStreamStatus] = mapped_column(
        Enum(EngineStreamStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="offline",
    )
    direction: Mapped[str] = mapped_column(String(16), server_default="both")
    zone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_fps: Mapped[int] = mapped_column(Integer, server_default="30")
    resolution_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolution_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    last_frame_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_fps: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    current_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_frames: Mapped[int] = mapped_column(Integer, server_default="0")
    dropped_frames: Mapped[int] = mapped_column(Integer, server_default="0")

    camera: Mapped["Camera"] = relationship(lazy="selectin")


class EngineRecognitionLog(Base):
    """Detailed recognition event log for the engine pipeline."""

    __tablename__ = "engine_recognition_logs"
    __table_args__ = (
        Index("ix_engine_recognition_logs_timestamp", "recognized_at"),
        Index("ix_engine_recognition_logs_employee", "employee_id", "recognized_at"),
        Index("ix_engine_recognition_logs_camera", "camera_id", "recognized_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    result: Mapped[RecognitionEventResult] = mapped_column(
        Enum(RecognitionEventResult, values_callable=lambda e: [x.value for x in e])
    )
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    liveness_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    liveness_passed: Mapped[bool] = mapped_column(Boolean, server_default="0")
    quality_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    verification_level: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processing_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pipeline_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recognized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    camera: Mapped["Camera | None"] = relationship(lazy="selectin")
    employee: Mapped["Employee | None"] = relationship(lazy="selectin")


class UnknownPersonLog(Base):
    """Log of unknown person detections."""

    __tablename__ = "unknown_person_logs"
    __table_args__ = (
        Index("ix_unknown_person_logs_detected_at", "detected_at"),
        Index("ix_unknown_person_logs_camera", "camera_id", "detected_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(128), unique=True)
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    zone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bbox_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    alert_sent: Mapped[bool] = mapped_column(Boolean, server_default="0")
    reviewed: Mapped[bool] = mapped_column(Boolean, server_default="0")
    reviewed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    review_result: Mapped[str | None] = mapped_column(String(32), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    camera: Mapped["Camera | None"] = relationship(lazy="selectin")


class EngineMetricsSnapshot(Base):
    """Periodic metrics snapshots for dashboards and reporting."""

    __tablename__ = "engine_metrics_snapshots"
    __table_args__ = (
        Index("ix_engine_metrics_snapshots_recorded_at", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    total_detections: Mapped[int] = mapped_column(Integer, server_default="0")
    total_recognized: Mapped[int] = mapped_column(Integer, server_default="0")
    total_unknown: Mapped[int] = mapped_column(Integer, server_default="0")
    total_liveness_passed: Mapped[int] = mapped_column(Integer, server_default="0")
    total_liveness_failed: Mapped[int] = mapped_column(Integer, server_default="0")
    total_quality_rejected: Mapped[int] = mapped_column(Integer, server_default="0")
    total_attendance_events: Mapped[int] = mapped_column(Integer, server_default="0")
    avg_recognition_ms: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    avg_detection_ms: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    avg_liveness_ms: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    active_cameras: Mapped[int] = mapped_column(Integer, server_default="0")
    active_tracks: Mapped[int] = mapped_column(Integer, server_default="0")
    index_size: Mapped[int] = mapped_column(Integer, server_default="0")
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
