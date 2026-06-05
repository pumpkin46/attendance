from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.core.dependencies import DbSession, TenantOrgId, require_permission
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.schemas.report import (
    AttendanceSummaryReport,
    DailyReport,
    MonthlyReport,
    OvertimeReport,
    UnknownPersonEvent,
)
from app.services import report_service

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/daily", response_model=DailyReport)
async def daily_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    report_date: date = Query(None, alias="date"),
    location_id: int | None = Query(None),
):
    return await report_service.daily_report(db, org_id, report_date or date.today(), location_id)


@router.get("/monthly", response_model=MonthlyReport)
async def monthly_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    year: int | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
    location_id: int | None = Query(None),
):
    today = date.today()
    return await report_service.monthly_report(
        db, org_id, year if year is not None else today.year,
        month if month is not None else today.month, location_id,
    )


@router.get("/attendance-summary", response_model=AttendanceSummaryReport)
async def attendance_summary(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    start_date: date = Query(..., alias="start"),
    end_date: date = Query(..., alias="end"),
):
    return await report_service.attendance_summary(db, org_id, start_date, end_date)


@router.get("/overtime", response_model=OvertimeReport)
async def overtime_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    start_date: date = Query(..., alias="start"),
    end_date: date = Query(..., alias="end"),
):
    return await report_service.overtime_report(db, org_id, start_date, end_date)


@router.get("/unknown-persons", response_model=PaginatedResponse[UnknownPersonEvent])
async def unknown_persons_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.view"),
    pagination: PaginationDep,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
):
    stmt = report_service.unknown_persons_query(org_id, date_from, date_to)
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page.data = [report_service.format_unknown_person_event(e) for e in page.data]
    return page


@router.get("/export")
async def export_report(
    db: DbSession,
    org_id: TenantOrgId,
    _: require_permission("reports.export"),
    report_date: date = Query(None, alias="date"),
    start_date: date = Query(None, alias="start"),
    end_date: date = Query(None, alias="end"),
):
    target_start = start_date or report_date or date.today()
    target_end = end_date or report_date or date.today()
    csv_text = await report_service.attendance_export_csv(db, org_id, target_start, target_end)
    filename = f"attendance_{target_start}_{target_end}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
