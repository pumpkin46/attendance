"""Recognition engine configuration with all tunable parameters."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class StreamConfig:
    min_fps: int = 15
    max_latency_ms: int = 500
    warmup_frames: int = 5
    reconnect_interval_seconds: int = 5
    max_reconnect_attempts: int = 10
    health_check_interval_seconds: int = 30


@dataclass
class DetectionConfig:
    min_face_size: int = 40
    max_faces_per_frame: int = 100
    confidence_threshold: float = 0.5
    det_size: tuple[int, int] = (640, 640)
    nms_threshold: float = 0.4


@dataclass
class TrackingConfig:
    max_tracks: int = 200
    iou_threshold: float = 0.35
    max_age_seconds: float = 30.0
    min_hits_for_recognition: int = 2
    cooldown_seconds: float = 5.0


@dataclass
class QualityConfig:
    min_quality_score: float = 0.70
    min_blur_score: float = 0.35
    min_brightness_score: float = 0.35
    min_resolution_score: float = 0.5
    min_occlusion_score: float = 0.4
    supported_yaw_degrees: float = 45.0
    supported_pitch_degrees: float = 30.0
    supported_roll_degrees: float = 30.0


@dataclass
class LivenessConfig:
    enabled: bool = True
    min_score: float = 0.85
    passive_enabled: bool = True
    active_enabled: bool = True
    detect_printed_photos: bool = True
    detect_screen_replays: bool = True
    detect_video_replays: bool = True
    detect_synthetic_faces: bool = True
    detect_deepfakes: bool = True
    detect_face_swaps: bool = True


@dataclass
class SearchConfig:
    auto_accept_threshold: float = 0.90
    review_threshold: float = 0.80
    unknown_threshold: float = 0.80
    top_k: int = 5
    embedding_dim: int = 512


@dataclass
class VerificationConfig:
    require_liveness: bool = True
    rfid_enabled: bool = True
    location_enabled: bool = True
    multi_factor_enabled: bool = False


@dataclass
class AttendanceConfig:
    duplicate_window_seconds: int = 300
    event_types: list[str] = field(default_factory=lambda: [
        "check_in", "check_out", "break_start", "break_end",
        "overtime_start", "overtime_end",
    ])
    auto_checkout_enabled: bool = True
    auto_checkout_hours: int = 12


@dataclass
class UnknownPersonConfig:
    enabled: bool = True
    save_snapshot: bool = True
    generate_alert: bool = True
    notify_security: bool = True
    alert_cooldown_seconds: int = 300
    snapshot_retention_days: int = 30


@dataclass
class PerformanceConfig:
    target_accuracy: float = 0.99
    max_false_positive_rate: float = 0.001
    max_false_negative_rate: float = 0.01
    max_detection_ms: int = 100
    max_embedding_ms: int = 50
    max_search_ms: int = 20
    max_recognition_ms: int = 300
    max_liveness_ms: int = 500
    max_event_creation_ms: int = 100
    max_api_response_ms: int = 200


@dataclass
class ScalabilityConfig:
    max_employees: int = 100_000
    max_embeddings: int = 1_000_000
    max_cameras: int = 5_000
    max_concurrent_streams: int = 5_000
    max_faces_per_frame: int = 100
    max_events_per_minute: int = 100_000


@dataclass
class EngineConfig:
    stream: StreamConfig = field(default_factory=StreamConfig)
    detection: DetectionConfig = field(default_factory=DetectionConfig)
    tracking: TrackingConfig = field(default_factory=TrackingConfig)
    quality: QualityConfig = field(default_factory=QualityConfig)
    liveness: LivenessConfig = field(default_factory=LivenessConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    verification: VerificationConfig = field(default_factory=VerificationConfig)
    attendance: AttendanceConfig = field(default_factory=AttendanceConfig)
    unknown_person: UnknownPersonConfig = field(default_factory=UnknownPersonConfig)
    performance: PerformanceConfig = field(default_factory=PerformanceConfig)
    scalability: ScalabilityConfig = field(default_factory=ScalabilityConfig)

    def to_dict(self) -> dict[str, Any]:
        from dataclasses import asdict
        return asdict(self)


engine_config = EngineConfig()
