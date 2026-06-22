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
from app.core.dependencies import get_single_org_id
from app.core.security import decode_access_token
from app.middleware.tenant import root_id_of, root_ids_of
from app.models.user import Role, User
from app.realtime.hub import Connection, emit, get_hub

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
) -> tuple[int, set[int] | None] | None:
    """Validate the token and return (user_id, org_ids), or None to reject.

    ``org_ids`` is the set of company roots the connection receives events for
    (a multi-org user's assigned companies, or a super admin's header-selected
    one), or None for a super admin watching every tenant.
    """
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

        is_super = user is not None and user.has_role(settings.super_admin_role)
        single_org: int | None = None
        assigned: list[int] = []
        # The ?org= param may name any node (a company root or a sub-unit) and can
        # be stale; resolve it to its COMPANY ROOT the same way the HTTP header is
        # (events are partitioned by root), never trusting the raw value.
        picked_root: int | None = None
        if user is not None:
            if is_super:
                single_org = await get_single_org_id(db)
            else:
                # Roll the user's grants (which may be sub-units) up to their roots.
                assigned = await root_ids_of(db, [o.id for o in user.organizations])
            if org_param:
                try:
                    picked_root = await root_id_of(db, int(org_param))
                except ValueError:
                    picked_root = None

    if user is None:
        return None
    if is_super:
        if org_param:
            # A named (resolved) company scopes to it; an absent/unknown one is
            # global, matching the HTTP header behaviour.
            return user.id, ({picked_root} if picked_root is not None else None)
        return user.id, ({single_org} if single_org is not None else None)
    # Non-super-admin: scope is the union of assigned companies (the param may
    # narrow to one of them). None = global scope, reserved for super admins, so a
    # user with no assigned company is refused like a bad token rather than going global.
    if not assigned:
        return None
    if picked_root is not None and picked_root in assigned:
        return user.id, {picked_root}
    return user.id, set(assigned)


async def _pump_outgoing(websocket: WebSocket, conn: Connection) -> None:
    while True:
        message = await conn.queue.get()
        await websocket.send_text(message)


async def _drain_incoming(websocket: WebSocket) -> None:
    # Clients only send keepalive pings; we ignore the payload and rely on this
    # loop to observe disconnects.
    while True:
        await websocket.receive_text()


async def _send_camera_frames(websocket: WebSocket, camera_id: int, fps: int = 10) -> None:
    """Push the stream's latest frame as binary JPEG at a capped rate.

    A persistent socket replaces snapshot polling, which saturated the browser's
    connection pool under engine load. When the stream isn't running yet we emit a
    small text status (~1/s) so the client can show a waiting state.
    """
    from fastapi.concurrency import run_in_threadpool

    from app.engine.stream_manager import get_stream_manager

    manager = get_stream_manager()
    interval = 1.0 / max(fps, 1)
    idle_ticks = 0
    while True:
        jpeg = await run_in_threadpool(manager.snapshot_jpeg, camera_id)
        if jpeg is not None:
            await websocket.send_bytes(jpeg)
            idle_ticks = 0
        else:
            idle_ticks += 1
            if idle_ticks % max(fps, 1) == 1:  # roughly once per second
                await websocket.send_text('{"status":"waiting"}')
        await asyncio.sleep(interval)


@router.websocket("/api/v1/engine/streams/{camera_id}/ws")
async def stream_ws(websocket: WebSocket, camera_id: int) -> None:
    """Live MJPEG-over-WebSocket preview of one registered camera stream."""
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    token = _extract_token(websocket)
    identity = await _resolve_identity(token, websocket.query_params.get("org"))
    if identity is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept(subprotocol=_BEARER_SUBPROTOCOL)

    sender = asyncio.create_task(_send_camera_frames(websocket, camera_id))
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


# How long a resolved (or "not visible to this tenant") identity label is reused
# before re-querying — a recognized track persists across many ticks, so this
# keeps the detections feed off the database on all but the first sighting.
_DETECTION_LABEL_TTL_SECONDS = 10.0


async def _label_detections(
    faces: list[dict], org_id: set[int] | None, cache: dict[str, tuple]
) -> None:
    """Attach tenant-gated display names to recognized faces, in place.

    The engine hands us the raw FAISS identity per recognized face. We resolve
    it through ``authorize_match`` (the same tenancy gate the kiosk uses), drop
    the raw identity from the wire, and add ``name``/``code``. An identity not
    visible to ``org_id`` is downgraded to "unknown" so neither the name nor the
    existence of a cross-tenant match leaks.
    """
    from time import monotonic

    now = monotonic()
    pending = {
        f["employee_id"]
        for f in faces
        if f.get("status") == "recognized"
        and f.get("employee_id")
        and cache.get(f["employee_id"], (None, None, 0.0))[2] < now
    }
    if pending:
        from app.services.recognition_service import authorize_match

        async with async_session_factory() as db:
            for identity in pending:
                row = await authorize_match(db, identity, org_id)
                if row is None:
                    cache[identity] = (None, None, now + _DETECTION_LABEL_TTL_SECONDS)
                    continue
                name = getattr(row, "name", None) or " ".join(
                    p
                    for p in (getattr(row, "first_name", None), getattr(row, "last_name", None))
                    if p
                ).strip()
                code = getattr(row, "employee_code", None)
                cache[identity] = (name or None, code, now + _DETECTION_LABEL_TTL_SECONDS)

    for face in faces:
        identity = face.pop("employee_id", None)  # never expose the raw pk/identity
        if face.get("status") != "recognized":
            face["name"] = None
            face["code"] = None
            continue
        entry = cache.get(identity)
        if entry is not None and entry[0] is None and entry[1] is None:
            # Resolved but not visible to this tenant — show as a plain unknown.
            face["status"] = "unknown"
            face["confidence"] = None
            face["name"] = None
            face["code"] = None
        elif entry is not None:
            face["name"] = entry[0]
            face["code"] = entry[1]
        else:
            face["name"] = None
            face["code"] = None


async def _send_camera_detections(
    websocket: WebSocket, camera_id: int, org_id: set[int] | None, fps: int = 5
) -> None:
    """Push the camera's live per-face detection state as JSON, capped at ``fps``.

    Companion channel to the raw-JPEG preview: the browser draws boxes + labels
    from this while showing pixels from ``/ws``. Each message is the engine's
    ``get_camera_detections`` snapshot (normalised boxes + derived status) with
    tenant-gated names merged in.
    """
    from app.engine.recognition_engine import get_recognition_engine

    engine = get_recognition_engine()
    interval = 1.0 / max(fps, 1)
    label_cache: dict[str, tuple] = {}
    while True:
        # Direct call (not a thread): the snapshot is a pure in-memory read and
        # must stay atomic against the engine's coroutines on this same loop.
        snapshot = engine.get_camera_detections(camera_id)
        await _label_detections(snapshot["faces"], org_id, label_cache)
        await websocket.send_json({"type": "detections", **snapshot})
        await asyncio.sleep(interval)


@router.websocket("/api/v1/engine/streams/{camera_id}/detections/ws")
async def stream_detections_ws(websocket: WebSocket, camera_id: int) -> None:
    """Live per-face detection metadata (boxes + identity) for one camera."""
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    token = _extract_token(websocket)
    identity = await _resolve_identity(token, websocket.query_params.get("org"))
    if identity is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    _user_id, org_id = identity

    await websocket.accept(subprotocol=_BEARER_SUBPROTOCOL)

    sender = asyncio.create_task(_send_camera_detections(websocket, camera_id, org_id))
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


async def _push_engine_status(websocket: WebSocket, period: float = 2.0) -> None:
    """Push engine status + stream telemetry as JSON on a fixed cadence.

    Replaces the AI Engine dashboard's 5s HTTP polling with a live feed while the
    page is open. Each message is ``{"status": <EngineStatus>, "streams": ...}``.
    """
    from fastapi.concurrency import run_in_threadpool
    from fastapi.encoders import jsonable_encoder

    from app.engine.recognition_engine import get_recognition_engine
    from app.engine.stream_manager import get_stream_manager

    engine = get_recognition_engine()
    manager = get_stream_manager()
    while True:
        status_payload = await run_in_threadpool(engine.get_engine_status)
        streams_payload = await run_in_threadpool(manager.get_all_status)
        await websocket.send_json(
            {
                "status": jsonable_encoder(status_payload),
                "streams": jsonable_encoder(streams_payload),
            }
        )
        await asyncio.sleep(period)


async def _push_monitoring(websocket: WebSocket, org_id: set[int] | None, period: float = 3.0) -> None:
    """Push the monitoring dashboard + live feed (tenant-scoped) on a fixed cadence.

    Gives the monitoring page smoothly-ticking counters without leaning on the
    per-event cache invalidation (which refetches on every recognition). Validated
    through the same response models as the HTTP endpoints so the shape matches.
    """
    from fastapi.encoders import jsonable_encoder

    from app.core.database import async_session_factory
    from app.schemas.monitoring import LiveFeedOut, MonitoringDashboardOut
    from app.services import monitoring_service

    while True:
        async with async_session_factory() as db:
            dashboard = await monitoring_service.build_dashboard(db, org_id)
            live_feed = await monitoring_service.build_live_feed(db, org_id)
        await websocket.send_json(
            {
                "dashboard": jsonable_encoder(MonitoringDashboardOut.model_validate(dashboard)),
                "live_feed": jsonable_encoder(LiveFeedOut.model_validate(live_feed)),
            }
        )
        await asyncio.sleep(period)


@router.websocket("/api/v1/monitoring/ws")
async def monitoring_ws(websocket: WebSocket) -> None:
    """Live monitoring dashboard + feed for the monitoring page."""
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    token = _extract_token(websocket)
    identity = await _resolve_identity(token, websocket.query_params.get("org"))
    if identity is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    _user_id, org_id = identity

    await websocket.accept(subprotocol=_BEARER_SUBPROTOCOL)

    sender = asyncio.create_task(_push_monitoring(websocket, org_id))
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


@router.websocket("/api/v1/engine/status/ws")
async def engine_status_ws(websocket: WebSocket) -> None:
    """Live engine status + stream telemetry for the AI Engine dashboard."""
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    token = _extract_token(websocket)
    identity = await _resolve_identity(token, websocket.query_params.get("org"))
    if identity is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept(subprotocol=_BEARER_SUBPROTOCOL)

    sender = asyncio.create_task(_push_engine_status(websocket))
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
    user_id, org_ids = identity

    hub = get_hub()
    conn = await hub.register(user_id, org_ids)
    if conn is None:
        # Per-user connection cap reached.
        await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
        return

    # Echo the negotiated subprotocol so the browser completes the handshake.
    # org_ids is a set (or None) → JSON-serialize as a sorted list.
    org_list = sorted(org_ids) if org_ids is not None else None
    await websocket.accept(subprotocol=_BEARER_SUBPROTOCOL)
    await websocket.send_json({"type": "connected", "data": {"org_ids": org_list}, "org_ids": org_list})

    # Chat presence: announce "online" only for the company roots where this is
    # the user's first live socket (the transition is computed atomically, shared
    # via Redis across workers). Skipped for a global super admin (org_ids None).
    if org_ids:
        for root in await hub.presence_connect(user_id, org_ids):
            await emit(root, "chat.presence", {"user_id": user_id, "online": True})

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
        # Retract presence only where the user's last socket just closed.
        if org_ids:
            for root in await hub.presence_disconnect(user_id, org_ids):
                await emit(root, "chat.presence", {"user_id": user_id, "online": False})
