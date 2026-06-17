"""Drop the denormalized org-tree columns; keep a pure parent_id adjacency list.

Removes ``root_organization_id``, ``path``, ``depth`` and ``address`` from
``organizations`` (and the constraints/indexes that depended on them). A node's
company root and sub-tree are now derived by walking ``parent_id`` with
recursive CTEs (see app.middleware.tenant). Code uniqueness moves from
per-company ``(root_organization_id, code)`` to per-parent ``(parent_id, code)``
sibling uniqueness; company-root code uniqueness is enforced in the service.

This also retires the self-referential ``root_organization_id`` FK that required
the deferrable workaround in h4c5d6e7f8a9 — the only self-FK left is
``parent_id`` (nullable on roots), which never self-references at insert.

PostgreSQL only (the SQLite test harness builds from the models). Forward-only.

Revision ID: i5d6e7f8a9b0
Revises: h4c5d6e7f8a9
Create Date: 2026-06-17
"""

from typing import Sequence, Union

from alembic import op


revision: str = "i5d6e7f8a9b0"
down_revision: Union[str, None] = "h4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop everything that depends on the columns first.
    op.drop_constraint("fk_org_root_organization_id", "organizations", type_="foreignkey")
    op.drop_constraint("uq_org_root_code", "organizations", type_="unique")
    op.drop_index("ix_org_root_active", table_name="organizations")
    op.drop_index("ix_org_path", table_name="organizations")

    op.drop_column("organizations", "root_organization_id")
    op.drop_column("organizations", "path")
    op.drop_column("organizations", "depth")
    op.drop_column("organizations", "address")

    # Sibling uniqueness replaces per-company uniqueness.
    op.create_unique_constraint("uq_org_parent_code", "organizations", ["parent_id", "code"])


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: the denormalized columns were derived data; restore from "
        "a pre-migration backup if a rollback is required."
    )
