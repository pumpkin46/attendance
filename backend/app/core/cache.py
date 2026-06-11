"""Best-effort Redis response cache for read-heavy aggregation endpoints.

Design goals:
  * **Never an error.** When Redis is disabled (``REDIS_ENABLED=false``),
    unreachable, or caching is turned off (``CACHE_ENABLED=false``), the value is
    simply computed and returned — a cache miss/outage degrades to the uncached
    path, it never fails a request.
  * **Bounded staleness.** Values are stored as JSON under a short TTL, so even
    without explicit invalidation the data is at most ``ttl`` seconds stale.

Use :func:`cached_json` for get-or-compute, and :func:`invalidate_prefix` to drop
a family of keys after a write.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger(__name__)


async def cached_json(key: str, ttl: int, compute: Callable[[], Awaitable[Any]]) -> Any:
    """Return ``key`` from Redis, or compute + store it (JSON, ``ttl`` seconds).

    ``compute`` is an async callable producing a JSON-encodable value (dict, list,
    or Pydantic model — encoded via ``jsonable_encoder``). On any Redis error the
    value is computed and returned without caching.
    """
    if not settings.cache_enabled:
        return await compute()
    redis = get_redis()
    if redis is None:
        return await compute()

    try:
        hit = await redis.get(key)
        if hit is not None:
            return json.loads(hit)
    except (RedisError, ValueError):
        return await compute()

    value = await compute()
    try:
        await redis.set(key, json.dumps(jsonable_encoder(value)), ex=ttl)
    except RedisError:
        pass
    return value


async def invalidate_prefix(prefix: str) -> None:
    """Delete every cache key starting with ``prefix`` (best-effort)."""
    if not settings.cache_enabled:
        return
    redis = get_redis()
    if redis is None:
        return
    try:
        keys = [k async for k in redis.scan_iter(match=f"{prefix}*", count=100)]
        if keys:
            await redis.delete(*keys)
    except RedisError:
        pass
