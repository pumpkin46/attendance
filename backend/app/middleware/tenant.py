from __future__ import annotations

from sqlalchemy import Select


def apply_tenant_filter(stmt: Select, org_id: int | None, org_column) -> Select:
    if org_id is not None:
        stmt = stmt.where(org_column == org_id)
    return stmt
