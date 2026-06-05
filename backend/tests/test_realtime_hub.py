"""Realtime hub: local fan-out, Redis pub/sub path, and tenant targeting."""

from __future__ import annotations

import asyncio
import json

import app.realtime.hub as hub_mod
from app.realtime.hub import RealtimeHub


def test_publish_delivers_locally_without_redis(monkeypatch):
    monkeypatch.setattr(hub_mod, "get_redis", lambda: None)
    hub = RealtimeHub()

    async def scenario():
        conn = await hub.register(user_id=1, org_id=7)
        await hub.publish(7, "cameras.changed", {"x": 1})
        return conn

    conn = asyncio.run(scenario())
    payload = json.loads(conn.queue.get_nowait())
    assert payload["type"] == "cameras.changed"
    assert payload["org_id"] == 7


def test_publish_broadcasts_via_redis_when_enabled(monkeypatch):
    published: list[tuple[str, str]] = []

    class FakeRedis:
        async def publish(self, channel, message):
            published.append((channel, message))

    monkeypatch.setattr(hub_mod, "get_redis", lambda: FakeRedis())
    hub = RealtimeHub()

    async def scenario():
        conn = await hub.register(1, 7)
        await hub.publish(7, "rfid.tap", {})
        return conn

    conn = asyncio.run(scenario())
    # Delivery happens via each worker's subscriber, not inline — so the local
    # queue is not filled directly by publish().
    assert conn.queue.empty()
    assert len(published) == 1
    assert published[0][0] == "realtime:events"


def test_tenant_targeting(monkeypatch):
    monkeypatch.setattr(hub_mod, "get_redis", lambda: None)
    hub = RealtimeHub()

    async def scenario():
        same_org = await hub.register(1, 7)
        other_org = await hub.register(2, 9)
        super_admin = await hub.register(3, None)
        await hub.publish(7, "anomalies.changed", {})
        return same_org, other_org, super_admin

    same_org, other_org, super_admin = asyncio.run(scenario())
    assert not same_org.queue.empty()      # matching tenant receives it
    assert other_org.queue.empty()         # a different tenant does not
    assert not super_admin.queue.empty()   # super-admin (org_id None) sees all
