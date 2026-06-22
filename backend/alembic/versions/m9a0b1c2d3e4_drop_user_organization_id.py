"""Drop organization_id from users.

Users no longer carry an organization. In the single-company model a
non-super-admin's tenant is resolved from the lone active organization at
request time (see ``get_tenant_org_id``), and super admins scope via the
``X-Organization-Id`` header. Dropping the column (and its FK) removes the
now-unused per-user tenant link.

PostgreSQL only (the SQLite test harness builds from the models, which no
longer declare the column). Forward-only. Dropping the column also drops the
dependent foreign-key constraint.

Revision ID: m9a0b1c2d3e4
Revises: l8f9a0b1c2d3
Create Date: 2026-06-18
"""

from typing import Sequence, Union

from alembic import op


revision: str = "m9a0b1c2d3e4"
down_revision: Union[str, None] = "l8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "organization_id")


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: the per-user organization link was removed; restore from "
        "a pre-migration backup if a rollback is required."
    )
