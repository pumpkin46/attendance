"""visitor management expansion

Revision ID: a1b2c3d4e5f6
Revises: 50fa64e85121
Create Date: 2026-06-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "50fa64e85121"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _pg_enum(name: str, *values: str) -> postgresql.ENUM:
    return postgresql.ENUM(*values, name=name, create_type=False)


def _create_enum(name: str, values: list[str]) -> None:
    vals = ", ".join(f"'{v}'" for v in values)
    op.execute(
        f"""
        DO $$ BEGIN
            CREATE TYPE {name} AS ENUM ({vals});
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
        """
    )


def upgrade() -> None:
    op.execute("ALTER TYPE visitorstatus ADD VALUE IF NOT EXISTS 'pending_approval'")
    op.execute("ALTER TYPE visitorstatus ADD VALUE IF NOT EXISTS 'checked_out'")

    _create_enum(
        "visitorcategory",
        ["walk_in", "pre_registered", "contractor", "vendor",
         "interview_candidate", "temporary_staff", "government_official", "delivery"],
    )
    _create_enum(
        "visittype",
        ["business_meeting", "interview", "vendor_visit", "maintenance", "delivery",
         "training", "contractor_work", "government_visit", "audit", "guest_visit"],
    )
    _create_enum(
        "idtype",
        ["passport", "national_id", "driving_license", "employee_referral", "company_badge"],
    )
    _create_enum(
        "approvalstatus",
        ["pending", "manager_approved", "security_approved", "approved", "rejected"],
    )
    _create_enum("badgetype", ["qr", "barcode", "rfid", "nfc"])
    _create_enum(
        "blacklistreason",
        ["blocked", "watchlist", "former_employee", "restricted_contractor"],
    )
    _create_enum(
        "notificationchannel",
        ["email", "sms", "telegram", "slack", "teams", "push"],
    )
    _create_enum(
        "documenttype",
        ["id_front", "id_back", "work_permit", "insurance", "vehicle_registration", "other"],
    )

    visitorcategory = _pg_enum(
        "visitorcategory", "walk_in", "pre_registered", "contractor", "vendor",
        "interview_candidate", "temporary_staff", "government_official", "delivery",
    )
    visittype = _pg_enum(
        "visittype", "business_meeting", "interview", "vendor_visit", "maintenance", "delivery",
        "training", "contractor_work", "government_visit", "audit", "guest_visit",
    )
    idtype = _pg_enum(
        "idtype", "passport", "national_id", "driving_license", "employee_referral", "company_badge",
    )
    approvalstatus = _pg_enum(
        "approvalstatus", "pending", "manager_approved", "security_approved", "approved", "rejected",
    )
    badgetype = _pg_enum("badgetype", "qr", "barcode", "rfid", "nfc")
    blacklistreason = _pg_enum(
        "blacklistreason", "blocked", "watchlist", "former_employee", "restricted_contractor",
    )
    notificationchannel = _pg_enum(
        "notificationchannel", "email", "sms", "telegram", "slack", "teams", "push",
    )
    documenttype = _pg_enum(
        "documenttype", "id_front", "id_back", "work_permit", "insurance", "vehicle_registration", "other",
    )

    op.add_column("visitors", sa.Column("pre_registered_by_user_id", sa.Integer(), nullable=True))
    op.add_column("visitors", sa.Column("visitor_code", sa.String(length=32), nullable=True))
    op.add_column("visitors", sa.Column("first_name", sa.String(length=128), nullable=True))
    op.add_column("visitors", sa.Column("last_name", sa.String(length=128), nullable=True))
    op.add_column("visitors", sa.Column("photo_url", sa.String(length=512), nullable=True))
    op.add_column("visitors", sa.Column("gender", sa.String(length=16), nullable=True))
    op.add_column("visitors", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("visitors", sa.Column("nationality", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("language", sa.String(length=32), nullable=True))
    op.add_column("visitors", sa.Column("email", sa.String(length=255), nullable=True))
    op.add_column("visitors", sa.Column("emergency_contact", sa.String(length=255), nullable=True))
    op.add_column("visitors", sa.Column("emergency_phone", sa.String(length=32), nullable=True))
    op.add_column("visitors", sa.Column("id_type", idtype, nullable=True))
    op.add_column("visitors", sa.Column("id_number", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("id_expiration_date", sa.Date(), nullable=True))
    op.add_column("visitors", sa.Column("passport_number", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("driving_license_number", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("national_id_number", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("job_title", sa.String(length=128), nullable=True))
    op.add_column("visitors", sa.Column("department", sa.String(length=128), nullable=True))
    op.add_column("visitors", sa.Column("business_category", sa.String(length=128), nullable=True))
    op.add_column("visitors", sa.Column("website", sa.String(length=255), nullable=True))
    op.add_column(
        "visitors",
        sa.Column("visitor_category", visitorcategory, server_default="walk_in", nullable=False),
    )
    op.add_column("visitors", sa.Column("visit_type", visittype, nullable=True))
    op.add_column("visitors", sa.Column("visit_description", sa.Text(), nullable=True))
    op.add_column("visitors", sa.Column("meeting_subject", sa.String(length=255), nullable=True))
    op.add_column("visitors", sa.Column("expected_duration_minutes", sa.Integer(), nullable=True))
    op.add_column("visitors", sa.Column("visit_priority", sa.String(length=16), nullable=True))
    op.add_column("visitors", sa.Column("expected_arrival", sa.DateTime(timezone=True), nullable=True))
    op.add_column("visitors", sa.Column("expected_departure", sa.DateTime(timezone=True), nullable=True))
    op.add_column("visitors", sa.Column("pin_code", sa.String(length=8), nullable=True))
    op.add_column("visitors", sa.Column("checked_out_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("visitors", sa.Column("current_zone", sa.String(length=128), nullable=True))
    op.add_column(
        "visitors",
        sa.Column("approval_status", approvalstatus, server_default="approved", nullable=False),
    )
    op.add_column("visitors", sa.Column("approval_notes", sa.Text(), nullable=True))
    op.add_column("visitors", sa.Column("contract_start_date", sa.Date(), nullable=True))
    op.add_column("visitors", sa.Column("contract_end_date", sa.Date(), nullable=True))
    op.add_column("visitors", sa.Column("safety_training_status", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("work_permit_number", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("vehicle_number", sa.String(length=32), nullable=True))
    op.add_column("visitors", sa.Column("vehicle_type", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("parking_zone", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("driver_info", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_visitors_visitor_code", "visitors", ["visitor_code"])
    op.create_index("ix_visitors_organization_id_status", "visitors", ["organization_id", "status"])
    op.create_foreign_key(
        "fk_visitors_pre_registered_by_user_id", "visitors", "users",
        ["pre_registered_by_user_id"], ["id"], ondelete="SET NULL",
    )

    op.create_table(
        "visitor_photos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("caption", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("document_type", documenttype, nullable=False),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_faces",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("embedding_id", sa.String(length=255), nullable=True),
        sa.Column("enrollment_method", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_badges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("badge_number", sa.String(length=32), nullable=False),
        sa.Column("badge_type", badgetype, server_default="qr", nullable=False),
        sa.Column("qr_code_data", sa.String(length=512), nullable=True),
        sa.Column("barcode_data", sa.String(length=128), nullable=True),
        sa.Column("rfid_tag", sa.String(length=64), nullable=True),
        sa.Column("nfc_tag", sa.String(length=64), nullable=True),
        sa.Column("access_zones", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("printed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_access_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("access_point_id", sa.Integer(), nullable=True),
        sa.Column("zone_name", sa.String(length=128), nullable=False),
        sa.Column("granted", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["access_point_id"], ["access_points.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_checkins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("checked_in_by_user_id", sa.Integer(), nullable=True),
        sa.Column("kiosk_id", sa.Integer(), nullable=True),
        sa.Column("method", sa.String(length=32), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["checked_in_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["kiosk_id"], ["visitor_kiosks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_visitor_checkins_visitor_id_checked_in_at", "visitor_checkins", ["visitor_id", "checked_in_at"])
    op.create_table(
        "visitor_checkouts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("checked_out_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("checked_out_by_user_id", sa.Integer(), nullable=True),
        sa.Column("method", sa.String(length=32), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["checked_out_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_hosts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("recipient_employee_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("channel", notificationchannel, nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["recipient_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "visitor_blacklist",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("id_number", sa.String(length=64), nullable=True),
        sa.Column("reason", blacklistreason, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("added_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["added_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_visitor_blacklist_organization_id", "visitor_blacklist", ["organization_id"])
    op.create_table(
        "visitor_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visitor_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("meta", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_visitor_logs_visitor_id_created_at", "visitor_logs", ["visitor_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_visitor_logs_visitor_id_created_at", table_name="visitor_logs")
    op.drop_table("visitor_logs")
    op.drop_index("ix_visitor_blacklist_organization_id", table_name="visitor_blacklist")
    op.drop_table("visitor_blacklist")
    op.drop_table("visitor_notifications")
    op.drop_table("visitor_hosts")
    op.drop_table("visitor_checkouts")
    op.drop_index("ix_visitor_checkins_visitor_id_checked_in_at", table_name="visitor_checkins")
    op.drop_table("visitor_checkins")
    op.drop_table("visitor_access_permissions")
    op.drop_table("visitor_badges")
    op.drop_table("visitor_faces")
    op.drop_table("visitor_documents")
    op.drop_table("visitor_photos")
    op.drop_constraint("fk_visitors_pre_registered_by_user_id", "visitors", type_="foreignkey")
    op.drop_index("ix_visitors_organization_id_status", table_name="visitors")
    op.drop_constraint("uq_visitors_visitor_code", "visitors", type_="unique")
    for col in [
        "driver_info", "parking_zone", "vehicle_type", "vehicle_number",
        "work_permit_number", "safety_training_status", "contract_end_date",
        "contract_start_date", "approval_notes", "approval_status", "current_zone",
        "checked_out_at", "pin_code", "expected_departure", "expected_arrival",
        "visit_priority", "expected_duration_minutes", "meeting_subject",
        "visit_description", "visit_type", "visitor_category", "website",
        "business_category", "department", "job_title", "national_id_number",
        "driving_license_number", "passport_number", "id_expiration_date",
        "id_number", "id_type", "emergency_phone", "emergency_contact", "email",
        "language", "nationality", "date_of_birth", "gender", "photo_url",
        "last_name", "first_name", "visitor_code", "pre_registered_by_user_id",
    ]:
        op.drop_column("visitors", col)
    for name in (
        "documenttype", "notificationchannel", "blacklistreason", "badgetype",
        "approvalstatus", "idtype", "visittype", "visitorcategory",
    ):
        op.execute(f"DROP TYPE IF EXISTS {name}")
