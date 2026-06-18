"""Enforce company-root code uniqueness at the database level.

Sibling uniqueness is ``UNIQUE(parent_id, code)``, but company roots have
``parent_id IS NULL`` and Postgres treats NULLs as distinct, so two roots could
share a code (the old global ``UNIQUE(code)`` was dropped in the org-tree merge).
Root-code uniqueness then rested only on a race-prone app-layer check. This adds
a partial unique index so the database is the source of truth.

Any pre-existing duplicate root codes (from the historical race) are
deterministically de-duplicated by suffixing the higher-id rows before the index
is created, so the migration cannot fail on legacy data.

PostgreSQL only (the SQLite test harness builds from the models, which carry the
equivalent ``sqlite_where`` partial index).

Revision ID: k7e8f9a0b1c2
Revises: j6d7e8f9a0b1
Create Date: 2026-06-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "k7e8f9a0b1c2"
down_revision: Union[str, None] = "j6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    # Keep the lowest-id row's code in each duplicate root group; suffix the
    # rest with their id (unique by construction) so the index can be created.
    conn.execute(
        sa.text(
            """
            UPDATE organizations o
            SET code = o.code || '-' || o.id
            WHERE o.parent_id IS NULL
              AND EXISTS (
                SELECT 1 FROM organizations o2
                WHERE o2.parent_id IS NULL
                  AND o2.code = o.code
                  AND o2.id < o.id
              )
            """
        )
    )
    op.create_index(
        "uq_org_root_code",
        "organizations",
        ["code"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_org_root_code", table_name="organizations")
