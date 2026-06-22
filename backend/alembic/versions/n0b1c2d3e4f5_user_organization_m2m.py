"""Add the user_organization join table (multi-org access per user).

A user can be granted access to many organizations (companies). For a
non-super-admin, the tenant read-scope is the UNION of these orgs' sub-trees
(see get_tenant_scope); a super admin stays global / header-scoped.

Pairs with m9a0b1c2d3e4 (which dropped the single users.organization_id): the
net effect is users moving from one organization to many. No backfill — the
dropped column is already gone, and single-org deployments only have the global
super admin (no per-org users to migrate).

PostgreSQL only (the SQLite test harness builds from the models). Forward-only.

Revision ID: n0b1c2d3e4f5
Revises: m9a0b1c2d3e4
Create Date: 2026-06-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "n0b1c2d3e4f5"
down_revision: Union[str, None] = "m9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_organization",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "organization_id"),
    )
    # Reverse lookups (org -> its users) for the org delete/usage checks.
    op.create_index(
        "ix_user_organization_organization_id",
        "user_organization",
        ["organization_id"],
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: drop the user_organization table from a pre-migration "
        "backup if a rollback is required."
    )
