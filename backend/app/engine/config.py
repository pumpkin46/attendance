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
    # Retained for backward compat / status reporting only. The reconnect loop
    # no longer gives up after this many tries; it backs off and retries
    # indefinitely so a routine NVR reboot or network blip self-heals.
    max_reconnect_attempts: int = 10
    # Cap for the exponential reconnect backoff (starts at
    # reconnect_interval_seconds, doubles, clamps here).
    max_reconnect_interval_seconds: int = 60
    health_check_interval_seconds: int = 30
    # FFmpeg open/read timeouts (ms) for IP-camera captures. Without these a
    # dead RTSP source can block VideoCapture.read() indefinitely in a worker
    # thread, which also makes clean shutdown impossible.
    open_timeout_ms: int = 5000
    read_timeout_ms: int = 5000
    # Grace period when stopping a stream: wait this long for the read loop to
    # finish its current iteration before force-cancelling.
    stop_grace_seconds: float = 8.0
    # Frames per second handed to the recognition pipeline, independent of the
    # stream read rate. On CPU-only hosts a single detection takes hundreds of
    # ms, so analyzing every frame of a 30fps stream saturates every core.
    process_fps: int = 5


@dataclass
class DetectionConfig:
    min_face_size: int = 40
    max_faces_per_frame: int = 100
    confidence_threshold: float = 0.5
    det_size: tuple[int, int] = (640, 640)
    nms_threshold: float = 0.4
    # onnxruntime intra-op threads for the engine's InsightFace sessions.
    # 0 = half the logical cores (min 1), leaving headroom for the OS and the
    # API event loop; the ORT default grabs every core.
    intra_op_threads: int = 0


@dataclass
class TrackingConfig:
    max_tracks: int = 200
    iou_threshold: float = 0.35
    max_age_seconds: float = 30.0
    min_hits_for_recognition: int = 2
    cooldown_seconds: float = 5.0


@dataclass
class QualityConfig:
    min_quality_score: float = 0.45
    min_blur_score: float = 0.35
    min_brightness_score: float = 0.35
    min_resolution_score: float = 0.5
    min_occlusion_score: float = 0.4
    supported_yaw_degrees: float = 45.0
    supported_pitch_degrees: float = 30.0
    supported_roll_degrees: float = 30.0


@dataclass
class EnhancementConfig:
    # Adaptive low-light pre-pass applied to the frame BEFORE detection, so the
    # SAME brightened frame feeds detection + the ArcFace embedding (both come
    # from one InsightFace app.get call) and the downstream quality gate +
    # liveness. Without it a dim frame either embeds poorly or is rejected as
    # "underexposed" before recognition ever runs. A no-op for frames already
    # at/above target_luminance (well-lit scenes are untouched).
    low_light_enabled: bool = True
    target_luminance: float = 110.0
    max_gain: float = 2.5
    clahe_clip_limit: float = 2.0


@dataclass
class LivenessConfig:
    enabled: bool = True
    min_score: float = 0.85
    passive_enabled: bool = True
    active_enabled: bool = True
    # When True, the live RTSP path buffers recent frames per track and REQUIRES
    # the temporal (blink/head-movement) check to pass, not just the single-frame
    # passive anti-spoof model. Default False: a passive entry camera cannot
    # demand an interactive blink, so requiring it would falsely reject still
    # faces. Operators who run challenge-style cameras can opt in
    # (ENGINE_LIVE_ACTIVE_LIVENESS). The kiosk/API path enforces active liveness
    # independently of this flag.
    live_active_required: bool = False
    # Frames buffered per track to feed the active check when the flag is on.
    live_frame_buffer: int = 12
    # NOTE: the detect_* flags below are descriptive only — the engine's
    # LivenessDetector is heuristic (texture/moire/color + blink) and does NOT
    # run a model for these categories. They are surfaced in the config API for
    # display, but toggling them changes nothing until a real anti-spoof model
    # is wired in (see LivenessDetector docstring).
    detect_printed_photos: bool = True
    detect_screen_replays: bool = True
    detect_video_replays: bool = True
    detect_synthetic_faces: bool = True
    detect_deepfakes: bool = True
    detect_face_swaps: bool = True


@dataclass
class SearchConfig:
    # Cosine similarity over L2-normalized ArcFace (buffalo_l) embeddings.
    # Genuine same-person pairs score ~0.4-0.7, so the old 0.90 floor marked
    # nearly every real employee UNKNOWN. These match the kiosk path's 0.5
    # recognition_threshold; tune via ENGINE_AUTO_ACCEPT_THRESHOLD /
    # ENGINE_REVIEW_THRESHOLD (wired in configure_from_settings()).
    auto_accept_threshold: float = 0.5
    review_threshold: float = 0.4
    unknown_threshold: float = 0.4
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
    enhancement: EnhancementConfig = field(default_factory=EnhancementConfig)
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


def configure_from_settings(cfg: EngineConfig | None = None) -> EngineConfig:
    """Apply runtime overrides from app settings onto the engine config.

    Without this the ENGINE_* settings (and their .env values) were dead code:
    the engine always ran on the hardcoded dataclass defaults. Called at app
    startup so operators can tune thresholds without editing source.
    """
    from app.core.config import settings

    cfg = cfg or engine_config
    cfg.search.auto_accept_threshold = settings.engine_auto_accept_threshold
    cfg.search.review_threshold = settings.engine_review_threshold
    cfg.enhancement.low_light_enabled = settings.engine_low_light_enabled
    cfg.enhancement.target_luminance = settings.engine_low_light_target_luminance
    cfg.enhancement.max_gain = settings.engine_low_light_max_gain
    cfg.enhancement.clahe_clip_limit = settings.engine_low_light_clahe_clip
    cfg.liveness.min_score = settings.engine_liveness_threshold
    cfg.liveness.live_active_required = settings.engine_live_active_liveness
    cfg.attendance.duplicate_window_seconds = settings.engine_duplicate_window_seconds
    cfg.tracking.max_tracks = settings.engine_max_tracks_per_camera
    cfg.tracking.cooldown_seconds = settings.engine_track_cooldown_seconds
    cfg.unknown_person.alert_cooldown_seconds = settings.engine_unknown_alert_cooldown
    return cfg
