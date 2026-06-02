from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Attendance AI Service"
    recognition_threshold: float = 0.95
    embedding_dim: int = 512
    index_path: str = "data/faiss.index"
    metadata_path: str = "data/metadata.json"
    use_mock_when_no_gpu: bool = True
    max_processing_ms: int = 300

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

    # FR-006 / FR-007 enrollment quality
    enrollment_min_images: int = 10
    enrollment_max_images: int = 50
    quality_min_det_score: float = 0.5
    quality_min_blur_score: float = 0.35
    quality_min_occlusion_score: float = 0.4
    quality_min_overall_score: float = 0.45
    quality_blur_variance_ref: float = 120.0


settings = Settings()
