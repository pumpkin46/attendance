"""Node-granular scoping for the privacy erase endpoint.

``POST /employees/{id}/privacy/erase`` is purely employee-keyed, so a sub-unit
admin must only be able to erase employees inside their granted sub-tree. The
endpoint takes the NODE scope (``get_tenant_node_scope``); a grant of a sibling
hotel must not reach an employee under another hotel. Builds a real
company > region > hotelA/hotelB tree against the DB fixture and exercises
``erase_employee_data`` directly.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.privacy import erase_employee_data
from app.core.dependencies import get_tenant_node_scope
from app.core.errors import NotFoundError
from app.models.employee import Employee
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


async def _tree(db):
    company = await _root(db, "Hotel Group", "HG")
    region = await _node(db, company.id, "Region", "RG")
    hotel_a = await _node(db, region.id, "Hotel A", "HA")
    hotel_b = await _node(db, region.id, "Hotel B", "HB")
    emp = await _emp(db, hotel_b.id, "HB1")  # employee lives under hotel B
    return company, region, hotel_a, hotel_b, emp


async def test_erase_blocked_for_sibling_node_grant(db_session, temp_faiss_paths):
    """A grant on hotelA must not reach an employee under hotelB → 404."""
    _company, _region, hotel_a, _hotel_b, emp = await _tree(db_session)

    user = _user([hotel_a.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)

    with pytest.raises(NotFoundError):
        await erase_employee_data(emp.id, _REQUEST, db_session, node_scope, user)


async def test_erase_succeeds_within_granted_node(db_session, temp_faiss_paths):
    """A grant on hotelB reaches its own employee and erases the PII."""
    _company, _region, _hotel_a, hotel_b, emp = await _tree(db_session)

    user = _user([hotel_b.id])
    node_scope = await get_tenant_node_scope(_request(), user, db_session)

    out = await erase_employee_data(emp.id, _REQUEST, db_session, node_scope, user)
    assert out.success is True

    refreshed = await db_session.get(Employee, emp.id)
    assert refreshed.first_name == "ERASED"
    assert refreshed.last_name == "ERASED"
    assert refreshed.email is None
    assert refreshed.is_active is False
