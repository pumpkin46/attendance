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

# Redis hash per company root holding {user_id: live-socket-count} for chat
# presence. A shared counter is required so online/offline transitions and the
# online roster are correct across workers/nodes (the in-process count is only
# this worker's sockets). Falls back to an in-process counter when Redis is off.
_PRESENCE_PREFIX = "chat:presence:"


def _presence_key(org_id: int) -> str:
    return f"{_PRESENCE_PREFIX}{org_id}"

# Bounded per-connection buffer. A client that cannot keep up drops events rather
# than ballooning memory; it will re-sync via a normal refetch on reconnect.
_MAX_QUEUED_EVENTS = 100

# Cap concurrent sockets per user to bound resource use from a single account.
_MAX_CONNECTIONS_PER_USER = 8

# The subscriber polls with an explicit read timeout rather than a blocking
# ``listen()``. A blocking read inherits the client's short ``socket_timeout``
# and raises on every idle window; a caller-supplied timeout instead returns
# ``None`` on expiry, so idle is normal. On expiry we loop, which also lets
# redis-py fire its periodic health-check PING to detect a dead connection.
_SUBSCRIBE_POLL_TIMEOUT = 30.0

# Backoff before reconnecting after the subscriber loses its Redis connection.
_SUBSCRIBE_RETRY_DELAY = 2.0


class Connection:
    """A single subscriber's mailbox.

    ``org_ids`` is the set of company roots this connection receives events for
    (a multi-org user's assigned companies). ``None`` means every tenant — a
    super admin watching globally.
    """

    def __init__(self, user_id: int, org_ids: set[int] | None) -> None:
        self.user_id = user_id
        self.org_ids = org_ids
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=_MAX_QUEUED_EVENTS)


class RealtimeHub:
    def __init__(self) -> None:
        self._connections: set[Connection] = set()
        self._lock = asyncio.Lock()
        self._pubsub: Any = None
        self._sub_task: asyncio.Task | None = None
        # In-process presence counters (org_id, user_id) -> live socket count,
        # used only when Redis is disabled (single-worker mode).
        self._presence_counts: dict[tuple[int, int], int] = {}

    async def register(self, user_id: int, org_ids: set[int] | None) -> Connection | None:
        """Register a subscriber, or return None if the per-user cap is reached."""
        conn = Connection(user_id, org_ids)
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

    async def presence_connect(self, user_id: int, org_ids: set[int]) -> list[int]:
        """Record a new live socket; return the company roots the user just came
        ONLINE in (0->1 transition) so the caller announces presence exactly once.

        Counts are shared via Redis when enabled (correct across workers), else
        kept in-process (single-worker). Best-effort: a Redis error yields an
        empty/partial result rather than breaking the connection.
        """
        redis = get_redis()
        if redis is not None:
            became: list[int] = []
            try:
                for org in org_ids:
                    n = await redis.hincrby(_presence_key(org), str(user_id), 1)
                    if n == 1:
                        became.append(org)
            except RedisError:
                logger.warning("Presence connect via Redis failed; presence may be stale")
            return became
        async with self._lock:
            became = []
            for org in org_ids:
                key = (org, user_id)
                n = self._presence_counts.get(key, 0) + 1
                self._presence_counts[key] = n
                if n == 1:
                    became.append(org)
            return became

    async def presence_disconnect(self, user_id: int, org_ids: set[int]) -> list[int]:
        """Drop a live socket; return the company roots the user just went
        OFFLINE in (1->0 transition)."""
        redis = get_redis()
        if redis is not None:
            gone: list[int] = []
            try:
                for org in org_ids:
                    n = await redis.hincrby(_presence_key(org), str(user_id), -1)
                    if n <= 0:
                        await redis.hdel(_presence_key(org), str(user_id))
                        gone.append(org)
            except RedisError:
                logger.warning("Presence disconnect via Redis failed; presence may be stale")
            return gone
        async with self._lock:
            gone = []
            for org in org_ids:
                key = (org, user_id)
                n = self._presence_counts.get(key, 0) - 1
                if n <= 0:
                    self._presence_counts.pop(key, None)
                    gone.append(org)
                else:
                    self._presence_counts[key] = n
            return gone

    async def online_user_ids(self, org_id: int | None) -> list[int]:
        """User ids with at least one live socket in ``org_id`` (company root).

        Reads the shared Redis roster when enabled (so it reflects every worker),
        else the in-process counters. ``None`` (a global super-admin scope) has no
        company roster, so it returns empty.
        """
        if org_id is None:
            return []
        redis = get_redis()
        if redis is not None:
            try:
                fields = await redis.hkeys(_presence_key(org_id))
                return sorted(int(f) for f in fields)
            except RedisError:
                return []
        async with self._lock:
            return sorted(
                user_id
                for (org, user_id), count in self._presence_counts.items()
                if org == org_id and count > 0
            )

    async def publish(
        self,
        org_id: int | None,
        event_type: str,
        data: dict[str, Any] | None = None,
        user_ids: list[int] | set[int] | None = None,
    ) -> None:
        # ``user_ids`` targets specific recipients (a chat conversation's members)
        # regardless of their current org scope; ``None`` keeps the org-broadcast
        # behaviour. Carried in the payload so the Redis subscriber on every
        # worker can apply the same targeting locally.
        to = sorted({int(u) for u in user_ids}) if user_ids is not None else None
        message = json.dumps(
            {
                "type": event_type,
                "data": data or {},
                "org_id": org_id,
                "to": to,
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
        await self._deliver_local(org_id, message, to)

    async def _deliver_local(
        self,
        org_id: int | None,
        message: str,
        user_ids: list[int] | None = None,
    ) -> None:
        """Fan a serialized event out to this process's matching connections.

        When ``user_ids`` is given the event is a direct delivery: only those
        users' sockets receive it, ignoring org scope (so a recipient currently
        viewing another tenant still gets their chat message, and a super-admin
        who is not a recipient does not). Otherwise it is an org broadcast: a
        super-admin connection (org_ids None) sees every tenant's events, an
        event with org_id=None is delivered ONLY to those super-admin
        connections, and a multi-org connection matches when its org root is in
        the set.
        """
        async with self._lock:
            if user_ids is not None:
                recipients = set(user_ids)
                targets = [c for c in self._connections if c.user_id in recipients]
            else:
                targets = [
                    conn
                    for conn in self._connections
                    if conn.org_ids is None or (org_id is not None and org_id in conn.org_ids)
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
        self._sub_task = asyncio.create_task(self._consume())

    async def _consume(self) -> None:
        """Subscribe and fan events out locally, reconnecting across drops.

        Polls with ``get_message(timeout=...)`` instead of a blocking
        ``listen()``: a blocking read inherits the client's short
        ``socket_timeout`` and would raise on every idle window, killing the
        loop. Transient Redis errors (idle restart, brief outage) reconnect with
        a backoff rather than tearing down realtime until the next app restart.
        """
        redis = get_redis()
        if redis is None:
            return
        while True:
            try:
                if self._pubsub is None:
                    self._pubsub = redis.pubsub()
                    await self._pubsub.subscribe(_CHANNEL)
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=_SUBSCRIBE_POLL_TIMEOUT,
                )
                if message is None or message.get("type") != "message":
                    continue
                raw = message.get("data")
                if not isinstance(raw, str):
                    continue
                try:
                    payload = json.loads(raw)
                    org_id = payload.get("org_id")
                    to = payload.get("to")
                except (ValueError, TypeError):
                    continue
                await self._deliver_local(org_id, raw, to)
            except asyncio.CancelledError:
                raise
            except RedisError:
                logger.warning("Realtime subscriber lost Redis; reconnecting")
                await self._reset_pubsub()
                await asyncio.sleep(_SUBSCRIBE_RETRY_DELAY)
            except Exception:  # pragma: no cover - defensive; keep the loop alive
                logger.exception("Realtime subscriber loop error; reconnecting")
                await self._reset_pubsub()
                await asyncio.sleep(_SUBSCRIBE_RETRY_DELAY)

    async def _reset_pubsub(self) -> None:
        """Drop the current pub/sub so the next loop iteration reconnects fresh."""
        if self._pubsub is not None:
            try:
                await self._pubsub.aclose()
            except Exception:  # pragma: no cover - best-effort cleanup
                pass
            self._pubsub = None

    async def stop_subscriber(self) -> None:
        if self._sub_task is not None:
            self._sub_task.cancel()
            try:
                await self._sub_task
            except asyncio.CancelledError:
                pass
            self._sub_task = None
        await self._reset_pubsub()


_hub = RealtimeHub()


def get_hub() -> RealtimeHub:
    return _hub


async def emit(
    org_id: int | None,
    event_type: str,
    data: dict[str, Any] | None = None,
    user_ids: list[int] | set[int] | None = None,
) -> None:
    """Fire-and-forget publish that never raises into the calling request.

    Pass ``user_ids`` to deliver only to those users' sockets (direct/chat
    delivery); omit it for the default org-scoped broadcast.
    """
    try:
        await _hub.publish(org_id, event_type, data, user_ids)
    except Exception:  # pragma: no cover - defensive; realtime must not break writes
        logger.exception("Failed to emit realtime event '%s'", event_type)
