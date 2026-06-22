from __future__ import annotations

from sqlalchemy import Select, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization

# Hard cap on org-tree recursion depth. Real org charts are a handful of levels
# deep; the cap is a safety net so a malformed tree (e.g. a parent_id cycle
# introduced by a concurrent move) makes the recursive walks terminate instead
# of looping forever and hanging the tenant-resolution hot path.
MAX_TREE_DEPTH = 64


def as_scope_ids(scope) -> list[int] | None:
    """Normalise a tenant scope to a flat list of org ids (or None = global).

    Accepts a single org id (writes / single-active callers) or a set/list of
    ids (a multi-org read scope), so every call site — including inline
    ``col.in_(...)`` filters — treats the scope uniformly and safely. The ids it
    contains are company roots for the root scope (``get_tenant_scope``) or
    granted nodes for the node scope (``get_tenant_node_scope``); the caller
    picks which dependency to pass, this just flattens it.
    """
    if scope is None:
        return None
    if isinstance(scope, int):
        return [scope]
    return list(scope)


def apply_tenant_filter(stmt: Select, scope, org_column) -> Select:
    """Hard cross-tenant boundary for tables keyed by a company ROOT.

    ``org_column`` always references a tenant root (every downstream table except
    employees stores the company root id in ``organization_id``), so membership
    is an ``IN`` over the caller's scope. ``scope`` is a single org id, a list of
    ids (a multi-org user's read scope), or None (validated global super-admin
    scope = no-op).

    NB: this is NOT for ``Employee.organization_id`` — an employee may be
    assigned to any node in the company tree (directory grouping), so its tenant
    filter is sub-tree based; use ``apply_employee_tenant_filter`` instead.
    """
    ids = as_scope_ids(scope)
    if ids is None:
        return stmt
    return stmt.where(org_column.in_(ids))


def apply_employee_tenant_filter(stmt: Select, scope, org_column) -> Select:
    """Cross-tenant boundary for tables keyed to an EMPLOYEE's organization_id.

    Unlike :func:`apply_tenant_filter` (root equality), an employee's
    ``organization_id`` may be a company root OR any descendant node (its
    directory placement), so the boundary is sub-tree membership over the UNION
    of the scope ids' sub-trees. Pass the NODE scope (``get_tenant_node_scope``)
    to keep a sub-unit grant sub-unit-granular; passing the root scope widens it
    to whole companies. ``scope`` is a single org id, a list of ids, or None
    (global = no-op).
    """
    ids = as_scope_ids(scope)
    if ids is None:
        return stmt
    return stmt.where(org_column.in_(descendants_subquery_multi(ids)))


def descendants_subquery(node_id: int):
    """A scalar subquery of ``node_id`` plus every descendant id.

    Walks the ``parent_id`` adjacency list with a recursive CTE — works on both
    PostgreSQL and SQLite. Anonymous CTE name so several can coexist in one
    statement. Used by the org-tree service (sub-tree fetch, delete/move guards).
    """
    base = select(Organization.id, literal(0).label("depth")).where(
        Organization.id == node_id
    )
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(Organization.id, (cte.c.depth + 1).label("depth")).where(
            Organization.parent_id == cte.c.id,
            cte.c.depth < MAX_TREE_DEPTH,
        )
    )
    return select(cte.c.id)


def descendants_subquery_multi(node_ids):
    """Scalar subquery of every id in the union of each node's sub-tree.

    Multi-root variant of :func:`descendants_subquery` — seeds the recursive CTE
    from several roots at once so a multi-org user's read scope (the union of
    their assigned companies' sub-trees) is one IN-subquery. An empty input
    yields an empty set (matches nothing).
    """
    ids = list(node_ids)
    base = select(Organization.id, literal(0).label("depth")).where(
        Organization.id.in_(ids)
    )
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(Organization.id, (cte.c.depth + 1).label("depth")).where(
            Organization.parent_id == cte.c.id,
            cte.c.depth < MAX_TREE_DEPTH,
        )
    )
    return select(cte.c.id)


def roots_subquery_multi(node_ids):
    """Scalar subquery of the company roots reached by walking up from each node.

    Upward counterpart of :func:`descendants_subquery_multi`: seeds the recursive
    CTE from several nodes at once and walks ``parent_id`` toward the top, keeping
    only rows whose ``parent_id`` is NULL (the company roots). A node that is
    already a root yields itself. Used to map a user's granted nodes onto the
    company roots that gate every root-keyed table. Empty input → empty set.
    """
    ids = list(node_ids)
    base = select(
        Organization.id, Organization.parent_id, literal(0).label("depth")
    ).where(Organization.id.in_(ids))
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(
            Organization.id, Organization.parent_id, (cte.c.depth + 1).label("depth")
        ).where(
            Organization.id == cte.c.parent_id,
            cte.c.depth < MAX_TREE_DEPTH,
        )
    )
    return select(cte.c.id).where(cte.c.parent_id.is_(None))


async def root_ids_of(db: AsyncSession, node_ids) -> list[int]:
    """The distinct company roots the given nodes roll up to (order-stable)."""
    ids = list(node_ids)
    if not ids:
        return []
    rows = (await db.execute(roots_subquery_multi(ids))).scalars().all()
    # De-dup while preserving first-seen order so callers get a stable scope.
    seen: dict[int, None] = {}
    for r in rows:
        seen.setdefault(r, None)
    return list(seen)


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
    base = select(
        Organization.id, Organization.parent_id, literal(0).label("depth")
    ).where(Organization.id == node_id)
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(
            Organization.id, Organization.parent_id, (cte.c.depth + 1).label("depth")
        ).where(
            Organization.id == cte.c.parent_id,
            cte.c.depth < MAX_TREE_DEPTH,
        )
    )
    return (
        await db.execute(select(cte.c.id).where(cte.c.parent_id.is_(None)))
    ).scalar_one_or_none()


async def ancestor_chain(
    db: AsyncSession, node_id: int, *, include_self: bool = False
) -> list[Organization]:
    """Ancestors of ``node_id`` ordered root → … → parent (and node if asked)."""
    base = select(
        Organization.id, Organization.parent_id, literal(0).label("depth")
    ).where(Organization.id == node_id)
    cte = base.cte(recursive=True)
    cte = cte.union_all(
        select(
            Organization.id, Organization.parent_id, (cte.c.depth + 1).label("depth")
        ).where(
            Organization.id == cte.c.parent_id,
            cte.c.depth < MAX_TREE_DEPTH,
        )
    )
    ids = [row[0] for row in (await db.execute(select(cte.c.id))).all()]
    if not ids:
        return []
    rows = (await db.execute(select(Organization).where(Organization.id.in_(ids)))).scalars().all()
    by_id = {r.id: r for r in rows}
    # Walk up from the node to assemble the ordered chain. ``seen`` breaks on a
    # revisit so a parent_id cycle terminates instead of looping forever.
    chain: list[Organization] = []
    cursor: int | None = node_id
    seen: set[int] = set()
    while cursor is not None and cursor in by_id and cursor not in seen:
        seen.add(cursor)
        chain.append(by_id[cursor])
        cursor = by_id[cursor].parent_id
    chain.reverse()
    if not include_self and chain:
        chain = chain[:-1]
    return chain
