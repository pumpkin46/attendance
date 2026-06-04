"""Authenticated realtime WebSocket endpoint.

Browsers cannot set an ``Authorization`` header on a WebSocket handshake. To keep
the JWT out of URLs (and therefore out of access logs / proxy logs / browser
history) it is passed via the ``Sec-WebSocket-Protocol`` header as
``["bearer", "<token>"]`` and the server echoes back ``bearer`` on accept.

A super-admin may pass ``?org=<id>`` (a non-sensitive tenant id) to scope the
stream to one tenant.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.security import decode_access_token
from app.models.user import Role, User
from app.realtime.hub import Connection, get_hub

logger = logging.getLogger(__name__)
router = APIRouter()

# Subprotocol the server selects/echoes when a token is offered.
_BEARER_SUBPROTOCOL = "bearer"


def _extract_token(websocket: WebSocket) -> str | None:
    """Read the bearer token from the Sec-WebSocket-Protocol header."""
    header = websocket.headers.get("sec-websocket-protocol")
    if not header:
        return None
    parts = [p.strip() for p in header.split(",") if p.strip()]
    if len(parts) >= 2 and parts[0] == _BEARER_SUBPROTOCOL:
        return parts[1]
    return None


def _origin_allowed(origin: str | None) -> bool:
    """Defense-in-depth Origin allowlist (auth via token is the primary control)."""
    if origin is None:
        return True  # non-browser client; no Origin header to enforce
    allowed = settings.cors_origins
    if "*" in allowed:
        return True
    return origin in allowed


async def _resolve_identity(
    token: str | None, org_param: str | None
) -> tuple[int, int | None] | None:
    """Validate the token and return (user_id, org_id), or None if unauthenticated."""
    if not token:
        return None
    payload = decode_access_token(token)
    if payload is None:
        return None
    try:
        user_id_int = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None

    async with async_session_factory() as db:
        stmt = (
            select(User)
            .options(selectinload(User.roles).selectinload(Role.permissions))
            .where(User.id == user_id_int, User.is_active == True)  # noqa: E712
        )
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

    if user is None:
        return None
    if user.has_role(settings.super_admin_role):
        if org_param:
            try:
                return user.id, int(org_param)
            except ValueError:
                return user.id, None
        return user.id, None
    return user.id, user.organization_id


async def _pump_outgoing(websocket: WebSocket, conn: Connection) -> None:
    while True:
        message = await conn.queue.get()
        await websocket.send_text(message)


async def _drain_incoming(websocket: WebSocket) -> None:
    # Clients only send keepalive pings; we ignore the payload and rely on this
    # loop to observe disconnects.
    while True:
        await websocket.receive_text()


@router.websocket("/api/v1/ws")
async def realtime_ws(websocket: WebSocket) -> None:
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    token = _extract_token(websocket)
    identity = await _resolve_identity(token, websocket.query_params.get("org"))
    if identity is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_id, org_id = identity

    hub = get_hub()
    conn = await hub.register(user_id, org_id)
    if conn is None:
        # Per-user connection cap reached.
        await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
        return

    # Echo the negotiated subprotocol so the browser completes the handshake.
    await websocket.accept(subprotocol=_BEARER_SUBPROTOCOL)
    await websocket.send_json({"type": "connected", "data": {"org_id": org_id}, "org_id": org_id})

    sender = asyncio.create_task(_pump_outgoing(websocket, conn))
    receiver = asyncio.create_task(_drain_incoming(websocket))
    try:
        _, pending = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        sender.cancel()
        receiver.cancel()
        await hub.unregister(conn)
