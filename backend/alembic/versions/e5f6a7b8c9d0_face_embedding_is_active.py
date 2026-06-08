"""add is_active to face_embeddings

The enrollment API soft-deactivates embeddings (delete_face_enrollment) and the
face-status endpoint counts only active ones, but the column was never created —
every enroll-* write failed once it reached _save_enrollment. Add the flag the
code has always assumed, defaulting existing rows to active.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "face_embeddings",
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
    )
    op.create_index(
        "ix_face_embeddings_employee_id_is_active",
        "face_embeddings",
        ["employee_id", "is_active"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_face_embeddings_employee_id_is_active",
        table_name="face_embeddings",
    )
    op.drop_column("face_embeddings", "is_active")
