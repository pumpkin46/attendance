"""Security-alert exports (CSV / Excel / PDF) for the AI security reports page.

Pure presentation, mirroring ``audit_export``: the export endpoint passes the
same filtered ``SecurityAlert`` rows the page renders and this module turns
them into bytes. CSV is machine-readable (ISO-8601 timestamps localized via
``tz_offset``); Excel and PDF reuse the report scaffold (title band, KPI
cards, severity-colored rows, frozen/filterable header, page footer).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from app.services.report_export import (
    ExportContext,
    _csv_bytes,
    _iso_local,
    _pdf_bytes,
    _xlsx_bytes,
    _xlsx_scaffold,
    _xlsx_table,
)

if TYPE_CHECKING:
    from app.models.security import SecurityAlert

_TITLE = "AI Security Alerts"

_HEADERS = (
    "ID", "Occurred", "Type", "Severity", "Title", "Description",
    "Camera", "Employee", "Status", "Acknowledged", "Resolved", "Details",
)
_ALIGNS = "RLLLLLLLLLLL"
_XLSX_WIDTHS = (7, 21, 18, 10, 30, 42, 18, 22, 13, 21, 21, 36)
# 1-based index of the Severity column for the colored-cell treatment.
_XLSX_SEVERITY_COL = 4

# The PDF is a print document — condensed columns so rows stay readable.
_PDF_HEADERS = ("Occurred", "Type", "Severity", "Title", "Description", "Camera", "Employee", "Status")
_PDF_ALIGNS = "LLLLLLLL"
_PDF_WIDTHS = (14.5, 12, 9, 20, 28, 11, 13, 9)
_PDF_SEVERITY_COL = 2  # 0-based, per the PDF renderer's contract


def _plain(value: object) -> str:
    """Enum members come back from the ORM; exports speak plain strings."""
    return str(getattr(value, "value", value) or "")


def _employee_name(alert: "SecurityAlert") -> str:
    e = alert.employee
    return f"{e.first_name} {e.last_name}" if e else ""


def _rows(alerts: list["SecurityAlert"], ctx: ExportContext) -> list[list[object]]:
    return [
        [
            a.id,
            _iso_local(a.occurred_at, ctx),
            a.alert_type,
            _plain(a.severity),
            a.title,
            a.message or "",
            a.camera.name if a.camera else "",
            _employee_name(a),
            _plain(a.status),
            _iso_local(a.acknowledged_at, ctx),
            _iso_local(a.resolved_at, ctx),
            json.dumps(a.meta, ensure_ascii=True, sort_keys=True) if a.meta else "",
        ]
        for a in alerts
    ]


def _kpis(alerts: list["SecurityAlert"]) -> list[tuple[str, str]]:
    by_status = [_plain(a.status) for a in alerts]
    high = sum(1 for a in alerts if _plain(a.severity) in ("critical", "high"))
    return [
        ("Alerts", str(len(alerts))),
        ("Open", str(by_status.count("open"))),
        ("Critical / High", str(high)),
        ("Resolved", str(by_status.count("resolved"))),
    ]


def _subtitle(alerts: list["SecurityAlert"], ctx: ExportContext) -> str:
    stamps = [a.occurred_at for a in alerts if a.occurred_at is not None]
    if not stamps:
        return "No alerts"
    first = _iso_local(min(stamps), ctx)[:10]
    last = _iso_local(max(stamps), ctx)[:10]
    return first if first == last else f"{first} - {last}"


def export_security_alerts(
    alerts: list["SecurityAlert"], fmt: str, ctx: ExportContext
) -> bytes:
    if fmt == "csv":
        return _csv_bytes(list(_HEADERS), _rows(alerts, ctx))
    if fmt == "xlsx":
        return _render_xlsx(alerts, ctx)
    if fmt == "pdf":
        return _render_pdf(alerts, ctx)
    raise ValueError(f"Unsupported security export format: {fmt}")


def _render_xlsx(alerts: list["SecurityAlert"], ctx: ExportContext) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Security Alerts"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"

    start = _xlsx_scaffold(
        ws, len(_HEADERS), _TITLE, _subtitle(alerts, ctx), ctx, _kpis(alerts)
    )
    _xlsx_table(
        ws,
        start,
        list(_HEADERS),
        _rows(alerts, ctx),
        _ALIGNS,
        list(_XLSX_WIDTHS),
        status_col=_XLSX_SEVERITY_COL,
        totals=None,
        status_keys=[_plain(a.severity) for a in alerts],
    )
    return _xlsx_bytes(wb)


def _pdf_stamp(value, ctx: ExportContext) -> str:
    """Compact viewer-local timestamp for the print layout."""
    iso = _iso_local(value, ctx)
    return iso[:16].replace("T", " ") if iso else ""


def _pdf_rows(alerts: list["SecurityAlert"], ctx: ExportContext) -> list[list[str]]:
    return [
        [
            _pdf_stamp(a.occurred_at, ctx),
            a.alert_type.replace("_", " "),
            _plain(a.severity).capitalize(),
            a.title,
            a.message or "",
            a.camera.name if a.camera else "-",
            _employee_name(a) or "-",
            _plain(a.status).capitalize(),
        ]
        for a in alerts
    ]


def _render_pdf(alerts: list["SecurityAlert"], ctx: ExportContext) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape

    return _pdf_bytes(
        _TITLE,
        _subtitle(alerts, ctx),
        ctx,
        _kpis(alerts),
        list(_PDF_HEADERS),
        _pdf_rows(alerts, ctx),
        col_widths=list(_PDF_WIDTHS),
        aligns=_PDF_ALIGNS,
        status_col=_PDF_SEVERITY_COL,
        totals=None,
        pagesize=landscape(A4),
        status_keys=[_plain(a.severity) for a in alerts],
    )
