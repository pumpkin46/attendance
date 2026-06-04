from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.core.dependencies import CurrentUser, require_permission
from app.core.errors import ValidationError
from app.core.rate_limit import recognition_rate_limit
from app.schemas.recognition import (
    DeleteRequest,
    DeleteResponse,
    DetectRequest,
    DetectResponse,
    EnrollBatchRequest,
    EnrollBatchResponse,
    EnrollRequest,
    EnrollResponse,
    LivenessVerifyRequest,
    LivenessVerifyResponse,
    IdentifyRequest,
    IdentifyResponse,
    RecognizeRequest,
    RecognizeResponse,
    RecognizeStreamRequest,
    StreamCaptureRequest,
    StreamCaptureResponse,
    EmbeddingExportResponse,
    EmbeddingImportRequest,
    EmbeddingImportResponse,
    AnomalyAnalyzeRequest,
    AnomalyAnalyzeResponse,
    ValidateImageRequest,
    ValidateImageResponse,
    EnrollStructuredRequest,
    EnrollStructuredResponse,
)
from app.services import face_service
from app.services.anomaly_detector import analyze_records
from app.services.stream_capture import capture_stream_frame

router = APIRouter(prefix="/api/v1")


@router.post("/enroll", response_model=EnrollResponse)
async def enroll(req: EnrollRequest, user: require_permission("employees.manage")):
    result = await run_in_threadpool(face_service.enroll, req.employee_id, req.image)
    if not result.get("success"):
        raise ValidationError(result.get("error", "Enrollment failed"))
    return EnrollResponse(**result)


@router.post("/validate-image", response_model=ValidateImageResponse)
async def validate_image(req: ValidateImageRequest, user: CurrentUser):
    result = await run_in_threadpool(
        face_service.validate_image, req.image, req.expected_pose
    )
    return ValidateImageResponse(**result)


@router.post("/enroll-structured", response_model=EnrollStructuredResponse)
async def enroll_structured(req: EnrollStructuredRequest, user: require_permission("employees.manage")):
    result = await run_in_threadpool(
        face_service.enroll_structured, req.employee_id, req.poses
    )
    return EnrollStructuredResponse(**result)


@router.post("/enroll-batch", response_model=EnrollBatchResponse)
async def enroll_batch(req: EnrollBatchRequest, user: require_permission("employees.manage")):
    result = await run_in_threadpool(
        face_service.enroll_batch, req.employee_id, req.images
    )
    return EnrollBatchResponse(**result)


@router.post(
    "/recognize",
    response_model=RecognizeResponse,
    dependencies=[recognition_rate_limit()],
)
async def recognize(req: RecognizeRequest, user: CurrentUser):
    result = await run_in_threadpool(
        face_service.recognize,
        req.image,
        require_liveness=req.require_liveness,
        liveness_frames=req.liveness_frames,
        session_id=req.session_id,
        source=req.source,
    )
    return RecognizeResponse(**result)


@router.post(
    "/recognize-stream",
    response_model=RecognizeResponse,
    dependencies=[recognition_rate_limit()],
)
async def recognize_stream(req: RecognizeStreamRequest, user: CurrentUser):
    capture = await run_in_threadpool(capture_stream_frame, req.stream_url)
    if not capture.get("success"):
        raise ValidationError(capture.get("error", "Stream capture failed"))
    result = await run_in_threadpool(
        face_service.recognize,
        capture["image"],
        require_liveness=req.require_liveness,
        session_id=req.session_id,
        source=req.source or "rtsp",
    )
    result["capture_ms"] = capture.get("processing_ms")
    return RecognizeResponse(**result)


@router.post(
    "/identify",
    response_model=IdentifyResponse,
    dependencies=[recognition_rate_limit()],
)
async def identify(req: IdentifyRequest, user: CurrentUser):
    result = await run_in_threadpool(
        face_service.identify,
        req.image,
        req.require_liveness,
        req.liveness_frames,
        session_id=req.session_id,
        source=req.source,
    )
    return IdentifyResponse(**result)


@router.post("/liveness/verify", response_model=LivenessVerifyResponse)
async def liveness_verify(req: LivenessVerifyRequest, user: CurrentUser):
    result = await run_in_threadpool(face_service.verify_liveness_sequence, req.frames)
    return LivenessVerifyResponse(**result)


@router.post("/detect", response_model=DetectResponse)
async def detect(req: DetectRequest, user: CurrentUser):
    result = await run_in_threadpool(face_service.detect_faces, req.image)
    return DetectResponse(**result)


@router.post("/capture-stream", response_model=StreamCaptureResponse)
async def capture_stream(req: StreamCaptureRequest, user: require_permission("cameras.manage")):
    result = await run_in_threadpool(capture_stream_frame, req.stream_url)
    if not result.get("success"):
        raise ValidationError(result.get("error", "Stream capture failed"))
    return StreamCaptureResponse(**result)


@router.get("/embeddings/export", response_model=EmbeddingExportResponse)
async def export_embeddings(user: require_permission("recognition.manage")):
    result = await run_in_threadpool(face_service.export_embeddings)
    return EmbeddingExportResponse(**result)


@router.post("/embeddings/import", response_model=EmbeddingImportResponse)
async def import_embeddings(req: EmbeddingImportRequest, user: require_permission("recognition.manage")):
    result = await run_in_threadpool(
        face_service.import_embeddings, req.index_b64, req.metadata
    )
    return EmbeddingImportResponse(**result)


@router.post("/embeddings/reload", response_model=EmbeddingImportResponse)
async def reload_embeddings(user: require_permission("recognition.manage")):
    result = await run_in_threadpool(face_service.reload_embeddings)
    return EmbeddingImportResponse(**result)


@router.post("/anomalies/analyze", response_model=AnomalyAnalyzeResponse)
async def analyze_anomalies(req: AnomalyAnalyzeRequest, user: CurrentUser):
    records = [r.model_dump() for r in req.records]
    result = await run_in_threadpool(analyze_records, records, req.config)
    return AnomalyAnalyzeResponse(**result)


@router.post("/delete", response_model=DeleteResponse)
async def delete_embedding(req: DeleteRequest, user: require_permission("employees.manage")):
    result = await run_in_threadpool(face_service.delete_employee, req.employee_id)
    return DeleteResponse(**result)
