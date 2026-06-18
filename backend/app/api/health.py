from __future__ import annotations

import asyncio
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

    # Report the ACTUAL runtime anti-spoof posture, not a static string keyed on
    # the enabled flag: if the model failed to download/verify, the engine is on
    # coarse heuristics (a sharp print/screen can defeat it) — operators must be
    # able to see that instead of assuming "MiniFASNetV2" is running.
    if not settings.antispoof_enabled:
        antispoof_mode = "disabled"
    elif model_loaded:
        antispoof_mode = "model"
    else:
        antispoof_mode = "heuristic_only"

    return {
        "liveness_enabled": settings.liveness_enabled,
        "active_liveness_enabled": settings.active_liveness_enabled,
        "antispoof_model_loaded": model_loaded,
        "antispoof_mode": antispoof_mode,
        "antispoof_fail_without_model": settings.antispoof_fail_without_model,
        "insightface_loaded": insightface_loaded,
        "liveness_methods": {
            "ai_model": "MiniFASNetV2" if antispoof_mode == "model" else antispoof_mode,
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

    # Redis backs rate limiting, cross-worker duplicate suppression, response
    # caching and the realtime pub/sub. When it is enabled but down, the API
    # keeps answering while those silently degrade — so report it.
    if settings.redis_enabled:
        from app.core.redis import get_redis

        try:
            redis = get_redis()
            await redis.ping()
            checks["redis"] = {"status": "healthy"}
        except Exception as exc:
            checks["redis"] = {"status": "unhealthy", "error": str(exc)}

    # Celery Beat runs the periodic jobs (visitor expiry, anomaly detection,
    # retention purge). Ping the broker so a dead worker/broker is visible.
    if settings.celery_enabled:
        try:
            from app.celery_app import celery_app

            # control.ping is a synchronous broker broadcast that blocks until a
            # reply or the timeout; run it off the event loop so a slow/absent
            # worker cannot stall every other request on the single worker.
            replies = await asyncio.to_thread(celery_app.control.ping, timeout=0.25)
            if replies:
                checks["celery"] = {"status": "healthy", "workers": len(replies)}
            else:
                checks["celery"] = {"status": "degraded", "error": "no workers responded"}
        except Exception as exc:
            checks["celery"] = {"status": "degraded", "error": str(exc)}

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
