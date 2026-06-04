"""add organization_id to recognition_events

Gives recognition events a direct tenant column so they can be scoped without a
camera -> location join. This lets camera-less events (e.g. from the
/recognition/identify endpoint) be tenant-scoped, and makes "matched" events
visible to org-scoped users.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recognition_events",
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_recognition_events_org_recognized_at",
        "recognition_events",
        ["organization_id", "recognized_at"],
    )
    # Backfill the tenant for existing rows that have a camera.
    op.execute(
        """
        UPDATE recognition_events re
        SET organization_id = l.organization_id
        FROM cameras c
        JOIN locations l ON c.location_id = l.id
        WHERE re.camera_id = c.id
          AND re.organization_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_recognition_events_org_recognized_at",
        table_name="recognition_events",
    )
    op.drop_column("recognition_events", "organization_id")
