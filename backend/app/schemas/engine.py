"""Response models for the AI Recognition Engine API.

The engine internals (recognition pipeline, stream manager, metrics, tracker,
vector index, config) return loose, evolving ``dict`` payloads. To keep the API
typed without dropping any data, the models below declare the fields we can
identify and set ``extra="allow"`` so additional keys pass through untouched.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


# ─── Recognition ──────────────────────────────────────────────────────────────


class RecognitionResult(BaseModel):
    """Output of the full recognition pipeline (``RecognitionResult.to_dict``)."""

    model_config = ConfigDict(extra="allow")

    success: bool | None = None
    employee_id: str | None = None
    employee_name: str | None = None
    confidence: float | None = None
    matched: bool | None = None
    liveness_passed: bool | None = None
    liveness_score: float | None = None
    quality_score: float | None = None
    verification_level: str | None = None
    event_type: str | None = None
    is_unknown: bool | None = None
    track_id: Any | None = None
    camera_id: int | None = None
    pipeline: Any | None = None
    processing_ms: float | None = None
    reason: str | None = None
    sla: Any | None = None


class FaceDetectionResult(BaseModel):
    """Output of ``detect_faces`` (faces without full recognition)."""

    model_config = ConfigDict(extra="allow")

    success: bool
    faces: list[Any] = []
    face_count: int = 0
    detection_ms: float | None = None
    frame_width: int | None = None
    frame_height: int | None = None


# ─── Stream Management ────────────────────────────────────────────────────────


class StreamStatus(BaseModel):
    """Status of a single registered stream."""

    model_config = ConfigDict(extra="allow")

    camera_id: int | None = None
    status: str | None = None
    protocol: str | None = None
    camera_type: str | None = None
    mode: str | None = None
    health: dict[str, Any] | None = None


class StreamListStatus(BaseModel):
    """Status of all registered streams."""

    model_config = ConfigDict(extra="allow")

    total_streams: int
    active_streams: int
    streams: dict[str, StreamStatus] = {}


class StreamAddResult(BaseModel):
    """Result of registering a new stream."""

    model_config = ConfigDict(extra="allow")

    success: bool
    camera_id: int
    status: str


class StreamControlResult(BaseModel):
    """Result of start/stop/remove stream actions."""

    model_config = ConfigDict(extra="allow")

    success: bool
    camera_id: int


# ─── Engine Control ───────────────────────────────────────────────────────────


class EngineActionResult(BaseModel):
    """Result of a start/stop engine action."""

    model_config = ConfigDict(extra="allow")

    success: bool
    status: str


class EngineStatus(BaseModel):
    """Comprehensive engine status (``get_engine_status``)."""

    model_config = ConfigDict(extra="allow")

    running: bool
    streams: dict[str, Any] | None = None
    tracking: dict[str, Any] | None = None
    search_index: dict[str, Any] | None = None
    attendance: dict[str, Any] | None = None
    unknown_persons: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    sla_compliance: dict[str, Any] | None = None


# ─── Metrics & Monitoring ─────────────────────────────────────────────────────


class PerformanceSummary(BaseModel):
    """Engine performance summary (``get_performance_summary``)."""

    model_config = ConfigDict(extra="allow")

    uptime_seconds: float | None = None
    recognition_metrics: dict[str, Any] | None = None
    pipeline_performance: dict[str, Any] | None = None
    camera_health: dict[str, Any] | None = None
    alerts: dict[str, Any] | None = None


class SLACompliance(BaseModel):
    """SLA compliance report (``get_sla_compliance``)."""

    model_config = ConfigDict(extra="allow")


class RecognitionMetrics(BaseModel):
    """Recognition-specific metrics (``recognition.to_dict``)."""

    model_config = ConfigDict(extra="allow")


# ─── Unknown Persons ──────────────────────────────────────────────────────────


class UnknownPersonsResponse(BaseModel):
    """Recent unknown person detections."""

    model_config = ConfigDict(extra="allow")

    events: list[Any] = []
    total: int
    stats: dict[str, Any] | None = None


# ─── Tracking ─────────────────────────────────────────────────────────────────


class TrackingStats(BaseModel):
    """Face tracking statistics (``tracker.get_stats``)."""

    model_config = ConfigDict(extra="allow")

    total_tracks: int
    recognized_tracks: int | None = None
    unknown_tracks: int | None = None
    cameras_tracking: int | None = None


# ─── Vector Index ─────────────────────────────────────────────────────────────


class IndexStats(BaseModel):
    """Vector search index statistics (``vector_search.get_stats``)."""

    model_config = ConfigDict(extra="allow")

    total_embeddings: int
    total_employees: int | None = None
    index_version: str | None = None


class IndexReloadResult(BaseModel):
    """Result of reloading the FAISS index (success + index stats)."""

    model_config = ConfigDict(extra="allow")

    success: bool
    total_embeddings: int | None = None
    total_employees: int | None = None
    index_version: str | None = None


# ─── Configuration ────────────────────────────────────────────────────────────


class EngineConfigResponse(BaseModel):
    """Full engine configuration (``engine_config.to_dict``)."""

    model_config = ConfigDict(extra="allow")


class EngineConfigUpdateResult(BaseModel):
    """Result of a runtime config update."""

    model_config = ConfigDict(extra="allow")

    success: bool
    updated: dict[str, Any] = {}


# ─── Performance Requirements ─────────────────────────────────────────────────


class PerformanceRequirements(BaseModel):
    """Static SLA requirements for the engine."""

    model_config = ConfigDict(extra="allow")

    performance: dict[str, Any]
    scalability: dict[str, Any]
