"""Async Redis client used for cross-worker shared state.

Redis is optional: when ``REDIS_ENABLED`` is false (the default) ``get_redis``
returns ``None`` and callers fall back to their in-process behaviour, so the app
runs unchanged without a Redis server. When enabled, the same client backs
duplicate-suppression and rate-limiting across all workers/nodes.
"""

from __future__ import annotations

import logging

from redis.asyncio import Redis, from_url

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Redis | None = None


def get_redis() -> Redis | None:
    """Return the shared async Redis client, or ``None`` when Redis is disabled.

    The client connects lazily on first command; callers must tolerate
    ``redis.exceptions.RedisError`` and fall back to local behaviour so a Redis
    outage never breaks a request.
    """
    global _client
    if not settings.redis_enabled:
        return None
    if _client is None:
        _client = from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            health_check_interval=30,
        )
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        finally:
            _client = None
