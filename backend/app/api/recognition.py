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
    EvaluationReport,
    EvaluationRequest,
    EventFeedbackRequest,
    EventFeedbackResponse,
    PerformanceComplianceResponse,
    RecognitionConfigResponse,
    RecognitionEventOut,
    RecognitionMetrics,
    UnknownSummary,
)
from app.services import face_service, recognition_evaluation, recognition_service
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
    outcome = await recognition_service.record_identification(
        db, result, org_id, image_b64=body.image, camera_id=body.camera_id
    )
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
async def recognize_from_stream(
    body: RecognizeStreamRequest,
    # cameras.manage: opening an arbitrary client-supplied URL server-side is
    # an SSRF primitive; restrict to camera administrators (mirrors
    # /engine/streams/add) on top of validate_stream_url.
    user: require_permission("cameras.manage"),
):
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
    org_id: TenantOrgId = None,
):
    path = await recognition_service.snapshot_path(db, event_id, org_id)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/recognition/unknown-summary", response_model=UnknownSummary)
async def get_unknown_summary(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId = None,
):
    return await recognition_service.unknown_summary(db, org_id)


@router.get(
    "/recognition/performance-compliance",
    response_model=PerformanceComplianceResponse,
)
async def get_performance_compliance(user: require_permission("recognition.view")):
    """Required performance metrics (accuracy, FPR, FNR, latency) vs measured.

    Accuracy/FPR/FNR are measured from ground-truth-labeled outcomes (event
    feedback and evaluation runs); latency comes from live pipeline stage
    timings. ``met`` is null for metrics with no measurement yet.
    """
    from app.engine.metrics import get_metrics

    metrics = get_metrics()
    rec = metrics.recognition
    stage_avgs = metrics.get_stage_averages()
    recognition_ms = (
        sum(v for k, v in stage_avgs.items() if k != "liveness_detection")
        if stage_avgs else None
    )
    return PerformanceComplianceResponse(
        requirements=recognition_evaluation.requirements_compliance(
            accuracy=rec.measured_accuracy,
            false_positive_rate=rec.false_positive_rate,
            false_negative_rate=rec.false_negative_rate,
            recognition_ms=recognition_ms,
            liveness_ms=stage_avgs.get("liveness_detection"),
        ),
        labeled_samples=rec.labeled_total,
        pipeline_stage_averages_ms={k: round(v, 1) for k, v in stage_avgs.items()},
    )


@router.post("/recognition/evaluate", response_model=EvaluationReport)
async def evaluate_recognition(
    body: EvaluationRequest,
    user: require_permission("recognition.manage"),
):
    """Run a labeled accuracy evaluation against the live pipeline and index.

    Genuine probes (employee_id set) measure accuracy and false rejects;
    impostor probes (employee_id null) measure false accepts. Returns the
    measured metrics with a compliance verdict per requirement.
    """
    return await run_in_threadpool(
        recognition_evaluation.evaluate,
        [s.model_dump() for s in body.samples],
        require_liveness=body.require_liveness,
        record_metrics=body.record_metrics,
    )


@router.post(
    "/recognition/events/{event_id}/feedback",
    response_model=EventFeedbackResponse,
)
async def record_event_feedback(
    event_id: int,
    body: EventFeedbackRequest,
    db: DbSession,
    user: require_permission("recognition.manage"),
    org_id: TenantOrgId = None,
):
    """Label a recognition event as correct/incorrect (ground truth).

    Feeds measured accuracy / false positive rate / false negative rate so the
    performance-compliance report reflects real-world outcomes.
    """
    return await recognition_service.record_event_feedback(
        db, event_id, body.outcome, org_id, note=body.note, user_id=user.id
    )
