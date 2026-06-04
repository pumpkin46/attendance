"""In-process publish/subscribe hub for realtime WebSocket fan-out.

Events are partitioned by ``organization_id`` for tenant isolation. A connection
scoped to ``org_id=None`` (a super-admin watching every tenant) receives all
events; a publish with ``org_id=None`` is delivered ONLY to those super-admin
connections, never fanned out across tenants.

This is intentionally process-local: it matches the single-worker deployment.
To scale to multiple workers, swap the body of ``publish`` for a Redis (or other
broker) PUBLISH and feed each connection's queue from a per-worker SUBSCRIBE — the
public surface (``register``/``unregister``/``publish``/``emit``) can stay the same.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

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
        # A super-admin connection (org_id is None) sees every tenant's events.
        # A publish with org_id=None is therefore delivered ONLY to those
        # super-admin connections — never fanned out to all tenants.
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
                logger.warning("Realtime queue full; dropping '%s' for a slow client", event_type)


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
