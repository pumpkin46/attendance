from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


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


class RequirementCompliance(BaseModel):
    """One row of the required-performance-metrics table."""

    metric: str
    requirement: str
    target: float
    measured: float | None = None
    met: bool | None = None


class PerformanceComplianceResponse(BaseModel):
    requirements: list[RequirementCompliance]
    labeled_samples: int
    pipeline_stage_averages_ms: dict[str, float]


class EvaluationSample(BaseModel):
    image: str = Field(..., description="Base64-encoded probe image")
    employee_id: str | None = Field(
        default=None,
        description="Expected employee id; None marks an impostor probe "
        "(person not enrolled)",
    )


class EvaluationRequest(BaseModel):
    samples: list[EvaluationSample] = Field(..., min_length=1, max_length=500)
    require_liveness: bool = False
    record_metrics: bool = Field(
        default=True,
        description="Feed labeled outcomes into the live engine metrics",
    )


class EvaluationReport(BaseModel):
    total_samples: int
    genuine_samples: int
    impostor_samples: int
    true_accepts: int
    false_rejects: int
    misidentified: int
    false_accepts: int
    true_rejects: int
    accuracy: float | None = None
    false_positive_rate: float | None = None
    false_negative_rate: float | None = None
    avg_processing_ms: float | None = None
    max_processing_ms: int | None = None
    avg_recognition_ms: float | None = None
    avg_liveness_ms: float | None = None
    compliance: list[RequirementCompliance]
    samples: list[dict[str, Any]]
    evaluation_ms: int


class EventFeedbackRequest(BaseModel):
    outcome: Literal["correct", "incorrect"]
    note: str | None = Field(default=None, max_length=500)


class EventFeedbackResponse(BaseModel):
    event_id: int
    result: str
    outcome: str
    label: str
