"""Drop org_node_id from employees / users / locations.

Per-member assignment to an org-tree node (and the sub-tree scoping it enabled)
is removed: members link to their company via ``organization_id`` only, and the
``organizations`` tree is a purely structural org chart. Employees keep their
free-text ``department`` label.

PostgreSQL only (the SQLite test harness builds from the models). Forward-only.

Revision ID: j6d7e8f9a0b1
Revises: i5d6e7f8a9b0
Create Date: 2026-06-17
"""

from typing import Sequence, Union

from alembic import op


revision: str = "j6d7e8f9a0b1"
down_revision: Union[str, None] = "i5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TARGETS = (
    ("employees", "fk_employees_org_node_id", "ix_employees_org_node"),
    ("users", "fk_users_org_node_id", "ix_users_org_node"),
    ("locations", "fk_locations_org_node_id", "ix_locations_org_node"),
)


def upgrade() -> None:
    for table, fk_name, index_name in _TARGETS:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.drop_index(index_name, table_name=table)
        op.drop_column(table, "org_node_id")


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: per-member org-node assignment was removed; restore from "
        "a pre-migration backup if a rollback is required."
    )
