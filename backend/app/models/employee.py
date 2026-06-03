from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"
    __table_args__ = (
        Index("ix_employees_organization_id_is_active", "organization_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    branch_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )
    department_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    employee_code: Mapped[str] = mapped_column(String(255), unique=True)
    first_name: Mapped[str] = mapped_column(String(255))
    last_name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    face_enrolled: Mapped[bool] = mapped_column(Boolean, server_default="0")
    face_enrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    location: Mapped["Location | None"] = relationship(lazy="selectin")
    branch: Mapped["Branch | None"] = relationship(lazy="selectin")
    department_rel: Mapped["Department | None"] = relationship(lazy="selectin")
    face_embeddings: Mapped[list["FaceEmbedding"]] = relationship(
        "FaceEmbedding", back_populates="employee", lazy="noload"
    )
    shift_assignments: Mapped[list["ShiftAssignment"]] = relationship(
        "ShiftAssignment", back_populates="employee", lazy="noload"
    )
    attendance_records: Mapped[list["AttendanceRecord"]] = relationship(
        "AttendanceRecord", back_populates="employee", lazy="noload"
    )
    rfid_cards: Mapped[list["RfidCard"]] = relationship(
        "RfidCard", back_populates="employee", lazy="noload"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
