"""Org-tree service: hierarchy, tenant isolation, and node mutation guards
(cycle / delete-block). The tree is a structural parent_id adjacency list;
members link to the company via organization_id only (no per-node assignment).
depth/path/root_organization_id are computed on the response.
"""

from __future__ import annotations

import pytest

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.employee import Employee
from app.schemas.organization import (
    OrganizationCreate,
    OrgNodeCreate,
    OrgNodeMove,
    OrgNodeUpdate,
)
from app.services import organization_service as svc
from app.api.employees import list_employees
from app.core.pagination import PaginationParams

# tenant_org_id None == a global super admin (no tenant filter) while building.
GLOBAL = None


async def _root(db, name, code):
    return await svc.create_organization(db, OrganizationCreate(name=name, code=code), is_super_admin=True)


async def _node(db, parent, name, code, node_type="department"):
    # Returns an OrgNodeOut (with computed depth/path/root_organization_id).
    return await svc.create_node(
        db, GLOBAL, OrgNodeCreate(parent_id=parent.id, name=name, code=code, node_type=node_type)
    )


async def _employee(db, *, root_id, code):
    emp = Employee(organization_id=root_id, employee_code=code, first_name="T", last_name="P")
    db.add(emp)
    await db.flush()
    return emp


# ── Structure ─────────────────────────────────────────────────────────────────


async def test_create_organization_is_a_root(db_session):
    org = await _root(db_session, "Acme", "ACME")
    assert org.parent_id is None
    assert org.node_type == "company"


async def test_duplicate_root_code_rejected_at_db_level(db_session):
    # Partial unique index (parent_id IS NULL) makes the DB — not just the
    # race-prone app check — the source of truth for company-code uniqueness.
    from sqlalchemy.exc import IntegrityError

    from app.models.organization import Organization

    db_session.add(Organization(name="A", code="DUP", parent_id=None))
    await db_session.flush()
    db_session.add(Organization(name="B", code="DUP", parent_id=None))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_create_node_computes_path_and_depth(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    backend = await _node(db_session, tech, "Backend", "BACKEND", node_type="team")

    assert tech.parent_id == org.id and tech.depth == 1
    assert tech.path == f"/{org.id}/{tech.id}/"
    assert tech.root_organization_id == org.id
    assert backend.depth == 2
    assert backend.path == f"/{org.id}/{tech.id}/{backend.id}/"


async def test_sibling_code_must_be_unique(db_session):
    org = await _root(db_session, "Acme", "ACME")
    await _node(db_session, org, "Technology", "DUP")
    with pytest.raises(ConflictError):
        await _node(db_session, org, "Other", "DUP")


async def test_same_code_allowed_under_different_parents(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    fin = await _node(db_session, org, "Finance", "FIN")
    await _node(db_session, tech, "Team A", "TEAM")
    await _node(db_session, fin, "Team B", "TEAM")


# ── Tree assembly ──────────────────────────────────────────────────────────


async def test_get_tree_nests(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    backend = await _node(db_session, tech, "Backend", "BACKEND", node_type="team")

    tree = await svc.get_tree(db_session, org.id)
    assert len(tree) == 1
    root_out = tree[0]
    assert root_out.id == org.id and root_out.depth == 0
    assert root_out.children[0].id == tech.id
    assert root_out.children[0].children[0].id == backend.id


# ── Cross-tenant isolation ────────────────────────────────────────────────────


async def test_tenant_tree_excludes_other_company(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    await _node(db_session, a, "A-Dept", "AD")
    b_dept = await _node(db_session, b, "B-Dept", "BD")

    a_tree = await svc.get_tree(db_session, a.id)
    a_ids = {a_tree[0].id, *(c.id for c in a_tree[0].children)}
    assert b_dept.id not in a_ids

    # A node mutation scoped to tenant A cannot reach tenant B's node.
    with pytest.raises(NotFoundError):
        await svc.update_node(db_session, a.id, b_dept.id, OrgNodeUpdate(name="X"))


# ── Move: cycle guard + reparent ──────────────────────────────────────────────


async def test_move_into_own_descendant_is_rejected(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    backend = await _node(db_session, tech, "Backend", "BACKEND", node_type="team")
    with pytest.raises(ValidationError):
        await svc.move_node(db_session, GLOBAL, tech.id, OrgNodeMove(new_parent_id=backend.id))


async def test_move_reparents_whole_subtree(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    backend = await _node(db_session, tech, "Backend", "BACKEND", node_type="team")
    api = await _node(db_session, backend, "API", "API", node_type="team")
    finance = await _node(db_session, org, "Finance", "FIN")

    moved = await svc.move_node(db_session, GLOBAL, backend.id, OrgNodeMove(new_parent_id=finance.id))
    assert moved.parent_id == finance.id
    assert moved.depth == 2
    assert moved.path == f"/{org.id}/{finance.id}/{backend.id}/"

    api_detail = await svc.get_node(db_session, GLOBAL, api.id)
    assert api_detail.depth == 3
    assert api_detail.path == f"/{org.id}/{finance.id}/{backend.id}/{api.id}/"


async def test_cannot_move_company_root(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    with pytest.raises(ValidationError):
        await svc.move_node(db_session, GLOBAL, org.id, OrgNodeMove(new_parent_id=tech.id))


# ── Delete: block-if-non-empty ────────────────────────────────────────────────


async def test_delete_blocks_with_child_node(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    await _node(db_session, tech, "Backend", "BACKEND", node_type="team")
    with pytest.raises(ConflictError):
        await svc.delete_node(db_session, GLOBAL, tech.id)


async def test_delete_empty_leaf_succeeds(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    leaf = await _node(db_session, tech, "Backend", "BACKEND", node_type="team")
    await svc.delete_node(db_session, GLOBAL, leaf.id)
    await svc.delete_node(db_session, GLOBAL, tech.id)


async def test_cannot_delete_company_root_via_node_endpoint(db_session):
    org = await _root(db_session, "Acme", "ACME")
    with pytest.raises(ValidationError):
        await svc.delete_node(db_session, GLOBAL, org.id)


# ── Organization list counts ──────────────────────────────────────────────────


async def test_list_organizations_counts_nodes_and_employees(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    await _node(db_session, tech, "Backend", "BACKEND", node_type="team")
    await _employee(db_session, root_id=org.id, code="E1")

    rows = await svc.list_organizations(db_session, scope=[org.id])
    assert len(rows) == 1
    assert rows[0].nodes_count == 2          # Technology + Backend
    assert rows[0].employees_count == 1


# ── Endpoint-level tenant filtering (guards the apply_tenant_filter wiring) ────


async def test_list_employees_endpoint_respects_tenant(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    await _employee(db_session, root_id=a.id, code="A1")
    await _employee(db_session, root_id=b.id, code="B1")

    pag = PaginationParams(page=1, per_page=50)
    scoped = await list_employees(db_session, None, a.id, pag)
    assert {e.employee_code for e in scoped.data} == {"A1"}
