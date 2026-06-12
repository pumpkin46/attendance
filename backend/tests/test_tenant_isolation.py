"""Direct tests for the multi-tenant boundary (get_tenant_org_id).

Every other API test mocks this out with `lambda: 1`; here it is exercised
directly so the actual isolation logic is covered.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

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
        # Used by the "does this org id exist" check; return the id if known.
        return self._existing[0] if self._existing else None

    async def execute(self, stmt):
        rows = [(i,) for i in self._existing]
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [r[0] for r in rows]))


def _user(*, super_admin: bool, org_id):
    return SimpleNamespace(
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
    async def test_org_none_stays_none(self):
        user = _user(super_admin=False, org_id=None)
        result = await get_tenant_org_id(_request(), user, db=_OrgSession([1]))
        assert result is None


class TestSuperAdmin:
    @pytest.mark.asyncio
    async def test_header_scopes_to_requested_org(self):
        user = _user(super_admin=True, org_id=None)
        result = await get_tenant_org_id(
            _request({settings.tenant_header: "3"}), user, db=_OrgSession([3])
        )
        assert result == 3

    @pytest.mark.asyncio
    async def test_unknown_org_header_rejected(self):
        user = _user(super_admin=True, org_id=None)
        with pytest.raises(HTTPException) as exc:
            await get_tenant_org_id(
                _request({settings.tenant_header: "999"}), user, db=_OrgSession([])
            )
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_non_integer_header_rejected(self):
        user = _user(super_admin=True, org_id=None)
        with pytest.raises(HTTPException) as exc:
            await get_tenant_org_id(
                _request({settings.tenant_header: "abc"}), user, db=_OrgSession([1])
            )
        assert exc.value.status_code == 400

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
