"""Granular org-node access on a real tree.

A user may be granted any node in the org tree. For the EMPLOYEE directory the
boundary is the granted nodes' sub-trees (a sub-unit grant sees only that unit);
for company-root-keyed access the grant rolls up to its company. Exercises
``get_tenant_scope`` / ``get_tenant_node_scope`` / ``get_tenant_org_id`` and the
employee list + write guards end-to-end against the DB fixture.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.employees import create_employee, list_employees, update_employee
from app.core.dependencies import (
    get_tenant_node_scope,
    get_tenant_org_id,
    get_tenant_scope,
)
from app.core.errors import ValidationError
from app.core.pagination import PaginationParams
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeUpdate
from app.schemas.organization import OrganizationCreate, OrgNodeCreate
from app.services import organization_service as svc

_REQUEST = SimpleNamespace(client=None, headers={})


def _request(headers=None):
    return SimpleNamespace(headers=headers or {}, client=None)


def _user(node_ids):
    """A non-super-admin granted the given org-tree node ids."""
    return SimpleNamespace(
        id=1,
        organizations=[SimpleNamespace(id=i) for i in node_ids],
        has_role=lambda _role: False,
    )


async def _root(db, name, code):
    return await svc.create_organization(
        db, OrganizationCreate(name=name, code=code), is_super_admin=True
    )


async def _node(db, parent_id, name, code):
    return await svc.create_node(
        db, None, OrgNodeCreate(parent_id=parent_id, name=name, code=code, node_type="department")
    )


async def _emp(db, org_id, code):
    e = Employee(organization_id=org_id, employee_code=code, first_name="T", last_name="P")
    db.add(e)
    await db.flush()
    return e


async def test_subnode_grant_root_rolls_up_nodes_stay_granular(db_session):
    company = await _root(db_session, "Hotel Group", "HG")
    region = await _node(db_session, company.id, "W.P Kuala Lumpur", "WPKL")
    four_points = await _node(db_session, region.id, "Four Points", "FP")
    await _node(db_session, four_points.id, "Lady Yi's", "LY")

    user = _user([four_points.id])
    roots = await get_tenant_scope(_request(), user, db_session)
    nodes = await get_tenant_node_scope(_request(), user, db_session)
    active = await get_tenant_org_id(_request(), user, db_session)

    assert roots == [company.id]       # root-keyed access → the whole company
    assert nodes == [four_points.id]   # employee access → the granted sub-unit
    assert active == company.id        # the single active org for writes


async def test_employee_directory_is_subtree_only(db_session):
    company = await _root(db_session, "Hotel Group", "HG")
    region = await _node(db_session, company.id, "Region", "RG")
    four_points = await _node(db_session, region.id, "Four Points", "FP")
    lady_yi = await _node(db_session, four_points.id, "Lady Yi's", "LY")
    jw = await _node(db_session, region.id, "JW Marriott", "JW")

    await _emp(db_session, four_points.id, "FP1")
    await _emp(db_session, lady_yi.id, "LY1")   # inside the granted sub-tree
    await _emp(db_session, jw.id, "JW1")        # sibling hotel — must be hidden
    await _emp(db_session, company.id, "HQ1")   # company HQ — must be hidden

    user = _user([four_points.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)
    out = await list_employees(db_session, user, node_scope, PaginationParams(page=1, per_page=50))
    assert {e.employee_code for e in out.data} == {"FP1", "LY1"}


async def test_multi_node_grant_unions_subtrees(db_session):
    company = await _root(db_session, "HG", "HG")
    region = await _node(db_session, company.id, "Region", "RG")
    a = await _node(db_session, region.id, "A", "A")
    b = await _node(db_session, region.id, "B", "B")
    c = await _node(db_session, region.id, "C", "C")
    await _emp(db_session, a.id, "A1")
    await _emp(db_session, b.id, "B1")
    await _emp(db_session, c.id, "C1")

    user = _user([a.id, b.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)
    out = await list_employees(db_session, user, node_scope, PaginationParams(page=1, per_page=50))
    assert {e.employee_code for e in out.data} == {"A1", "B1"}


async def test_create_employee_blocked_outside_granted_subtree(db_session):
    company = await _root(db_session, "HG", "HG")
    region = await _node(db_session, company.id, "Region", "RG")
    a = await _node(db_session, region.id, "A", "A")
    b = await _node(db_session, region.id, "B", "B")  # sibling the user does NOT hold

    user = _user([a.id])
    org_id = await get_tenant_org_id(_request(), user, db_session)        # = company root
    node_scope = await get_tenant_node_scope(_request(), user, db_session)  # = [a]

    # Same company, but a sibling unit outside the grant → rejected.
    with pytest.raises(ValidationError):
        await create_employee(
            EmployeeCreate(employee_code="X1", first_name="X", last_name="Y", organization_id=b.id),
            _REQUEST, db_session, org_id, node_scope, user,
        )

    # Into the granted unit → allowed.
    ok = await create_employee(
        EmployeeCreate(employee_code="X2", first_name="X", last_name="Y", organization_id=a.id),
        _REQUEST, db_session, org_id, node_scope, user,
    )
    assert ok.organization_id == a.id


async def test_update_cannot_move_employee_outside_granted_subtree(db_session):
    company = await _root(db_session, "HG", "HG")
    region = await _node(db_session, company.id, "Region", "RG")
    a = await _node(db_session, region.id, "A", "A")
    b = await _node(db_session, region.id, "B", "B")
    emp = await _emp(db_session, a.id, "E1")

    user = _user([a.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)

    with pytest.raises(ValidationError):
        await update_employee(
            emp.id, EmployeeUpdate(organization_id=b.id), _REQUEST, db_session, node_scope, user
        )


async def test_get_employee_outside_subtree_is_404(db_session):
    from app.core.errors import NotFoundError
    from app.api.employees import get_employee

    company = await _root(db_session, "HG", "HG")
    region = await _node(db_session, company.id, "Region", "RG")
    a = await _node(db_session, region.id, "A", "A")
    b = await _node(db_session, region.id, "B", "B")
    outsider = await _emp(db_session, b.id, "OUT")

    user = _user([a.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)
    with pytest.raises(NotFoundError):
        await get_employee(outsider.id, db_session, user, node_scope)
