"""Employee org-node assignment + sub-tree tenant scoping.

`employees.organization_id` may now point at ANY node in the company tree (the
directory placement), not just the company root. The tenant boundary therefore
became sub-tree membership. These tests pin the security-critical behaviours:
cross-tenant isolation still holds, sub-node employees stay visible to their
company, the directory filter narrows by sub-tree, counts roll up, the
org-node delete guard protects against the CASCADE FK, and create/update
validate the chosen node against the caller's tenant.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.employees import (
    _resolve_employee_org,
    create_employee,
    employee_counts_by_org_node,
    list_employees,
    update_employee,
)
from app.core.errors import ConflictError, ValidationError
from app.core.pagination import PaginationParams
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeUpdate
from app.schemas.organization import OrganizationCreate, OrgNodeCreate
from app.services import organization_service as svc
from app.services.recognition_service import authorize_match

GLOBAL = None


async def _root(db, name, code):
    return await svc.create_organization(
        db, OrganizationCreate(name=name, code=code), is_super_admin=True
    )


async def _node(db, parent, name, code, node_type="department"):
    return await svc.create_node(
        db, GLOBAL, OrgNodeCreate(parent_id=parent.id, name=name, code=code, node_type=node_type)
    )


async def _emp(db, *, org_id, code, active=True):
    emp = Employee(
        organization_id=org_id,
        employee_code=code,
        first_name="T",
        last_name="P",
        is_active=active,
    )
    db.add(emp)
    await db.flush()
    await db.refresh(emp)
    return emp


def _pag():
    return PaginationParams(page=1, per_page=50)


# ── List scoping: sub-tree membership ─────────────────────────────────────────


async def test_subnode_employee_visible_to_company_root(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    await _emp(db_session, org_id=org.id, code="ROOT1")
    await _emp(db_session, org_id=tech.id, code="SUB1")

    # Querying the company root returns employees on the root AND its sub-nodes.
    res = await list_employees(db_session, None, org.id, _pag())
    assert {e.employee_code for e in res.data} == {"ROOT1", "SUB1"}


async def test_org_node_filter_narrows_to_subtree(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    backend = await _node(db_session, tech, "Backend", "BE", node_type="team")
    finance = await _node(db_session, org, "Finance", "FIN")
    await _emp(db_session, org_id=tech.id, code="TECH1")
    await _emp(db_session, org_id=backend.id, code="BE1")
    await _emp(db_session, org_id=finance.id, code="FIN1")

    # Selecting Technology includes Backend (its descendant) but not Finance.
    res = await list_employees(db_session, None, org.id, _pag(), org_node_id=tech.id)
    assert {e.employee_code for e in res.data} == {"TECH1", "BE1"}

    res_leaf = await list_employees(db_session, None, org.id, _pag(), org_node_id=backend.id)
    assert {e.employee_code for e in res_leaf.data} == {"BE1"}


async def test_list_employees_union_scope(db_session):
    # A multi-org user (scope = a list of company roots) sees the UNION.
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    c = await _root(db_session, "Gamma", "GAMMA")
    a_tech = await _node(db_session, a, "Tech", "TECH")
    await _emp(db_session, org_id=a.id, code="A1")
    await _emp(db_session, org_id=a_tech.id, code="A2")  # sub-node of A
    await _emp(db_session, org_id=b.id, code="B1")
    await _emp(db_session, org_id=c.id, code="C1")

    res = await list_employees(db_session, None, [a.id, b.id], _pag())
    # A (incl. its sub-tree) + B, but not C.
    assert {e.employee_code for e in res.data} == {"A1", "A2", "B1"}


async def test_cross_tenant_subnode_employee_hidden(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    a_dept = await _node(db_session, a, "A-Dept", "AD")
    b_dept = await _node(db_session, b, "B-Dept", "BD")
    await _emp(db_session, org_id=a_dept.id, code="A1")
    await _emp(db_session, org_id=b_dept.id, code="B1")

    res_a = await list_employees(db_session, None, a.id, _pag())
    assert {e.employee_code for e in res_a.data} == {"A1"}

    # A foreign node id as the filter yields nothing — no cross-tenant read.
    res_foreign = await list_employees(db_session, None, a.id, _pag(), org_node_id=b_dept.id)
    assert res_foreign.data == []


async def test_search_filter(db_session):
    org = await _root(db_session, "Acme", "ACME")
    e = await _emp(db_session, org_id=org.id, code="ZZ9")
    e.first_name = "Alice"
    await db_session.flush()
    await _emp(db_session, org_id=org.id, code="QQ1")

    res = await list_employees(db_session, None, org.id, _pag(), search="alic")
    assert {e.employee_code for e in res.data} == {"ZZ9"}


# ── Counts ────────────────────────────────────────────────────────────────────


async def test_org_node_counts_endpoint_direct_per_node(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    await _emp(db_session, org_id=org.id, code="R1")
    await _emp(db_session, org_id=tech.id, code="T1")
    await _emp(db_session, org_id=tech.id, code="T2")

    counts = await employee_counts_by_org_node(db_session, None, org.id)
    assert counts[org.id] == 1
    assert counts[tech.id] == 2


async def test_list_organizations_counts_rollup_includes_subnodes(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    await _emp(db_session, org_id=org.id, code="R1")
    await _emp(db_session, org_id=tech.id, code="T1")

    rows = await svc.list_organizations(db_session, scope=[org.id])
    assert rows[0].employees_count == 2


# ── delete_node CASCADE guard ─────────────────────────────────────────────────


async def test_delete_node_blocked_when_employees_assigned(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    await _emp(db_session, org_id=tech.id, code="T1")

    # ondelete=CASCADE would hard-delete the employee — the guard must refuse.
    with pytest.raises(ConflictError):
        await svc.delete_node(db_session, GLOBAL, tech.id)


# ── Create/update node validation (IDOR) ──────────────────────────────────────


async def test_resolve_employee_org_defaults_to_root(db_session):
    org = await _root(db_session, "Acme", "ACME")
    node_id, root_id = await _resolve_employee_org(db_session, org.id, None)
    assert node_id == org.id and root_id == org.id


async def test_resolve_employee_org_accepts_in_tenant_node(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    node_id, root_id = await _resolve_employee_org(db_session, org.id, tech.id)
    assert node_id == tech.id and root_id == org.id


async def test_resolve_employee_org_rejects_foreign_node(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    b_dept = await _node(db_session, b, "B-Dept", "BD")
    with pytest.raises(ValidationError):
        await _resolve_employee_org(db_session, a.id, b_dept.id)


def _req():
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))


def _user():
    return SimpleNamespace(id=1)


async def test_create_employee_assigns_subnode(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    out = await create_employee(
        EmployeeCreate(employee_code="E1", first_name="A", last_name="B", organization_id=tech.id),
        _req(),
        db_session,
        org.id,
        None,  # node_scope: global here — org_id drives the company IDOR check
        _user(),
    )
    assert out.organization_id == tech.id


async def test_create_employee_rejects_foreign_node(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    b_dept = await _node(db_session, b, "B-Dept", "BD")
    with pytest.raises(ValidationError):
        await create_employee(
            EmployeeCreate(
                employee_code="E1", first_name="A", last_name="B", organization_id=b_dept.id
            ),
            _req(),
            db_session,
            a.id,
            None,  # node_scope
            _user(),
        )


async def test_update_employee_reassigns_within_tenant(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    emp = await _emp(db_session, org_id=org.id, code="E1")

    out = await update_employee(
        emp.id, EmployeeUpdate(organization_id=tech.id), _req(), db_session, org.id, _user()
    )
    assert out.organization_id == tech.id


async def test_update_employee_rejects_cross_company_move(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    b_dept = await _node(db_session, b, "B-Dept", "BD")
    emp = await _emp(db_session, org_id=a.id, code="E1")

    # Super admin (org_id None) still cannot move an employee to another company.
    with pytest.raises(ValidationError):
        await update_employee(
            emp.id, EmployeeUpdate(organization_id=b_dept.id), _req(), db_session, GLOBAL, _user()
        )


# ── Recognition gate (authorize_match) ────────────────────────────────────────


async def test_authorize_match_allows_subnode_employee(db_session):
    org = await _root(db_session, "Acme", "ACME")
    tech = await _node(db_session, org, "Technology", "TECH")
    emp = await _emp(db_session, org_id=tech.id, code="E1")

    # A camera in the company (org root context) recognizes a sub-node employee.
    row = await authorize_match(db_session, str(emp.id), org.id)
    assert row is not None and row.id == emp.id


async def test_authorize_match_rejects_cross_tenant(db_session):
    a = await _root(db_session, "Acme", "ACME")
    b = await _root(db_session, "Beta", "BETA")
    b_dept = await _node(db_session, b, "B-Dept", "BD")
    emp = await _emp(db_session, org_id=b_dept.id, code="B1")

    # Tenant A's camera must not resolve tenant B's employee.
    assert await authorize_match(db_session, str(emp.id), a.id) is None
