from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import select, func

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession, TenantOrgId, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.core.rate_limit import recognition_rate_limit
from app.core.pagination import PaginatedResponse, paginate, PaginationDep
from app.models.employee import Employee
from app.models.recognition import RecognitionEvent
from app.schemas.recognition import (
    DetectRequest,
    DetectResponse,
    IdentifyRequest,
    IdentifyResponse,
    LivenessVerifyRequest,
    LivenessVerifyResponse,
    RecognizeRequest,
    RecognizeResponse,
    RecognizeStreamRequest,
)
from app.schemas.recognition_api import (
    RecognitionConfigResponse,
    RecognitionEventOut,
    RecognitionMetrics,
    UnknownSummary,
)
from app.services import face_service
from app.services.stream_capture import capture_stream_frame
from app.services import attendance_service
from app.services.live_event_service import create_live_event

router = APIRouter(prefix="/api/v1", tags=["recognition"])


@router.get("/recognition/config", response_model=RecognitionConfigResponse)
async def get_recognition_config(user: CurrentUser):
    return RecognitionConfigResponse(
        recognition_threshold=settings.recognition_threshold,
        recognition_sla_ms=settings.recognition_sla_ms,
        liveness_enabled=settings.liveness_enabled,
        antispoof_enabled=settings.antispoof_enabled,
        attendance_min_confidence=settings.attendance_min_confidence,
        face_duplicate_window_seconds=settings.face_duplicate_window_seconds,
        max_processing_ms=settings.max_processing_ms,
        target_accuracy=settings.target_accuracy,
    )


@router.post("/recognition/detect", response_model=DetectResponse)
async def detect_faces(body: DetectRequest, user: CurrentUser):
    result = await run_in_threadpool(face_service.detect_faces, body.image)
    return DetectResponse(**result)


@router.post(
    "/recognition/identify",
    response_model=IdentifyResponse,
    dependencies=[recognition_rate_limit()],
)
async def identify_face(
    body: IdentifyRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    result = await run_in_threadpool(
        face_service.identify,
        image_b64=body.image,
        require_liveness=body.require_liveness,
        liveness_frames=body.liveness_frames,
        session_id=body.session_id,
        source=body.source,
    )

    if result.get("success") and result.get("employee_id"):
        emp_id_str = str(result["employee_id"])
        if emp_id_str.startswith("visitor-"):
            from app.models.visitor import Visitor
            visitor_id = int(emp_id_str.replace("visitor-", ""))
            visitor = await db.get(Visitor, visitor_id)
            if visitor and (org_id is None or visitor.organization_id == org_id):
                await create_live_event(
                    db=db,
                    organization_id=visitor.organization_id,
                    event_type="recognition.visitor",
                    message=f"Visitor {visitor.name} recognized",
                    visitor_id=visitor.id,
                    payload={"confidence": result.get("confidence")},
                )
        else:
            employee_id = int(emp_id_str)
            confidence = result.get("confidence", 0.0)
            liveness_passed = bool(result.get("liveness_passed", False))
            processing_ms = result.get("processing_ms", 0)

            await attendance_service.process_recognition(
                db=db,
                employee_id=employee_id,
                confidence=confidence,
                liveness_passed=liveness_passed,
                processing_ms=processing_ms,
                organization_id=org_id,
            )

            # Log the successful match so it appears in metrics, the events
            # list, and exports (previously only "unknown" events were recorded).
            employee = await db.get(Employee, employee_id)
            event_org_id = employee.organization_id if employee else org_id
            db.add(
                RecognitionEvent(
                    employee_id=employee_id,
                    organization_id=event_org_id,
                    result="matched",
                    confidence=confidence,
                    liveness_passed=liveness_passed,
                    processing_ms=processing_ms,
                    recognized_at=datetime.now(timezone.utc),
                )
            )
            await db.flush()

            if employee is not None:
                await create_live_event(
                    db=db,
                    organization_id=employee.organization_id,
                    event_type="recognition.matched",
                    message=f"{employee.first_name} {employee.last_name} recognized",
                    employee_id=employee.id,
                    payload={
                        "confidence": confidence,
                        "liveness_passed": liveness_passed,
                    },
                )
    else:
        event = RecognitionEvent(
            employee_id=None,
            organization_id=org_id,
            result="unknown",
            confidence=result.get("confidence"),
            liveness_passed=result.get("liveness_passed"),
            processing_ms=result.get("processing_ms"),
            recognized_at=datetime.now(timezone.utc),
        )
        db.add(event)
        await db.flush()

        await create_live_event(
            db=db,
            organization_id=org_id,
            event_type="recognition.unknown",
            message="Unknown face detected",
            payload={"confidence": result.get("confidence")},
        )

    return IdentifyResponse(**result)


@router.post(
    "/recognition/recognize",
    response_model=RecognizeResponse,
    dependencies=[recognition_rate_limit()],
)
async def recognize_face(body: RecognizeRequest, user: CurrentUser):
    result = await run_in_threadpool(
        face_service.recognize,
        image_b64=body.image,
        require_liveness=body.require_liveness,
        liveness_frames=body.liveness_frames,
        session_id=body.session_id,
        source=body.source,
    )
    return RecognizeResponse(**result)


@router.post("/recognition/recognize-stream", response_model=RecognizeResponse)
async def recognize_from_stream(body: RecognizeStreamRequest, user: CurrentUser):
    capture = await run_in_threadpool(capture_stream_frame, body.stream_url)
    if not capture["success"]:
        raise ValidationError(capture.get("error", "Failed to capture frame from stream"))

    image_b64 = capture["image"]
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    result = await run_in_threadpool(
        face_service.recognize,
        image_b64=image_b64,
        require_liveness=body.require_liveness,
        session_id=body.session_id,
        source=body.source or "rtsp",
    )
    return RecognizeResponse(**result)


@router.post("/recognition/liveness/verify", response_model=LivenessVerifyResponse)
async def verify_liveness(body: LivenessVerifyRequest, user: CurrentUser):
    result = await run_in_threadpool(face_service.verify_liveness_sequence, body.frames)
    return LivenessVerifyResponse(**result)


@router.get("/recognition/metrics", response_model=RecognitionMetrics)
async def get_recognition_metrics(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId = None,
):
    base_stmt = select(RecognitionEvent)
    if org_id is not None:
        base_stmt = base_stmt.where(RecognitionEvent.organization_id == org_id)

    total_result = await db.execute(
        select(func.count()).select_from(base_stmt.subquery())
    )
    total_events = total_result.scalar() or 0

    matched_stmt = base_stmt.where(RecognitionEvent.result == "matched")
    matched_result = await db.execute(
        select(func.count()).select_from(matched_stmt.subquery())
    )
    matched = matched_result.scalar() or 0

    unknown_stmt = base_stmt.where(RecognitionEvent.result == "unknown")
    unknown_result = await db.execute(
        select(func.count()).select_from(unknown_stmt.subquery())
    )
    unknown = unknown_result.scalar() or 0

    avg_conf_result = await db.execute(
        select(func.avg(RecognitionEvent.confidence)).select_from(base_stmt.subquery())
    )
    avg_confidence = avg_conf_result.scalar()

    avg_ms_result = await db.execute(
        select(func.avg(RecognitionEvent.processing_ms)).select_from(base_stmt.subquery())
    )
    avg_processing_ms = avg_ms_result.scalar()

    return RecognitionMetrics(
        total_events=total_events,
        matched=matched,
        unknown=unknown,
        avg_confidence=round(avg_confidence, 4) if avg_confidence else None,
        avg_processing_ms=round(avg_processing_ms, 1) if avg_processing_ms else None,
    )


@router.get("/recognition/events", response_model=PaginatedResponse[RecognitionEventOut])
async def list_recognition_events(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId,
    pagination: PaginationDep,
):
    stmt = select(RecognitionEvent)
    if org_id is not None:
        stmt = stmt.where(RecognitionEvent.organization_id == org_id)
    stmt = stmt.order_by(RecognitionEvent.recognized_at.desc())
    return await paginate(db, stmt, pagination.page, pagination.per_page, RecognitionEventOut)


@router.get("/recognition/events/{event_id}/snapshot")
async def get_event_snapshot(
    event_id: int,
    db: DbSession,
    user: require_permission("recognition.view"),
):
    stmt = select(RecognitionEvent).where(RecognitionEvent.id == event_id)
    result = await db.execute(stmt)
    event = result.scalar_one_or_none()
    if not event:
        raise NotFoundError("Event not found")
    if not event.snapshot_path:
        raise NotFoundError("No snapshot available")
    if not os.path.isfile(event.snapshot_path):
        raise NotFoundError("Snapshot file not found")
    return FileResponse(event.snapshot_path, media_type="image/jpeg")


@router.get("/recognition/unknown-summary", response_model=UnknownSummary)
async def get_unknown_summary(
    db: DbSession,
    user: require_permission("recognition.view"),
    org_id: TenantOrgId = None,
):
    base_stmt = select(RecognitionEvent).where(RecognitionEvent.result == "unknown")
    if org_id is not None:
        base_stmt = base_stmt.where(RecognitionEvent.organization_id == org_id)

    total_result = await db.execute(
        select(func.count()).select_from(base_stmt.subquery())
    )
    total_unknown = total_result.scalar() or 0

    now = datetime.now(timezone.utc)

    stmt_24h = base_stmt.where(RecognitionEvent.recognized_at >= now - timedelta(hours=24))
    result_24h = await db.execute(
        select(func.count()).select_from(stmt_24h.subquery())
    )
    last_24h = result_24h.scalar() or 0

    stmt_7d = base_stmt.where(RecognitionEvent.recognized_at >= now - timedelta(days=7))
    result_7d = await db.execute(
        select(func.count()).select_from(stmt_7d.subquery())
    )
    last_7d = result_7d.scalar() or 0

    return UnknownSummary(
        total_unknown=total_unknown,
        last_24h=last_24h,
        last_7d=last_7d,
    )
