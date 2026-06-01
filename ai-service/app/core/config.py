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
    liveness_enabled: bool = True
    liveness_min_det_score: float = 0.45


settings = Settings()
