from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_exception_handlers

from app.api.routes import router as ai_router
from app.api.auth import router as auth_router
from app.api.organizations import router as org_router
from app.api.employees import router as employees_router
from app.api.enrollment import router as enrollment_router
from app.api.attendance import router as attendance_router
from app.api.shifts import router as shifts_router
from app.api.anomalies import router as anomalies_router
from app.api.cameras import router as cameras_router
from app.api.recognition import router as recognition_router
from app.api.engine import router as engine_router
from app.api.monitoring import router as monitoring_router
from app.api.rfid import router as rfid_router
from app.api.access import router as access_router
from app.api.visitors import router as visitors_router, start_visitor_expiry_task
from app.api.uploads import router as uploads_router
from app.api.building import router as building_router
from app.api.security_monitoring import router as security_monitoring_router
from app.api.reports import router as reports_router
from app.api.notifications import router as notifications_router
from app.api.audit import router as audit_router
from app.api.privacy import router as privacy_router
from app.api.health import build_health_response, router as health_router
from app.api.ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_visitor_expiry_task()

    if settings.engine_enabled and settings.engine_auto_start:
        from app.engine.recognition_engine import get_recognition_engine
        recognition_engine = get_recognition_engine()
        await recognition_engine.start()

    yield

    if settings.engine_enabled and settings.engine_auto_start:
        from app.engine.recognition_engine import get_recognition_engine
        recognition_engine = get_recognition_engine()
        await recognition_engine.stop()

    await engine.dispose()


app = FastAPI(title=settings.app_name, version="2.0.0", lifespan=lifespan)

# Global handlers translate every error (typed AppError, HTTPException, request
# validation) into the single {"error": {code, message, details}} envelope.
register_exception_handlers(app)

# Wildcard origins and credentialed requests are mutually exclusive (and unsafe
# together); only allow credentials when origins are explicitly listed.
_cors_origins = settings.cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials="*" not in _cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI recognition routes (existing)
app.include_router(ai_router)

# Business API routes
app.include_router(auth_router)
app.include_router(org_router)
app.include_router(employees_router)
app.include_router(enrollment_router)
app.include_router(attendance_router)
app.include_router(shifts_router)
app.include_router(anomalies_router)
app.include_router(cameras_router)
app.include_router(recognition_router)
app.include_router(engine_router)
app.include_router(monitoring_router)
app.include_router(rfid_router)
app.include_router(access_router)
app.include_router(visitors_router)
app.include_router(uploads_router)
app.include_router(building_router)
app.include_router(security_monitoring_router)
app.include_router(reports_router)
app.include_router(notifications_router)
app.include_router(audit_router)
app.include_router(privacy_router)
app.include_router(health_router)
app.include_router(ws_router)


@app.get("/up")
async def up():
    return {"status": "ok"}


@app.get("/health")
async def root_health():
    """Legacy root health URL (scripts, older clients); same payload as /api/v1/health."""
    return await build_health_response()
