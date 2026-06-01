from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings

app = FastAPI(title=settings.app_name, version="1.0.0")

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
    from app.services.face_service import _get_face_app

    model_loaded = _get_face_app() is not None
    return {
        "status": "ok",
        "service": settings.app_name,
        "insightface_loaded": model_loaded,
        "recognition_threshold": settings.recognition_threshold,
    }
