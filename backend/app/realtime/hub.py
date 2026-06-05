"""Publish/subscribe hub for realtime WebSocket fan-out.

Events are partitioned by ``organization_id`` for tenant isolation. A connection
scoped to ``org_id=None`` (a super-admin watching every tenant) receives all
events; a publish with ``org_id=None`` is delivered ONLY to those super-admin
connections, never fanned out across tenants.

Two modes, transparent to callers (``register``/``unregister``/``publish``/``emit``):

* **Redis enabled** — ``publish`` does a Redis ``PUBLISH``; every worker runs a
  ``SUBSCRIBE`` loop (started in the app lifespan) that fans the event out to its
  own local connections. This makes realtime correct across multiple workers/nodes.
* **Redis disabled** — ``publish`` fans out directly to this process's
  connections (single-worker behaviour).

Pub/sub is best-effort: a dropped event is re-synced by the client's normal
refetch on reconnect.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from redis.exceptions import RedisError

from app.core.redis import get_redis

logger = logging.getLogger(__name__)

# Single channel; tenant targeting is applied locally per worker from the payload.
_CHANNEL = "realtime:events"

# Bounded per-connection buffer. A client that cannot keep up drops events rather
# than ballooning memory; it will re-sync via a normal refetch on reconnect.
_MAX_QUEUED_EVENTS = 100

# Cap concurrent sockets per user to bound resource use from a single account.
_MAX_CONNECTIONS_PER_USER = 8


class Connection:
    """A single subscriber's mailbox."""

    def __init__(self, user_id: int, org_id: int | None) -> None:
        self.user_id = user_id
        self.org_id = org_id
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=_MAX_QUEUED_EVENTS)


class RealtimeHub:
    def __init__(self) -> None:
        self._connections: set[Connection] = set()
        self._lock = asyncio.Lock()
        self._pubsub: Any = None
        self._sub_task: asyncio.Task | None = None

    async def register(self, user_id: int, org_id: int | None) -> Connection | None:
        """Register a subscriber, or return None if the per-user cap is reached."""
        conn = Connection(user_id, org_id)
        async with self._lock:
            active = sum(1 for c in self._connections if c.user_id == user_id)
            if active >= _MAX_CONNECTIONS_PER_USER:
                return None
            self._connections.add(conn)
        return conn

    async def unregister(self, conn: Connection) -> None:
        async with self._lock:
            self._connections.discard(conn)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def publish(
        self,
        org_id: int | None,
        event_type: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        message = json.dumps(
            {
                "type": event_type,
                "data": data or {},
                "org_id": org_id,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )
        # With Redis, broadcast to every worker; each worker's subscriber loop
        # delivers to its own local connections (including this one). Without
        # Redis, deliver to this process's connections directly.
        redis = get_redis()
        if redis is not None:
            try:
                await redis.publish(_CHANNEL, message)
                return
            except RedisError:
                logger.warning("Realtime PUBLISH failed; delivering locally only")
        await self._deliver_local(org_id, message)

    async def _deliver_local(self, org_id: int | None, message: str) -> None:
        """Fan a serialized event out to this process's matching connections.

        A super-admin connection (org_id is None) sees every tenant's events; an
        event with org_id=None is delivered ONLY to those super-admin connections.
        """
        async with self._lock:
            targets = [
                conn
                for conn in self._connections
                if conn.org_id is None or conn.org_id == org_id
            ]
        for conn in targets:
            try:
                conn.queue.put_nowait(message)
            except asyncio.QueueFull:
                logger.warning("Realtime queue full; dropping event for a slow client")

    # ── Cross-worker subscriber (started/stopped by the app lifespan) ─────────

    async def start_subscriber(self) -> None:
        """Begin consuming Redis pub/sub events for local fan-out (no-op if off)."""
        redis = get_redis()
        if redis is None or self._sub_task is not None:
            return
        try:
            self._pubsub = redis.pubsub()
            await self._pubsub.subscribe(_CHANNEL)
        except RedisError:
            logger.warning("Realtime subscriber could not connect; running local-only")
            self._pubsub = None
            return
        self._sub_task = asyncio.create_task(self._consume())

    async def _consume(self) -> None:
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "message":
                    continue
                raw = message.get("data")
                if not isinstance(raw, str):
                    continue
                try:
                    org_id = json.loads(raw).get("org_id")
                except (ValueError, TypeError):
                    continue
                await self._deliver_local(org_id, raw)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - defensive; keep the worker alive
            logger.exception("Realtime subscriber loop crashed")

    async def stop_subscriber(self) -> None:
        if self._sub_task is not None:
            self._sub_task.cancel()
            try:
                await self._sub_task
            except asyncio.CancelledError:
                pass
            self._sub_task = None
        if self._pubsub is not None:
            try:
                await self._pubsub.aclose()
            except Exception:  # pragma: no cover
                pass
            self._pubsub = None


_hub = RealtimeHub()


def get_hub() -> RealtimeHub:
    return _hub


async def emit(
    org_id: int | None,
    event_type: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget publish that never raises into the calling request."""
    try:
        await _hub.publish(org_id, event_type, data)
    except Exception:  # pragma: no cover - defensive; realtime must not break writes
        logger.exception("Failed to emit realtime event '%s'", event_type)
