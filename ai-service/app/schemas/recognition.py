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
    employee_id: str
    faiss_id: str
    quality_score: float | None = None
    processing_ms: int


class IdentifyResponse(BaseModel):
    success: bool = True
    employee_id: str | None = None
    confidence: float
    liveness_passed: bool
    processing_ms: int
