"""Admin user creation / update (single-company model).

Users are no longer bound to an organization — their tenant is resolved from the
lone active company at request time (see get_tenant_org_id). These cover that
create_user persists an account without an org link and that an admin password
reset establishes a token-revocation baseline.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.users import create_user, update_user
from app.core.errors import PermissionDeniedError, ValidationError
from app.models.organization import Organization
from app.models.user import Role, User
from app.schemas.users import AdminCreateUserRequest, AdminUpdateUserRequest

_REQUEST = SimpleNamespace(client=None, headers={})


def _org(org_id: int, name: str, code: str) -> Organization:
    # A company root: parent_id NULL marks it as the tenant.
    return Organization(id=org_id, name=name, code=code, node_type="company", parent_id=None)


async def _seed_creator(db, *, role_name: str, org_ids: tuple[int, ...] = ()):
    db.add(_org(1, "Org 1", "ORG1"))
    role = Role(name=role_name, label=role_name)
    db.add(role)
    await db.flush()
    orgs = []
    if org_ids:
        orgs = list(
            (await db.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars()
        )
    creator = User(
        name="Creator",
        email="creator@example.com",
        password="not-a-real-hash",
        auth_provider="local",
        is_active=True,
    )
    creator.roles = [role]
    # Set on the still-transient creator so it doesn't lazy-load the collection.
    creator.organizations = orgs
    db.add(creator)
    await db.flush()
    return creator


def _body(**overrides) -> AdminCreateUserRequest:
    payload = {"name": "New User", "email": "new@example.com", "password": "password123"}
    payload.update(overrides)
    return AdminCreateUserRequest(**payload)


async def test_create_user_persists_without_organization(db_session):
    creator = await _seed_creator(db_session, role_name="super_admin")
    out = await create_user(_body(), _REQUEST, db_session, creator, org_id=1)
    assert out.email == "new@example.com"
    # The per-user organization link was removed from the model and response.
    assert not hasattr(out, "organization_id")


async def test_create_user_assigns_organizations(db_session):
    creator = await _seed_creator(db_session, role_name="super_admin")  # adds org id=1
    db_session.add(_org(2, "Org 2", "ORG2"))
    await db_session.flush()
    out = await create_user(
        _body(organization_ids=[1, 2]), _REQUEST, db_session, creator, org_id=1
    )
    assert {o.id for o in out.organizations} == {1, 2}


async def test_super_admin_can_grant_a_sub_node(db_session):
    creator = await _seed_creator(db_session, role_name="super_admin")  # adds root org id=1
    sub = Organization(name="Dept", code="DEPT", node_type="department", parent_id=1)
    db_session.add(sub)
    await db_session.flush()
    # A sub-unit is now grantable (sub-tree access); a super admin may grant any.
    out = await create_user(
        _body(organization_ids=[sub.id]), _REQUEST, db_session, creator, org_id=1
    )
    assert {o.id for o in out.organizations} == {sub.id}


async def test_assign_rejects_unknown_org(db_session):
    creator = await _seed_creator(db_session, role_name="super_admin")
    with pytest.raises(ValidationError):
        await create_user(
            _body(organization_ids=[9999]), _REQUEST, db_session, creator, org_id=1
        )


async def test_non_super_admin_cannot_grant_unassigned_org(db_session):
    # creator is an org_admin assigned only to org 1 (a separate root).
    creator = await _seed_creator(db_session, role_name="org_admin", org_ids=(1,))
    db_session.add(_org(2, "Org 2", "ORG2"))
    await db_session.flush()
    with pytest.raises(PermissionDeniedError):
        await create_user(
            _body(organization_ids=[2]), _REQUEST, db_session, creator, org_id=1
        )


async def test_non_super_admin_can_grant_node_within_own_subtree(db_session):
    # org_admin assigned to org 1 may delegate a sub-unit inside org 1's tree…
    creator = await _seed_creator(db_session, role_name="org_admin", org_ids=(1,))
    sub = Organization(name="Dept", code="DEPT", node_type="department", parent_id=1)
    db_session.add(sub)
    await db_session.flush()
    out = await create_user(
        _body(organization_ids=[sub.id]), _REQUEST, db_session, creator, org_id=1
    )
    assert {o.id for o in out.organizations} == {sub.id}


async def test_non_super_admin_cannot_grant_sibling_subtree_node(db_session):
    # …but not a sub-unit of a DIFFERENT company they don't hold (no escalation).
    creator = await _seed_creator(db_session, role_name="org_admin", org_ids=(1,))
    db_session.add(_org(2, "Org 2", "ORG2"))
    await db_session.flush()
    foreign = Organization(name="Dept2", code="DEPT2", node_type="department", parent_id=2)
    db_session.add(foreign)
    await db_session.flush()
    with pytest.raises(PermissionDeniedError):
        await create_user(
            _body(organization_ids=[foreign.id]), _REQUEST, db_session, creator, org_id=1
        )


async def test_admin_password_reset_bumps_revocation_stamp(db_session):
    # An admin password reset must establish a revocation baseline so the
    # target's existing JWTs (pwd_at older / absent) are rejected afterwards.
    creator = await _seed_creator(db_session, role_name="super_admin")
    target = User(
        name="Target",
        email="target@example.com",
        password="old-hash",
        auth_provider="local",
        is_active=True,
    )
    db_session.add(target)
    await db_session.flush()
    assert target.password_changed_at is None

    await update_user(
        target.id,
        AdminUpdateUserRequest(password="new-password-123"),
        _REQUEST,
        db_session,
        creator,
        org_id=1,
    )
    assert target.password_changed_at is not None
    assert target.password != "old-hash"
