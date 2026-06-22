from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.dependencies import DbSession, TenantNodeScope, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.realtime.hub import emit
from app.schemas.attendance import (
    AnomalyDetectRequest,
    AnomalyDetectResponse,
    AnomalyOut,
    AnomalySummary,
    AnomalyUpdateRequest,
)
from app.services import anomaly_service

router = APIRouter(prefix="/api/v1", tags=["anomalies"])


@router.get("/anomalies/summary", response_model=AnomalySummary)
async def anomaly_summary(
    db: DbSession,
    org_id: TenantNodeScope,
    user: require_permission("reports.view"),
):
    return await anomaly_service.summary(db, org_id)


@router.get("/anomalies", response_model=PaginatedResponse[AnomalyOut])
async def list_anomalies(
    db: DbSession,
    org_id: TenantNodeScope,
    user: require_permission("reports.view"),
    pagination: PaginationDep,
    status: str | None = Query(None),
    severity: str | None = Query(None),
    employee_id: int | None = Query(None),
    anomaly_type: str | None = Query(None),
):
    stmt = anomaly_service.anomalies_query(
        org_id,
        status=status,
        severity=severity,
        employee_id=employee_id,
        anomaly_type=anomaly_type,
    )
    return await paginate(db, stmt, pagination.page, pagination.per_page, AnomalyOut)


@router.post("/anomalies/detect", response_model=AnomalyDetectResponse)
async def detect_anomalies(
    body: AnomalyDetectRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("attendance.manage"),
):
    result = await anomaly_service.run_anomaly_detection(
        db,
        org_id=org_id,
        employee_ids=body.employee_ids,
        lookback_days=body.lookback_days,
    )
    if result["anomalies_detected"]:
        await emit(
            org_id,
            "anomalies.changed",
            {"detection_run_id": result["detection_run_id"], "count": result["anomalies_detected"]},
        )
    return AnomalyDetectResponse(success=True, **result)


@router.patch("/anomalies/{anomaly_id}", response_model=AnomalyOut)
async def update_anomaly(
    anomaly_id: int,
    body: AnomalyUpdateRequest,
    db: DbSession,
    org_id_tenant: TenantOrgId,
    user: require_permission("attendance.manage"),
):
    anomaly, org_id = await anomaly_service.update_anomaly(
        db, anomaly_id, body, user.id, org_id_tenant
    )
    await emit(org_id, "anomalies.changed", {"anomaly_id": anomaly.id})
    return AnomalyOut.model_validate(anomaly, from_attributes=True)
