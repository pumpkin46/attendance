"""Add chat_conversation_members.is_pinned (per-user pinned conversations).

PostgreSQL only (the SQLite test harness builds from the models). Forward-only.

Revision ID: p2d3e4f5a6b7
Revises: o1c2d3e4f5a6
Create Date: 2026-06-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "p2d3e4f5a6b7"
down_revision: Union[str, None] = "o1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_conversation_members",
        sa.Column("is_pinned", sa.Boolean(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: drop chat_conversation_members.is_pinned from a "
        "pre-migration backup if a rollback is required."
    )
