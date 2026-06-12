"""Behavioral tests for JWT issuance, auth, and token revocation.

The prior suite overrode auth via dependency_overrides and never exercised
create_access_token / get_current_user or the /auth/login flow itself.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.security import create_access_token, decode_access_token
from app.api.auth import issue_token


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeUserSession:
    """Returns a fixed user for get_current_user's SELECT."""

    def __init__(self, user):
        self._user = user

    async def execute(self, stmt):
        return _FakeResult(self._user)


def _user(**over):
    base = dict(id=7, is_active=True, password_changed_at=None)
    base.update(over)
    return SimpleNamespace(**base)


def _request_with_token(token: str):
    return SimpleNamespace(headers={"Authorization": f"Bearer {token}"})


class TestTokenRoundTrip:
    def test_create_and_decode(self):
        token = create_access_token({"sub": "7"})
        payload = decode_access_token(token)
        assert payload["sub"] == "7"

    def test_tampered_token_rejected(self):
        token = create_access_token({"sub": "7"})
        assert decode_access_token(token + "x") is None

    def test_expired_token_rejected(self):
        token = create_access_token({"sub": "7"}, expires_delta=timedelta(seconds=-1))
        assert decode_access_token(token) is None


class TestGetCurrentUser:
    @pytest.mark.asyncio
    async def test_valid_token_returns_user(self):
        from app.core.dependencies import get_current_user

        user = _user()
        token = issue_token(user)
        result = await get_current_user(_request_with_token(token), db=_FakeUserSession(user))
        assert result is user

    @pytest.mark.asyncio
    async def test_missing_bearer_rejected(self):
        from app.core.dependencies import get_current_user

        with pytest.raises(HTTPException) as exc:
            await get_current_user(SimpleNamespace(headers={}), db=_FakeUserSession(_user()))
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_token_before_password_change_is_revoked(self):
        from app.core.dependencies import get_current_user

        # Token minted now, then the password changes a minute later.
        user = _user()
        token = issue_token(user)  # pwd_at = 0 (never changed)
        user.password_changed_at = datetime.now(timezone.utc) + timedelta(minutes=1)

        with pytest.raises(HTTPException) as exc:
            await get_current_user(_request_with_token(token), db=_FakeUserSession(user))
        assert exc.value.status_code == 401
        assert "password change" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_token_after_password_change_is_accepted(self):
        from app.core.dependencies import get_current_user

        changed = datetime(2026, 1, 1, tzinfo=timezone.utc)
        user = _user(password_changed_at=changed)
        token = issue_token(user)  # pwd_at = changed.timestamp()
        result = await get_current_user(_request_with_token(token), db=_FakeUserSession(user))
        assert result is user
