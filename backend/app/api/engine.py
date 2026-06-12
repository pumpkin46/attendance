"""API endpoints for the AI Recognition Engine."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.engine.config import engine_config
from app.engine.recognition_engine import get_recognition_engine
from app.engine.stream_manager import (
    StreamMode,
    StreamProtocol,
    get_stream_manager,
)
from app.engine.metrics import get_metrics
from app.engine.unknown_detector import get_unknown_detector
from app.engine.face_tracker import get_tracker
from app.engine.vector_search import get_vector_search
from app.realtime.hub import emit
from app.schemas.engine import (
    EngineActionResult,
    EngineConfigResponse,
    EngineConfigUpdateResult,
    EngineStatus,
    FaceDetectionResult,
    IndexReloadResult,
    IndexStats,
    PerformanceRequirements,
    PerformanceSummary,
    RecognitionMetrics,
    RecognitionResult,
    SLACompliance,
    StreamAddResult,
    StreamControlResult,
    StreamListStatus,
    StreamStatus,
    TrackingStats,
    UnknownPersonsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/engine", tags=["recognition-engine"])


# ─── Request / Response Models ────────────────────────────────────────────────


class EngineRecognizeRequest(BaseModel):
    image: str
    camera_id: int | None = None
    location_id: int | None = None
    zone: str | None = None
    direction: str | None = None
    rfid_employee_id: str | None = None
    liveness_frames: list[str] | None = None
    require_liveness: bool = True


class EngineStreamRecognizeRequest(BaseModel):
    stream_url: str
    camera_id: int | None = None
    location_id: int | None = None
    zone: str | None = None
    direction: str | None = None


class EngineDetectRequest(BaseModel):
    image: str


class StreamAddRequest(BaseModel):
    camera_id: int
    stream_url: str
    protocol: str = "rtsp"
    camera_type: str = "ip_camera"
    mode: str = "live_stream"
    organization_id: int | None = None
    location_id: int | None = None
    zone: str | None = None
    direction: str = "both"
    target_fps: int = 30
    resolution_width: int = 1920
    resolution_height: int = 1080


class StreamControlRequest(BaseModel):
    camera_id: int


class EngineConfigUpdate(BaseModel):
    recognition_threshold: float | None = None
    liveness_min_score: float | None = None
    liveness_enabled: bool | None = None
    duplicate_window_seconds: int | None = None
    unknown_person_enabled: bool | None = None
    max_faces_per_frame: int | None = None


# ─── Recognition Endpoints ────────────────────────────────────────────────────


async def _veto_unauthorized_match(db, payload: dict, org_id: int | None) -> bool:
    """Strip an identity the caller's tenant may not see; True when vetoed.

    The FAISS index is global: a match outside org_id is rewritten in place to
    the pipeline's unknown representation so neither the employee_id nor the
    name leaks across tenants.
    """
    from app.services.recognition_service import authorize_match

    if payload.get("employee_id") is None:
        return False
    if await authorize_match(db, str(payload["employee_id"]), org_id) is not None:
        return False
    logger.warning(
        "Engine match suppressed: identity %s not visible to org %s",
        payload["employee_id"],
        org_id,
    )
    payload.update(
        employee_id=None,
        employee_name=None,
        matched=False,
        event_type=None,
        is_unknown=True,
        reason="low_confidence",
    )
    return True


async def _persist_inline_attendance(
    db, result, org_id: int | None, camera_id: int | None, direction: str | None
) -> None:
    """Write the attendance row for an API-initiated recognition.

    API recognitions run with enqueue=False, so their events never reach the
    background consumer's queue: this inline write is the only writer (no
    claim race, no replay of a kiosk toggle as a check-in). Callers must have
    passed the tenancy veto first. "in"/"out" kiosks carry an explicit
    intent; anything else keeps the kiosk toggle (intent=None).
    """
    from app.engine.attendance_sync import employee_pk_from_identity
    from app.services import attendance_service

    if result.attendance_event is None:
        return
    employee_pk = employee_pk_from_identity(result.employee_id)
    if employee_pk is None:
        return
    await attendance_service.process_recognition(
        db=db,
        employee_id=employee_pk,
        camera_id=camera_id,
        confidence=result.confidence,
        liveness_passed=result.liveness_passed,
        organization_id=org_id,
        method="face",
        intent={"in": "check_in", "out": "check_out"}.get(direction),
    )


@router.post("/recognize", response_model=RecognitionResult)
async def engine_recognize(
    body: EngineRecognizeRequest,
    user: CurrentUser,
    db: DbSession,
    org_id: TenantOrgId,
):
    """Run the full 9-stage recognition pipeline on an image."""
    engine = get_recognition_engine()
    # enqueue=False: the event bypasses the background consumer's queue
    # entirely, so this handler is its only writer. There is no claim race to
    # lose: the consumer can neither replay a kiosk toggle punch with its
    # check_in intent nor persist a match the tenancy veto strips below.
    result = await run_in_threadpool(
        engine.recognize_image,
        body.image,
        camera_id=body.camera_id,
        location_id=body.location_id,
        zone=body.zone,
        direction=body.direction,
        rfid_employee_id=body.rfid_employee_id,
        liveness_frames_b64=body.liveness_frames,
        enqueue=False,
    )

    payload = result.to_dict()
    if await _veto_unauthorized_match(db, payload, org_id):
        return payload

    await _persist_inline_attendance(db, result, org_id, body.camera_id, body.direction)
    return payload


@router.post("/recognize-stream", response_model=RecognitionResult)
async def engine_recognize_stream(
    body: EngineStreamRecognizeRequest,
    db: DbSession,
    # cameras.manage + URL validation: a raw stream_url opened server-side is
    # an SSRF primitive (see services.stream_capture.validate_stream_url).
    user: require_permission("cameras.manage"),
    org_id: TenantOrgId,
):
    """Capture a frame from a video stream and run recognition."""
    from app.services.stream_capture import validate_stream_url

    error = await run_in_threadpool(validate_stream_url, body.stream_url)
    if error is not None:
        raise ValidationError(error)

    engine = get_recognition_engine()
    # enqueue=False for the same reason as /recognize: this handler is the
    # event's only writer, so a vetoed cross-tenant match can never be
    # persisted by the background consumer.
    result = await run_in_threadpool(
        engine.recognize_stream,
        body.stream_url,
        camera_id=body.camera_id,
        location_id=body.location_id,
        zone=body.zone,
        direction=body.direction,
        enqueue=False,
    )
    payload = result.to_dict()
    if await _veto_unauthorized_match(db, payload, org_id):
        return payload

    await _persist_inline_attendance(db, result, org_id, body.camera_id, body.direction)
    return payload


@router.post("/detect", response_model=FaceDetectionResult)
async def engine_detect(body: EngineDetectRequest, user: CurrentUser):
    """Detect faces in an image without running full recognition."""
    engine = get_recognition_engine()
    return await run_in_threadpool(engine.detect_faces, body.image)


# ─── Stream Management ────────────────────────────────────────────────────────


@router.post("/streams/add", response_model=StreamAddResult)
async def add_stream(
    body: StreamAddRequest,
    user: require_permission("cameras.manage"),
    db: DbSession,
    org_id: TenantOrgId,
):
    """Register a camera stream and persist its settings on the camera row.

    The camera must already exist; stream settings are written back to it so
    the registration survives backend restarts (the engine re-registers all
    active cameras with a stream URL on start).
    """
    from app.core.cache import invalidate_prefix
    from app.models.camera import CameraDirection
    from app.services import camera_service, stream_sync
    from app.services.stream_capture import validate_stream_url

    url_error = await run_in_threadpool(validate_stream_url, body.stream_url)
    if url_error is not None:
        raise ValidationError(url_error)

    camera = await camera_service.get_camera(db, body.camera_id, org_id)

    provided = body.model_fields_set
    camera.stream_url = body.stream_url
    if "target_fps" in provided:
        camera.target_fps = body.target_fps
    if "resolution_width" in provided:
        camera.resolution_width = body.resolution_width
    if "resolution_height" in provided:
        camera.resolution_height = body.resolution_height
    if "zone" in provided and body.zone:
        camera.zone = body.zone
    if "direction" in provided:
        try:
            camera.direction = CameraDirection(body.direction)
        except ValueError:
            pass
    await db.flush()
    await invalidate_prefix("cache:cameras:")

    protocol: StreamProtocol | None = None
    if "protocol" in provided:
        try:
            protocol = StreamProtocol(body.protocol)
        except ValueError:
            protocol = None
    try:
        mode = StreamMode(body.mode)
    except ValueError:
        mode = StreamMode.LIVE_STREAM

    manager = get_stream_manager()
    if manager.get_stream(body.camera_id) is not None:
        manager.remove_stream(body.camera_id)
    stream_sync.register_camera(
        manager,
        camera,
        camera.location.organization_id if camera.location else org_id,
        protocol=protocol,
        mode=mode,
    )
    stream = manager.get_stream(body.camera_id)
    return {"success": True, "camera_id": body.camera_id, "status": stream.status.value}


@router.post("/streams/start", response_model=StreamControlResult)
async def start_stream(body: StreamControlRequest, user: require_permission("cameras.manage")):
    """Start processing a registered stream."""
    manager = get_stream_manager()
    ok = await manager.start_stream(body.camera_id)
    if not ok:
        raise NotFoundError("Stream not found")
    return {"success": True, "camera_id": body.camera_id}


@router.post("/streams/stop", response_model=StreamControlResult)
async def stop_stream(body: StreamControlRequest, user: require_permission("cameras.manage")):
    """Stop processing a stream."""
    manager = get_stream_manager()
    ok = await manager.stop_stream(body.camera_id)
    if not ok:
        raise NotFoundError("Stream not found")
    return {"success": True, "camera_id": body.camera_id}


@router.delete("/streams/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_stream(camera_id: int, user: require_permission("cameras.manage")):
    """Remove a stream from the engine."""
    manager = get_stream_manager()
    # remove_stream only signals the read loop and pops the registry entry
    # (the loop releases its own capture), so run it on the loop rather than a
    # worker thread that would race the manager's state.
    manager.remove_stream(camera_id)
    return None


@router.get("/streams", response_model=StreamListStatus)
async def list_streams(user: CurrentUser):
    """Get status of all registered streams."""
    manager = get_stream_manager()
    return await run_in_threadpool(manager.get_all_status)


@router.get("/streams/{camera_id}", response_model=StreamStatus)
async def get_stream_status(camera_id: int, user: CurrentUser):
    """Get status of a specific stream."""
    manager = get_stream_manager()
    status_info = await run_in_threadpool(manager.get_stream_status, camera_id)
    if not status_info:
        raise NotFoundError("Stream not found")
    return status_info


@router.get("/streams/{camera_id}/snapshot")
async def get_stream_snapshot(camera_id: int, user: CurrentUser):
    """Latest frame of a running stream as a JPEG (live preview; poll to refresh)."""
    manager = get_stream_manager()
    jpeg = await run_in_threadpool(manager.snapshot_jpeg, camera_id)
    if jpeg is None:
        raise NotFoundError("No frame available — start the engine and this stream first")
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ─── Engine Control ───────────────────────────────────────────────────────────


@router.post("/start", response_model=EngineActionResult)
async def start_engine(user: require_permission("recognition.manage"), db: DbSession):
    """Start the recognition engine.

    Re-registers streams for all active cameras with a stream URL first, so
    registrations survive backend restarts.
    """
    from app.services.stream_sync import sync_streams_from_db

    synced = await sync_streams_from_db(db)
    engine = get_recognition_engine()
    await engine.start()
    await emit(None, "engine.changed", {"status": "running"})
    return {"success": True, "status": "running", "streams_synced": synced}


@router.post("/stop", response_model=EngineActionResult)
async def stop_engine(user: require_permission("recognition.manage")):
    """Stop the recognition engine."""
    engine = get_recognition_engine()
    await engine.stop()
    await emit(None, "engine.changed", {"status": "stopped"})
    return {"success": True, "status": "stopped"}


@router.get("/status", response_model=EngineStatus)
async def get_engine_status(user: CurrentUser):
    """Get comprehensive engine status."""
    engine = get_recognition_engine()
    return await run_in_threadpool(engine.get_engine_status)


# ─── Metrics & Monitoring ─────────────────────────────────────────────────────


@router.get("/metrics", response_model=PerformanceSummary)
async def get_engine_metrics(user: require_permission("recognition.view")):
    """Get engine performance metrics."""
    metrics = get_metrics()
    return await run_in_threadpool(metrics.get_performance_summary)


@router.get("/metrics/sla", response_model=SLACompliance)
async def get_sla_compliance(user: require_permission("recognition.view")):
    """Get SLA compliance report."""
    metrics = get_metrics()
    return await run_in_threadpool(metrics.get_sla_compliance)


@router.get("/metrics/recognition", response_model=RecognitionMetrics)
async def get_recognition_metrics(user: require_permission("recognition.view")):
    """Get recognition-specific metrics."""
    metrics = get_metrics()
    return await run_in_threadpool(metrics.recognition.to_dict)


# ─── Unknown Persons ──────────────────────────────────────────────────────────


@router.get("/unknown-persons", response_model=UnknownPersonsResponse)
async def list_unknown_persons(
    user: require_permission("recognition.view"),
    limit: int = 50,
):
    """Get recent unknown person detections."""
    detector = get_unknown_detector()
    events = await run_in_threadpool(detector.get_recent_events, limit)
    return {
        "events": [e.to_dict() for e in events],
        "total": len(events),
        "stats": detector.stats,
    }


# ─── Tracking ─────────────────────────────────────────────────────────────────


@router.get("/tracking/stats", response_model=TrackingStats)
async def get_tracking_stats(user: CurrentUser):
    """Get face tracking statistics."""
    tracker = get_tracker()
    return await run_in_threadpool(tracker.get_stats)


# ─── Vector Index ─────────────────────────────────────────────────────────────


@router.get("/index/stats", response_model=IndexStats)
async def get_index_stats(user: CurrentUser):
    """Get vector search index statistics."""
    search = get_vector_search()
    return await run_in_threadpool(search.get_stats)


@router.post("/index/reload", response_model=IndexReloadResult)
async def reload_index(user: require_permission("recognition.manage")):
    """Reload the FAISS index from disk."""
    search = get_vector_search()
    await run_in_threadpool(search.reload)
    stats = await run_in_threadpool(search.get_stats)
    return {"success": True, **stats}


# ─── Configuration ────────────────────────────────────────────────────────────


@router.get("/config", response_model=EngineConfigResponse)
async def get_engine_config(user: require_permission("recognition.view")):
    """Get current engine configuration."""
    return engine_config.to_dict()


@router.patch("/config", response_model=EngineConfigUpdateResult)
async def update_engine_config(
    body: EngineConfigUpdate,
    user: require_permission("recognition.manage"),
):
    """Update engine configuration at runtime."""
    updates = {}
    if body.recognition_threshold is not None:
        engine_config.search.auto_accept_threshold = body.recognition_threshold
        updates["recognition_threshold"] = body.recognition_threshold
    if body.liveness_min_score is not None:
        engine_config.liveness.min_score = body.liveness_min_score
        updates["liveness_min_score"] = body.liveness_min_score
    if body.liveness_enabled is not None:
        engine_config.liveness.enabled = body.liveness_enabled
        updates["liveness_enabled"] = body.liveness_enabled
    if body.duplicate_window_seconds is not None:
        engine_config.attendance.duplicate_window_seconds = body.duplicate_window_seconds
        updates["duplicate_window_seconds"] = body.duplicate_window_seconds
    if body.unknown_person_enabled is not None:
        engine_config.unknown_person.enabled = body.unknown_person_enabled
        updates["unknown_person_enabled"] = body.unknown_person_enabled
    if body.max_faces_per_frame is not None:
        engine_config.detection.max_faces_per_frame = body.max_faces_per_frame
        updates["max_faces_per_frame"] = body.max_faces_per_frame

    return {"success": True, "updated": updates}


# ─── Performance Requirements ─────────────────────────────────────────────────


@router.get("/performance-requirements", response_model=PerformanceRequirements)
async def get_performance_requirements(user: CurrentUser):
    """Get the performance SLA requirements for the engine."""
    perf = engine_config.performance
    scale = engine_config.scalability
    return {
        "performance": {
            "recognition_accuracy": f">= {perf.target_accuracy * 100}%",
            "false_positive_rate": f"< {perf.max_false_positive_rate * 100}%",
            "false_negative_rate": f"< {perf.max_false_negative_rate * 100}%",
            "face_detection_time": f"< {perf.max_detection_ms}ms",
            "embedding_generation": f"< {perf.max_embedding_ms}ms",
            "vector_search": f"< {perf.max_search_ms}ms",
            "recognition_time": f"< {perf.max_recognition_ms}ms",
            "liveness_verification": f"< {perf.max_liveness_ms}ms",
            "attendance_event_creation": f"< {perf.max_event_creation_ms}ms",
            "api_response_time": f"< {perf.max_api_response_ms}ms",
        },
        "scalability": {
            "max_employees": f"{scale.max_employees:,}+",
            "max_embeddings": f"{scale.max_embeddings:,}+",
            "max_cameras": f"{scale.max_cameras:,}+",
            "max_concurrent_streams": f"{scale.max_concurrent_streams:,}+",
            "max_faces_per_frame": f"{scale.max_faces_per_frame}+",
            "max_events_per_minute": f"{scale.max_events_per_minute:,}+",
        },
    }
