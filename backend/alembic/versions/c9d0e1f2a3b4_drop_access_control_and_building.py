"""Drop the access-control and smart-building features.

Removes the access_points / access_events and building_connectors /
building_events tables, the access_point_id columns that referenced them from
live_events, security_alerts and visitor_access_permissions, the orphaned
Postgres enum types, and the building.manage permission (with its role grants).

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Referencing columns first, then the referenced tables.
    op.drop_column("live_events", "access_point_id")
    op.drop_column("security_alerts", "access_point_id")
    op.drop_column("visitor_access_permissions", "access_point_id")

    op.drop_index("ix_access_events_access_point_id_occurred_at", table_name="access_events")
    op.drop_table("access_events")
    op.drop_table("access_points")

    op.drop_index(
        "ix_building_events_building_connector_id_created_at", table_name="building_events"
    )
    op.drop_table("building_events")
    op.drop_table("building_connectors")

    # Enum types outlive their tables in Postgres.
    bind = op.get_bind()
    for enum_name in ("devicetype", "defaultaction", "connectordriver", "buildingeventstatus"):
        sa.Enum(name=enum_name).drop(bind, checkfirst=True)

    # Retire the feature's permission and any role grants pointing at it.
    op.execute(
        "DELETE FROM role_permission WHERE permission_id IN "
        "(SELECT id FROM permissions WHERE name = 'building.manage')"
    )
    op.execute("DELETE FROM permissions WHERE name = 'building.manage'")


def downgrade() -> None:
    op.create_table(
        "access_points",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=True),
        sa.Column("camera_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "device_type",
            sa.Enum("door", "turnstile", "gate", name="devicetype"),
            server_default="door",
            nullable=False,
        ),
        sa.Column(
            "default_action",
            sa.Enum("unlock_door", "lock_door", "open_turnstile", "open_gate", name="defaultaction"),
            server_default="unlock_door",
            nullable=False,
        ),
        sa.Column("controller_url", sa.String(length=255), nullable=True),
        sa.Column("require_liveness", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("min_confidence", sa.Numeric(precision=5, scale=4), server_default="0.95", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["camera_id"], ["cameras.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "access_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("access_point_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("visitor_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("granted", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("deny_reason", sa.String(length=255), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("liveness_passed", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["access_point_id"], ["access_points.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_access_events_access_point_id_occurred_at",
        "access_events",
        ["access_point_id", "occurred_at"],
        unique=False,
    )

    op.create_table(
        "building_connectors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "driver",
            sa.Enum("webhook", "mqtt", "bacnet_gateway", name="connectordriver"),
            server_default="webhook",
            nullable=False,
        ),
        sa.Column("endpoint_url", sa.String(length=255), nullable=True),
        sa.Column("api_secret", sa.String(length=255), nullable=True),
        sa.Column("subscribed_events", sa.JSON(), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "building_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("building_connector_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "sent", "failed", "skipped", name="buildingeventstatus"),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["building_connector_id"], ["building_connectors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_building_events_building_connector_id_created_at",
        "building_events",
        ["building_connector_id", "created_at"],
        unique=False,
    )

    op.add_column(
        "live_events",
        sa.Column("access_point_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        None, "live_events", "access_points", ["access_point_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column(
        "security_alerts",
        sa.Column("access_point_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        None, "security_alerts", "access_points", ["access_point_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column(
        "visitor_access_permissions",
        sa.Column("access_point_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        None,
        "visitor_access_permissions",
        "access_points",
        ["access_point_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.execute(
        "INSERT INTO permissions (name, label) "
        "SELECT 'building.manage', 'Manage Smart Building Integrations' "
        "WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'building.manage')"
    )
