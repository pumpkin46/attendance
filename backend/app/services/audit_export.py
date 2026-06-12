"""Audit-trail exports (CSV / Excel) for the compliance audit log.

Pure presentation, mirroring ``report_export``: the export endpoint passes the
same ``AuditLog`` rows the page renders and this module turns them into bytes.
CSV is machine-readable (ISO-8601 timestamps localized via ``tz_offset``,
JSON-encoded value payloads); Excel is a print-ready presentation document
reusing the report scaffold (title band, KPI cards, frozen/filterable header).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from app.services.report_export import (
    ExportContext,
    _csv_bytes,
    _iso_local,
    _xlsx_bytes,
    _xlsx_scaffold,
    _xlsx_table,
)

if TYPE_CHECKING:
    from app.models.audit import AuditLog

_HEADERS = (
    "ID", "Timestamp", "Actor", "Actor Email", "Action", "Entity Type",
    "Entity ID", "IP Address", "User Agent", "Old Values", "New Values",
)
_ALIGNS = "RLLLLLRLLLL"
_XLSX_WIDTHS = (7, 21, 20, 26, 24, 13, 9, 15, 34, 38, 38)


def _json_cell(values: dict | None) -> str:
    return json.dumps(values, ensure_ascii=True, sort_keys=True) if values else ""


def _rows(logs: list["AuditLog"], ctx: ExportContext) -> list[list[object]]:
    return [
        [
            log.id,
            _iso_local(log.created_at, ctx),
            log.user.name if log.user else "System",
            log.user.email if log.user else "",
            log.action,
            log.entity_type or "",
            log.entity_id if log.entity_id is not None else "",
            log.ip_address or "",
            log.user_agent or "",
            _json_cell(log.old_values),
            _json_cell(log.new_values),
        ]
        for log in logs
    ]


def _kpis(logs: list["AuditLog"]) -> list[tuple[str, str]]:
    actors = {log.user_id for log in logs if log.user_id is not None}
    system = any(log.user_id is None for log in logs)
    return [
        ("Events", str(len(logs))),
        ("Actors", str(len(actors) + (1 if system else 0))),
        ("Action types", str(len({log.action for log in logs}))),
        ("Entity types", str(len({log.entity_type for log in logs if log.entity_type}))),
    ]


def _subtitle(logs: list["AuditLog"], ctx: ExportContext) -> str:
    stamps = [log.created_at for log in logs if log.created_at is not None]
    if not stamps:
        return "No events"
    # Rows arrive newest-first; min/max keeps this order-independent.
    first = _iso_local(min(stamps), ctx)[:10]
    last = _iso_local(max(stamps), ctx)[:10]
    return first if first == last else f"{first} - {last}"


def export_audit_logs(logs: list["AuditLog"], fmt: str, ctx: ExportContext) -> bytes:
    if fmt == "csv":
        return _csv_bytes(list(_HEADERS), _rows(logs, ctx))
    if fmt == "xlsx":
        return _render_xlsx(logs, ctx)
    raise ValueError(f"Unsupported audit export format: {fmt}")


def _render_xlsx(logs: list["AuditLog"], ctx: ExportContext) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Audit Trail"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"

    start = _xlsx_scaffold(
        ws, len(_HEADERS), "Audit Trail", _subtitle(logs, ctx), ctx, _kpis(logs)
    )
    _xlsx_table(
        ws,
        start,
        list(_HEADERS),
        _rows(logs, ctx),
        _ALIGNS,
        list(_XLSX_WIDTHS),
        status_col=None,
        totals=None,
    )
    return _xlsx_bytes(wb)
