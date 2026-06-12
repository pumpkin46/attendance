"""Backfill organization_id for orphan tenant users (single-org deployments)

Hand-authored data migration. get_tenant_org_id and the WebSocket identity
resolution now reject a non-super-admin whose organization_id is NULL:
previously NULL silently meant GLOBAL scope (apply_tenant_filter and the
realtime hub treat None as "all tenants"), so an org-less tenant user could
see every tenant's data. With that hole closed, such accounts flip from
(insecurely) working to 403 with no remediation path. When exactly one active
organization exists there is no ambiguity about where they belong, so attach
them to it. Super admins keep NULL (their legitimate global scope); with zero
or multiple active organizations nothing is changed and an operator must
assign those users explicitly.

PostgreSQL syntax.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-12

"""
from typing import Sequence, Union

from alembic import op


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 'super_admin' is the default of settings.super_admin_role, hardcoded
    # because migrations cannot import application settings.
    op.execute(
        """
        UPDATE users
        SET organization_id = (SELECT id FROM organizations WHERE is_active = TRUE)
        WHERE organization_id IS NULL
          AND (SELECT COUNT(*) FROM organizations WHERE is_active = TRUE) = 1
          AND NOT EXISTS (
              SELECT 1
              FROM role_user ru
              JOIN roles r ON r.id = ru.role_id
              WHERE ru.user_id = users.id
                AND r.name = 'super_admin'
          )
        """
    )


def downgrade() -> None:
    # No-op: backfilled rows are indistinguishable from users that always
    # belonged to the organization, so the NULLs cannot be safely restored.
    pass
