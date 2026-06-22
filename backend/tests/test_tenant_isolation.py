"""Direct tests for the multi-tenant boundary.

Covers the two request-scope dependencies (get_tenant_org_id = the single ACTIVE
org for writes; get_tenant_scope = the READ set, the union of a user's assigned
companies) and the WebSocket identity resolver, which mirrors the scope rules.
Every other API test mocks these out; here they run on fakes so the actual
isolation logic is exercised.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.api.ws as ws_mod
from app.core.config import settings
from app.core.dependencies import (
    get_tenant_node_scope,
    get_tenant_org_id,
    get_tenant_scope,
)


class _OrgSession:
    """Stands in for the DB: org existence + single-org / root lookups.

    root_id_of() and get_single_org_id() both reduce to the same fake rows here.
    """

    def __init__(self, existing_org_ids: list[int]):
        self._existing = existing_org_ids

    async def scalar(self, stmt):
        return self._existing[0] if self._existing else None

    async def execute(self, stmt):
        existing = list(self._existing)
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: existing),
            scalar_one_or_none=lambda: (existing[0] if existing else None),
        )


def _user(*, super_admin: bool, org_ids: tuple[int, ...] = ()):
    return SimpleNamespace(
        id=7,
        organizations=[SimpleNamespace(id=i) for i in org_ids],
        has_role=lambda role: super_admin and role == settings.super_admin_role,
    )


def _request(headers=None):
    return SimpleNamespace(headers=headers or {})


# ── Active org (writes) for a non-super-admin ─────────────────────────────────


class TestActiveOrgNonSuper:
    @pytest.mark.asyncio
    async def test_sole_assigned_org_is_active(self):
        user = _user(super_admin=False, org_ids=(5,))
        result = await get_tenant_org_id(_request(), user, db=_OrgSession([5]))
        assert result == 5

    @pytest.mark.asyncio
    async def test_ambiguous_without_header_rejected(self):
        # 2+ assigned and no header -> a write has no unambiguous target -> 403.
        user = _user(super_admin=False, org_ids=(5, 9))
        with pytest.raises(HTTPException) as exc:
            await get_tenant_org_id(_request(), user, db=_OrgSession([5, 9]))
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_header_selects_an_assigned_org(self):
        user = _user(super_admin=False, org_ids=(5, 9))
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "9"}), user, db=_OrgSession([9])
        )
        assert result == 9

    @pytest.mark.asyncio
    async def test_no_assigned_org_rejected(self):
        user = _user(super_admin=False, org_ids=())
        with pytest.raises(HTTPException) as exc:
            await get_tenant_org_id(_request(), user, db=_OrgSession([]))
        assert exc.value.status_code == 403


# ── Read scope (union) for a non-super-admin ──────────────────────────────────


class TestScopeNonSuper:
    @pytest.mark.asyncio
    async def test_scope_is_all_assigned(self):
        user = _user(super_admin=False, org_ids=(5, 9))
        result = await get_tenant_scope(_request(), user, db=_OrgSession([5, 9]))
        assert set(result) == {5, 9}

    @pytest.mark.asyncio
    async def test_header_narrows_scope_to_one(self):
        user = _user(super_admin=False, org_ids=(5, 9))
        result = await get_tenant_scope(
            _request({settings.tenant_header: "9"}), user, db=_OrgSession([9])
        )
        assert result == [9]

    @pytest.mark.asyncio
    async def test_no_assigned_org_rejected(self):
        user = _user(super_admin=False, org_ids=())
        with pytest.raises(HTTPException) as exc:
            await get_tenant_scope(_request(), user, db=_OrgSession([]))
        assert exc.value.status_code == 403


# ── Node scope (Employee-directory granularity) for a non-super-admin ─────────


class TestNodeScopeNonSuper:
    @pytest.mark.asyncio
    async def test_node_scope_is_the_granted_nodes(self):
        # With a fake that echoes its rows, roots == nodes; the divergence (a
        # sub-unit grant rolling up to the company root for get_tenant_scope, but
        # staying the sub-unit for the node scope) is covered in test_node_scope.
        user = _user(super_admin=False, org_ids=(5, 9))
        result = await get_tenant_node_scope(_request(), user, db=_OrgSession([5, 9]))
        assert set(result) == {5, 9}

    @pytest.mark.asyncio
    async def test_no_assigned_org_rejected(self):
        user = _user(super_admin=False, org_ids=())
        with pytest.raises(HTTPException) as exc:
            await get_tenant_node_scope(_request(), user, db=_OrgSession([]))
        assert exc.value.status_code == 403


# ── Super admin: active org + scope ──────────────────────────────────────────


class TestSuperAdmin:
    @pytest.mark.asyncio
    async def test_active_header_scopes_to_requested_org(self):
        user = _user(super_admin=True)
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "3"}), user, db=_OrgSession([3])
        )
        assert result == 3

    @pytest.mark.asyncio
    async def test_active_no_header_single_org(self):
        user = _user(super_admin=True)
        result = await get_tenant_org_id(_request(), user, db=_OrgSession([42]))
        assert result == 42

    @pytest.mark.asyncio
    async def test_active_no_header_multiple_is_global(self):
        user = _user(super_admin=True)
        result = await get_tenant_org_id(_request(), user, db=_OrgSession([1, 2]))
        assert result is None

    @pytest.mark.asyncio
    async def test_scope_header_one_company(self):
        user = _user(super_admin=True)
        result = await get_tenant_scope(
            _request({settings.tenant_header: "3"}), user, db=_OrgSession([3])
        )
        assert result == [3]

    @pytest.mark.asyncio
    async def test_scope_no_header_single_is_that_company(self):
        user = _user(super_admin=True)
        result = await get_tenant_scope(_request(), user, db=_OrgSession([42]))
        assert result == [42]

    @pytest.mark.asyncio
    async def test_scope_no_header_multiple_is_global(self):
        user = _user(super_admin=True)
        result = await get_tenant_scope(_request(), user, db=_OrgSession([1, 2]))
        assert result is None


# ── WebSocket identity (mirrors the scope rules; returns a set of roots) ──────


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

        # The test users are company-root-assigned, so a grant (and any ?org=
        # value) rolls up to itself.
        async def fake_root_ids(_db, ids):
            return list(ids)

        async def fake_root_id(_db, oid):
            return oid

        monkeypatch.setattr(ws_mod, "root_ids_of", fake_root_ids)
        monkeypatch.setattr(ws_mod, "root_id_of", fake_root_id)

    return setup


class TestWsResolveIdentity:
    @pytest.mark.asyncio
    async def test_tenant_user_gets_all_assigned(self, ws_identity):
        user = _user(super_admin=False, org_ids=(5, 9))
        ws_identity(user)
        assert await ws_mod._resolve_identity("tok", None) == (7, {5, 9})

    @pytest.mark.asyncio
    async def test_tenant_user_header_narrows(self, ws_identity):
        user = _user(super_admin=False, org_ids=(5, 9))
        ws_identity(user)
        assert await ws_mod._resolve_identity("tok", "9") == (7, {9})

    @pytest.mark.asyncio
    async def test_tenant_user_no_assigned_rejected(self, ws_identity):
        user = _user(super_admin=False, org_ids=())
        ws_identity(user)
        assert await ws_mod._resolve_identity("tok", None) is None

    @pytest.mark.asyncio
    async def test_super_admin_scopes_via_org_param(self, ws_identity):
        user = _user(super_admin=True)
        ws_identity(user)
        assert await ws_mod._resolve_identity("tok", "3") == (7, {3})

    @pytest.mark.asyncio
    async def test_super_admin_without_param_falls_back_to_single_org(self, ws_identity):
        user = _user(super_admin=True)
        ws_identity(user, single_org=42)
        assert await ws_mod._resolve_identity("tok", None) == (7, {42})

    @pytest.mark.asyncio
    async def test_super_admin_keeps_global_scope_with_multiple_orgs(self, ws_identity):
        user = _user(super_admin=True)
        ws_identity(user, single_org=None)
        assert await ws_mod._resolve_identity("tok", None) == (7, None)
