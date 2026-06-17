"""Make the organizations.root_organization_id self-FK deferrable.

A company root references itself (root_organization_id == id), but the id is
only known after INSERT. Root creation therefore inserts a placeholder and
updates to the real id within one transaction. With an IMMEDIATE foreign key
PostgreSQL rejects the placeholder INSERT (the referenced id does not yet
exist); DEFERRABLE INITIALLY DEFERRED moves the check to COMMIT, by which point
the column points at the row itself. (RESTRICT cannot be deferred, so the action
becomes NO ACTION — deletes are still guarded in organization_service.)

PostgreSQL only (the SQLite test harness has FK enforcement off). Splits out of
g3b4c5d6e7f8 so already-migrated databases get the fix without a re-run.

Revision ID: h4c5d6e7f8a9
Revises: g3b4c5d6e7f8
Create Date: 2026-06-17
"""

from typing import Sequence, Union

from alembic import op


revision: str = "h4c5d6e7f8a9"
down_revision: Union[str, None] = "g3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("fk_org_root_organization_id", "organizations", type_="foreignkey")
    op.create_foreign_key(
        "fk_org_root_organization_id",
        "organizations",
        "organizations",
        ["root_organization_id"],
        ["id"],
        deferrable=True,
        initially="DEFERRED",
    )


def downgrade() -> None:
    op.drop_constraint("fk_org_root_organization_id", "organizations", type_="foreignkey")
    op.create_foreign_key(
        "fk_org_root_organization_id",
        "organizations",
        "organizations",
        ["root_organization_id"],
        ["id"],
        ondelete="RESTRICT",
    )
