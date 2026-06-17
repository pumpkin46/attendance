"""Admin user creation: organization defaulting.

A super admin's new users must never be created org-less (accounts with no
organization cannot use tenant-scoped endpoints, which return 403 for them).
When the request body omits organization_id, the tenant context resolved by
TenantOrgId (the selected tenant header, or the single active org) is used.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.api.users import create_user
from app.models.organization import Organization
from app.models.user import Role, User
from app.schemas.users import AdminCreateUserRequest

_REQUEST = SimpleNamespace(client=None, headers={})


def _org(org_id: int, name: str, code: str) -> Organization:
    # A company root: parent_id NULL marks it as the tenant.
    return Organization(id=org_id, name=name, code=code, node_type="company", parent_id=None)


async def _seed_creator(db, *, role_name: str, creator_org: int | None):
    db.add(_org(1, "Org 1", "ORG1"))
    role = Role(name=role_name, label=role_name)
    db.add(role)
    creator = User(
        organization_id=creator_org,
        name="Creator",
        email="creator@example.com",
        password="not-a-real-hash",
        auth_provider="local",
        is_active=True,
    )
    creator.roles = [role]
    db.add(creator)
    await db.flush()
    return creator


def _body(**overrides) -> AdminCreateUserRequest:
    payload = {"name": "New User", "email": "new@example.com", "password": "password123"}
    payload.update(overrides)
    return AdminCreateUserRequest(**payload)


async def test_super_admin_create_defaults_to_tenant_org(db_session):
    # The frontend form sends no organization_id; the single-org tenant
    # context (org_id=1) must fill it in instead of leaving the user org-less.
    creator = await _seed_creator(db_session, role_name="super_admin", creator_org=None)
    out = await create_user(_body(), _REQUEST, db_session, creator, org_id=1)
    assert out.organization_id == 1


async def test_super_admin_explicit_org_wins_over_context(db_session):
    creator = await _seed_creator(db_session, role_name="super_admin", creator_org=None)
    db_session.add(_org(2, "Org 2", "ORG2"))
    await db_session.flush()
    out = await create_user(
        _body(organization_id=2), _REQUEST, db_session, creator, org_id=1
    )
    assert out.organization_id == 2


async def test_non_super_creator_always_inherits_own_org(db_session):
    # Org admins cannot place users in another tenant, whatever the body says.
    creator = await _seed_creator(db_session, role_name="org_admin", creator_org=1)
    db_session.add(_org(2, "Org 2", "ORG2"))
    await db_session.flush()
    out = await create_user(
        _body(organization_id=2), _REQUEST, db_session, creator, org_id=1
    )
    assert out.organization_id == 1
