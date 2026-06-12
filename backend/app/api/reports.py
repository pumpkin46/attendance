from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Query, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.core.dependencies import DbSession, TenantOrgId, require_permission
from app.core.errors import ValidationError
from app.core.timeutil import local_date
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.models.organization import Organization
from app.schemas.report import UnknownPersonEvent, UnknownPersonsSummary
from app.services import report_export, report_service

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/unknown-persons", response_model=PaginatedResponse[UnknownPersonEvent])
async def unknown_persons_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    pagination: PaginationDep,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    camera_id: int | None = Query(None),
    alerts_only: bool = Query(False),
):
    stmt = report_service.unknown_persons_query(org_id, date_from, date_to, camera_id, alerts_only)
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page.data = [report_service.format_unknown_person_event(e) for e in page.data]
    return page


@router.get("/unknown-persons/summary", response_model=UnknownPersonsSummary)
async def unknown_persons_summary(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
):
    """Range-wide totals for the Unknown Faces stat cards and camera filter."""
    return await report_service.unknown_persons_summary(db, org_id, date_from, date_to)


# Hard ceiling on the attendance-export window: the renderers are CPU-bound
# and the query is unbounded by row count, so cap by time span instead.
MAX_EXPORT_RANGE_DAYS = 366


@router.get("/export")
async def export_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.export"),
    export_format: Literal["csv", "xlsx", "pdf"] = Query("csv", alias="format"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    legacy_start: date | None = Query(
        None, alias="start", deprecated=True, description="Deprecated alias for date_from"
    ),
    legacy_end: date | None = Query(
        None, alias="end", deprecated=True, description="Deprecated alias for date_to"
    ),
    tz_offset: int = Query(0, ge=-840, le=840, description="JS Date.getTimezoneOffset() of the viewer"),
):
    """Download the attendance records over a range as a styled CSV, Excel, or PDF file."""
    date_from = date_from or legacy_start
    date_to = date_to or legacy_end

    today = local_date()
    start = date_from or today
    end = date_to or today
    if start > end:
        raise ValidationError("date_from must not be after date_to")
    if (end - start).days > MAX_EXPORT_RANGE_DAYS:
        raise ValidationError(f"Export range is limited to {MAX_EXPORT_RANGE_DAYS} days")

    org_name = None
    if org_id is not None:
        org_name = (
            await db.execute(select(Organization.name).where(Organization.id == org_id))
        ).scalar_one_or_none()
    ctx = report_export.ExportContext(
        org_name=org_name,
        generated_at=datetime.now(timezone.utc),
        tz_offset=tz_offset,
    )

    report = await report_service.attendance_range_report(db, org_id, start, end)
    # Rendering (openpyxl/reportlab) is CPU-bound — keep it off the event loop.
    content = await run_in_threadpool(report_export.export_attendance, report, export_format, ctx)
    basename = f"attendance-{start.isoformat()}-to-{end.isoformat()}"

    return Response(
        content=content,
        media_type=report_export.MEDIA_TYPES[export_format],
        headers={"Content-Disposition": f'attachment; filename="{basename}.{export_format}"'},
    )
