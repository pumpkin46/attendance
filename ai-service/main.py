from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings

app = FastAPI(title=settings.app_name, version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health():
    from pathlib import Path

    from app.services.face_service import _get_face_app

    model_loaded = _get_face_app() is not None
    antispoof_path = Path(settings.antispoof_model_path)
    return {
        "status": "ok",
        "service": settings.app_name,
        "insightface_loaded": model_loaded,
        "antispoof_enabled": settings.antispoof_enabled,
        "antispoof_model_loaded": antispoof_path.is_file(),
        "liveness_enabled": settings.liveness_enabled,
        "active_liveness_enabled": settings.active_liveness_enabled,
        "liveness_methods": {
            "ai_model": "MiniFASNetV2",
            "blink_detection": settings.active_liveness_enabled,
            "head_movement": settings.active_liveness_enabled,
            "spoof_types": ["printed_photo", "mobile_screen", "video_replay", "deepfake"],
        },
        "recognition_threshold": settings.recognition_threshold,
        "recognition_engine": {
            "pipeline_stages": [
                "video_stream",
                "face_detection",
                "face_tracking",
                "face_quality_check",
                "liveness_detection",
                "embedding_generation",
                "vector_search",
                "identity_match",
            ],
            "supported_sources": [
                "webcam",
                "usb_camera",
                "ip_camera",
                "rtsp",
                "nvr",
                "cctv",
                "mobile",
            ],
            "recognition_sla_ms": settings.recognition_sla_ms,
            "liveness_sla_ms": settings.liveness_sla_ms,
            "target_accuracy": settings.target_accuracy,
            "max_false_positive_rate": settings.max_false_positive_rate,
            "max_false_negative_rate": settings.max_false_negative_rate,
        },
        "nfr": {
            "NFR-001_recognition_sla_ms": settings.recognition_sla_ms,
            "NFR-002_max_employees": settings.max_employees,
            "NFR-003_max_cameras": settings.max_cameras,
        },
    }
