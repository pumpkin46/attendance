"""add snapshot_path and resolved_by to security_alerts

The monitoring API schema (SecurityAlertOut) and the resolve transition both
reference columns the table never had: resolve_alert sets resolved_by (silently
lost as a plain Python attribute) and alert snapshots had nowhere to live.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "security_alerts",
        sa.Column("snapshot_path", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "security_alerts",
        sa.Column("resolved_by", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_security_alerts_resolved_by_users",
        "security_alerts",
        "users",
        ["resolved_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_security_alerts_resolved_by_users", "security_alerts", type_="foreignkey"
    )
    op.drop_column("security_alerts", "resolved_by")
    op.drop_column("security_alerts", "snapshot_path")
