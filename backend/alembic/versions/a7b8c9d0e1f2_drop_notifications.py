"""Drop the notifications table.

The in-app notifications feature was removed: nothing ever wrote to this
table (legacy of the Laravel-style polymorphic notifiable schema) and the
API + page that read from it are gone.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_notifications_notifiable_type_notifiable_id", table_name="notifications")
    op.drop_table("notifications")


def downgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=255), nullable=False),
        sa.Column("notifiable_type", sa.String(length=255), nullable=False),
        sa.Column("notifiable_id", sa.Integer(), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notifications_notifiable_type_notifiable_id",
        "notifications",
        ["notifiable_type", "notifiable_id"],
        unique=False,
    )
