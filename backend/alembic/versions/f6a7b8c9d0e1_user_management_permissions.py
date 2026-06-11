"""Add users.manage / roles.manage permissions and grant them to org_admin.

Data-only migration so existing deployments (already seeded) pick up the
permissions backing the new user & permission management API.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-11
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERMISSIONS = [
    ("users.manage", "Manage Users"),
    ("roles.manage", "Manage Roles & Permissions"),
]


def upgrade() -> None:
    for name, label in _PERMISSIONS:
        op.execute(
            f"""
            INSERT INTO permissions (name, label)
            SELECT '{name}', '{label}'
            WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = '{name}')
            """
        )
        op.execute(
            f"""
            INSERT INTO role_permission (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'org_admin'
              AND p.name = '{name}'
              AND NOT EXISTS (
                  SELECT 1 FROM role_permission rp
                  WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        )


def downgrade() -> None:
    names = ", ".join(f"'{name}'" for name, _ in _PERMISSIONS)
    op.execute(
        f"""
        DELETE FROM role_permission
        WHERE permission_id IN (SELECT id FROM permissions WHERE name IN ({names}))
        """
    )
    op.execute(f"DELETE FROM permissions WHERE name IN ({names})")
