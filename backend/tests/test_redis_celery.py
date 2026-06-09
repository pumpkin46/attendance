"""Redis-backed shared state + Celery wiring."""

from __future__ import annotations

import asyncio

import app.core.rate_limit as rate_limit
import app.services.attendance_service as attendance_service
import app.tasks.maintenance  # noqa: F401 — registers tasks on the celery app
from app.celery_app import celery_app
from app.tasks.base import run_async


class FakeRedis:
    """Minimal async Redis stand-in covering the ops we use."""

    def __init__(self):
        self.store: dict[str, str | int] = {}

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    async def incr(self, key):
        self.store[key] = int(self.store.get(key, 0)) + 1
        return self.store[key]

    async def expire(self, key, ttl):
        return True


# ── Duplicate suppression ─────────────────────────────────────────────────────


def test_redis_dup_suppression_is_shared(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(attendance_service, "get_redis", lambda: fake)
    # First call within the window creates the key → not a duplicate; second sees it.
    assert asyncio.run(attendance_service._is_duplicate_shared("emp:1", 60)) is False
    assert asyncio.run(attendance_service._is_duplicate_shared("emp:1", 60)) is True


def test_dup_falls_back_to_memory_without_redis(monkeypatch):
    monkeypatch.setattr(attendance_service, "get_redis", lambda: None)
    attendance_service._dup_cache.clear()
    assert asyncio.run(attendance_service._is_duplicate_shared("emp:2", 60)) is False
    assert asyncio.run(attendance_service._is_duplicate_shared("emp:2", 60)) is True


# ── Rate limiting ─────────────────────────────────────────────────────────────


def test_rate_limit_redis_fixed_window(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(rate_limit, "get_redis", lambda: fake)
    results = [asyncio.run(rate_limit._allow_redis("login", "1.2.3.4", 2, 60)) for _ in range(3)]
    assert results == [True, True, False]


def test_rate_limit_returns_none_without_redis(monkeypatch):
    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    assert asyncio.run(rate_limit._allow_redis("login", "1.2.3.4", 2, 60)) is None


# ── Celery wiring ─────────────────────────────────────────────────────────────


def test_beat_schedule_registered():
    assert set(celery_app.conf.beat_schedule) == {
        "expire-visitors",
        "detect-anomalies",
        "purge-retention",
        "purge-snapshots",
    }
    for task in (
        "expire_visitors",
        "detect_anomalies",
        "purge_retention",
        "purge_snapshots",
    ):
        assert f"maintenance.{task}" in celery_app.tasks


def test_run_async_executes_impl():
    async def impl(_session):
        return 42

    assert run_async(impl) == 42
