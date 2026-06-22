from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Query, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import Select, func, or_, select

from app.core.dependencies import DbSession, TenantScope, require_permission
from app.core.errors import ValidationError
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.middleware.tenant import as_scope_ids
from app.models.audit import AuditLog
from app.models.organization import Organization
from app.models.user import User
from app.services import audit_export
from app.services.report_export import ExportContext, MEDIA_TYPES

router = APIRouter(prefix="/api/v1", tags=["audit"])

# Export ceilings: the renderers are CPU-bound and run per-row, so cap by row
# count. CSV is a cheap stream; Excel styles every cell and gets a lower cap.
MAX_EXPORT_ROWS = {"csv": 50_000, "xlsx": 10_000}

TzOffsetQuery = Query(0, ge=-840, le=840, description="JS Date.getTimezoneOffset() of the viewer")


class AuditActorOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    email: str


class AuditLogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int | None = None
    user: AuditActorOut | None = None
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    old_values: dict | None = None
    new_values: dict | None = None
    created_at: datetime | None = None


class AuditStatsOut(BaseModel):
    total: int
    today: int
    actors: int
    action_types: int


class AuditFacetsOut(BaseModel):
    actions: list[str]
    entity_types: list[str]
    actors: list[AuditActorOut]


def _day_start_utc(day: date, tz_offset: int) -> datetime:
    """UTC instant of the viewer-local midnight (offset = UTC minus local, minutes)."""
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(
        minutes=tz_offset
    )


def _apply_filters(
    stmt: Select,
    *,
    action: str | None,
    entity_type: str | None,
    user_id: int | None,
    q: str | None,
    date_from: date | None,
    date_to: date | None,
    tz_offset: int,
) -> Select:
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if date_from and date_to and date_from > date_to:
        raise ValidationError("date_from must not be after date_to")
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= _day_start_utc(date_from, tz_offset))
    if date_to:
        stmt = stmt.where(
            AuditLog.created_at < _day_start_utc(date_to + timedelta(days=1), tz_offset)
        )
    if q:
        like = f"%{q}%"
        conditions = [
            AuditLog.action.ilike(like),
            AuditLog.entity_type.ilike(like),
            AuditLog.ip_address.ilike(like),
            User.name.ilike(like),
            User.email.ilike(like),
        ]
        if q.isdigit():
            conditions.append(AuditLog.entity_id == int(q))
        stmt = stmt.outerjoin(User, AuditLog.user_id == User.id).where(or_(*conditions))
    return stmt


@router.get("/audit-logs", response_model=PaginatedResponse[AuditLogOut])
async def list_audit_logs(
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("audit.view"),
    pagination: PaginationDep,
    action: str | None = Query(None),
    entity_type: str | None = Query(None),
    user_id: int | None = Query(None),
    q: str | None = Query(None, max_length=255, description="Search action, entity, IP or actor"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    tz_offset: int = TzOffsetQuery,
):
    stmt = select(AuditLog).order_by(AuditLog.id.desc())
    stmt = _apply_filters(
        stmt,
        action=action,
        entity_type=entity_type,
        user_id=user_id,
        q=q,
        date_from=date_from,
        date_to=date_to,
        tz_offset=tz_offset,
    )
    return await paginate(db, stmt, pagination.page, pagination.per_page, AuditLogOut)


@router.get("/audit-logs/stats", response_model=AuditStatsOut)
async def audit_log_stats(
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("audit.view"),
    tz_offset: int = TzOffsetQuery,
):
    """Trail-wide totals for the stat cards (independent of list filters)."""
    total, actors, action_types, system = (
        await db.execute(
            select(
                func.count(AuditLog.id),
                func.count(func.distinct(AuditLog.user_id)),
                func.count(func.distinct(AuditLog.action)),
                func.count(AuditLog.id).filter(AuditLog.user_id.is_(None)),
            )
        )
    ).one()

    local_today = (datetime.now(timezone.utc) - timedelta(minutes=tz_offset)).date()
    today = (
        await db.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.created_at >= _day_start_utc(local_today, tz_offset)
            )
        )
    ).scalar() or 0

    return AuditStatsOut(
        total=total or 0,
        today=today,
        # Count "System" as one actor when unattributed events exist.
        actors=(actors or 0) + (1 if system else 0),
        action_types=action_types or 0,
    )


@router.get("/audit-logs/facets", response_model=AuditFacetsOut)
async def audit_log_facets(
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("audit.view"),
):
    """Distinct filter options actually present in the trail."""
    actions = (
        (await db.execute(select(AuditLog.action).distinct().order_by(AuditLog.action)))
        .scalars()
        .all()
    )
    entity_types = (
        (
            await db.execute(
                select(AuditLog.entity_type)
                .where(AuditLog.entity_type.is_not(None))
                .distinct()
                .order_by(AuditLog.entity_type)
            )
        )
        .scalars()
        .all()
    )
    actors = (
        (
            await db.execute(
                select(User)
                .where(User.id.in_(select(AuditLog.user_id).where(AuditLog.user_id.is_not(None))))
                .order_by(User.name)
            )
        )
        .scalars()
        .all()
    )
    return AuditFacetsOut(
        actions=list(actions),
        entity_types=list(entity_types),
        actors=[AuditActorOut.model_validate(u) for u in actors],
    )


@router.get("/audit-logs/export")
async def export_audit_logs(
    db: DbSession,
    org_id: TenantScope,
    _: require_permission("audit.view"),
    export_format: Literal["csv", "xlsx"] = Query("csv", alias="format"),
    action: str | None = Query(None),
    entity_type: str | None = Query(None),
    user_id: int | None = Query(None),
    q: str | None = Query(None, max_length=255),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    tz_offset: int = TzOffsetQuery,
):
    """Download the (filtered) audit trail as CSV or a styled Excel workbook."""
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(MAX_EXPORT_ROWS[export_format])
    stmt = _apply_filters(
        stmt,
        action=action,
        entity_type=entity_type,
        user_id=user_id,
        q=q,
        date_from=date_from,
        date_to=date_to,
        tz_offset=tz_offset,
    )
    logs = list((await db.execute(stmt)).scalars().all())

    # The export header carries a single org label. With a multi-org read scope
    # the trail spans several companies, so only stamp a name when the scope
    # resolves to exactly one root; otherwise leave it None (same as a global
    # super admin's trail-wide export).
    org_name = None
    scope_ids = as_scope_ids(org_id)
    if scope_ids is not None and len(scope_ids) == 1:
        org_name = (
            await db.execute(
                select(Organization.name).where(Organization.id == scope_ids[0])
            )
        ).scalar_one_or_none()
    ctx = ExportContext(
        org_name=org_name,
        generated_at=datetime.now(timezone.utc),
        tz_offset=tz_offset,
    )

    # Rendering (openpyxl) is CPU-bound — keep it off the event loop.
    content = await run_in_threadpool(audit_export.export_audit_logs, logs, export_format, ctx)

    local_stamp = (ctx.generated_at - timedelta(minutes=tz_offset)).strftime("%Y%m%d-%H%M")
    basename = f"audit-trail-{local_stamp}"
    return Response(
        content=content,
        media_type=MEDIA_TYPES[export_format],
        headers={"Content-Disposition": f'attachment; filename="{basename}.{export_format}"'},
    )
