"""Lightweight in-process rate limiting.

This is a best-effort limiter intended for brute-force / abuse mitigation on
auth-sensitive and resource-intensive endpoints. State is per-process (a simple
sliding window keyed by client IP) and therefore NOT shared across multiple
workers or nodes. For hard guarantees behind a load balancer, also enforce
limits at the reverse proxy. Disable globally with ``RATE_LIMIT_ENABLED=false``.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status

from app.core.config import settings

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


def rate_limit(name: str, max_requests: int, window_seconds: int):
    """Return a FastAPI dependency enforcing ``max_requests`` per window per IP.

    Use in a route's ``dependencies=[...]`` list so it does not alter the
    handler signature.
    """

    async def _dependency(request: Request) -> None:
        if not settings.rate_limit_enabled or max_requests <= 0:
            return
        now = time.monotonic()
        key = f"{name}:{_client_ip(request)}"
        bucket = _hits[key]
        cutoff = now - window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= max_requests:
            retry_after = int(bucket[0] + window_seconds - now) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down and try again later.",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
        bucket.append(now)
        _purge_if_needed(now, window_seconds)

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
