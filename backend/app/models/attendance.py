from __future__ import annotations

import enum
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class LeaveStatus(enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class AnomalySeverity(enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AnomalyStatus(enum.Enum):
    open = "open"
    acknowledged = "acknowledged"
    resolved = "resolved"
    false_positive = "false_positive"


class AttendancePolicy(Base, TimestampMixin):
    __tablename__ = "attendance_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255))
    grace_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="15")
    min_work_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="240")
    max_work_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="600")
    break_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="60")
    overtime_after_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="480")
    overtime_multiplier: Mapped[float] = mapped_column(Numeric(4, 2), server_default="1.5")
    night_shift_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    night_shift_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    night_shift_multiplier: Mapped[float] = mapped_column(Numeric(4, 2), server_default="1.25")
    # Stored as a JSON list of weekday ints (0-6), not an object.
    weekend_days: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    weekend_multiplier: Mapped[float] = mapped_column(Numeric(4, 2), server_default="1.5")
    holiday_paid: Mapped[bool] = mapped_column(Boolean, server_default="1")
    auto_checkout_exit_zone: Mapped[bool] = mapped_column(Boolean, server_default="1")
    require_liveness_checkin: Mapped[bool] = mapped_column(Boolean, server_default="1")
    min_confidence: Mapped[float] = mapped_column(Numeric(5, 4), server_default="0.95")
    half_day_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="240")
    is_default: Mapped[bool] = mapped_column(Boolean, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    organization: Mapped["Organization"] = relationship(lazy="selectin")


class Shift(Base, TimestampMixin):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    attendance_policy_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("attendance_policies.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(32), server_default="fixed")
    rotation_slot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    segments: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    grace_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="15")
    break_minutes: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    min_work_minutes: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    max_work_minutes: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Stored as a JSON list of weekday ints (0-6), not an object.
    days_of_week: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    attendance_policy: Mapped["AttendancePolicy | None"] = relationship(lazy="selectin")
    assignments: Mapped[list[ShiftAssignment]] = relationship(
        back_populates="shift", lazy="noload"
    )


class ShiftAssignment(Base, TimestampMixin):
    __tablename__ = "shift_assignments"
    __table_args__ = (
        Index("ix_shift_assignments_employee_id_effective_from", "employee_id", "effective_from"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    shift_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shifts.id", ondelete="CASCADE")
    )
    effective_from: Mapped[date] = mapped_column(Date)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    flex_start_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    employee: Mapped["Employee"] = relationship(back_populates="shift_assignments", lazy="selectin")
    shift: Mapped[Shift] = relationship(back_populates="assignments", lazy="selectin")


class Holiday(Base, TimestampMixin):
    __tablename__ = "holidays"
    # A plain UNIQUE(org, date, location_id) does NOT prevent duplicate org-wide
    # holidays: NULL location_id is "distinct" from NULL in Postgres, so two
    # rows with the same org+date and NULL location both pass. Two partial
    # unique indexes — one for per-location rows, one for org-wide (NULL
    # location) rows — close that gap.
    __table_args__ = (
        Index(
            "uq_holidays_org_date_location",
            "organization_id",
            "date",
            "location_id",
            unique=True,
            postgresql_where=text("location_id IS NOT NULL"),
            sqlite_where=text("location_id IS NOT NULL"),
        ),
        Index(
            "uq_holidays_org_date_global",
            "organization_id",
            "date",
            unique=True,
            postgresql_where=text("location_id IS NULL"),
            sqlite_where=text("location_id IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    date: Mapped[date] = mapped_column(Date)
    is_recurring: Mapped[bool] = mapped_column(Boolean, server_default="0")

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    location: Mapped["Location | None"] = relationship(lazy="selectin")


class LeaveRequest(Base, TimestampMixin):
    __tablename__ = "leave_requests"
    __table_args__ = (
        Index("ix_leave_requests_employee_id", "employee_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String(32))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="pending",
    )
    approved_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    employee: Mapped["Employee"] = relationship(lazy="selectin")
    approver: Mapped["User | None"] = relationship(lazy="selectin")


class AttendanceRecord(Base, TimestampMixin):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date"),
        Index("ix_attendance_records_work_date_status", "work_date", "status"),
        Index("ix_attendance_records_location_id", "location_id"),
        Index("ix_attendance_records_camera_id", "camera_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    camera_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    shift_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shifts.id", ondelete="SET NULL"), nullable=True
    )
    work_date: Mapped[date] = mapped_column(Date)
    check_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    check_out_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    check_in_method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    check_out_method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    worked_minutes: Mapped[int] = mapped_column(Integer, server_default="0")
    overtime_minutes: Mapped[int] = mapped_column(Integer, server_default="0")
    status: Mapped[str] = mapped_column(String(32), server_default="absent")
    attendance_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    employee: Mapped["Employee"] = relationship(back_populates="attendance_records", lazy="selectin")
    location: Mapped["Location | None"] = relationship(lazy="selectin")
    shift: Mapped["Shift | None"] = relationship(lazy="selectin")


class AttendanceAnomaly(Base, TimestampMixin):
    __tablename__ = "attendance_anomalies"
    __table_args__ = (
        Index("ix_attendance_anomalies_status_severity", "status", "severity"),
        Index("ix_attendance_anomalies_employee_id_detected_at", "employee_id", "detected_at"),
        Index("ix_attendance_anomalies_anomaly_type_status", "anomaly_type", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attendance_record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("attendance_records.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    anomaly_type: Mapped[str] = mapped_column(String(255))
    severity: Mapped[AnomalySeverity] = mapped_column(
        Enum(AnomalySeverity, values_callable=lambda e: [x.value for x in e]),
        server_default="medium",
    )
    score: Mapped[float] = mapped_column(Numeric(5, 4), server_default="0")
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    evidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[AnomalyStatus] = mapped_column(
        Enum(AnomalyStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="open",
    )
    detection_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    attendance_record: Mapped["AttendanceRecord | None"] = relationship(lazy="selectin")
    employee: Mapped["Employee"] = relationship(lazy="selectin")
