"""Convert recognition_events.result from a native enum to varchar.

recognition_events.result was a native PG enum (``recognitionresult``) while
engine_recognition_logs.result is already varchar. The two parallel definitions
could drift, and writing a richer outcome (e.g. quality_rejected) to the enum
column would require an ALTER TYPE. Converting to varchar(32) makes them
consistent; the canonical ``RecognitionResult`` enum is now just the Python-side
validation/reference list. Stored values are unchanged (matched/unknown/...).

PostgreSQL only (the SQLite test harness builds from the models, which already
declare the column as String). Forward-only.

Revision ID: l8f9a0b1c2d3
Revises: k7e8f9a0b1c2
Create Date: 2026-06-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "l8f9a0b1c2d3"
down_revision: Union[str, None] = "k7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "recognition_events",
        "result",
        existing_type=sa.Enum(name="recognitionresult"),
        type_=sa.String(length=32),
        existing_nullable=False,
        postgresql_using="result::text",
    )
    # The native enum type is now unused.
    op.execute("DROP TYPE IF EXISTS recognitionresult")


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: rows may now hold values outside the original 4-member "
        "enum (e.g. quality_rejected); restore from a pre-migration backup if a "
        "rollback is required."
    )
