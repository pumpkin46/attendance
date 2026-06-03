from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RecognitionConfigResponse(BaseModel):
    recognition_threshold: float
    recognition_sla_ms: int
    liveness_enabled: bool
    antispoof_enabled: bool
    attendance_min_confidence: float
    face_duplicate_window_seconds: int
    max_processing_ms: int
    target_accuracy: float


class RecognitionEventOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    camera_id: int | None = None
    employee_id: int | None = None
    result: str
    confidence: float | None = None
    liveness_passed: bool | None = None
    processing_ms: int | None = None
    image_hash: str | None = None
    snapshot_path: str | None = None
    metadata: str | None = None
    recognized_at: datetime | None = None
    notified_at: datetime | None = None


class RecognitionMetrics(BaseModel):
    total_events: int
    matched: int
    unknown: int
    avg_confidence: float | None = None
    avg_processing_ms: float | None = None


class UnknownSummary(BaseModel):
    total_unknown: int
    last_24h: int
    last_7d: int
