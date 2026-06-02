from fastapi import APIRouter, HTTPException

from app.schemas.recognition import (
    DeleteRequest,
    DetectRequest,
    DetectResponse,
    EnrollBatchRequest,
    EnrollBatchResponse,
    EnrollRequest,
    EnrollResponse,
    IdentifyRequest,
    IdentifyResponse,
    ValidateImageRequest,
    ValidateImageResponse,
)
from app.services import face_service

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
    result = face_service.identify(req.image, req.require_liveness)
    return IdentifyResponse(**result)


@router.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    result = face_service.detect_faces(req.image)
    return DetectResponse(**result)


@router.post("/delete")
def delete_embedding(req: DeleteRequest):
    return face_service.delete_employee(req.employee_id)
