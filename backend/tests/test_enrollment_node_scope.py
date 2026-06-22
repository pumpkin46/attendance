"""Node-granular scoping for the face-enrollment employee lookups.

Every enrollment endpoint (enroll/re-enroll/bulk/face-status/delete) resolves
its target employee through the shared helpers ``_get_employee_or_404`` and
``_get_employee_or_none``, which apply ``apply_employee_tenant_filter`` over the
NODE scope (``get_tenant_node_scope``). A sub-unit admin must therefore only be
able to enroll/manage employees inside their granted sub-tree: a grant of a
sibling hotel must 404 on an employee under another hotel.

The lookup is the smallest callable unit that owns the two
``apply_employee_tenant_filter`` sites, so it is exercised directly here rather
than through the full enroll endpoints (which require image payloads / the FAISS
engine). Builds a real company > region > hotelA/hotelB org-tree against the DB
fixture.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.enrollment import _get_employee_or_404, _get_employee_or_none
from app.core.dependencies import get_tenant_node_scope
from app.core.errors import NotFoundError
from app.models.employee import Employee
from app.schemas.organization import OrganizationCreate, OrgNodeCreate
from app.services import organization_service as svc


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
        db,
        None,
        OrgNodeCreate(parent_id=parent_id, name=name, code=code, node_type="department"),
    )


async def _emp(db, org_id, code):
    e = Employee(organization_id=org_id, employee_code=code, first_name="T", last_name="P")
    db.add(e)
    await db.flush()
    return e


async def _tree(db):
    company = await _root(db, "Hotel Group", "HG")
    region = await _node(db, company.id, "Region", "RG")
    hotel_a = await _node(db, region.id, "Hotel A", "HA")
    hotel_b = await _node(db, region.id, "Hotel B", "HB")
    emp = await _emp(db, hotel_b.id, "HB1")  # employee lives under hotel B
    return company, region, hotel_a, hotel_b, emp


async def test_lookup_404s_for_sibling_node_grant(db_session):
    """A grant on hotelA must not reach an employee under hotelB -> 404."""
    _company, _region, hotel_a, _hotel_b, emp = await _tree(db_session)

    user = _user([hotel_a.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)

    with pytest.raises(NotFoundError):
        await _get_employee_or_404(db_session, emp.id, node_scope)

    # The lenient (bulk-enroll) variant returns None instead of raising.
    assert await _get_employee_or_none(db_session, emp.id, node_scope) is None


async def test_lookup_succeeds_within_granted_node(db_session):
    """A grant on hotelB reaches its own employee."""
    _company, _region, _hotel_a, hotel_b, emp = await _tree(db_session)

    user = _user([hotel_b.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)

    found = await _get_employee_or_404(db_session, emp.id, node_scope)
    assert found.id == emp.id

    found_or_none = await _get_employee_or_none(db_session, emp.id, node_scope)
    assert found_or_none is not None
    assert found_or_none.id == emp.id


async def test_company_root_grant_reaches_descendant_employee(db_session):
    """A grant on the company root still rolls down to a hotelB employee."""
    company, _region, _hotel_a, _hotel_b, emp = await _tree(db_session)

    user = _user([company.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)

    found = await _get_employee_or_404(db_session, emp.id, node_scope)
    assert found.id == emp.id
