"""Unit tests for the styled attendance report exports (CSV / Excel / PDF)."""

from datetime import date, datetime, timezone

import pytest

from app.schemas.report import AttendanceRangeEntry, AttendanceRangeReport
from app.services import report_export


@pytest.fixture
def ctx() -> report_export.ExportContext:
    # Viewer at UTC+2 (JS getTimezoneOffset() = -120).
    return report_export.ExportContext(
        org_name="Acme Corp",
        generated_at=datetime(2026, 6, 11, 14, 30, tzinfo=timezone.utc),
        tz_offset=-120,
    )


@pytest.fixture
def attendance_range() -> AttendanceRangeReport:
    return AttendanceRangeReport(
        period_start=date(2026, 6, 4),
        period_end=date(2026, 6, 11),
        total_records=2,
        present=1,
        late_or_early=1,
        worked_minutes=943,
        overtime_minutes=35,
        entries=[
            AttendanceRangeEntry(
                work_date=date(2026, 6, 11),
                employee_code="EMP001",
                employee_name="Maria Garcia",
                department="Engineering",
                status="present",
                check_in_at=datetime(2026, 6, 11, 6, 58, tzinfo=timezone.utc),
                check_out_at=datetime(2026, 6, 11, 15, 35, tzinfo=timezone.utc),
                worked_minutes=485,
                overtime_minutes=35,
            ),
            AttendanceRangeEntry(
                work_date=date(2026, 6, 10),
                employee_code="EMP002",
                employee_name="Jan Novak",
                status="late",
                attendance_type="manual",
                check_in_at=datetime(2026, 6, 10, 7, 24, tzinfo=timezone.utc),
                check_out_at=datetime(2026, 6, 10, 15, 2, tzinfo=timezone.utc),
                worked_minutes=458,
                overtime_minutes=0,
            ),
        ],
    )


def test_attendance_export_all_formats(attendance_range, ctx):
    csv_data = report_export.export_attendance(attendance_range, "csv", ctx)
    assert csv_data.startswith(b"\xef\xbb\xbf")
    text = csv_data.decode("utf-8-sig")
    assert "Employee Code" in text
    assert "08:58" in text  # viewer TZ (UTC+2)
    assert "manual" in text  # attendance_type column

    xlsx_data = report_export.export_attendance(attendance_range, "xlsx", ctx)
    assert xlsx_data[:2] == b"PK"
    import io

    from openpyxl import load_workbook

    ws = load_workbook(io.BytesIO(xlsx_data)).active
    assert ws["A1"].value == "Attendance Report"

    pdf_data = report_export.export_attendance(attendance_range, "pdf", ctx)
    assert pdf_data[:5] == b"%PDF-"


def test_csv_is_utf8_bom_with_viewer_times(attendance_range, ctx):
    data = report_export.export_attendance(attendance_range, "csv", ctx)
    assert data.startswith(b"\xef\xbb\xbf")
    text = data.decode("utf-8-sig")
    # 06:58 UTC rendered for a UTC+2 viewer.
    assert "08:58" in text
    assert "EMP002" in text


def test_renders_with_no_records(ctx):
    empty = AttendanceRangeReport(
        period_start=date(2026, 6, 11),
        period_end=date(2026, 6, 11),
        total_records=0,
        present=0,
        late_or_early=0,
        worked_minutes=0,
        overtime_minutes=0,
        entries=[],
    )
    assert report_export.export_attendance(empty, "pdf", ctx)[:5] == b"%PDF-"
    assert report_export.export_attendance(empty, "xlsx", ctx)[:2] == b"PK"


def test_naive_datetimes_treated_as_utc(attendance_range, ctx):
    attendance_range.entries[0].check_in_at = datetime(2026, 6, 11, 6, 58)  # naive
    text = report_export.export_attendance(attendance_range, "csv", ctx).decode("utf-8-sig")
    assert "08:58" in text
