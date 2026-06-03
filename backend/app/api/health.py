from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.core.database import async_session_factory
from app.services import face_service
from app.services.antispoof import get_antispoof_verifier

router = APIRouter(prefix="/api/v1", tags=["health"])

SPOOF_TYPES = ("print", "screen", "video", "deepfake")


def _liveness_status() -> dict:
    verifier = get_antispoof_verifier()
    model_loaded = verifier.session is not None
    insightface_loaded = face_service._get_face_app() is not None

    return {
        "liveness_enabled": settings.liveness_enabled,
        "active_liveness_enabled": settings.active_liveness_enabled,
        "antispoof_model_loaded": model_loaded,
        "insightface_loaded": insightface_loaded,
        "liveness_methods": {
            "ai_model": "MiniFASNetV2" if settings.antispoof_enabled else "disabled",
            "blink_detection": settings.active_liveness_enabled,
            "head_movement": settings.active_liveness_enabled,
            "spoof_types": list(SPOOF_TYPES),
        },
    }


async def build_health_response() -> dict:
    checks: dict[str, dict] = {}

    db_ok = False
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        checks["database"] = {"status": "unhealthy", "error": str(exc)}
    if db_ok:
        checks["database"] = {"status": "healthy"}

    try:
        idx = face_service.get_index()
        checks["ai_service"] = {
            "status": "healthy",
            "embedding_count": idx.count(),
            "index_version": idx.version_hash(),
        }
    except Exception as exc:
        checks["ai_service"] = {"status": "degraded", "error": str(exc)}

    overall = "healthy" if all(c["status"] == "healthy" for c in checks.values()) else "degraded"

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        **_liveness_status(),
    }


@router.get("/health")
async def health_check():
    return await build_health_response()
