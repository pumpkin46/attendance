from typing import Any

from pydantic import BaseModel, Field


class EnrollRequest(BaseModel):
    employee_id: str
    image: str = Field(..., description="Base64-encoded image")


class IdentifyRequest(BaseModel):
    image: str
    require_liveness: bool = True
    liveness_frames: list[str] | None = Field(
        default=None,
        description="Optional frame sequence for blink/head-movement verification (FR-018)",
    )
    session_id: str | None = Field(
        default=None,
        description="Stable session for face tracking across frames",
    )
    source: str | None = Field(
        default=None,
        description="webcam, usb_camera, ip_camera, rtsp, nvr, cctv, mobile",
    )


class RecognizeRequest(IdentifyRequest):
    """Full pipeline recognition request."""


class PipelineStage(BaseModel):
    stage: str
    duration_ms: int = 0
    status: str = "ok"


class RecognizeResponse(BaseModel):
    model_config = {"extra": "ignore"}

    success: bool = True
    employee_id: str | None = None
    confidence: float = 0.0
    matched: bool = False
    reason: str | None = None
    quality_score: float | None = None
    track_id: int | None = None
    face_count: int | None = None
    bbox: list[float] | None = None
    pipeline: list[dict[str, Any]] = Field(default_factory=list)
    processing_ms: int = 0
    recognition_ms: int | None = None
    liveness_ms: int | None = None
    sla: dict[str, Any] | None = None
    source: str | None = None
    liveness_passed: bool | None = None
    liveness_score: float | None = None
    liveness_reason: str | None = None
    liveness_checks: dict[str, Any] | None = None
    spoof_type: str | None = None


class RecognizeStreamRequest(BaseModel):
    stream_url: str
    require_liveness: bool = False
    source: str | None = "rtsp"
    session_id: str | None = None


class LivenessVerifyRequest(BaseModel):
    frames: list[str] = Field(..., min_length=1, description="Webcam frame sequence (base64 JPEG)")


class LivenessVerifyResponse(BaseModel):
    success: bool = True
    passed: bool = False
    score: float = 0.0
    blink_detected: bool = False
    head_movement_detected: bool = False
    frame_count: int = 0
    reason: str | None = None
    checks: dict[str, Any] = Field(default_factory=dict)
    processing_ms: int = 0


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
    spoof_type: str | None = None


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
    spoof_type: str | None = None


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


class ValidateImageRequest(BaseModel):
    image: str
    expected_pose: str | None = Field(
        default=None,
        description="Guided pose slot: front, left, right, up, down, smiling, neutral, glasses, without_glasses",
    )


class ValidateImageResponse(BaseModel):
    accepted: bool
    reason: str | None = None
    quality_score: float = 0.0
    checks: dict[str, Any] = Field(default_factory=dict)
    bbox: list[float] | None = None
    face_metadata: dict[str, Any] | None = None
    processing_ms: int = 0


class EnrollStructuredRequest(BaseModel):
    employee_id: str
    poses: dict[str, str] = Field(
        ...,
        description="Map of pose_type -> base64 image (9 required slots)",
    )


class EnrollStructuredResponse(BaseModel):
    success: bool
    employee_id: str | None = None
    embeddings_stored: int | None = None
    faiss_ids: list[str] | None = None
    average_quality_score: float | None = None
    enrollment_score: float | None = None
    accepted: list[dict[str, Any]] | None = None
    rejected: list[dict[str, Any]] | None = None
    missing_poses: list[str] | None = None
    required_poses: list[str] | None = None
    error: str | None = None
    processing_ms: int | None = None


class EnrollBatchRequest(BaseModel):
    employee_id: str
    images: list[str] = Field(..., min_length=1, description="10–50 base64 images")


class EnrollBatchResponse(BaseModel):
    success: bool
    employee_id: str | None = None
    embeddings_stored: int | None = None
    faiss_ids: list[str] | None = None
    average_quality_score: float | None = None
    accepted: list[dict[str, Any]] | None = None
    rejected: list[dict[str, Any]] | None = None
    rejected_count: int | None = None
    accepted_count: int | None = None
    error: str | None = None
    processing_ms: int | None = None


class StreamCaptureRequest(BaseModel):
    stream_url: str = Field(..., description="RTSP, HTTP, or other OpenCV-supported URL")


class StreamCaptureResponse(BaseModel):
    success: bool = True
    image: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    processing_ms: int = 0
    error: str | None = None


class EmbeddingExportResponse(BaseModel):
    success: bool = True
    version: str
    embedding_count: int = 0
    index_b64: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class EmbeddingImportRequest(BaseModel):
    index_b64: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class EmbeddingImportResponse(BaseModel):
    success: bool = True
    embedding_count: int = 0
    version: str | None = None


class AnomalyRecordInput(BaseModel):
    record_id: int | None = None
    employee_id: int
    work_date: str
    check_in_at: str | None = None
    check_out_at: str | None = None
    check_in_hour: float | None = None
    shift_start_hour: float | None = None
    worked_minutes: int = 0
    overtime_minutes: int = 0
    status: str = "absent"
    check_in_method: str | None = None
    day_of_week: int = 1
    recognition_events_count: int = 0


class AnomalyAnalyzeRequest(BaseModel):
    records: list[AnomalyRecordInput] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)


class AnomalyItem(BaseModel):
    record_id: int | None = None
    employee_id: int
    anomaly_type: str
    score: float
    severity: str
    title: str
    description: str
    evidence: dict[str, Any] = Field(default_factory=dict)


class AnomalyAnalyzeResponse(BaseModel):
    success: bool = True
    anomalies: list[AnomalyItem] = Field(default_factory=list)
    records_analyzed: int = 0
    anomaly_count: int = 0
    processing_ms: int = 0
    error: str | None = None
