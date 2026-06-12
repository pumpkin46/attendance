"""Production fail-closed guard tests for Settings.

Guards the Tier-2 fix: the old guard only rejected the exact default string,
so a committed placeholder like "change-me-to-a-random-64-char-string" booted
a production instance with a repo-public JWT signing key.
"""

from __future__ import annotations

import pytest

from app.core.config import DEFAULT_SECRET_KEY, Settings

STRONG_SECRET = "a" * 64


def _settings(**overrides) -> Settings:
    # _env_file=None: ignore any local .env so tests are hermetic.
    return Settings(_env_file=None, **overrides)


class TestProductionSecretGuard:
    def test_default_secret_rejected(self):
        with pytest.raises(ValueError):
            _settings(app_env="production", SECRET_KEY=DEFAULT_SECRET_KEY)

    def test_change_me_placeholder_variants_rejected(self):
        # The .env.example placeholder that used to slip through the guard.
        with pytest.raises(ValueError):
            _settings(
                app_env="production",
                SECRET_KEY="change-me-to-a-random-64-char-string",
            )
        with pytest.raises(ValueError):
            _settings(app_env="production", SECRET_KEY="CHANGE-ME-NOW-" + "x" * 32)

    def test_short_secret_rejected(self):
        with pytest.raises(ValueError):
            _settings(app_env="production", SECRET_KEY="tooshort")

    def test_empty_secret_rejected(self):
        with pytest.raises(ValueError):
            _settings(app_env="production", SECRET_KEY="   ")

    def test_strong_secret_accepted_and_debug_forced_off(self):
        s = _settings(app_env="production", SECRET_KEY=STRONG_SECRET, app_debug=True)
        assert s.secret_key == STRONG_SECRET
        assert s.app_debug is False

    def test_wildcard_cors_rejected_in_production(self):
        with pytest.raises(ValueError):
            _settings(
                app_env="production",
                SECRET_KEY=STRONG_SECRET,
                cors_allow_origins="*",
            )

    def test_local_env_permits_default_secret(self):
        s = _settings(app_env="local")
        assert s.secret_key == DEFAULT_SECRET_KEY


class TestSelfRegistrationDefault:
    def test_registration_disabled_by_default(self):
        # Self-registration exposes authenticated-only compute endpoints
        # (recognition, engine) to anyone who can reach the API; it must be
        # an explicit opt-in.
        assert _settings().registration_enabled is False
