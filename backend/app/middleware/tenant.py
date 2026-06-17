from __future__ import annotations

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization


def apply_tenant_filter(stmt: Select, org_id: int | None, org_column) -> Select:
    """Hard cross-tenant boundary: restrict to a single company root.

    ``org_column`` always references a tenant root (every downstream table
    stores the company root id in ``organization_id``), so this stays a plain
    equality. No-op when ``org_id`` is None (validated global super-admin scope).
    """
    if org_id is not None:
        stmt = stmt.where(org_column == org_id)
    return stmt


def descendants_subquery(node_id: int):
    """A scalar subquery of ``node_id`` plus every descendant id.

    Walks the ``parent_id`` adjacency list with a recursive CTE — works on both
    PostgreSQL and SQLite. Anonymous CTE name so several can coexist in one
    statement. Used by the org-tree service (sub-tree fetch, delete/move guards).
    """
    base = select(Organization.id).where(Organization.id == node_id)
    cte = base.cte(recursive=True)
    cte = cte.union_all(select(Organization.id).where(Organization.parent_id == cte.c.id))
    return select(cte.c.id)


async def descendant_ids(
    db: AsyncSession, node_id: int, *, include_self: bool = True
) -> set[int]:
    """All descendant ids of ``node_id`` (optionally including the node)."""
    ids = set((await db.execute(descendants_subquery(node_id))).scalars().all())
    if not include_self:
        ids.discard(node_id)
    return ids


async def fetch_subtree(db: AsyncSession, node_id: int) -> list[Organization]:
    """Every Organization row in ``node_id``'s sub-tree (including itself)."""
    stmt = select(Organization).where(Organization.id.in_(descendants_subquery(node_id)))
    return list((await db.execute(stmt)).scalars().all())


async def root_id_of(db: AsyncSession, node_id: int) -> int | None:
    """The company root (top ancestor with no parent) of ``node_id``.

    Returns None when the node does not exist. Walks ``parent_id`` upward with a
    recursive CTE and picks the row whose ``parent_id`` is NULL.
    """
    base = select(Organization.id, Organization.parent_id).where(Organization.id == node_id)
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(Organization.id, Organization.parent_id).where(Organization.id == cte.c.parent_id)
    )
    return (
        await db.execute(select(cte.c.id).where(cte.c.parent_id.is_(None)))
    ).scalar_one_or_none()


async def ancestor_chain(
    db: AsyncSession, node_id: int, *, include_self: bool = False
) -> list[Organization]:
    """Ancestors of ``node_id`` ordered root → … → parent (and node if asked)."""
    base = select(Organization.id, Organization.parent_id).where(Organization.id == node_id)
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(Organization.id, Organization.parent_id).where(Organization.id == cte.c.parent_id)
    )
    ids = [row[0] for row in (await db.execute(select(cte.c.id))).all()]
    if not ids:
        return []
    rows = (await db.execute(select(Organization).where(Organization.id.in_(ids)))).scalars().all()
    by_id = {r.id: r for r in rows}
    # Walk up from the node to assemble the ordered chain.
    chain: list[Organization] = []
    cursor: int | None = node_id
    while cursor is not None and cursor in by_id:
        chain.append(by_id[cursor])
        cursor = by_id[cursor].parent_id
    chain.reverse()
    if not include_self and chain:
        chain = chain[:-1]
    return chain
