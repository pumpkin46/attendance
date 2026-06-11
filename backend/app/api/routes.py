"""Recognition utility endpoints (embeddings, anomaly analysis, stream capture).

The recognize / identify / detect / enroll* / liveness-verify operations that
previously lived here are duplicated by the canonical routers and have been
removed:
  - recognition:  app/api/recognition.py  → /api/v1/recognition/*
  - enrollment:   app/api/enrollment.py   → /api/v1/enrollment/*, /employees/*/enroll-face-*

What remains here are the endpoints with no equivalent elsewhere: embedding
index export/import/reload, ad-hoc anomaly analysis, single-frame stream
capture, and embedding deletion. All are mounted under /api/v1.
"""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.core.dependencies import CurrentUser, require_permission
from app.core.errors import ValidationError
from app.schemas.recognition import (
    AnomalyAnalyzeRequest,
    AnomalyAnalyzeResponse,
    DeleteRequest,
    DeleteResponse,
    EmbeddingExportResponse,
    EmbeddingImportRequest,
    EmbeddingImportResponse,
    StreamCaptureRequest,
    StreamCaptureResponse,
)
from app.services import face_service
from app.services.anomaly_detector import analyze_records
from app.services.stream_capture import capture_stream_frame

router = APIRouter(prefix="/api/v1")


@router.post("/capture-stream", response_model=StreamCaptureResponse)
async def capture_stream(req: StreamCaptureRequest, user: require_permission("cameras.manage")):
    result = await run_in_threadpool(capture_stream_frame, req.stream_url)
    if not result.get("success"):
        raise ValidationError(result.get("error", "Stream capture failed"))
    return StreamCaptureResponse(**result)


@router.get("/embeddings/export", response_model=EmbeddingExportResponse)
async def export_embeddings(user: require_permission("recognition.manage")):
    result = await run_in_threadpool(face_service.export_embeddings)
    return EmbeddingExportResponse(**result)


@router.post("/embeddings/import", response_model=EmbeddingImportResponse)
async def import_embeddings(req: EmbeddingImportRequest, user: require_permission("recognition.manage")):
    result = await run_in_threadpool(
        face_service.import_embeddings, req.index_b64, req.metadata
    )
    return EmbeddingImportResponse(**result)


@router.post("/embeddings/reload", response_model=EmbeddingImportResponse)
async def reload_embeddings(user: require_permission("recognition.manage")):
    result = await run_in_threadpool(face_service.reload_embeddings)
    return EmbeddingImportResponse(**result)


@router.post("/anomalies/analyze", response_model=AnomalyAnalyzeResponse)
async def analyze_anomalies(req: AnomalyAnalyzeRequest, user: CurrentUser):
    records = [r.model_dump() for r in req.records]
    result = await run_in_threadpool(analyze_records, records, req.config)
    return AnomalyAnalyzeResponse(**result)


@router.post("/delete", response_model=DeleteResponse)
async def delete_embedding(req: DeleteRequest, user: require_permission("employees.manage")):
    result = await run_in_threadpool(face_service.delete_employee, req.employee_id)
    return DeleteResponse(**result)
