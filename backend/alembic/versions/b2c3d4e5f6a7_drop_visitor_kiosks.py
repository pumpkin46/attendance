"""drop visitor kiosks

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "visitor_checkins_kiosk_id_fkey", "visitor_checkins", type_="foreignkey"
    )
    op.drop_column("visitor_checkins", "kiosk_id")
    op.drop_table("visitor_kiosks")


def downgrade() -> None:
    op.create_table(
        "visitor_kiosks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=True),
        sa.Column("access_point_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("api_token", sa.String(length=255), nullable=False),
        sa.Column("allow_walk_in", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("require_host", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("require_liveness", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["access_point_id"], ["access_points.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id"),
    )
    op.add_column("visitor_checkins", sa.Column("kiosk_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "visitor_checkins_kiosk_id_fkey",
        "visitor_checkins",
        "visitor_kiosks",
        ["kiosk_id"],
        ["id"],
        ondelete="SET NULL",
    )
