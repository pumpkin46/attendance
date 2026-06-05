"""Rate limiting for auth-sensitive and resource-intensive endpoints.

Uses Redis (a per-IP fixed window via ``INCR``/``EXPIRE``) when Redis is enabled,
so limits hold across all workers and nodes. When Redis is disabled or
unreachable it falls back to an in-process sliding window (single-worker
behaviour). Disable globally with ``RATE_LIMIT_ENABLED=false``.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.redis import get_redis

# key -> timestamps (monotonic seconds) of recent requests
_hits: dict[str, deque[float]] = defaultdict(deque)
_MAX_TRACKED_KEYS = 50_000


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _purge_if_needed(now: float, window_seconds: int) -> None:
    if len(_hits) <= _MAX_TRACKED_KEYS:
        return
    cutoff = now - window_seconds
    for key in [k for k, dq in _hits.items() if not dq or dq[-1] < cutoff]:
        _hits.pop(key, None)
    if len(_hits) > _MAX_TRACKED_KEYS:
        _hits.clear()


def _allow_in_memory(name: str, ip: str, max_requests: int, window_seconds: int) -> bool:
    """In-process sliding window. Returns True if the request is allowed."""
    now = time.monotonic()
    key = f"{name}:{ip}"
    bucket = _hits[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= max_requests:
        return False
    bucket.append(now)
    _purge_if_needed(now, window_seconds)
    return True


async def _allow_redis(
    name: str, ip: str, max_requests: int, window_seconds: int
) -> bool | None:
    """Redis fixed-window limiter. Returns True/False, or None to fall back."""
    redis = get_redis()
    if redis is None:
        return None
    try:
        bucket = int(time.time() // window_seconds)
        key = f"rl:{name}:{ip}:{bucket}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
        return count <= max_requests
    except RedisError:
        return None


def rate_limit(name: str, max_requests: int, window_seconds: int):
    """Return a FastAPI dependency enforcing ``max_requests`` per window per IP.

    Use in a route's ``dependencies=[...]`` list so it does not alter the
    handler signature.
    """

    async def _dependency(request: Request) -> None:
        if not settings.rate_limit_enabled or max_requests <= 0:
            return
        ip = _client_ip(request)
        allowed = await _allow_redis(name, ip, max_requests, window_seconds)
        if allowed is None:
            allowed = _allow_in_memory(name, ip, max_requests, window_seconds)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down and try again later.",
                headers={"Retry-After": str(window_seconds)},
            )

    return Depends(_dependency)


def login_rate_limit():
    return rate_limit(
        "login",
        settings.rate_limit_login_max,
        settings.rate_limit_login_window_seconds,
    )


def recognition_rate_limit():
    return rate_limit(
        "recognition",
        settings.rate_limit_recognition_max,
        settings.rate_limit_recognition_window_seconds,
    )
