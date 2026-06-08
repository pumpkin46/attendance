from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import ValidationError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.core.rate_limit import recognition_rate_limit
from app.schemas.recognition import (
    DetectRequest,
    DetectResponse,
    IdentifyRequest,
    IdentifyResponse,
    LivenessVerifyRequest,
    LivenessVerifyResponse,
    RecognizeRequest,
    RecognizeResponse,
    RecognizeStreamRequest,
)
from app.schemas.recognition_api import (
    RecognitionConfigResponse,
    RecognitionEventOut,
    RecognitionMetrics,
    UnknownSummary,
)
from app.services import face_service, recognition_service
from app.services.stream_capture import capture_stream_frame

router = APIRouter(prefix="/api/v1", tags=["recognition"])


@router.get("/recognition/config", response_model=RecognitionConfigResponse)
async def get_recognition_config(user: CurrentUser):
    return RecognitionConfigResponse(
        recognition_threshold=settings.recognition_threshold,
        recognition_sla_ms=settings.recognition_sla_ms,
        liveness_enabled=settings.liveness_enabled,
        antispoof_enabled=settings.antispoof_enabled,
        attendance_min_confidence=settings.attendance_min_confidence,
        face_duplicate_window_seconds=settings.face_duplicate_window_seconds,
        max_processing_ms=settings.max_processing_ms,
        target_accuracy=settings.target_accuracy,
    )


@router.post("/recognition/detect", response_model=DetectResponse)
async def detect_faces(body: DetectRequest, user: CurrentUser):
    result = await run_in_threadpool(face_service.detect_faces, body.image)
    return DetectResponse(**result)


@router.post(
    "/recognition/identify",
    response_model=IdentifyResponse,
    dependencies=[recognition_rate_limit()],
)
async def identify_face(
    body: IdentifyRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    result = await run_in_threadpool(
        face_service.identify,
        image_b64=body.image,
        require_liveness=body.require_liveness,
        liveness_frames=body.liveness_frames,
        session_id=body.session_id,
        source=body.source,
    )
    outcome = await recognition_service.record_identification(db, result, org_id)
    return IdentifyResponse(
        **result,
        matched=outcome.get("matched", False),
        employee=outcome.get("employee"),
        attendance=outcome.get("attendance"),
    )


@router.post(
    "/recognition/recognize",
    response_model=RecognizeResponse,
    dependencies=[recognition_rate_limit()],
)
async def recognize_face(body: RecognizeRequest, user: CurrentUser):
    result = await run_in_threadpool(
        face_service.recognize,
        image_b64=body.image,
        require_liveness=body.require_liveness,
        liveness_frames=body.liveness_frames,
        session_id=body.session_id,
        source=body.source,
    )
    return RecognizeResponse(**result)


@router.post("/recognition/recognize-stream", response_model=RecognizeResponse)
async def recognize_from_stream(body: RecognizeStreamRequest, user: CurrentUser):
    capture = await run_in_threadpool(capture_stream_frame, body.stream_url)
    if not capture["success"]:
        raise ValidationError(capture.get("error", "Failed to capture frame from stream"))

    image_b64 = capture["image"]
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    result = await run_in_threadpool(
        face_service.recognize,
        image_b64=image_b64,
        require_liveness=body.require_liveness,
        session_id=body.session_id,
        source=body.source or "rtsp",
    )
    return RecognizeResponse(**result)


@router.post("/recognition/liveness/verify", response_model=LivenessVerifyResponse)
async def verify_liveness(body: LivenessVerifyRequest, user: CurrentUser):
    result = await run_in_threadpool(face_service.verify_liveness_sequence, body.frames)
    return LivenessVerifyResponse(**result)


@router.get("/recognition/metrics", response_model=RecognitionMetrics)
async def get_recognition_metrics(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId = None,
):
    return await recognition_service.metrics(db, org_id)


@router.get("/recognition/events", response_model=PaginatedResponse[RecognitionEventOut])
async def list_recognition_events(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = recognition_service.events_query(org_id)
    return await paginate(db, stmt, pagination.page, pagination.per_page, RecognitionEventOut)


@router.get("/recognition/events/{event_id}/snapshot")
async def get_event_snapshot(
    event_id: int,
    db: DbSession,
    user: require_permission("recognition.view"),
):
    path = await recognition_service.snapshot_path(db, event_id)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/recognition/unknown-summary", response_model=UnknownSummary)
async def get_unknown_summary(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId = None,
):
    return await recognition_service.unknown_summary(db, org_id)
