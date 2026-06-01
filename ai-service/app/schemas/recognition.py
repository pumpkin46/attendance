from typing import Any

from pydantic import BaseModel, Field


class EnrollRequest(BaseModel):
    employee_id: str
    image: str = Field(..., description="Base64-encoded image")


class IdentifyRequest(BaseModel):
    image: str
    require_liveness: bool = True


class DeleteRequest(BaseModel):
    employee_id: str


class EnrollResponse(BaseModel):
    success: bool = True
    employee_id: str | None = None
    faiss_id: str | None = None
    quality_score: float | None = None
    processing_ms: int | None = None
    liveness_passed: bool | None = None
    liveness_score: float | None = None
    liveness_reason: str | None = None
    liveness_checks: dict[str, Any] | None = None


class IdentifyResponse(BaseModel):
    success: bool = True
    employee_id: str | None = None
    confidence: float = 0.0
    liveness_passed: bool = False
    processing_ms: int = 0
    liveness_score: float | None = None
    face_count: int | None = None
    liveness_reason: str | None = None
    liveness_checks: dict[str, Any] | None = None


class FaceBox(BaseModel):
    bbox: list[float]
    det_score: float


class DetectRequest(BaseModel):
    image: str


class DetectResponse(BaseModel):
    success: bool = True
    faces: list[FaceBox] = []
    face_count: int = 0
    processing_ms: int = 0
    image_width: int | None = None
    image_height: int | None = None
