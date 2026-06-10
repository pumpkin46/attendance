from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import lazyload

from app.core.dependencies import DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, paginate, PaginationDep
from app.models.audit import AuditLog

router = APIRouter(prefix="/api/v1", tags=["audit"])


class AuditLogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int | None = None
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    old_values: dict | None = None
    new_values: dict | None = None
    created_at: datetime | None = None


@router.get("/audit-logs", response_model=PaginatedResponse[AuditLogOut])
async def list_audit_logs(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("audit.view"),
    pagination: PaginationDep,
    action: str | None = Query(None),
    entity_type: str | None = Query(None),
):
    # AuditLogOut is flat (user_id only); skip the lazy="selectin" user load.
    stmt = select(AuditLog).options(lazyload(AuditLog.user)).order_by(AuditLog.id.desc())

    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)

    return await paginate(db, stmt, pagination.page, pagination.per_page, AuditLogOut)
