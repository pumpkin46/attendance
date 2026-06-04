"""API endpoints for the AI Recognition Engine."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.engine.config import engine_config
from app.engine.recognition_engine import get_recognition_engine
from app.engine.stream_manager import (
    CameraType,
    StreamMode,
    StreamProtocol,
    get_stream_manager,
)
from app.engine.metrics import get_metrics
from app.engine.unknown_detector import get_unknown_detector
from app.engine.face_tracker import get_tracker
from app.engine.vector_search import get_vector_search

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


@router.post("/recognize")
async def engine_recognize(
    body: EngineRecognizeRequest,
    user: CurrentUser,
    db: DbSession,
    org_id: TenantOrgId,
):
    """Run the full 9-stage recognition pipeline on an image."""
    engine = get_recognition_engine()
    result = engine.recognize_image(
        body.image,
        camera_id=body.camera_id,
        location_id=body.location_id,
        zone=body.zone,
        direction=body.direction,
        rfid_employee_id=body.rfid_employee_id,
        liveness_frames_b64=body.liveness_frames,
    )

    if result.attendance_event:
        from app.services import attendance_service
        emp_id_str = result.employee_id
        if emp_id_str and not emp_id_str.startswith("visitor-"):
            try:
                await attendance_service.process_recognition(
                    db=db,
                    employee_id=int(emp_id_str),
                    camera_id=body.camera_id,
                    confidence=result.confidence,
                    liveness_passed=result.liveness_passed,
                    method="face",
                )
            except (ValueError, TypeError) as exc:
                # Non-numeric employee id from the engine — skip the attendance
                # write but record why so it is not silently lost.
                logger.warning(
                    "Skipping attendance write for employee_id=%r: %s",
                    emp_id_str,
                    exc,
                )

    return result.to_dict()


@router.post("/recognize-stream")
async def engine_recognize_stream(
    body: EngineStreamRecognizeRequest,
    user: CurrentUser,
):
    """Capture a frame from a video stream and run recognition."""
    engine = get_recognition_engine()
    result = engine.recognize_stream(
        body.stream_url,
        camera_id=body.camera_id,
        location_id=body.location_id,
        zone=body.zone,
        direction=body.direction,
    )
    return result.to_dict()


@router.post("/detect")
async def engine_detect(body: EngineDetectRequest, user: CurrentUser):
    """Detect faces in an image without running full recognition."""
    engine = get_recognition_engine()
    return engine.detect_faces(body.image)


# ─── Stream Management ────────────────────────────────────────────────────────


@router.post("/streams/add")
async def add_stream(
    body: StreamAddRequest,
    user: require_permission("cameras.manage"),
):
    """Register a new camera stream for real-time processing."""
    manager = get_stream_manager()
    try:
        protocol = StreamProtocol(body.protocol)
    except ValueError:
        protocol = StreamProtocol.RTSP
    try:
        camera_type = CameraType(body.camera_type)
    except ValueError:
        camera_type = CameraType.IP_CAMERA
    try:
        mode = StreamMode(body.mode)
    except ValueError:
        mode = StreamMode.LIVE_STREAM

    stream = manager.add_stream(
        camera_id=body.camera_id,
        stream_url=body.stream_url,
        protocol=protocol,
        camera_type=camera_type,
        mode=mode,
        organization_id=body.organization_id,
        location_id=body.location_id,
        zone=body.zone,
        direction=body.direction,
        target_fps=body.target_fps,
        resolution=(body.resolution_width, body.resolution_height),
    )
    return {"success": True, "camera_id": body.camera_id, "status": stream.status.value}


@router.post("/streams/start")
async def start_stream(body: StreamControlRequest, user: require_permission("cameras.manage")):
    """Start processing a registered stream."""
    manager = get_stream_manager()
    ok = await manager.start_stream(body.camera_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Stream not found")
    return {"success": True, "camera_id": body.camera_id}


@router.post("/streams/stop")
async def stop_stream(body: StreamControlRequest, user: require_permission("cameras.manage")):
    """Stop processing a stream."""
    manager = get_stream_manager()
    ok = await manager.stop_stream(body.camera_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Stream not found")
    return {"success": True, "camera_id": body.camera_id}


@router.delete("/streams/{camera_id}")
async def remove_stream(camera_id: int, user: require_permission("cameras.manage")):
    """Remove a stream from the engine."""
    manager = get_stream_manager()
    manager.remove_stream(camera_id)
    return {"success": True, "camera_id": camera_id}


@router.get("/streams")
async def list_streams(user: CurrentUser):
    """Get status of all registered streams."""
    manager = get_stream_manager()
    return manager.get_all_status()


@router.get("/streams/{camera_id}")
async def get_stream_status(camera_id: int, user: CurrentUser):
    """Get status of a specific stream."""
    manager = get_stream_manager()
    status_info = manager.get_stream_status(camera_id)
    if not status_info:
        raise HTTPException(status_code=404, detail="Stream not found")
    return status_info


# ─── Engine Control ───────────────────────────────────────────────────────────


@router.post("/start")
async def start_engine(user: require_permission("recognition.manage")):
    """Start the recognition engine."""
    engine = get_recognition_engine()
    await engine.start()
    return {"success": True, "status": "running"}


@router.post("/stop")
async def stop_engine(user: require_permission("recognition.manage")):
    """Stop the recognition engine."""
    engine = get_recognition_engine()
    await engine.stop()
    return {"success": True, "status": "stopped"}


@router.get("/status")
async def get_engine_status(user: CurrentUser):
    """Get comprehensive engine status."""
    engine = get_recognition_engine()
    return engine.get_engine_status()


# ─── Metrics & Monitoring ─────────────────────────────────────────────────────


@router.get("/metrics")
async def get_engine_metrics(user: require_permission("recognition.view")):
    """Get engine performance metrics."""
    metrics = get_metrics()
    return metrics.get_performance_summary()


@router.get("/metrics/sla")
async def get_sla_compliance(user: require_permission("recognition.view")):
    """Get SLA compliance report."""
    metrics = get_metrics()
    return metrics.get_sla_compliance()


@router.get("/metrics/recognition")
async def get_recognition_metrics(user: require_permission("recognition.view")):
    """Get recognition-specific metrics."""
    metrics = get_metrics()
    return metrics.recognition.to_dict()


# ─── Unknown Persons ──────────────────────────────────────────────────────────


@router.get("/unknown-persons")
async def list_unknown_persons(
    user: require_permission("recognition.view"),
    limit: int = 50,
):
    """Get recent unknown person detections."""
    detector = get_unknown_detector()
    events = detector.get_recent_events(limit)
    return {
        "events": [e.to_dict() for e in events],
        "total": len(events),
        "stats": detector.stats,
    }


# ─── Tracking ─────────────────────────────────────────────────────────────────


@router.get("/tracking/stats")
async def get_tracking_stats(user: CurrentUser):
    """Get face tracking statistics."""
    tracker = get_tracker()
    return tracker.get_stats()


# ─── Vector Index ─────────────────────────────────────────────────────────────


@router.get("/index/stats")
async def get_index_stats(user: CurrentUser):
    """Get vector search index statistics."""
    search = get_vector_search()
    return search.get_stats()


@router.post("/index/reload")
async def reload_index(user: require_permission("recognition.manage")):
    """Reload the FAISS index from disk."""
    search = get_vector_search()
    search.reload()
    return {"success": True, **search.get_stats()}


# ─── Configuration ────────────────────────────────────────────────────────────


@router.get("/config")
async def get_engine_config(user: require_permission("recognition.view")):
    """Get current engine configuration."""
    return engine_config.to_dict()


@router.patch("/config")
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


@router.get("/performance-requirements")
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
