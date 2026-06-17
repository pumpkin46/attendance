"""Direct tests for the multi-tenant boundary (get_tenant_org_id + ws identity).

Every other API test mocks these out; here they are exercised directly so the
actual isolation logic is covered.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.api.ws as ws_mod
from app.core.config import settings
from app.core.dependencies import get_tenant_org_id


class _Scalar:
    def __init__(self, value):
        self._value = value


class _OrgSession:
    """Stands in for the DB: org existence + single-org lookups."""

    def __init__(self, existing_org_ids: list[int]):
        self._existing = existing_org_ids

    async def scalar(self, stmt):
        # Used by single-row lookups; return the id if known.
        return self._existing[0] if self._existing else None

    async def execute(self, stmt):
        existing = list(self._existing)
        # Supports both get_single_org_id (.scalars().all()) and root_id_of
        # (.scalar_one_or_none()), which is the recursive root-of-node walk.
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: existing),
            scalar_one_or_none=lambda: (existing[0] if existing else None),
        )


def _user(*, super_admin: bool, org_id):
    return SimpleNamespace(
        id=7,
        organization_id=org_id,
        has_role=lambda role: super_admin and role == settings.super_admin_role,
    )


def _request(headers=None):
    return SimpleNamespace(headers=headers or {})


class TestNonSuperAdmin:
    @pytest.mark.asyncio
    async def test_uses_own_org_ignoring_header(self):
        user = _user(super_admin=False, org_id=5)
        # Even if a header claims org 9, a normal user is pinned to their org.
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "9"}), user, db=_OrgSession([5, 9])
        )
        assert result == 5

    @pytest.mark.asyncio
    async def test_org_none_is_rejected(self):
        # None = validated global scope, reserved for super admins. A tenant
        # user without an org must not inherit it (apply_tenant_filter is a
        # no-op on None, so passing it through would expose every tenant).
        user = _user(super_admin=False, org_id=None)
        with pytest.raises(HTTPException) as exc:
            await get_tenant_org_id(_request(), user, db=_OrgSession([1]))
        assert exc.value.status_code == 403
        assert exc.value.detail == "Your account is not assigned to an organization"


class TestSuperAdmin:
    @pytest.mark.asyncio
    async def test_header_scopes_to_requested_org(self):
        user = _user(super_admin=True, org_id=None)
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "3"}), user, db=_OrgSession([3])
        )
        assert result == 3

    @pytest.mark.asyncio
    async def test_unknown_org_header_falls_back(self):
        # A stale selection (the org was deleted) must not brick every request:
        # fall back to the single-org / global scope rather than 400. Here no
        # org exists, so the fallback yields global scope (None).
        user = _user(super_admin=True, org_id=None)
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "999"}), user, db=_OrgSession([])
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_non_integer_header_falls_back(self):
        # A garbage header degrades to the no-header behaviour instead of 400 —
        # with exactly one org, that single org.
        user = _user(super_admin=True, org_id=None)
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "abc"}), user, db=_OrgSession([1])
        )
        assert result == 1

    @pytest.mark.asyncio
    async def test_no_header_falls_back_to_single_org(self):
        user = _user(super_admin=True, org_id=None)
        # Exactly one active org -> super admin acts on it without a header.
        result = await get_tenant_org_id(_request(), user, db=_OrgSession([42]))
        assert result == 42

    @pytest.mark.asyncio
    async def test_no_header_multiple_orgs_is_none(self):
        user = _user(super_admin=True, org_id=None)
        result = await get_tenant_org_id(_request(), user, db=_OrgSession([1, 2]))
        assert result is None


class _UserSession:
    """Stands in for the ws session factory: yields itself, returns one user."""

    def __init__(self, user):
        self._user = user

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, stmt):
        user = self._user
        return SimpleNamespace(scalar_one_or_none=lambda: user)


@pytest.fixture
def ws_identity(monkeypatch):
    """Patch the ws module's collaborators so _resolve_identity runs on fakes."""

    def setup(user, single_org=None):
        monkeypatch.setattr(ws_mod, "decode_access_token", lambda _tok: {"sub": str(user.id)})
        monkeypatch.setattr(ws_mod, "async_session_factory", lambda: _UserSession(user))

        async def fake_single_org(_db):
            return single_org

        monkeypatch.setattr(ws_mod, "get_single_org_id", fake_single_org)

    return setup


class TestWsResolveIdentity:
    """The WebSocket path must mirror get_tenant_org_id's tenancy rules."""

    @pytest.mark.asyncio
    async def test_tenant_user_pinned_to_own_org(self, ws_identity):
        user = _user(super_admin=False, org_id=5)
        ws_identity(user)
        # The ?org= param is super-admin only; a tenant user keeps their org.
        assert await ws_mod._resolve_identity("tok", "9") == (7, 5)

    @pytest.mark.asyncio
    async def test_orphan_tenant_user_rejected(self, ws_identity):
        # The hub treats org_id=None as global scope (every tenant's events),
        # so an org-less tenant user must be refused like an invalid token.
        user = _user(super_admin=False, org_id=None)
        ws_identity(user)
        assert await ws_mod._resolve_identity("tok", None) is None

    @pytest.mark.asyncio
    async def test_super_admin_scopes_via_org_param(self, ws_identity):
        user = _user(super_admin=True, org_id=None)
        ws_identity(user)
        assert await ws_mod._resolve_identity("tok", "3") == (7, 3)

    @pytest.mark.asyncio
    async def test_super_admin_without_param_falls_back_to_single_org(self, ws_identity):
        user = _user(super_admin=True, org_id=None)
        ws_identity(user, single_org=42)
        assert await ws_mod._resolve_identity("tok", None) == (7, 42)

    @pytest.mark.asyncio
    async def test_super_admin_keeps_global_scope_with_multiple_orgs(self, ws_identity):
        user = _user(super_admin=True, org_id=None)
        ws_identity(user, single_org=None)
        assert await ws_mod._resolve_identity("tok", None) == (7, None)
