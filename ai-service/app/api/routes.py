from fastapi import APIRouter, HTTPException

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
    StreamCaptureRequest,
    StreamCaptureResponse,
    EmbeddingExportResponse,
    EmbeddingImportRequest,
    EmbeddingImportResponse,
    ValidateImageRequest,
    ValidateImageResponse,
)
from app.services import face_service
from app.services.stream_capture import capture_stream_frame

router = APIRouter(prefix="/api/v1")


@router.post("/enroll", response_model=EnrollResponse)
def enroll(req: EnrollRequest):
    result = face_service.enroll(req.employee_id, req.image)
    if not result.get("success"):
        raise HTTPException(422, detail=result.get("error", "Enrollment failed"))
    return EnrollResponse(**result)


@router.post("/validate-image", response_model=ValidateImageResponse)
def validate_image(req: ValidateImageRequest):
    return ValidateImageResponse(**face_service.validate_image(req.image))


@router.post("/enroll-batch", response_model=EnrollBatchResponse)
def enroll_batch(req: EnrollBatchRequest):
    result = face_service.enroll_batch(req.employee_id, req.images)
    if not result.get("success"):
        return EnrollBatchResponse(**result)
    return EnrollBatchResponse(**result)


@router.post("/identify", response_model=IdentifyResponse)
def identify(req: IdentifyRequest):
    result = face_service.identify(
        req.image,
        req.require_liveness,
        req.liveness_frames,
    )
    return IdentifyResponse(**result)


@router.post("/liveness/verify", response_model=LivenessVerifyResponse)
def liveness_verify(req: LivenessVerifyRequest):
    result = face_service.verify_liveness_sequence(req.frames)
    return LivenessVerifyResponse(**result)


@router.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    result = face_service.detect_faces(req.image)
    return DetectResponse(**result)


@router.post("/capture-stream", response_model=StreamCaptureResponse)
def capture_stream(req: StreamCaptureRequest):
    result = capture_stream_frame(req.stream_url)
    if not result.get("success"):
        raise HTTPException(422, detail=result.get("error", "Stream capture failed"))
    return StreamCaptureResponse(**result)


@router.get("/embeddings/export", response_model=EmbeddingExportResponse)
def export_embeddings():
    return EmbeddingExportResponse(**face_service.export_embeddings())


@router.post("/embeddings/import", response_model=EmbeddingImportResponse)
def import_embeddings(req: EmbeddingImportRequest):
    result = face_service.import_embeddings(req.index_b64, req.metadata)
    return EmbeddingImportResponse(**result)


@router.post("/embeddings/reload", response_model=EmbeddingImportResponse)
def reload_embeddings():
    return EmbeddingImportResponse(**face_service.reload_embeddings())


@router.post("/delete")
def delete_embedding(req: DeleteRequest):
    return face_service.delete_employee(req.employee_id)
