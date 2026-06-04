from fastapi import APIRouter, HTTPException

from app.core.dependencies import CurrentUser, require_permission
from app.schemas.recognition import (
    DeleteRequest,
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
def enroll(req: EnrollRequest, user: require_permission("employees.manage")):
    result = face_service.enroll(req.employee_id, req.image)
    if not result.get("success"):
        raise HTTPException(422, detail=result.get("error", "Enrollment failed"))
    return EnrollResponse(**result)


@router.post("/validate-image", response_model=ValidateImageResponse)
def validate_image(req: ValidateImageRequest, user: CurrentUser):
    return ValidateImageResponse(
        **face_service.validate_image(req.image, req.expected_pose)
    )


@router.post("/enroll-structured", response_model=EnrollStructuredResponse)
def enroll_structured(req: EnrollStructuredRequest, user: require_permission("employees.manage")):
    result = face_service.enroll_structured(req.employee_id, req.poses)
    if not result.get("success"):
        return EnrollStructuredResponse(**result)
    return EnrollStructuredResponse(**result)


@router.post("/enroll-batch", response_model=EnrollBatchResponse)
def enroll_batch(req: EnrollBatchRequest, user: require_permission("employees.manage")):
    result = face_service.enroll_batch(req.employee_id, req.images)
    if not result.get("success"):
        return EnrollBatchResponse(**result)
    return EnrollBatchResponse(**result)


@router.post("/recognize", response_model=RecognizeResponse)
def recognize(req: RecognizeRequest, user: CurrentUser):
    return RecognizeResponse(
        **face_service.recognize(
            req.image,
            require_liveness=req.require_liveness,
            liveness_frames=req.liveness_frames,
            session_id=req.session_id,
            source=req.source,
        )
    )


@router.post("/recognize-stream", response_model=RecognizeResponse)
def recognize_stream(req: RecognizeStreamRequest, user: CurrentUser):
    capture = capture_stream_frame(req.stream_url)
    if not capture.get("success"):
        raise HTTPException(422, detail=capture.get("error", "Stream capture failed"))
    result = face_service.recognize(
        capture["image"],
        require_liveness=req.require_liveness,
        session_id=req.session_id,
        source=req.source or "rtsp",
    )
    result["capture_ms"] = capture.get("processing_ms")
    return RecognizeResponse(**result)


@router.post("/identify", response_model=IdentifyResponse)
def identify(req: IdentifyRequest, user: CurrentUser):
    result = face_service.identify(
        req.image,
        req.require_liveness,
        req.liveness_frames,
        session_id=req.session_id,
        source=req.source,
    )
    return IdentifyResponse(**result)


@router.post("/liveness/verify", response_model=LivenessVerifyResponse)
def liveness_verify(req: LivenessVerifyRequest, user: CurrentUser):
    result = face_service.verify_liveness_sequence(req.frames)
    return LivenessVerifyResponse(**result)


@router.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest, user: CurrentUser):
    result = face_service.detect_faces(req.image)
    return DetectResponse(**result)


@router.post("/capture-stream", response_model=StreamCaptureResponse)
def capture_stream(req: StreamCaptureRequest, user: require_permission("cameras.manage")):
    result = capture_stream_frame(req.stream_url)
    if not result.get("success"):
        raise HTTPException(422, detail=result.get("error", "Stream capture failed"))
    return StreamCaptureResponse(**result)


@router.get("/embeddings/export", response_model=EmbeddingExportResponse)
def export_embeddings(user: require_permission("recognition.manage")):
    return EmbeddingExportResponse(**face_service.export_embeddings())


@router.post("/embeddings/import", response_model=EmbeddingImportResponse)
def import_embeddings(req: EmbeddingImportRequest, user: require_permission("recognition.manage")):
    result = face_service.import_embeddings(req.index_b64, req.metadata)
    return EmbeddingImportResponse(**result)


@router.post("/embeddings/reload", response_model=EmbeddingImportResponse)
def reload_embeddings(user: require_permission("recognition.manage")):
    return EmbeddingImportResponse(**face_service.reload_embeddings())


@router.post("/anomalies/analyze", response_model=AnomalyAnalyzeResponse)
def analyze_anomalies(req: AnomalyAnalyzeRequest, user: CurrentUser):
    records = [r.model_dump() for r in req.records]
    result = analyze_records(records, req.config)
    return AnomalyAnalyzeResponse(**result)


@router.post("/delete")
def delete_embedding(req: DeleteRequest, user: require_permission("employees.manage")):
    return face_service.delete_employee(req.employee_id)
