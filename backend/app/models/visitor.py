from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class VisitorStatus(enum.Enum):
    pending_approval = "pending_approval"
    scheduled = "scheduled"
    checked_in = "checked_in"
    checked_out = "checked_out"
    expired = "expired"
    cancelled = "cancelled"


class VisitorCategory(enum.Enum):
    walk_in = "walk_in"
    pre_registered = "pre_registered"
    contractor = "contractor"
    vendor = "vendor"
    interview_candidate = "interview_candidate"
    temporary_staff = "temporary_staff"
    government_official = "government_official"
    delivery = "delivery"


class VisitType(enum.Enum):
    business_meeting = "business_meeting"
    interview = "interview"
    vendor_visit = "vendor_visit"
    maintenance = "maintenance"
    delivery = "delivery"
    training = "training"
    contractor_work = "contractor_work"
    government_visit = "government_visit"
    audit = "audit"
    guest_visit = "guest_visit"


class IdType(enum.Enum):
    passport = "passport"
    national_id = "national_id"
    driving_license = "driving_license"
    employee_referral = "employee_referral"
    company_badge = "company_badge"


class ApprovalStatus(enum.Enum):
    pending = "pending"
    manager_approved = "manager_approved"
    security_approved = "security_approved"
    approved = "approved"
    rejected = "rejected"


class BadgeType(enum.Enum):
    qr = "qr"
    barcode = "barcode"
    rfid = "rfid"
    nfc = "nfc"


class BlacklistReason(enum.Enum):
    blocked = "blocked"
    watchlist = "watchlist"
    former_employee = "former_employee"
    restricted_contractor = "restricted_contractor"


class NotificationChannel(enum.Enum):
    email = "email"
    sms = "sms"
    telegram = "telegram"
    slack = "slack"
    teams = "teams"
    push = "push"


class DocumentType(enum.Enum):
    id_front = "id_front"
    id_back = "id_back"
    work_permit = "work_permit"
    insurance = "insurance"
    vehicle_registration = "vehicle_registration"
    other = "other"


class Visitor(Base, TimestampMixin):
    __tablename__ = "visitors"
    __table_args__ = (
        Index("ix_visitors_status_face_expires_at", "status", "face_expires_at"),
        Index("ix_visitors_organization_id_status", "organization_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    host_employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    pre_registered_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Basic information
    visitor_code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(64), nullable=True)
    language: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Contact
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    emergency_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    emergency_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Identity verification
    id_type: Mapped[IdType | None] = mapped_column(
        Enum(IdType, values_callable=lambda e: [x.value for x in e]), nullable=True
    )
    id_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    id_expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    passport_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    driving_license_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    national_id_number: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Company information
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(128), nullable=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    business_category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Visit information
    visitor_category: Mapped[VisitorCategory] = mapped_column(
        Enum(VisitorCategory, values_callable=lambda e: [x.value for x in e]),
        server_default="walk_in",
    )
    purpose: Mapped[str | None] = mapped_column(String(255), nullable=True)
    visit_type: Mapped[VisitType | None] = mapped_column(
        Enum(VisitType, values_callable=lambda e: [x.value for x in e]), nullable=True
    )
    visit_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    meeting_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expected_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    visit_priority: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Schedule
    visit_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    visit_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expected_arrival: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expected_departure: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Check-in/out
    check_in_code: Mapped[str | None] = mapped_column(String(12), unique=True, nullable=True)
    badge_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    status: Mapped[VisitorStatus] = mapped_column(
        Enum(VisitorStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="scheduled",
    )
    checked_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    checked_out_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    current_zone: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Face recognition
    face_registered: Mapped[bool] = mapped_column(Boolean, server_default="0")
    ai_identity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    face_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Approval workflow
    approval_status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus, values_callable=lambda e: [x.value for x in e]),
        server_default="approved",
    )
    approval_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Contractor / enterprise
    contract_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    safety_training_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    work_permit_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vehicle_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parking_zone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    driver_info: Mapped[str | None] = mapped_column(Text, nullable=True)

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    host_employee: Mapped["Employee | None"] = relationship(lazy="selectin")
    photos: Mapped[list["VisitorPhoto"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    documents: Mapped[list["VisitorDocument"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    faces: Mapped[list["VisitorFace"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    badges: Mapped[list["VisitorBadge"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    access_permissions: Mapped[list["VisitorAccessPermission"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    checkins: Mapped[list["VisitorCheckin"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    checkouts: Mapped[list["VisitorCheckout"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    hosts: Mapped[list["VisitorHost"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    notifications: Mapped[list["VisitorNotification"]] = relationship(
        back_populates="visitor", lazy="noload"
    )
    logs: Mapped[list["VisitorLog"]] = relationship(
        back_populates="visitor", lazy="noload"
    )

    @property
    def full_name(self) -> str:
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name}"
        return self.name


class VisitorPhoto(Base, TimestampMixin):
    __tablename__ = "visitor_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    url: Mapped[str] = mapped_column(String(512))
    is_primary: Mapped[bool] = mapped_column(Boolean, server_default="0")
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)

    visitor: Mapped[Visitor] = relationship(back_populates="photos", lazy="selectin")


class VisitorDocument(Base, TimestampMixin):
    __tablename__ = "visitor_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    document_type: Mapped[DocumentType] = mapped_column(
        Enum(DocumentType, values_callable=lambda e: [x.value for x in e])
    )
    url: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    visitor: Mapped[Visitor] = relationship(back_populates="documents", lazy="selectin")


class VisitorFace(Base, TimestampMixin):
    __tablename__ = "visitor_faces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    embedding_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enrollment_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    visitor: Mapped[Visitor] = relationship(back_populates="faces", lazy="selectin")


class VisitorBadge(Base, TimestampMixin):
    __tablename__ = "visitor_badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    badge_number: Mapped[str] = mapped_column(String(32))
    badge_type: Mapped[BadgeType] = mapped_column(
        Enum(BadgeType, values_callable=lambda e: [x.value for x in e]),
        server_default="qr",
    )
    qr_code_data: Mapped[str | None] = mapped_column(String(512), nullable=True)
    barcode_data: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rfid_tag: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nfc_tag: Mapped[str | None] = mapped_column(String(64), nullable=True)
    access_zones: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    printed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    visitor: Mapped[Visitor] = relationship(back_populates="badges", lazy="selectin")


class VisitorAccessPermission(Base, TimestampMixin):
    __tablename__ = "visitor_access_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    zone_name: Mapped[str] = mapped_column(String(128))
    granted: Mapped[bool] = mapped_column(Boolean, server_default="1")
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    visitor: Mapped[Visitor] = relationship(back_populates="access_permissions", lazy="selectin")


class VisitorCheckin(Base):
    __tablename__ = "visitor_checkins"
    __table_args__ = (
        Index("ix_visitor_checkins_visitor_id_checked_in_at", "visitor_id", "checked_in_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    checked_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    checked_in_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    visitor: Mapped[Visitor] = relationship(back_populates="checkins", lazy="selectin")


class VisitorCheckout(Base):
    __tablename__ = "visitor_checkouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    checked_out_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    checked_out_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    visitor: Mapped[Visitor] = relationship(back_populates="checkouts", lazy="selectin")


class VisitorHost(Base, TimestampMixin):
    __tablename__ = "visitor_hosts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE")
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, server_default="1")
    notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    visitor: Mapped[Visitor] = relationship(back_populates="hosts", lazy="selectin")
    employee: Mapped["Employee"] = relationship(lazy="selectin")


class VisitorNotification(Base, TimestampMixin):
    __tablename__ = "visitor_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    recipient_employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(64))
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, values_callable=lambda e: [x.value for x in e])
    )
    message: Mapped[str] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), server_default="pending")

    visitor: Mapped[Visitor] = relationship(back_populates="notifications", lazy="selectin")
    recipient: Mapped["Employee | None"] = relationship(lazy="selectin")


class VisitorBlacklist(Base, TimestampMixin):
    __tablename__ = "visitor_blacklist"
    __table_args__ = (
        Index("ix_visitor_blacklist_organization_id", "organization_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    visitor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    id_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reason: Mapped[BlacklistReason] = mapped_column(
        Enum(BlacklistReason, values_callable=lambda e: [x.value for x in e])
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="1")
    added_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    organization: Mapped["Organization"] = relationship(lazy="selectin")
    visitor: Mapped[Visitor | None] = relationship(lazy="selectin")


class VisitorLog(Base):
    __tablename__ = "visitor_logs"
    __table_args__ = (
        Index("ix_visitor_logs_visitor_id_created_at", "visitor_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("visitors.id", ondelete="CASCADE")
    )
    event_type: Mapped[str] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    visitor: Mapped[Visitor] = relationship(back_populates="logs", lazy="selectin")
