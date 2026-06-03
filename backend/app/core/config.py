from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── App ──────────────────────────────────────────────────────────────
    app_name: str = "Attendance Platform"
    app_env: str = "local"
    app_debug: bool = True
    app_url: str = "http://localhost:8000"
    app_timezone: str = "UTC"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # ── Database ─────────────────────────────────────────────────────────
    db_host: str = "127.0.0.1"
    db_port: int = 5432
    db_database: str = "attendance"
    db_username: str = "postgres"
    db_password: str = ""
    db_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 20

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.db_username}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_database}"
        )

    @property
    def database_url_sync(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_username}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_database}"
        )

    # ── Password hashing ─────────────────────────────────────────────────
    hash_driver: str = "argon2id"
    argon_memory: int = 65536
    argon_time: int = 4

    # ── Tenancy ──────────────────────────────────────────────────────────
    tenant_isolation_enabled: bool = True
    tenant_header: str = "X-Organization-Id"
    super_admin_role: str = "super_admin"

    # ── GDPR / Privacy ───────────────────────────────────────────────────
    gdpr_enabled: bool = True
    retention_audit_logs_days: int = 365
    retention_recognition_events_days: int = 90
    retention_notifications_days: int = 90
    privacy_contact_email: str = "privacy@attendance.local"

    # ── Attendance ────────────────────────────────────────────────────────
    attendance_grace_minutes: int = 15
    attendance_min_work_minutes: int = 240
    attendance_max_work_minutes: int = 600
    attendance_break_minutes: int = 60
    attendance_half_day_minutes: int = 240
    attendance_min_confidence: float = 0.95
    attendance_overtime_threshold_minutes: int = 480
    face_duplicate_window_seconds: int = 60
    rfid_duplicate_window_seconds: int = 60

    # ── Anomaly detection ─────────────────────────────────────────────────
    anomaly_detection_enabled: bool = True
    anomaly_lookback_days: int = 30
    anomaly_overtime_minutes: int = 600
    anomaly_checkin_deviation_minutes: int = 120

    # ── Face enrollment ──────────────────────────────────────────────────
    face_enrollment_mode: str = "structured"
    face_enrollment_required_poses: str = "front,left,right,up,down,smiling,neutral,glasses,without_glasses"
    face_enrollment_min_images: int = 10
    face_enrollment_max_images: int = 50
    face_enrollment_retain_raw_images: bool = False

    # ── Unknown face handling ─────────────────────────────────────────────
    unknown_person_alert: bool = True
    unknown_snapshot_enabled: bool = True
    unknown_notify_admins: bool = True
    unknown_alert_cooldown_seconds: int = 300
    unknown_snapshot_retention_days: int = 30

    # ── Camera / Edge / RFID ──────────────────────────────────────────────
    camera_stream_poll_interval_seconds: int = 5
    camera_online_threshold_seconds: int = 120
    camera_health_log_retention_days: int = 7
    camera_health_log_interval_seconds: int = 300
    rfid_reader_offline_seconds: int = 300
    edge_device_offline_seconds: int = 300
    edge_sync_interval_seconds: int = 300

    # ── Visitors ──────────────────────────────────────────────────────────
    visitor_default_visit_hours: int = 8
    visitor_face_expiry_buffer_minutes: int = 30
    visitor_kiosk_offline_seconds: int = 300
    visitor_kiosk_default_visit_hours: int = 4
    visitor_badge_prefix: str = "V"

    # ── Building integration ──────────────────────────────────────────────
    building_integration_enabled: bool = True
    building_webhook_timeout: int = 5
    building_business_hours_start: str = "08:00"
    building_business_hours_end: str = "18:00"
    building_business_timezone: str = "UTC"

    # ── Security monitoring ───────────────────────────────────────────────
    security_monitoring_enabled: bool = True
    security_after_hours_start: str = "20:00"
    security_after_hours_end: str = "06:00"
    security_tailgating_window: int = 8
    security_alert_cooldown: int = 120

    # ── OAuth / SSO ───────────────────────────────────────────────────────
    oauth_enabled: bool = False
    saml_enabled: bool = False
    ldap_enabled: bool = False

    # ── AI Recognition (existing settings) ────────────────────────────────
    recognition_threshold: float = 0.95
    recognition_sla_ms: int = 300
    liveness_sla_ms: int = 500
    target_accuracy: float = 0.99
    max_false_positive_rate: float = 0.001
    max_false_negative_rate: float = 0.01
    embedding_dim: int = 512
    index_path: str = "data/faiss.index"
    metadata_path: str = "data/metadata.json"
    use_mock_when_no_gpu: bool = True
    max_processing_ms: int = 500
    max_employees: int = 10_000
    max_cameras: int = 100

    # Liveness & anti-spoof
    liveness_enabled: bool = True
    liveness_min_det_score: float = 0.45
    antispoof_enabled: bool = True
    antispoof_block_enrollment: bool = True
    antispoof_model_path: str = "models/MiniFASNetV2.onnx"
    antispoof_model_url: str = (
        "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx"
    )
    antispoof_crop_scale: float = 2.7
    antispoof_real_threshold: float = 0.5
    antispoof_heuristic_threshold: float = 0.35
    antispoof_combined_threshold: float = 0.45
    antispoof_require_both: bool = True
    antispoof_fail_without_model: bool = False

    # Active liveness
    active_liveness_enabled: bool = True
    active_liveness_min_frames: int = 5
    active_liveness_max_frames: int = 24
    active_liveness_require_blink: bool = True
    active_liveness_require_head_movement: bool = False
    active_liveness_require_frames: bool = False
    active_liveness_blink_variance_drop: float = 0.35
    active_liveness_head_yaw_range: float = 0.06
    active_liveness_head_pitch_range: float = 0.05
    enrollment_min_images: int = 10
    enrollment_max_images: int = 50
    quality_min_det_score: float = 0.5
    quality_min_blur_score: float = 0.35
    quality_min_brightness_score: float = 0.35
    quality_min_occlusion_score: float = 0.4
    quality_min_resolution_score: float = 0.5
    quality_min_overall_score: float = 0.45
    quality_blur_variance_ref: float = 120.0
    quality_min_face_pixels: float = 80.0
    enrollment_structured_poses: str = (
        "front,left,right,up,down,smiling,neutral,glasses,without_glasses"
    )


settings = Settings()
