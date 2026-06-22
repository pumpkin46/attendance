"""Node-granular tenant scoping for RFID employee-keyed operations.

The RFID card endpoints (list/add/revoke) and ``_employee_in_tenant_or_404``
resolve the target EMPLOYEE, so a sub-unit admin must only reach employees
inside their granted sub-tree. These sites take the NODE scope
(``get_tenant_node_scope``): a grant of a sibling hotel must not resolve an
employee under another hotel, even though both hotels share the same company
root (which still gates the root-keyed reader CRUD — unchanged here).

Builds a real company > region > hotelA/hotelB tree against the DB fixture and
exercises ``_employee_in_tenant_or_404`` directly. The company root is passed as
``org_id`` (what the endpoint carries) while ``node_scope`` carries the grant, so
the test mirrors exactly how the endpoint threads the two scopes.
"""

from __future__ import annotations

import pytest

from app.core.errors import NotFoundError
from app.models.employee import Employee
from app.schemas.organization import OrganizationCreate, OrgNodeCreate
from app.services import organization_service as svc
from app.services.rfid_service import _employee_in_tenant_or_404


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
    await db.refresh(e)
    return e


async def _tree(db):
    company = await _root(db, "Hotel Group", "HG")
    region = await _node(db, company.id, "Region", "RG")
    hotel_a = await _node(db, region.id, "Hotel A", "HA")
    hotel_b = await _node(db, region.id, "Hotel B", "HB")
    emp = await _emp(db, hotel_b.id, "HB1")  # employee lives under hotel B
    return company, region, hotel_a, hotel_b, emp


async def test_employee_lookup_blocked_for_sibling_node_grant(db_session):
    """A grant on hotelA must not resolve an employee under hotelB -> 404."""
    company, _region, hotel_a, _hotel_b, emp = await _tree(db_session)

    # org_id = the company root (what the endpoint carries); node_scope narrows
    # to the sibling hotel A, which does NOT contain the hotel-B employee.
    with pytest.raises(NotFoundError):
        await _employee_in_tenant_or_404(
            db_session, emp.id, company.id, node_scope=[hotel_a.id]
        )


async def test_employee_lookup_succeeds_within_granted_node(db_session):
    """A grant on hotelB resolves its own employee."""
    company, _region, _hotel_a, hotel_b, emp = await _tree(db_session)

    found = await _employee_in_tenant_or_404(
        db_session, emp.id, company.id, node_scope=[hotel_b.id]
    )
    assert found.id == emp.id


async def test_employee_lookup_succeeds_within_company_when_no_node_scope(db_session):
    """node_scope=None falls back to org_id (the company root), which still
    reaches a sub-node employee — the company-wide behaviour is preserved."""
    company, _region, _hotel_a, _hotel_b, emp = await _tree(db_session)

    found = await _employee_in_tenant_or_404(
        db_session, emp.id, company.id, node_scope=None
    )
    assert found.id == emp.id


async def test_employee_lookup_blocked_for_sibling_node_even_via_company_org_id(db_session):
    """The node scope, not org_id, decides: even though org_id is the company
    root (which contains the employee), a hotelA grant still yields 404 because
    the node scope takes precedence for the employee filter."""
    company, _region, hotel_a, _hotel_b, emp = await _tree(db_session)

    with pytest.raises(NotFoundError):
        # Company root as org_id would match on its own, but node_scope=[hotelA]
        # overrides it for the employee filter.
        await _employee_in_tenant_or_404(
            db_session, emp.id, company.id, node_scope=[hotel_a.id]
        )
